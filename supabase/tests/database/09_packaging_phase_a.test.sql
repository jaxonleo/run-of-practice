-- Free / Pro / Organization packaging, Phase A (2026-10-14): registry and
-- bundle values, Pro+ retirement, founding_coach cohort + signup cutoff,
-- the billing launch guard, the helper role merge, entitlement_events, and
-- the profiles.upsell_state write guard. Fixture: seed.sql's coach A/B,
-- the platform admin (a...0005), Test Org.
begin;
select plan(28);

-- Founding Coach: every seeded user subject carries it, nothing is left on
-- early_access_all_access, and it covers every registry key at full.
select is(
  (select count(*)::int from public.entitlement_cohort_assignments where subject_type = 'user' and cohort_bundle_key <> 'founding_coach'),
  0, 'every user cohort row is founding_coach'
);
select is(
  (select count(*)::int from public.features f
    where not exists (select 1 from public.bundle_features bf
      where bf.bundle_key = 'founding_coach' and bf.feature_key = f.feature_key and bf.state = 'full' and bf.limit_value is null)),
  0, 'founding_coach has a full/unlimited row for every registry key'
);
select is(
  (select count(*)::int from public.features f
    where public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000001', null, f.feature_key) ->> 'state' <> 'full'
       or public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000001', null, f.feature_key) ->> 'source' <> 'cohort'),
  0, 'coach A resolves every feature full via source cohort (zero observable change)'
);

-- Pro+ retired.
select is((select count(*)::int from public.entitlement_plan_state where plan_bundle_key = 'pro_plus'), 0, 'zero pro_plus plan rows');
select isnt((select retired_at from public.entitlement_bundles where bundle_key = 'pro_plus'), null, 'pro_plus is marked retired');

-- Bundle values.
select is((select limit_value from public.bundle_features where bundle_key = 'free' and feature_key = 'library.personal_templates'), 2, 'free keeps 2 personal templates');
select is((select state from public.bundle_features where bundle_key = 'free' and feature_key = 'goals.access'), 'full', 'free goals.access is full');
select is((select state from public.bundle_features where bundle_key = 'free' and feature_key = 'delegation.practice_planning'), 'locked', 'free delegation stays locked');
select is((select state from public.bundle_features where bundle_key = 'pro' and feature_key = 'delegation.practice_planning'), 'full', 'pro now includes delegated planning');
select is((select state from public.bundle_features where bundle_key = 'free' and feature_key = 'goals.trends'), 'preview', 'free goals.trends is preview');
select is((select display_name from public.entitlement_bundles where bundle_key = 'org_standard'), 'Club', 'org_standard is displayed as Club');
select is((select state from public.bundle_features where bundle_key = 'org_standard' and feature_key = 'org.development_suite'), 'locked', 'Club does not include the development suite');
select is((select state from public.bundle_features where bundle_key = 'org_development' and feature_key = 'org.development_suite'), 'full', 'Club + Development does');
select is(
  public.resolve_entitlement('organization', null, '90000000-0000-0000-0000-000000000001', 'benchmarks.access') ->> 'state',
  'full', 'an org on Club resolves the new Pro features at full'
);

-- admin_set_plan refuses a retired bundle.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000005', true);
select throws_like(
  $$select public.admin_set_plan('user', 'a0000000-0000-0000-0000-000000000002', null, 'pro_plus')$$,
  '%retired%', 'admin_set_plan refuses the retired pro_plus bundle'
);
select lives_ok(
  $$select public.admin_set_plan('user', 'a0000000-0000-0000-0000-000000000002', null, 'pro')$$,
  'admin_set_plan still accepts an active plan'
);

-- Founding cutoff: admin-only, and authenticated cannot write the row directly.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select throws_like(
  $$select public.admin_set_founding_cutoff(now())$$,
  'not authorized', 'a non-admin cannot set the founding cutoff'
);
select throws_like(
  $$update public.entitlement_settings set founding_cohort_cutoff = now()$$,
  '%permission denied%', 'authenticated cannot update entitlement_settings directly'
);
select is((select count(*)::int from public.entitlement_settings), 1, 'authenticated can read the single settings row');
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Launch guard: billing cannot be enabled while the cutoff is null.
select throws_like(
  $$update public.entitlement_settings set billing_enabled = true$$,
  '%entitlement_settings_billing_needs_cutoff%',
  'billing_enabled cannot flip to true while founding_cohort_cutoff is null'
);

-- Signup trigger: before the cutoff a new profile is a founding coach...
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000f1', 'pkg-before@example.com');
select is(
  (select cohort_bundle_key from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-0000000000f1'),
  'founding_coach', 'a signup with no cutoff set joins founding_coach'
);

-- ...after it, no cohort, and they resolve from the free plan.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000005', true);
select public.admin_set_founding_cutoff(now() - interval '1 minute');
reset role;
select set_config('request.jwt.claim.sub', '', true);
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000f2', 'pkg-after@example.com');
select is(
  (select count(*)::int from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-0000000000f2'),
  0, 'a signup after the cutoff gets no cohort'
);
select is(
  public.resolve_entitlement('user', 'a0000000-0000-0000-0000-0000000000f2', null, 'library.personal_templates') ->> 'limit_value',
  '2', 'and resolves Free limits from its plan row'
);
select lives_ok(
  $$update public.entitlement_settings set billing_enabled = true$$,
  'with the cutoff set, billing_enabled may flip'
);

-- Helper role is gone from both role constraints.
select throws_like(
  $$insert into public.team_staff (team_id, first_name, last_name, role, invite_email) values ('b0000000-0000-0000-0000-000000000001', 'H', 'L', 'helper', 'h@example.com')$$,
  '%team_staff_role_check%', 'team_staff refuses the retired helper role'
);

-- entitlement_events: insert own, never someone else's, never read back.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$insert into public.entitlement_events (user_id, team_id, event, catalog_id, feature_key) values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'limit_hit', 'T1', 'teams.personal_count')$$,
  'a coach can log their own entitlement event'
);
select throws_like(
  $$insert into public.entitlement_events (user_id, event) values ('a0000000-0000-0000-0000-000000000002', 'cta_click')$$,
  '%row-level security%', 'a coach cannot log an event as someone else'
);

-- profiles.upsell_state is not writable by a direct update.
select throws_like(
  $$update public.profiles set upsell_state = '{"x":1}' where id = 'a0000000-0000-0000-0000-000000000001'$$,
  '%written through its RPC only%', 'a direct profiles.upsell_state update is refused'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
