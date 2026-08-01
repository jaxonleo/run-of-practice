-- Scaffolding for the Free/Pro/Organizations entitlement model (pricing brief,
-- 2026-07-31). Not enforced anywhere yet -- BILLING_ENABLED is false, so
-- src/entitlements.js short-circuits every can() check to allowed:true
-- regardless of what's stored here. This just gives the eventual gate work
-- somewhere real to read from instead of inventing it under time pressure.
--
-- Deliberately a separate table, not new columns on profiles: profiles has
-- `grant select, update on public.profiles to authenticated` with no
-- column-level restriction (RLS is row-level, `profiles_update_own` only
-- checks `id = auth.uid()`), so a plan_type column added there would be
-- silently self-service-writable by any signed-in coach via a plain
-- `.update()` call. Keeping billing state in its own table with no
-- authenticated INSERT/UPDATE grant at all (service_role/future RPCs only,
-- same "flat, separate gate" pattern admin_users already uses for
-- is_admin()) avoids that hole entirely rather than trying to defend it
-- with per-column revokes.
create table public.user_entitlements (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan_type text not null default 'free' check (plan_type in ('free', 'pro')),
  billing_status text not null default 'none' check (billing_status in ('none', 'trialing', 'active', 'canceled')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  -- Eligibility for the brief's $79 early-access first-year offer. The
  -- actual rule (created a team / built a practice / ran one live, before a
  -- cutoff date) isn't decided yet -- left null ("not yet evaluated") rather
  -- than guessing a default, so nothing here asserts a business fact that
  -- hasn't actually been made.
  early_access_eligible boolean,
  early_access_offer_redeemed boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.user_entitlements is
  'Per-user plan/billing state for the Free/Pro/Organizations model. Organization-team pricing is governed separately by org_staff/org agreement, not this table. Not enforced yet -- see src/entitlements.js.';

alter table public.user_entitlements enable row level security;

create policy "user_entitlements_select_own" on public.user_entitlements
  for select using (user_id = auth.uid());

-- No insert/update/delete policy for `authenticated` on purpose -- this
-- table is server-authoritative only. service_role bypasses RLS but still
-- needs its own explicit grant on the base table (this project's own
-- documented gotcha: service_role bypasses RLS but not GRANTs).
grant select on public.user_entitlements to authenticated;
grant select, insert, update on public.user_entitlements to service_role;

-- One row per existing profile, defaulted to Free -- matches "unrestricted
-- pseudo-plan during early access": the stored plan_type is the real
-- fallback for whenever billing eventually turns on, but EARLY_ACCESS_ACTIVE
-- bypasses it entirely today, so this backfill changes nothing observable.
insert into public.user_entitlements (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

-- Auto-create a Free row for every future signup, same trigger-on-insert
-- pattern handle_new_user() already uses for profiles itself.
create function public.handle_new_profile_entitlements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_entitlements (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_profile_created_entitlements
  after insert on public.profiles
  for each row execute function public.handle_new_profile_entitlements();
