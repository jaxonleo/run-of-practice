-- Multi-Coach Builder handoff section 8: a real push/in-app notice the
-- moment the head coach assigns a coach to a station -- required because
-- assignment timing and edit timing are decoupled (an assistant may be
-- assigned days before they ever open the app again). Same shape/RLS/ack
-- pattern as team_join_notices (20260803010000), just keyed to the
-- assigned coach (assigned_user_id) rather than to whoever manages the
-- team, and populated by a trigger rather than a single RPC -- unlike
-- accepting an invite, a station's team_staff_id can be written from more
-- than one place (Builder's savePracticeTree/saveActivityTree pre-live,
-- and updateStationLead live) and a trigger is the one place that's
-- guaranteed to see every real assignment regardless of which write path
-- made it, matching this codebase's own existing use of a trigger for the
-- same "don't rely on every call site remembering" reason
-- (claim_pending_team_staff).
create table public.station_assignment_notices (
  id uuid primary key default gen_random_uuid(),
  station_id uuid references public.stations(id) on delete set null,
  practice_id uuid not null references public.practices(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  assigned_user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  station_name text,
  practice_name text,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

comment on table public.station_assignment_notices is
  'One row per real station-assignment write (team_staff_id set/changed to a non-null value), surfaced as a Home notification to the assigned coach. station_id kept nullable/on delete set null since the notice is a historical record that should survive the station later being archived or restructured.';

alter table public.station_assignment_notices enable row level security;

create policy "station_assignment_notices_select" on public.station_assignment_notices
  for select to authenticated using (assigned_user_id = auth.uid());

grant select on public.station_assignment_notices to authenticated;

-- No direct write policy -- the trigger below (insert) and
-- acknowledge_station_assignment_notice (update) are the only ways to
-- touch this table, same narrow-write pattern team_join_notices/
-- team_departures already established.
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
  where ts.id = new.team_staff_id;

  -- A pending (not-yet-signed-up) staff row, or an assignment back to the
  -- caller's own row, has no notice to surface.
  if v_assigned_user_id is null or v_assigned_user_id = auth.uid() then
    return new;
  end if;

  insert into public.station_assignment_notices (station_id, practice_id, team_id, assigned_user_id, assigned_by, station_name, practice_name)
  values (new.id, v_practice_id, v_team_id, v_assigned_user_id, auth.uid(), new.name, v_practice_name);

  return new;
end;
$$;

create trigger station_assignment_notify
  after insert or update of team_staff_id on public.stations
  for each row execute function public.notify_station_assignment();

create function public.acknowledge_station_assignment_notice(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.station_assignment_notices
  set acknowledged_at = now()
  where id = p_notice_id and assigned_user_id = auth.uid();
end;
$$;

grant execute on function public.acknowledge_station_assignment_notice(uuid) to authenticated;
