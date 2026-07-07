-- Asset-specific ownership check, distinct from the generic can_access_owned/
-- can_manage_owned (which only know about org/personal, and are used by
-- several tables that will never have a team option -- activity_library,
-- templates, locations, skill_tags). Keeping this asset-specific rather than
-- widening the generic functions avoids touching every other caller.
create or replace function public.can_access_asset_owned(p_organization_id uuid, p_owner_user_id uuid, p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    p_owner_user_id = auth.uid()
    or (p_organization_id is not null and public.is_org_member(p_organization_id))
    or (p_team_id is not null and public.can_access_team(p_team_id));
$$;

create or replace function public.can_manage_asset_owned(p_organization_id uuid, p_owner_user_id uuid, p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    p_owner_user_id = auth.uid()
    or (p_organization_id is not null and public.is_org_admin(p_organization_id))
    or (p_team_id is not null and public.can_manage_team(p_team_id));
$$;

-- Updated: a practice's equipment may now be the team's own shared asset
-- (any team_staff/owner can see and use it, regardless of org), the org's
-- assets (if the team is org-affiliated), or the building coach's own
-- personal assets. This replaces the previous version, which had no
-- team-owned option at all -- that's exactly the gap being closed here.
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
  from public.stations s
  join public.station_blocks sb on sb.id = s.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  join public.teams tm on tm.id = p.team_id
  join public.assets ast on ast.id = p_asset_id
  where s.id = p_station_id;
$$;
