-- Entitlement architecture, part 3 of 6: per-subject state.
--
-- A "subject" is whoever an entitlement bundle/cohort/override can be
-- assigned to. Two kinds exist today (a personal user, an organization),
-- and the handoff's own requirements list plans, cohorts, grandfathering,
-- and overrides for both, plus "future organization-level access" as one
-- of the four resolution inputs -- not a bolt-on. Rather than two fully
-- separate table sets (user_plan_state/organization_plan_state, etc.) or a
-- bare polymorphic subject_id with no referential integrity, each table
-- below carries both a nullable user_id and a nullable organization_id FK
-- (real FKs, real ON DELETE CASCADE) plus a subject_type discriminator and
-- a CHECK enforcing exactly one is set. A third subject type later (if one
-- is ever needed) is a new nullable FK column and a widened CHECK, not a
-- new table set -- and every row still has real referential integrity to
-- something, unlike a bare uuid subject_id ever would.
--
-- All three tables follow user_entitlements' own established pattern
-- (RLS enabled, no insert/update/delete grant for authenticated at all --
-- see part 4's admin RPCs and part 5's resolution functions for the only
-- ways in). service_role gets full grants per this project's own
-- documented "service_role bypasses RLS but not GRANTs" gotcha.

create table public.entitlement_plan_state (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('user', 'organization')),
  user_id uuid references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  plan_bundle_key text not null references public.entitlement_bundles(bundle_key),
  billing_status text not null default 'none' check (billing_status in ('none', 'trialing', 'active', 'canceled')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  -- Reserved for the future Stripe session (handoff's own "Stripe subscription
  -- -> internal plan/entitlement bundle -> feature access" model). Nullable
  -- and unused until then -- adding these now, while this table has zero
  -- real billing rows, is a plain column add; adding them after Stripe rows
  -- exist would be a live-data migration instead.
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  early_access_eligible boolean,
  early_access_offer_redeemed boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint entitlement_plan_state_subject_shape check (
    (subject_type = 'user' and user_id is not null and organization_id is null)
    or (subject_type = 'organization' and organization_id is not null and user_id is null)
  )
);

create unique index entitlement_plan_state_user_unique
  on public.entitlement_plan_state (user_id) where subject_type = 'user';
create unique index entitlement_plan_state_org_unique
  on public.entitlement_plan_state (organization_id) where subject_type = 'organization';

comment on table public.entitlement_plan_state is
  'Per-subject active plan/billing state. Replaces user_entitlements (dropped in the next migration) -- see resolve_entitlement (part 5) for how this ranks against cohort/override.';

alter table public.entitlement_plan_state enable row level security;

create policy "entitlement_plan_state_select_own" on public.entitlement_plan_state
  for select using (
    (subject_type = 'user' and user_id = auth.uid())
    or (subject_type = 'organization' and public.is_org_member(organization_id))
  );

grant select on public.entitlement_plan_state to authenticated;
grant select, insert, update, delete on public.entitlement_plan_state to service_role;

-- The persistent, authoritative cohort/grandfathering record the handoff
-- asks for explicitly: "Users should be explicitly assigned to a cohort /
-- entitlement version and that assignment should be stored... Do not
-- repeatedly derive access from raw signup dates." One active cohort per
-- subject (an admin reassigns rather than stacks -- multiple simultaneous
-- cohorts aren't a real requirement yet and would complicate precedence
-- for no current benefit).
create table public.entitlement_cohort_assignments (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('user', 'organization')),
  user_id uuid references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  cohort_bundle_key text not null references public.entitlement_bundles(bundle_key),
  assigned_reason text,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  constraint entitlement_cohort_assignments_subject_shape check (
    (subject_type = 'user' and user_id is not null and organization_id is null)
    or (subject_type = 'organization' and organization_id is not null and user_id is null)
  )
);

create unique index entitlement_cohort_assignments_user_unique
  on public.entitlement_cohort_assignments (user_id) where subject_type = 'user';
create unique index entitlement_cohort_assignments_org_unique
  on public.entitlement_cohort_assignments (organization_id) where subject_type = 'organization';

comment on table public.entitlement_cohort_assignments is
  'Permanent, explicitly-assigned cohort/grandfathering record per subject. A packaging change never removes what this points at -- see resolve_entitlement (part 5), where this outranks the active plan bundle.';

alter table public.entitlement_cohort_assignments enable row level security;

create policy "entitlement_cohort_assignments_select_own" on public.entitlement_cohort_assignments
  for select using (
    (subject_type = 'user' and user_id = auth.uid())
    or (subject_type = 'organization' and public.is_org_member(organization_id))
  );

grant select on public.entitlement_cohort_assignments to authenticated;
grant select, insert, update, delete on public.entitlement_cohort_assignments to service_role;

-- Individual grants/revocations (handoff §5: beta users, founding coaches,
-- internal testing, support cases, promotional access, product
-- experiments). Outranks everything -- including a cohort assignment, so a
-- support case can revoke one specific feature from an otherwise-
-- grandfathered account without touching their cohort. Carries an audit
-- trail (granted_by/reason) since this is a manual, per-feature lever, same
-- actor-identity convention this schema already uses for sensitive writes.
create table public.entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('user', 'organization')),
  user_id uuid references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  feature_key text not null references public.features(feature_key) on delete cascade,
  state text not null check (state in ('full', 'preview', 'locked', 'hidden')),
  limit_value integer,
  granted_by uuid references public.profiles(id) on delete set null,
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint entitlement_overrides_subject_shape check (
    (subject_type = 'user' and user_id is not null and organization_id is null)
    or (subject_type = 'organization' and organization_id is not null and user_id is null)
  )
);

create unique index entitlement_overrides_user_feature_unique
  on public.entitlement_overrides (user_id, feature_key) where subject_type = 'user';
create unique index entitlement_overrides_org_feature_unique
  on public.entitlement_overrides (organization_id, feature_key) where subject_type = 'organization';

comment on table public.entitlement_overrides is
  'Per-feature individual grants/revocations, highest precedence in resolve_entitlement (part 5). One row per (subject, feature) -- re-granting is an update, not a new row.';

alter table public.entitlement_overrides enable row level security;

create policy "entitlement_overrides_select_own" on public.entitlement_overrides
  for select using (
    (subject_type = 'user' and user_id = auth.uid())
    or (subject_type = 'organization' and public.is_org_member(organization_id))
  );

grant select on public.entitlement_overrides to authenticated;
grant select, insert, update, delete on public.entitlement_overrides to service_role;

-- Auto-create both rows for every new signup, same trigger-on-insert
-- pattern handle_new_user()/handle_new_profile_entitlements() already use.
-- The cohort grant here is deliberate, not a leftover: with BILLING_ENABLED
-- still false, a brand-new signup today should see identical access to an
-- existing one, and this keeps that a real, inspectable per-user record
-- instead of a second implicit bypass living only in code (see part 4's
-- removal of the old FEATURE_FLAGS.EARLY_ACCESS_ACTIVE gate). Whoever flips
-- BILLING_ENABLED on for real is expected to also stop this default cohort
-- grant (or point new signups at a narrower one) as a deliberate decision
-- at that time -- not something this trigger should guess at now.
create function public.handle_new_profile_entitlement_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.entitlement_plan_state (subject_type, user_id, plan_bundle_key)
  values ('user', new.id, 'free')
  on conflict (user_id) where subject_type = 'user' do nothing;

  insert into public.entitlement_cohort_assignments (subject_type, user_id, cohort_bundle_key, assigned_reason)
  values ('user', new.id, 'early_access_all_access', 'default_signup_grant')
  on conflict (user_id) where subject_type = 'user' do nothing;

  return new;
end;
$$;

create trigger on_profile_created_entitlement_state
  after insert on public.profiles
  for each row execute function public.handle_new_profile_entitlement_state();

-- Same idea for organizations -- every org gets a resolvable plan bundle
-- from creation, no special-cased "org has no entitlement row" branch
-- anywhere in resolve_entitlement.
create function public.handle_new_org_entitlement_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.entitlement_plan_state (subject_type, organization_id, plan_bundle_key)
  values ('organization', new.id, 'org_standard')
  on conflict (organization_id) where subject_type = 'organization' do nothing;

  return new;
end;
$$;

create trigger on_organization_created_entitlement_state
  after insert on public.organizations
  for each row execute function public.handle_new_org_entitlement_state();
