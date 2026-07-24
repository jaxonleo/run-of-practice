-- Which locations a team actually uses -- explicit per-team assignment
-- rather than tagging locations by sport, since two teams in the same sport
-- can use entirely different fields/gyms. No rows for a team means no
-- restriction has been set up yet (shows every location, today's behavior);
-- one or more rows narrows the practice/template Location picker to just
-- those. Same append/remove convention as asset_locations.
create table public.team_locations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (team_id, location_id)
);
create index team_locations_team_id_idx on public.team_locations (team_id);
create index team_locations_location_id_idx on public.team_locations (location_id);
alter table public.team_locations enable row level security;

-- Teams and locations both use the simple org-vs-personal-coach ownership
-- split (no team-shared concept the way assets have) -- can_access_team/
-- can_manage_team (20260704000800_rls_functions.sql) already fully answer
-- "can this user see/edit this team," so this just delegates to them
-- rather than re-deriving the ownership check against locations too.
create policy team_locations_select on public.team_locations for select to authenticated
  using (public.can_access_team(team_id));
create policy team_locations_manage on public.team_locations for all to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id));
grant select, insert, update, delete on public.team_locations to authenticated;
