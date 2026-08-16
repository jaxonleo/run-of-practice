-- Multi-Coach Builder, the actual concurrency fix (see BUILD-STATUS.md
-- section 1 of the handoff this implements). savePracticeTree/
-- saveActivityTree write the ENTIRE activity tree on every Save -- a full
-- overwrite, not a per-row write. Two coaches saving different stations of
-- the same block around the same time today silently clobber each other.
-- This is the same failure class already fixed once for Practice Setup's
-- presence/attendance toggles (toggle_setup_presence, 20260813163000): one
-- atomic UPDATE touching only this station's own row, never a read of the
-- whole tree from client state.
--
-- Deliberately narrow: only the fields a station's assigned coach actually
-- fills in (drill identity, description, coaching points, grouping,
-- location, equipment). Skeleton fields -- id, position, station_block_id,
-- team_staff_id (who's assigned/leads it) -- are untouched here on purpose;
-- those stay head-coach-only via the existing savePracticeTree/
-- updateStationLead paths.
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
  -- Re-derive the station's real current team/leader from the DB, not from
  -- anything the client claims -- also doubles as the "does this station
  -- still exist, under this same activity/practice, unarchived" check.
  select p.team_id, s.team_staff_id
    into v_team_id, v_station_team_staff_id
  from public.stations s
  join public.station_blocks sb on sb.id = s.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  where s.id = p_station_id
    and sb.practice_activity_id = p_activity_id
    and pa.practice_id = p_practice_id
    and s.archived_at is null;

  if v_team_id is null then
    -- The head coach removed/restructured this station out from under the
    -- caller (or the ids never matched to begin with) -- a distinct,
    -- client-matchable error, not a bare RLS-style rejection.
    raise exception 'STATION_NOT_FOUND: this station no longer exists in this plan' using errcode = 'P0002';
  end if;

  select ts.id into v_caller_team_staff_id
  from public.team_staff ts
  where ts.id = v_station_team_staff_id and ts.user_id = auth.uid() and ts.archived_at is null;

  -- Either the head coach/org-admin, or literally the coach this exact
  -- station is currently assigned to (re-checked fresh above, so a coach
  -- reassigned away from this station mid-edit lands here too -- same
  -- distinct error, client tells the two cases apart by the message).
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

revoke all on function public.update_station_content(uuid, uuid, uuid, text, text, text, uuid, uuid, text, int, uuid[]) from public;
grant execute on function public.update_station_content(uuid, uuid, uuid, text, text, text, uuid, uuid, text, int, uuid[]) to authenticated;
