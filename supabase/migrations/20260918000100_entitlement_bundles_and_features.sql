-- Entitlement architecture, part 2 of 6: bundles and what each includes.
--
-- entitlement_bundles is the set of nameable "packages" -- both customer-
-- facing plans (free/pro/pro_plus, and org_standard for organizations) and
-- cohort-only bundles that are never directly purchasable (e.g.
-- early_access_all_access, part 3). Versioned repackaging (the handoff's
-- founding_coach/pro_v1/pro_v2 example) is just inserting a new row here
-- later -- display_name lets several bundle_keys share one customer-facing
-- name (pro_v1 and pro_v2 can both show "Pro").
create table public.entitlement_bundles (
  bundle_key text primary key,
  display_name text not null,
  -- true: a normal, currently-assignable plan (what entitlement_plan_state
  -- rows point at). false: cohort-only -- never appears in
  -- entitlement_plan_state, only ever assigned via
  -- entitlement_cohort_assignments (part 3). Purely descriptive, not
  -- enforced by a constraint -- nothing stops an admin RPC from using a
  -- bundle either way later if a real reason shows up.
  is_plan boolean not null default true,
  description text,
  created_at timestamptz not null default now()
);

comment on table public.entitlement_bundles is
  'Nameable entitlement packages (plans and cohort-only bundles). What each one includes lives in bundle_features.';

alter table public.entitlement_bundles enable row level security;
create policy "entitlement_bundles_select_authenticated" on public.entitlement_bundles
  for select using (true);
grant select on public.entitlement_bundles to authenticated;
grant select, insert, update, delete on public.entitlement_bundles to service_role;

-- What a bundle actually grants, one row per (bundle, feature). Deliberately
-- not every feature needs a row in every bundle -- see features.default_state
-- for the ones that don't (part 1).
create table public.bundle_features (
  bundle_key text not null references public.entitlement_bundles(bundle_key) on delete cascade,
  feature_key text not null references public.features(feature_key) on delete cascade,
  state text not null check (state in ('full', 'preview', 'locked', 'hidden')),
  -- Only meaningful when features.limit_type = 'count' for this feature_key;
  -- null means uncapped on this specific bundle. A count-type feature this
  -- bundle doesn't grant at all is expressed as state='locked' with
  -- limit_value left null (not state='full'/limit_value=0 -- a 0 numeric
  -- cap and "not granted" are the same real-world outcome, but only one of
  -- them maps onto the handoff's four presentation states cleanly).
  limit_value integer,
  primary key (bundle_key, feature_key)
);

comment on table public.bundle_features is
  'What each bundle includes, one row per (bundle, feature). Changing what a plan includes is an update here, never application code.';

alter table public.bundle_features enable row level security;
create policy "bundle_features_select_authenticated" on public.bundle_features
  for select using (true);
grant select on public.bundle_features to authenticated;
grant select, insert, update, delete on public.bundle_features to service_role;

insert into public.entitlement_bundles (bundle_key, display_name, is_plan, description) values
  ('free', 'Free', true, 'Default plan for every new personal (non-organization) signup.'),
  ('pro', 'Pro', true, 'Paid personal plan.'),
  ('pro_plus', 'Pro+', true, 'Paid personal plan, adds unlimited delegated practice planning and a second concurrent live practice.'),
  ('org_standard', 'Organization', true, 'Standard organization-team plan. Org pricing/terms are negotiated per organization (org_staff/org agreement), not self-serve -- see PLAN_LIMITS'' historical comment -- but every organization still needs a resolvable bundle so entitlement_plan_state has one FK shape for both subject types instead of a special-cased branch.'),
  ('early_access_all_access', 'Early Access (internal)', false, 'Cohort-only. Replaces the old global FEATURE_FLAGS.EARLY_ACCESS_ACTIVE boolean with a persisted, per-subject grant -- see entitlement_cohort_assignments (part 3). Grants everything at "full" so no real coach''s access changes the moment this system starts being read from.');

-- Ported 1:1 from src/entitlements.js's PLAN_LIMITS as it stood immediately
-- before this migration (Decision History: this is the frozen historical
-- source, not re-derived from memory) -- free/pro/pro_plus below must
-- match those numbers exactly, since a mismatch here is invisible today
-- (early_access_all_access covers every real user regardless) and would
-- only surface as a real behavior change months from now when
-- BILLING_ENABLED is finally flipped on. See 06_entitlements.test.sql for
-- the pgTAP assertions encoding these exact values so a future edit can't
-- silently drift.
insert into public.bundle_features (bundle_key, feature_key, state, limit_value) values
  -- free (PLAN_LIMITS.free)
  ('free', 'teams.personal_count', 'full', 1),
  ('free', 'teams.assistants', 'full', 2),
  ('free', 'library.personal_drills', 'full', 20),
  ('free', 'library.personal_templates', 'full', 3),
  ('free', 'library.full_catalog', 'locked', null),
  ('free', 'history.practice_history', 'full', 10),
  ('free', 'goals.access', 'locked', null),
  ('free', 'goals.insights_depth', 'locked', null),
  ('free', 'live.concurrent_sessions', 'full', 1),
  ('free', 'delegation.practice_planning', 'locked', null),

  -- pro (PLAN_LIMITS.pro)
  ('pro', 'teams.personal_count', 'full', 3),
  ('pro', 'teams.assistants', 'full', null),
  ('pro', 'library.personal_drills', 'full', null),
  ('pro', 'library.personal_templates', 'full', null),
  ('pro', 'library.full_catalog', 'full', null),
  ('pro', 'history.practice_history', 'full', null),
  ('pro', 'goals.access', 'full', null),
  ('pro', 'goals.insights_depth', 'full', null),
  ('pro', 'live.concurrent_sessions', 'full', 1),
  ('pro', 'delegation.practice_planning', 'locked', null),

  -- pro_plus (PLAN_LIMITS.pro_plus) -- only concurrent_sessions (2, not 1)
  -- and delegation.practice_planning (unlimited, not locked) differ from pro.
  ('pro_plus', 'teams.personal_count', 'full', 3),
  ('pro_plus', 'teams.assistants', 'full', null),
  ('pro_plus', 'library.personal_drills', 'full', null),
  ('pro_plus', 'library.personal_templates', 'full', null),
  ('pro_plus', 'library.full_catalog', 'full', null),
  ('pro_plus', 'history.practice_history', 'full', null),
  ('pro_plus', 'goals.access', 'full', null),
  ('pro_plus', 'goals.insights_depth', 'full', null),
  ('pro_plus', 'live.concurrent_sessions', 'full', 2),
  ('pro_plus', 'delegation.practice_planning', 'full', null),

  -- org_standard -- matches src/entitlements.js's can() organization
  -- short-circuit exactly (every org-scoped resource was unconditionally
  -- allowed:true, never gated by a personal plan). Making that an explicit
  -- bundle row per feature, instead of a code-level short-circuit, means
  -- org packaging can actually change later without touching resolution
  -- logic.
  ('org_standard', 'teams.personal_count', 'full', null),
  ('org_standard', 'teams.assistants', 'full', null),
  ('org_standard', 'library.personal_drills', 'full', null),
  ('org_standard', 'library.personal_templates', 'full', null),
  ('org_standard', 'library.full_catalog', 'full', null),
  ('org_standard', 'history.practice_history', 'full', null),
  ('org_standard', 'goals.access', 'full', null),
  ('org_standard', 'goals.insights_depth', 'full', null),
  ('org_standard', 'live.concurrent_sessions', 'full', null),
  ('org_standard', 'delegation.practice_planning', 'full', null),

  -- early_access_all_access -- everything full/uncapped, same intent as
  -- today's global EARLY_ACCESS_ACTIVE bypass, just persisted per-subject.
  ('early_access_all_access', 'teams.personal_count', 'full', null),
  ('early_access_all_access', 'teams.assistants', 'full', null),
  ('early_access_all_access', 'library.personal_drills', 'full', null),
  ('early_access_all_access', 'library.personal_templates', 'full', null),
  ('early_access_all_access', 'library.full_catalog', 'full', null),
  ('early_access_all_access', 'history.practice_history', 'full', null),
  ('early_access_all_access', 'goals.access', 'full', null),
  ('early_access_all_access', 'goals.insights_depth', 'full', null),
  ('early_access_all_access', 'live.concurrent_sessions', 'full', null),
  ('early_access_all_access', 'delegation.practice_planning', 'full', null);
