-- Re-point the real write-access gate and the assignment notice at the new
-- delegated_to column instead of team_staff_id -- see the previous
-- migration's comment for why the two were split apart. Same
-- "re-declare whole function" constraint Postgres always has.
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
  v_station_delegated_to uuid;
  v_caller_team_staff_id uuid;
  v_asset_id uuid;
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

-- The notice-firing trigger moves from team_staff_id to delegated_to too --
-- it was always meant to mean "you've been asked to plan this," which is
-- exactly what delegated_to now represents on its own, cleanly.
drop trigger if exists station_assignment_notify on public.stations;

create or replace function public.notify_station_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assigned_user_id uuid;
  v_team_id uuid;
  v_practice_id uuid;
  v_practice_name text;
begin
  if new.delegated_to is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.delegated_to is not distinct from new.delegated_to then
    return new;
  end if;

  select ts.user_id, p.team_id, p.id, p.name
    into v_assigned_user_id, v_team_id, v_practice_id, v_practice_name
  from public.team_staff ts
  join public.station_blocks sb on sb.id = new.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  where ts.id = new.delegated_to and ts.can_build_practices;

  if v_assigned_user_id is null or v_assigned_user_id = auth.uid() then
    return new;
  end if;

  insert into public.station_assignment_notices (station_id, practice_id, team_id, assigned_user_id, assigned_by, station_name, practice_name)
  values (new.id, v_practice_id, v_team_id, v_assigned_user_id, auth.uid(), new.name, v_practice_name);

  return new;
end;
$$;

create trigger station_assignment_notify
  after insert or update of delegated_to on public.stations
  for each row execute function public.notify_station_assignment();
