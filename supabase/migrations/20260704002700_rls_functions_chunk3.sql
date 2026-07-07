-- locations/templates reuse can_access_owned/can_manage_owned directly in
-- their own policies (same shape as assets/activity_library) -- no wrapper
-- needed. Everything below is for things that need to look up ownership
-- through a join chain.

create function public.can_access_location(p_location_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_owned(l.organization_id, l.owner_user_id)
  from public.locations l where l.id = p_location_id;
$$;

create function public.can_manage_location(p_location_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_owned(l.organization_id, l.owner_user_id)
  from public.locations l where l.id = p_location_id;
$$;

create function public.can_access_template_activity(p_template_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_owned(t.organization_id, t.owner_user_id)
  from public.template_activities ta
  join public.templates t on t.id = ta.template_id
  where ta.id = p_template_activity_id;
$$;

create function public.can_manage_template_activity(p_template_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_owned(t.organization_id, t.owner_user_id)
  from public.template_activities ta
  join public.templates t on t.id = ta.template_id
  where ta.id = p_template_activity_id;
$$;

-- Same rule as can_link_asset_to_activity, applied to a template's equipment
-- slots: org template -> only that org's assets; personal template -> the
-- owner's own assets, or any org they belong to.
create function public.can_link_asset_to_template_activity(p_template_activity_id uuid, p_asset_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when t.organization_id is not null then ast.organization_id = t.organization_id
      else (
        ast.owner_user_id = t.owner_user_id
        or (ast.organization_id is not null and public.is_org_member(ast.organization_id))
      )
    end
  from public.template_activities ta
  join public.templates t on t.id = ta.template_id
  join public.assets ast on ast.id = p_asset_id
  where ta.id = p_template_activity_id;
$$;

create function public.can_access_template_station_block(p_block_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_owned(t.organization_id, t.owner_user_id)
  from public.template_station_blocks b
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  where b.id = p_block_id;
$$;

create function public.can_manage_template_station_block(p_block_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_owned(t.organization_id, t.owner_user_id)
  from public.template_station_blocks b
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  where b.id = p_block_id;
$$;

create function public.can_access_template_station(p_station_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_owned(t.organization_id, t.owner_user_id)
  from public.template_stations s
  join public.template_station_blocks b on b.id = s.template_station_block_id
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  where s.id = p_station_id;
$$;

create function public.can_manage_template_station(p_station_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_owned(t.organization_id, t.owner_user_id)
  from public.template_stations s
  join public.template_station_blocks b on b.id = s.template_station_block_id
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  where s.id = p_station_id;
$$;

create function public.can_link_asset_to_template_station(p_station_id uuid, p_asset_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when t.organization_id is not null then ast.organization_id = t.organization_id
      else (
        ast.owner_user_id = t.owner_user_id
        or (ast.organization_id is not null and public.is_org_member(ast.organization_id))
      )
    end
  from public.template_stations s
  join public.template_station_blocks b on b.id = s.template_station_block_id
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  join public.assets ast on ast.id = p_asset_id
  where s.id = p_station_id;
$$;

-- Practices are team-scoped, not coach/org-scoped -- reuse can_access_team /
-- can_manage_team from chunk 1 by joining up to the practice's team.
create function public.can_access_practice(p_practice_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_team(p.team_id) from public.practices p where p.id = p_practice_id;
$$;

create function public.can_manage_practice(p_practice_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_team(p.team_id) from public.practices p where p.id = p_practice_id;
$$;

create function public.can_access_practice_activity(p_practice_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_team(p.team_id)
  from public.practice_activities pa
  join public.practices p on p.id = pa.practice_id
  where pa.id = p_practice_activity_id;
$$;

create function public.can_manage_practice_activity(p_practice_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_team(p.team_id)
  from public.practice_activities pa
  join public.practices p on p.id = pa.practice_id
  where pa.id = p_practice_activity_id;
$$;

-- Practice equipment compatibility: an org-affiliated team's practice can use
-- that org's assets OR the building coach's own personal assets. A personal
-- team (no org) can only use the building coach's own assets -- there is no
-- team-owned equipment pool, per the "assets belong to a coach or org, never
-- a team" decision. Known limitation: on a personal team with more than one
-- staff member and no shared org, one coach's equipment won't be visible in
-- full detail to a co-coach. Flagged, not solved, here.
create function public.can_link_asset_to_practice_activity(p_practice_activity_id uuid, p_asset_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when tm.organization_id is not null then (ast.organization_id = tm.organization_id or ast.owner_user_id = auth.uid())
      else (ast.owner_user_id = auth.uid())
    end
  from public.practice_activities pa
  join public.practices p on p.id = pa.practice_id
  join public.teams tm on tm.id = p.team_id
  join public.assets ast on ast.id = p_asset_id
  where pa.id = p_practice_activity_id;
$$;

create function public.can_access_station_block(p_station_block_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_team(p.team_id)
  from public.station_blocks sb
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  where sb.id = p_station_block_id;
$$;

create function public.can_manage_station_block(p_station_block_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_team(p.team_id)
  from public.station_blocks sb
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  where sb.id = p_station_block_id;
$$;

create function public.can_access_station(p_station_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_team(p.team_id)
  from public.stations s
  join public.station_blocks sb on sb.id = s.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  where s.id = p_station_id;
$$;

create function public.can_manage_station(p_station_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_team(p.team_id)
  from public.stations s
  join public.station_blocks sb on sb.id = s.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  where s.id = p_station_id;
$$;

create function public.can_link_asset_to_station(p_station_id uuid, p_asset_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when tm.organization_id is not null then (ast.organization_id = tm.organization_id or ast.owner_user_id = auth.uid())
      else (ast.owner_user_id = auth.uid())
    end
  from public.stations s
  join public.station_blocks sb on sb.id = s.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  join public.teams tm on tm.id = p.team_id
  join public.assets ast on ast.id = p_asset_id
  where s.id = p_station_id;
$$;
