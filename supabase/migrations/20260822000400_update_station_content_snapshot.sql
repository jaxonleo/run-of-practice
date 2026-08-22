-- update_station_content (Multi-Coach Builder's atomic per-station RPC) is
-- a second write path into stations that bypasses saveActivityTree
-- entirely -- without this, a station a delegated coach edits directly
-- through their own MyStationBuilderScreen would never get the
-- tag_snapshot/sublocation_name_snapshot durability fields the rest of
-- practice-building (savePracticeTree/saveActivityTree, supabase.js)
-- already stamps. Same body otherwise, verbatim (confirmed via
-- pg_get_functiondef before writing this).
create or replace function public.update_station_content(p_practice_id uuid, p_activity_id uuid, p_station_id uuid, p_name text, p_description text, p_coaching_points text, p_library_activity_id uuid, p_sublocation_id uuid, p_grouping text, p_num_groups integer, p_equipment_asset_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    and ts.archived_at is null;

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
