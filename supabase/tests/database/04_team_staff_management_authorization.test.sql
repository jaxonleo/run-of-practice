-- team_staff_insert_manage's WITH CHECK is can_manage_team(team_id), which
-- requires being the team's owner, an org admin, or a team_staff row with
-- role='head_coach' -- deliberately NOT satisfied by can_build_practices
-- alone. This is exactly the distinction the Multi-Coach Builder feature
-- (forty-eighth session, BUILD-STATUS.md) was built to keep separate:
-- being delegated planning rights on individual stations is not the same
-- permission as being able to manage the team's own coaching staff. An
-- assistant with can_build_practices=true should still be unable to add a
-- new coach to the roster.
begin;
select plan(3);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ insert into public.team_staff (team_id, first_name, last_name, role, invite_email) values ('b0000000-0000-0000-0000-000000000001', 'New', 'Coach', 'assistant_coach', 'newcoach@example.com') $$,
  'the team''s own head coach can add a new staff member'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', true);
select throws_like(
  $$ insert into public.team_staff (team_id, first_name, last_name, role, invite_email) values ('b0000000-0000-0000-0000-000000000001', 'Another', 'Coach', 'assistant_coach', 'another@example.com') $$,
  '%row-level security%',
  'a delegated-build-rights assistant (not a head coach) cannot add staff -- can_build_practices is not can_manage_team'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select throws_like(
  $$ insert into public.team_staff (team_id, first_name, last_name, role, invite_email) values ('b0000000-0000-0000-0000-000000000001', 'Outsider', 'Coach', 'assistant_coach', 'outsider@example.com') $$,
  '%row-level security%',
  'an unrelated head coach cannot add staff to a team they do not manage'
);

select * from finish();
rollback;
