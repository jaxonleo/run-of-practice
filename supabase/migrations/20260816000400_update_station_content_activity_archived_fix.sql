-- Real bug found on review, not yet hit live: update_station_content's own
-- existence check (20260816000100) verified the station row itself wasn't
-- archived, but never checked the containing practice_activities row --
-- saveActivityTree archives a removed activity (practice_activities.
-- archived_at) without cascading that archival down to its station_blocks/
-- stations children at all (station_blocks has no archived_at column of
-- its own; a station's archived_at is the only per-row archive flag in
-- this whole tree). fetchPracticesFull already filters practice_activities
-- by archived_at is null, so the client-side "is this still mine" check in
-- MyStationBuilder.jsx already treats a station whose parent activity was
-- just deleted as gone -- but a coach's write racing in the moment before
-- their next poll catches up could still land on an orphaned station row
-- whose own archived_at was never set, since the RPC's own re-derivation
-- didn't check the parent. Same "re-declare whole function" constraint
-- Postgres always has -- full body, not a patch.
create or replace function public.update_station_content(
  p_practice_id uuid,
  p_activity_id uuid,
  p_station_id uuid,
  p_name text,
  p_description text,
  p_coaching_points text,
  p_library_activity_id uuid,
  p_sublocation_id uuid,
  p_grouping text,
  p_num_groups int,
  p_equipment_asset_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_station_team_staff_id uuid;
  v_caller_team_staff_id uuid;
  v_asset_id uuid;
begin
  select p.team_id, s.team_staff_id
    into v_team_id, v_station_team_staff_id
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
  where ts.id = v_station_team_staff_id and ts.user_id = auth.uid() and ts.archived_at is null;

  if not (public.can_manage_team(v_team_id) or v_caller_team_staff_id is not null) then
    raise exception 'NOT_AUTHORIZED: you are not assigned to this station' using errcode = '42501';
  end if;

  update public.stations set
    name = p_name,
    description = p_description,
    coaching_points = p_coaching_points,
    library_activity_id = p_library_activity_id,
    sublocation_id = p_sublocation_id,
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
$$;
