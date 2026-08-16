-- Real gap found from direct feedback: "how is it clear I want them to
-- design the station, not just run it?" -- the Coach picker in Builder
-- (pre-live) was deliberately narrowed to can_build_practices-eligible
-- coaches (20260816, Builder: gate Assign Leader picker), but the *live*
-- reassignment picker (Practice Setup / CommandScreen's SetupStationBlockRow)
-- was correctly left open to any roster coach or a freeform helper name --
-- that one has always been about who's physically running the station, not
-- an editing grant. The problem: update_station_content's own authorization
-- check only verified "is the caller currently this station's
-- team_staff_id," never re-checking can_build_practices itself. A head
-- coach reassigning a station's live leader to a coach who was never
-- granted Share Practice Planning would silently ALSO hand that coach
-- editing rights to the station's content, via the exact same RPC a real
-- delegate uses -- an unintended side effect of a picker that was supposed
-- to be edit-permission-neutral. Fixed by requiring can_build_practices in
-- the RPC's own re-check, not just relying on Builder's picker having
-- filtered the option list -- the RPC is the real security boundary here,
-- so it needs to enforce the same rule the UI only ever suggested. Same
-- "re-declare whole function" constraint, full body from 20260816000400.
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

  -- can_build_practices required here, not just a team_staff_id match --
  -- being set as a station's live leader (a different, unrestricted
  -- picker) must never be a backdoor into edit rights for a coach who was
  -- never actually granted Share Practice Planning.
  select ts.id into v_caller_team_staff_id
  from public.team_staff ts
  where ts.id = v_station_team_staff_id
    and ts.user_id = auth.uid()
    and ts.can_build_practices
    and ts.archived_at is null;

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
