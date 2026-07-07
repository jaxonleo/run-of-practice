alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.teams enable row level security;
alter table public.team_staff enable row level security;
alter table public.players enable row level security;

-- No DELETE policy is defined on any table below, anywhere in this file.
-- That's deliberate: rows are archived (archived_at set), never deleted,
-- through the normal app. Anything that truly needs hard deletion happens
-- out of band, not through the anon/authenticated API roles.

-- profiles: a user can only see/edit their own profile row. No cross-user
-- profile reads are needed anywhere in this schema -- team_staff stores
-- display names directly for exactly this reason.
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- organizations
create policy "organizations_select_member" on public.organizations
  for select using (public.is_org_member(id));

create policy "organizations_insert_self" on public.organizations
  for insert with check (created_by = auth.uid());

create policy "organizations_update_admin" on public.organizations
  for update using (public.is_org_admin(id));

-- organization_members
create policy "org_members_select" on public.organization_members
  for select using (public.is_org_member(organization_id));

create policy "org_members_insert_admin" on public.organization_members
  for insert with check (public.is_org_admin(organization_id));

create policy "org_members_update_admin" on public.organization_members
  for update using (public.is_org_admin(organization_id));

-- teams
create policy "teams_select_access" on public.teams
  for select using (public.can_access_team(id));

create policy "teams_insert_own_or_org" on public.teams
  for insert with check (
    (organization_id is null and owner_user_id = auth.uid())
    or (organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "teams_update_manage" on public.teams
  for update using (public.can_manage_team(id));

-- team_staff
create policy "team_staff_select_access" on public.team_staff
  for select using (public.can_access_team(team_id));

create policy "team_staff_insert_manage" on public.team_staff
  for insert with check (public.can_manage_team(team_id));

create policy "team_staff_update_manage" on public.team_staff
  for update using (public.can_manage_team(team_id));

-- players
create policy "players_select_access" on public.players
  for select using (public.can_access_team(team_id));

create policy "players_insert_manage" on public.players
  for insert with check (public.can_manage_team(team_id));

create policy "players_update_manage" on public.players
  for update using (public.can_manage_team(team_id));
