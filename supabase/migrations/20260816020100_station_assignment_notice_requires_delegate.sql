-- Companion to 20260816020000: since update_station_content now refuses a
-- coach who isn't can_build_practices-eligible even if they're currently a
-- station's team_staff_id (e.g. reassigned live as physical leader only),
-- the assignment notice shouldn't tell them to "Build My Station" either --
-- that would be a real dead end, a notice promising something the RPC will
-- now actually refuse. Only fires for a coach who can really act on it.
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
  if new.team_staff_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.team_staff_id is not distinct from new.team_staff_id then
    return new;
  end if;

  select ts.user_id, p.team_id, p.id, p.name
    into v_assigned_user_id, v_team_id, v_practice_id, v_practice_name
  from public.team_staff ts
  join public.station_blocks sb on sb.id = new.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  where ts.id = new.team_staff_id and ts.can_build_practices;

  if v_assigned_user_id is null or v_assigned_user_id = auth.uid() then
    return new;
  end if;

  insert into public.station_assignment_notices (station_id, practice_id, team_id, assigned_user_id, assigned_by, station_name, practice_name)
  values (new.id, v_practice_id, v_team_id, v_assigned_user_id, auth.uid(), new.name, v_practice_name);

  return new;
end;
$$;
