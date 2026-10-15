-- Free / Pro / Organization packaging, Phase E (2026-10-14): suspended
-- delegations (never cleared, restored on upgrade), the batched team plan
-- status read, and the coach's own active-team status. Fixture: coach A
-- (a...0001) owns Test Team A, where assistant Builder (a...0003, staff
-- f...0003) holds a can_build_practices grant. Everything rolls back.
begin;
select plan(9);

-- Founding: the delegate plans as before.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', true);
select ok(public.can_build_practice_for_team('b0000000-0000-0000-0000-000000000001'), 'a founding team''s delegate can plan');
reset role;

-- Coach A drops to Free: the grant is suspended, not cleared.
delete from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
select ok(not public.can_build_practice_for_team('b0000000-0000-0000-0000-000000000001'), 'on Free the delegation is suspended');
reset role;
select is((select can_build_practices from public.team_staff where id = 'f0000000-0000-0000-0000-000000000003'), true, 'the grant itself is untouched');

set local role authenticated;
select is(
  (select delegation_allowed from public.get_teams_plan_status(array['b0000000-0000-0000-0000-000000000001'::uuid])),
  false, 'get_teams_plan_status reports delegation not allowed on the Free team'
);
select is(
  (select plan_active from public.get_teams_plan_status(array['b0000000-0000-0000-0000-000000000001'::uuid])),
  true, 'and the owner''s only team is still active'
);
reset role;

-- Upgrade: the same grant works again with no re-granting.
update public.entitlement_plan_state set plan_bundle_key = 'pro' where user_id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
select ok(public.can_build_practice_for_team('b0000000-0000-0000-0000-000000000001'), 'on Pro the suspended grant is back');
reset role;
update public.entitlement_plan_state set plan_bundle_key = 'free' where user_id = 'a0000000-0000-0000-0000-000000000001';

-- The coach's own status, as coach A on Free with one team.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((public.get_my_team_plan_status() ->> 'limit')::int, 1, 'Free limit is 1');
select is((public.get_my_team_plan_status() ->> 'owned_active')::int, 1, 'coach A owns 1 active personal team');
select is(public.get_my_team_plan_status() ->> 'chosen_team_id', null, 'no active team chosen yet');
reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
