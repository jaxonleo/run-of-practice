-- Entitlement architecture, Phase 5: the admin lookup RPCs backing the
-- QA/founder entitlement simulator (admin_find_user_by_email,
-- admin_list_organizations, and the widened admin_get_entitlements shape).
begin;
select plan(9);

-- Non-admin refusal, all three.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select throws_like(
  $$select public.admin_find_user_by_email('test-coach-b@example.com')$$,
  'not authorized', 'a non-admin cannot look up a user by email'
);
select throws_like(
  $$select public.admin_list_organizations()$$,
  'not authorized', 'a non-admin cannot list organizations'
);
select throws_like(
  $$select public.admin_get_entitlements('user', 'a0000000-0000-0000-0000-000000000002', null)$$,
  'not authorized', 'a non-admin cannot call admin_get_entitlements'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- The real admin.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000005', true);

select is(
  (select id from public.admin_find_user_by_email('test-coach-b@example.com')),
  'a0000000-0000-0000-0000-000000000002'::uuid,
  'admin_find_user_by_email finds the right user, case-insensitively matched on a lowercase query'
);
select is(
  (select count(*)::int from public.admin_find_user_by_email('no-such-account@example.com')),
  0, 'a non-existent email returns zero rows, not an error'
);
select is(
  (select count(*)::int from public.admin_list_organizations() where name = 'Test Org'),
  1, 'admin_list_organizations includes the seeded Test Org'
);

-- admin_get_entitlements' widened shape: plan_bundle_key/cohort_bundle_key/
-- overrides/resolved, not just a bare resolved map.
select is(
  public.admin_get_entitlements('user', 'a0000000-0000-0000-0000-000000000001', null) ->> 'plan_bundle_key',
  'free', 'admin_get_entitlements reports coach A''s real stored plan_bundle_key'
);
select is(
  public.admin_get_entitlements('user', 'a0000000-0000-0000-0000-000000000001', null) ->> 'cohort_bundle_key',
  'early_access_all_access', 'admin_get_entitlements reports coach A''s real stored cohort_bundle_key'
);

-- Grant a real override, then confirm it shows up in the overrides array
-- (not just in the already-tested resolved map).
select public.admin_grant_override('user', 'a0000000-0000-0000-0000-000000000001', null, 'goals.access', 'locked', null, 'test: override visibility');
select is(
  jsonb_array_length(public.admin_get_entitlements('user', 'a0000000-0000-0000-0000-000000000001', null) -> 'overrides'),
  1, 'a granted override appears in admin_get_entitlements'' own overrides array'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
