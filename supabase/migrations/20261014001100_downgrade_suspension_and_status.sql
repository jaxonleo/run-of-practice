-- Free / Pro / Organization packaging, Phase E (downgrade): suspended
-- delegations and the client reads for paused teams and the active-team
-- chooser. Nothing is deleted or cleared anywhere.
--
-- 1. Delegation suspension. can_build_practice_for_team (every RLS policy
--    and RPC that lets a delegate plan) and update_station_content (station
--    delegates) now also require the team plan's
--    delegation.practice_planning. On Free the grants are suspended, not
--    cleared; a delegate mid-edit gets the existing NOT_AUTHORIZED refusal,
--    which MyStationBuilder already turns into its "no longer delegated"
--    banner with Copy My Notes.
-- 2. get_teams_plan_status(team ids): per accessible team, whether its
--    owner's plan covers it (team_is_plan_active) and whether delegated
--    planning is allowed, in one round trip for fetchMyTeams.
-- 3. get_my_team_plan_status(): the caller's personal-team cap, how many
--    active personal teams they own, their chosen active team, and when
--    they may next switch, for the downgrade chooser and catalog T3.

create function public.get_teams_plan_status(p_team_ids uuid[])
returns table (team_id uuid, plan_active boolean, delegation_allowed boolean)
language sql
security definer
stable
set search_path = public
as $$
  select t.id,
         public.team_is_plan_active(t.id),
         coalesce(public.team_can_access_feature(t.id, 'delegation.practice_planning'), false)
  from public.teams t
  where t.id = any(p_team_ids[1:200]) and public.can_access_team(t.id);
$$;

revoke all on function public.get_teams_plan_status(uuid[]) from public;
grant execute on function public.get_teams_plan_status(uuid[]) to authenticated;

create function public.get_my_team_plan_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_resolved jsonb;
  v_owned integer;
  v_chosen uuid;
  v_changed timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  v_resolved := public.resolve_entitlement('user', auth.uid(), null, 'teams.personal_count');
  select count(*)::integer into v_owned from public.teams
    where owner_user_id = auth.uid() and organization_id is null and archived_at is null;
  select ps.active_personal_team_id, ps.active_team_changed_at into v_chosen, v_changed
    from public.entitlement_plan_state ps
    where ps.subject_type = 'user' and ps.user_id = auth.uid();
  -- A chosen team that was archived since no longer counts as a choice.
  if v_chosen is not null and not exists (
    select 1 from public.teams where id = v_chosen and archived_at is null and organization_id is null and owner_user_id = auth.uid()
  ) then
    v_chosen := null;
  end if;
  return jsonb_build_object(
    'limit', case when v_resolved ->> 'state' in ('full', 'preview') then (v_resolved ->> 'limit_value')::integer else 0 end,
    'owned_active', v_owned,
    'chosen_team_id', v_chosen,
    'changed_at', v_changed,
    'next_switch_at', case when v_chosen is not null and v_changed is not null then v_changed + interval '30 days' end
  );
end;
$$;

revoke all on function public.get_my_team_plan_status() from public;
grant execute on function public.get_my_team_plan_status() to authenticated;

-- can_build_practice_for_team: deployed body plus the plan check.
CREATE OR REPLACE FUNCTION public.can_build_practice_for_team(p_team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.team_staff ts
    where ts.team_id = p_team_id
      and ts.user_id = auth.uid()
      and ts.can_build_practices
      and ts.archived_at is null
  )
  -- Packaging Phase E: a delegation grant only counts while the team's plan
  -- includes delegated planning. The can_build_practices flag itself is
  -- never cleared, so an upgrade restores every grant as it was.
  and public.team_can_access_feature(p_team_id, 'delegation.practice_planning');
$function$;

-- update_station_content: deployed body plus the plan check on the
-- caller's delegation.
CREATE OR REPLACE FUNCTION public.update_station_content(p_practice_id uuid, p_activity_id uuid, p_station_id uuid, p_name text, p_description text, p_coaching_points text, p_library_activity_id uuid, p_sublocation_id uuid, p_grouping text, p_num_groups integer, p_equipment_asset_ids uuid[], p_benchmark_id uuid DEFAULT NULL::uuid, p_benchmark_version_id uuid DEFAULT NULL::uuid, p_set_benchmark boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id uuid;
  v_station_delegated_to uuid;
  v_caller_team_staff_id uuid;
  v_asset_id uuid;
  v_tag_snapshot uuid[];
  v_sublocation_name text;
begin
  select p.team_id, s.delegated_to
    into v_team_id, v_station_delegated_to
  from public.stations s
  join public.station_blocks sb on sb.id = s.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  where s.id = p_station_id
    and sb.practice_activity_id = p_activity_id
    and pa.practice_id = p_practice_id
    and s.archived_at is null
    and pa.archived_at is null;

  if v_team_id is null then
    raise exception 'STATION_NOT_FOUND: this station no longer exists in this plan' using errcode = 'P0002';
  end if;

  select ts.id into v_caller_team_staff_id
  from public.team_staff ts
  where ts.id = v_station_delegated_to
    and ts.user_id = auth.uid()
    and ts.can_build_practices
    and ts.archived_at is null
    and public.team_can_access_feature(v_team_id, 'delegation.practice_planning');

  if not (public.can_manage_team(v_team_id) or v_caller_team_staff_id is not null) then
    raise exception 'NOT_AUTHORIZED: you are not delegated to plan this station' using errcode = '42501';
  end if;

  if p_library_activity_id is not null then
    select array_agg(skill_tag_id) into v_tag_snapshot from public.drill_tags where activity_library_id = p_library_activity_id;
  end if;
  if p_sublocation_id is not null then
    select name into v_sublocation_name from public.sublocations where id = p_sublocation_id;
  end if;

  update public.stations set
    name = p_name,
    description = p_description,
    coaching_points = p_coaching_points,
    library_activity_id = p_library_activity_id,
    sublocation_id = p_sublocation_id,
    tag_snapshot = v_tag_snapshot,
    sublocation_name_snapshot = v_sublocation_name,
    grouping = coalesce(p_grouping, 'whole'),
    num_groups = p_num_groups,
    benchmark_id = case when p_set_benchmark then p_benchmark_id else benchmark_id end,
    benchmark_version_id = case when p_set_benchmark then p_benchmark_version_id else benchmark_version_id end,
    station_updated_at = now(),
    station_updated_by = (
      select id from public.team_staff
      where user_id = auth.uid() and team_id = v_team_id and archived_at is null
      limit 1
    )
  where id = p_station_id;

  delete from public.station_equipment where station_id = p_station_id;
  if p_equipment_asset_ids is not null then
    foreach v_asset_id in array p_equipment_asset_ids loop
      if v_asset_id is not null and public.can_link_asset_to_station(p_station_id, v_asset_id) then
        insert into public.station_equipment (station_id, asset_id)
        values (p_station_id, v_asset_id)
        on conflict (station_id, asset_id) do nothing;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'station_id', p_station_id);
end;
$function$;
