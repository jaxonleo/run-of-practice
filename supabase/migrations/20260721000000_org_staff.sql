-- Org Experience handoff (ROP-Org-Experience-Handoff.md), part 1: role model.
-- organization_members (roles owner/admin/coach/viewer) is replaced wholesale
-- by org_staff (v1 role: 'director' only). Confirmed zero real rows in
-- organization_members before this migration -- every existing organization
-- row was leftover test data from the 2026-07-07 sharing-model session
-- (created_by is null on all of them, which is exactly why the
-- handle_new_organization trigger never gave any of them a member row).
-- Safe to replace outright rather than migrate data.
--
-- Unlike organization_members, org_staff gets NO direct insert/update/delete
-- policy at all -- handoff design principle 0 ("SECURITY DEFINER functions
-- only, no direct table grants for org/team/library writes") is a
-- deliberate tightening versus the old model. All membership changes go
-- through SECURITY DEFINER RPCs added in later migrations (org invite/accept,
-- team-assignment RPCs), never a direct authenticated INSERT/UPDATE.
create table public.org_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'director' check (role in ('director')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.org_staff is
  'Org-level roles. v1 ships director only -- role is a plain text CHECK, '
  'not a hard-coded enum, so adding admin later is a one-line constraint '
  'change, not a data migration. Replaces organization_members wholesale '
  '(see migration comment); no admin/viewer distinction carried forward, '
  'per handoff Sec 1.';

-- Partial unique index (active rows only), not a flat unique constraint --
-- lets a director who left (archived_at set) be re-added later without a
-- delete, matching the archive-don't-delete convention used throughout this
-- schema (e.g. team_staff's re-add-revives-archived-row behavior).
create unique index org_staff_active_unique
  on public.org_staff (organization_id, user_id) where archived_at is null;
create index org_staff_user_id_idx on public.org_staff (user_id);

alter table public.org_staff enable row level security;

-- Self-reference-fix pattern applied from day one (see
-- org_members_self_reference_fix.sql / organizations_self_reference_fix.sql
-- for the bug class this avoids): a direct "see my own row" branch means a
-- newly-inserted row is visible to the inserting statement's own RETURNING
-- without depending on is_org_member's lookup timing.
create policy "org_staff_select" on public.org_staff
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_org_member(organization_id)
  );

grant select on public.org_staff to authenticated;

-- is_org_member / is_org_admin now read org_staff. CREATE OR REPLACE keeps
-- every existing call site (can_access_team, can_manage_team,
-- can_access_owned, can_manage_owned, can_access_asset_owned,
-- can_manage_asset_owned, teams/activity_library/assets/locations/
-- skill_tags/templates policies, etc.) working unchanged -- same signature,
-- same OID, just a new body.
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_staff os
    where os.organization_id = p_org_id
      and os.user_id = auth.uid()
      and os.archived_at is null
  );
$$;

-- v1 has exactly one role (director), so this is equivalent to
-- is_org_member today. Kept as a distinct query (not a call to
-- is_org_member) so that adding a lesser 'admin' role later is a change to
-- this WHERE clause alone.
create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_staff os
    where os.organization_id = p_org_id
      and os.user_id = auth.uid()
      and os.role = 'director'
      and os.archived_at is null
  );
$$;

-- Whoever creates an organization becomes its director. (Body only change --
-- same trigger, same function name, org creation flow doesn't exist in the
-- client yet but the invariant should hold the day it does.)
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.org_staff (organization_id, user_id, role)
    values (new.id, new.created_by, 'director');
  end if;
  return new;
end;
$$;

-- profiles_select_org_co_member ("Shared by ___" attribution, library
-- sharing addendum 2026-07-07) was the one place that queried
-- organization_members directly instead of going through a helper function.
-- Same semantics, org_staff instead.
drop policy if exists "profiles_select_org_co_member" on public.profiles;
create policy "profiles_select_org_co_member" on public.profiles
  for select using (
    exists (
      select 1 from public.org_staff me
      join public.org_staff them
        on them.organization_id = me.organization_id
      where me.user_id = auth.uid()
        and them.user_id = profiles.id
        and me.archived_at is null and them.archived_at is null
    )
  );

-- The 4 pre-existing organization rows are all leftover test data (see
-- migration comment above) -- archived, not deleted, consistent with this
-- schema's convention. created_by is null on all of them and will not be
-- null for any organization created through a real signup flow, so this
-- filter only ever touches that stale set.
update public.organizations set archived_at = now()
where created_by is null and archived_at is null;

-- Nothing else references organization_members after the policy rewrite
-- above (confirmed: grants_authenticated.sql's grant disappears with the
-- table; no foreign key anywhere points at organization_members.id).
drop table if exists public.organization_members cascade;
