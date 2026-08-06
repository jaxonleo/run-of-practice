-- Same gap just confirmed and fixed for templates (20260805110000), also
-- present here: can_link_asset_to_practice_activity/can_link_asset_to_station
-- already handle a team-tagged asset (assets.team_id) and the caller's own
-- personal asset, but never "a teammate's personal equipment" -- the
-- overwhelmingly common real case, since almost no equipment in this app is
-- actually team_id-tagged. A delegated planner (team_staff.can_build_practices)
-- building or editing a practice for a team, wanting to use equipment the
-- head coach (or any other staff member) already owns personally, would hit
-- the exact same silent RLS rejection this session's template fix just
-- closed. Extends both with the same "owned by any non-archived team_staff
-- member of this practice's own team" fallback.
create or replace function public.can_link_asset_to_practice_activity(p_practice_activity_id uuid, p_asset_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    ast.team_id = tm.id
    or ast.owner_user_id = auth.uid()
    or (tm.organization_id is not null and ast.organization_id = tm.organization_id)
    or exists (
      select 1 from public.team_staff ts
      where ts.team_id = tm.id and ts.user_id = ast.owner_user_id and ts.archived_at is null
    )
  from public.practice_activities pa
  join public.practices p on p.id = pa.practice_id
  join public.teams tm on tm.id = p.team_id
  join public.assets ast on ast.id = p_asset_id
  where pa.id = p_practice_activity_id;
$$;

create or replace function public.can_link_asset_to_station(p_station_id uuid, p_asset_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    ast.team_id = tm.id
    or ast.owner_user_id = auth.uid()
    or (tm.organization_id is not null and ast.organization_id = tm.organization_id)
    or exists (
      select 1 from public.team_staff ts
      where ts.team_id = tm.id and ts.user_id = ast.owner_user_id and ts.archived_at is null
    )
  from public.stations s
  join public.station_blocks sb on sb.id = s.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  join public.teams tm on tm.id = p.team_id
  join public.assets ast on ast.id = p_asset_id
  where s.id = p_station_id;
$$;
