-- Entitlement architecture (Run_of_Practice_Entitlement_Architecture_Handoff.md,
-- 2026-09-18): resolution precedence (override > cohort > plan > registry
-- default), organization-scoped resolution, RLS isolation on the three new
-- subject tables, and admin-RPC authorization. Fixture: seed.sql's coach
-- A/B, the platform-admin user (a...0005), and Test Org (coach A directs
-- it, coach B is not a member).
begin;
select plan(23);

-- Every new signup gets a free plan_state row and an early_access_all_access
-- cohort row (the two triggers added in 20260918000200) -- confirmed for
-- coach A as coach A, exercising RLS's "select own" branch at the same time.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);

select is(
  (select plan_bundle_key from public.entitlement_plan_state where user_id = 'a0000000-0000-0000-0000-000000000001'),
  'free', 'coach A''s default plan_state row is free'
);
select is(
  (select cohort_bundle_key from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-000000000001'),
  'early_access_all_access', 'coach A''s default cohort is early_access_all_access'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Precedence, step by step. resolve_entitlement takes explicit subject
-- args (not auth.uid()), so these run without impersonating anyone.
select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000001', null, 'teams.personal_count') ->> 'state',
  'full', 'cohort (early_access_all_access) outranks the free plan''s real cap of 1'
);
select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000001', null, 'teams.personal_count') ->> 'source',
  'cohort', 'resolution source is correctly reported as cohort'
);

-- Override beats cohort.
insert into public.entitlement_overrides (subject_type, user_id, feature_key, state, reason)
values ('user', 'a0000000-0000-0000-0000-000000000001', 'teams.personal_count', 'locked', 'test: override precedence');

select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000001', null, 'teams.personal_count') ->> 'state',
  'locked', 'an individual override outranks even the early-access cohort'
);
select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000001', null, 'teams.personal_count') ->> 'source',
  'override', 'resolution source is correctly reported as override'
);

-- Plan beats registry default, once a subject has no cohort. Coach B loses
-- her cohort row for the rest of this test to exercise the plan tier and
-- (later) the admin RPCs cleanly -- rolled back with everything else.
delete from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-000000000002';

select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'delegation.practice_planning') ->> 'state',
  'locked', 'free plan (coach B''s plan_bundle_key) locks delegated planning, with no cohort to override it'
);
select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'delegation.practice_planning') ->> 'source',
  'plan', 'resolution source is correctly reported as plan'
);

-- Registry default: benchmarks.history has no bundle_features row on any
-- bundle (deliberately, per the handoff's own worked example) -- resolves
-- from features.default_state alone.
select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'benchmarks.history') ->> 'state',
  'full', 'an unpackaged feature resolves from the registry''s own default_state'
);
select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'benchmarks.history') ->> 'source',
  'default', 'resolution source is correctly reported as default'
);

-- can_access_feature() as the signed-in user (auth.uid()-based, unlike
-- resolve_entitlement's explicit-subject form).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select ok(
  public.can_access_feature('goals.access'),
  'can_access_feature() reads the caller''s own resolved entitlements via auth.uid()'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Organization-scoped resolution: Test Org has no cohort, so its
-- org_standard plan bundle resolves directly.
select is(
  public.resolve_entitlement('organization', null, '90000000-0000-0000-0000-000000000001', 'teams.personal_count') ->> 'state',
  'full', 'an organization''s org_standard plan bundle grants full, uncapped access'
);

-- get_organization_entitlements: real member succeeds, non-member is refused.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select is(
  public.get_organization_entitlements('90000000-0000-0000-0000-000000000001') -> 'teams.personal_count' ->> 'state',
  'full', 'an org member can fetch the org''s full resolved entitlement map'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select throws_like(
  $$select public.get_organization_entitlements('90000000-0000-0000-0000-000000000001')$$,
  'not authorized', 'a non-member is refused, not silently shown a partial/empty map'
);

-- RLS isolation: coach A cannot see coach B's plan_state row (still as
-- coach B from the block above, flip to coach A).
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*)::int from public.entitlement_plan_state where user_id = 'a0000000-0000-0000-0000-000000000002'),
  0, 'coach A cannot see coach B''s plan_state row'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Admin RPCs: a non-admin is refused...
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select throws_like(
  $$select public.admin_set_plan('user', 'a0000000-0000-0000-0000-000000000002', null, 'pro')$$,
  'not authorized', 'a non-admin coach cannot call admin_set_plan'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- ...the real admin succeeds, and the full override/cohort precedence
-- chain still holds when driven through the admin RPCs instead of a raw
-- insert/delete.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000005', true);

select public.admin_set_plan('user', 'a0000000-0000-0000-0000-000000000002', null, 'pro');
select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'goals.access') ->> 'state',
  'full', 'admin_set_plan moved coach B to pro, which grants goals.access'
);

select public.admin_grant_override('user', 'a0000000-0000-0000-0000-000000000002', null, 'goals.access', 'locked', null, 'test: support case');
select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'goals.access') ->> 'state',
  'locked', 'an admin-granted override still outranks the plan bundle'
);

select public.admin_revoke_override('user', 'a0000000-0000-0000-0000-000000000002', null, 'goals.access');
select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'goals.access') ->> 'state',
  'full', 'revoking the override falls back to the plan bundle, not to locked/hidden'
);

select public.admin_assign_cohort('user', 'a0000000-0000-0000-0000-000000000002', null, 'early_access_all_access', 'test: restore cohort');
select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'delegation.practice_planning') ->> 'state',
  'full', 'an admin-assigned cohort outranks pro''s own locked delegated-planning row'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Grants: the three subject tables follow user_entitlements' own
-- established pattern -- select-only for authenticated, nothing for anon,
-- server/admin-RPC-only writes.
-- Scoped to data-access privileges only, same convention
-- 05_grants_regression.test.sql already established -- REFERENCES/TRIGGER/
-- TRUNCATE are granted to anon on every table in this project by Supabase's
-- own default project setup (confirmed directly against profiles, not
-- something this migration introduced), so asserting their absence here
-- would just be a false alarm about a pre-existing, schema-wide condition.
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('entitlement_plan_state', 'entitlement_cohort_assignments', 'entitlement_overrides')
      and grantee = 'anon' and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  'anon has no data-level grant on any of the three entitlement subject tables'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('entitlement_plan_state', 'entitlement_cohort_assignments', 'entitlement_overrides')
      and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated has no insert/update/delete grant on any entitlement subject table -- admin RPCs are the only door in'
);
select ok(
  (
    select count(distinct table_name) from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('entitlement_plan_state', 'entitlement_cohort_assignments', 'entitlement_overrides')
      and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) = 3,
  'authenticated does have the real select access each of the three tables'' own RLS policies expect to gate'
);

select * from finish();
rollback;
