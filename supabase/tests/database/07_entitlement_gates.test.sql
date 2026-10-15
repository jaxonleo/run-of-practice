-- Entitlement architecture, Phase 3: the three real gates wired this
-- session (goals.access AND-gate, delegation.practice_planning count-gate,
-- library.personal_drills count-gate). Two things every gate here must
-- prove: it actually blocks a subject with no cohort at the free plan's
-- real limit, and it leaves every real seeded account (still carrying its
-- early_access_all_access cohort) completely unaffected -- the whole point
-- of wiring real enforcement before real billing exists.
begin;
select plan(11);

-- Gate 1: goals.access. can_view_goals_for_team already required
-- can_manage_team OR can_build_practice_for_team (role) -- confirm the new
-- plan AND-clause doesn't regress a real, cohort-covered head coach first.
-- can_manage_team itself reads auth.uid(), so every check here needs
-- coach A actually impersonated (set local role authenticated + the jwt
-- claim), reset back to postgres before any direct write to an
-- entitlement table -- authenticated has select-only there, on purpose.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select ok(
  public.can_view_goals_for_team('b0000000-0000-0000-0000-000000000001'),
  'coach A (real cohort intact) still sees Goals & Insights on her own team -- the new plan AND-gate changes nothing observable'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Drop coach A's cohort (rolled back with everything else in this file).
-- Since the 2026-10-14 packaging, Free includes goals.access, so the free
-- plan alone still lets her in; a locked override proves the AND-gate
-- itself still blocks.
delete from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select ok(
  public.can_view_goals_for_team('b0000000-0000-0000-0000-000000000001'),
  'with no cohort, the free plan now includes goals.access (Free flips to full, 2026-10-14)'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

insert into public.entitlement_overrides (subject_type, user_id, feature_key, state, reason)
values ('user', 'a0000000-0000-0000-0000-000000000001', 'goals.access', 'locked', 'test: AND-gate');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select ok(
  not public.can_view_goals_for_team('b0000000-0000-0000-0000-000000000001'),
  'a locked goals.access actually blocks -- the role check alone is not sufficient'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

delete from public.entitlement_overrides where user_id = 'a0000000-0000-0000-0000-000000000001' and feature_key = 'goals.access';

-- Moving coach A to pro (which grants goals.access) restores access without
-- restoring the cohort -- proves the plan tier itself, not just the
-- cohort, is a real path to access.
update public.entitlement_plan_state set plan_bundle_key = 'pro' where user_id = 'a0000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select ok(
  public.can_view_goals_for_team('b0000000-0000-0000-0000-000000000001'),
  'coach A on the pro plan (no cohort) sees Goals & Insights again -- goals.access is full on pro'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

update public.entitlement_plan_state set plan_bundle_key = 'free' where user_id = 'a0000000-0000-0000-0000-000000000001';

-- Gate 2: delegation.practice_planning. Coach A's team already has one
-- real delegate (assistant Builder, f...0003, seeded can_build_practices=true).
-- Coach A is still on free with no cohort from the block above -- free
-- locks this feature entirely, so granting a *second* delegate must fail.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select throws_like(
  $$select public.set_practice_delegate('f0000000-0000-0000-0000-000000000004', true)$$,
  'ENTITLEMENT_LIMIT:delegation.practice_planning',
  'granting a second delegate on the free plan (no cohort) is refused with the coded entitlement error'
);

-- Clearing a delegation is always allowed regardless of plan -- removing
-- access should never be plan-gated.
select public.set_practice_delegate('f0000000-0000-0000-0000-000000000003', false);
select is(
  (select can_build_practices from public.team_staff where id = 'f0000000-0000-0000-0000-000000000003'),
  false, 'clearing an existing delegation is never blocked by the plan gate'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Restore the fixture's original delegate directly (not through the gated
-- RPC -- coach A is still on free with no cohort at this point, so routing
-- this cleanup through set_practice_delegate would itself be refused; this
-- is fixture restoration, not something under test).
update public.team_staff set can_build_practices = true where id = 'f0000000-0000-0000-0000-000000000003';

-- Restore coach A's cohort -- pro_plus-equivalent (uncapped delegation) is
-- what proves the *upgrade path* works, not just that free is blocked.
insert into public.entitlement_cohort_assignments (subject_type, user_id, cohort_bundle_key, assigned_reason)
values ('user', 'a0000000-0000-0000-0000-000000000001', 'founding_coach', 'test: restore for later gates');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.set_practice_delegate('f0000000-0000-0000-0000-000000000004', true)$$,
  'with the cohort restored, granting a second delegate succeeds -- the gate reflects entitlement state live, not a cached decision'
);
select public.set_practice_delegate('f0000000-0000-0000-0000-000000000004', false);
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Gate 3: library.personal_drills. Free plan caps this at 20
-- (bundle_features), so can_create_personal_drill() must reflect the
-- caller's real current count. Coach A has zero personal drills in this
-- fixture (seed.sql never creates any), so at 20 existing rows the next
-- one must be refused, and below 20 it must be allowed. Coach A's cohort
-- is intact again from the restore above, so this exercises the plan's
-- real cap directly by moving her to free for this block only.
update public.entitlement_plan_state set plan_bundle_key = 'free' where user_id = 'a0000000-0000-0000-0000-000000000001';
delete from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-000000000001';

-- 19 existing personal drills, built as postgres (pure fixture setup,
-- bypasses RLS) -- one below the free plan's real cap of 20. Deliberately
-- never deletes from activity_library as authenticated below -- that role
-- has no DELETE grant on this table (drills are archived, not deleted,
-- same convention as everywhere else in this schema), so this only ever
-- inserts, matching what a real coach's own client actually does.
insert into public.activity_library (owner_user_id, sport, name)
select 'a0000000-0000-0000-0000-000000000001', 'Basketball', 'Fixture Drill ' || gs
from generate_series(1, 19) gs;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);

select ok(
  public.can_create_personal_drill(),
  'at 19 existing personal drills, one below the free plan''s cap of 20, creating one more is allowed'
);

select lives_ok(
  $$insert into public.activity_library (owner_user_id, sport, name)
    values ('a0000000-0000-0000-0000-000000000001', 'Basketball', 'The Twentieth')$$,
  'the RLS policy itself (not just the boolean helper) allows the 20th real insert, landing exactly on the cap'
);

select ok(
  not public.can_create_personal_drill(),
  'at exactly 20 (the real cap just reached), a 21st is correctly refused'
);

select throws_like(
  $$insert into public.activity_library (owner_user_id, sport, name)
    values ('a0000000-0000-0000-0000-000000000001', 'Basketball', 'One Too Many')$$,
  'ENTITLEMENT_LIMIT:library.personal_drills',
  'a real 21st insert is refused with the coded entitlement error (the cap trigger fires before the RLS policy, which still backs it up)'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
