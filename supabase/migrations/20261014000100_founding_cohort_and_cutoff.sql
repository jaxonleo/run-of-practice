-- Free / Pro / Organization packaging, Phase A part 2 of 4: the Founding
-- Coach cohort and a signup cutoff Jax can set without a migration.
--
-- Before this, on_profile_created_entitlement_state gave every new profile
-- early_access_all_access, so every coach who signed up before launch
-- would keep full access permanently. Now:
--   * every existing user cohort row moves to founding_coach (identical
--     access: every key full/unlimited, see 20261014000000 step 5);
--   * new profiles get founding_coach only while the cutoff is unset or in
--     the future, and no cohort at all after it (they resolve from their
--     free plan row).
-- early_access_all_access stays in place with zero assignments.
-- Organizations are unchanged (still org_standard, no org cohort).

-- 1. Reassign existing coaches.
do $$
declare
  v_before integer;
  v_moved integer;
  v_after integer;
begin
  select count(*) into v_before from public.entitlement_cohort_assignments
    where subject_type = 'user' and cohort_bundle_key = 'early_access_all_access';

  update public.entitlement_cohort_assignments
    set cohort_bundle_key = 'founding_coach',
        assigned_reason = 'founding_coach_reassignment_2026_10_14'
    where subject_type = 'user' and cohort_bundle_key = 'early_access_all_access';
  get diagnostics v_moved = row_count;

  select count(*) into v_after from public.entitlement_cohort_assignments
    where subject_type = 'user' and cohort_bundle_key = 'founding_coach';

  raise notice 'founding_coach reassignment: % early_access_all_access user row(s) before, % moved, % founding_coach user row(s) after',
    v_before, v_moved, v_after;
end;
$$;

-- 2. Single-row settings table. Select-only for authenticated; the only
-- write path is admin_set_founding_cutoff below.
create table public.entitlement_settings (
  id boolean primary key default true check (id),
  founding_cohort_cutoff timestamptz,
  -- Server-side mirror of the client's FEATURE_FLAGS.BILLING_ENABLED. Not
  -- read by anything yet; it exists so the launch guard below is a real
  -- constraint (and a pgTAP assertion) rather than only a checklist line.
  -- The Stripe handoff should flip this row, not just the client constant.
  billing_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint entitlement_settings_billing_needs_cutoff
    check (not billing_enabled or founding_cohort_cutoff is not null)
);

comment on table public.entitlement_settings is
  'Single-row global entitlement settings. founding_cohort_cutoff: new profiles join the founding_coach cohort only while this is null or in the future. Launch guard: BILLING_ENABLED must not flip to true while it is null (see BUILD-STATUS Known Gaps).';

insert into public.entitlement_settings (id) values (true);

alter table public.entitlement_settings enable row level security;
create policy "entitlement_settings_select_authenticated" on public.entitlement_settings
  for select to authenticated using (true);
revoke all on public.entitlement_settings from anon, authenticated;
grant select on public.entitlement_settings to authenticated;
grant select, insert, update, delete on public.entitlement_settings to service_role;

create function public.admin_set_founding_cutoff(p_cutoff timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.entitlement_settings
    set founding_cohort_cutoff = p_cutoff, updated_at = now(), updated_by = auth.uid()
    where id;
end;
$$;

revoke all on function public.admin_set_founding_cutoff(timestamptz) from public;
grant execute on function public.admin_set_founding_cutoff(timestamptz) to authenticated;

-- 3. Signup trigger: founding_coach only before the cutoff.
create or replace function public.handle_new_profile_entitlement_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz;
begin
  insert into public.entitlement_plan_state (subject_type, user_id, plan_bundle_key)
  values ('user', new.id, 'free')
  on conflict (user_id) where subject_type = 'user' do nothing;

  select s.founding_cohort_cutoff into v_cutoff from public.entitlement_settings s where s.id;

  if v_cutoff is null or now() < v_cutoff then
    insert into public.entitlement_cohort_assignments (subject_type, user_id, cohort_bundle_key, assigned_reason)
    values ('user', new.id, 'founding_coach', 'founding_signup_before_cutoff')
    on conflict (user_id) where subject_type = 'user' do nothing;
  end if;

  return new;
end;
$$;
