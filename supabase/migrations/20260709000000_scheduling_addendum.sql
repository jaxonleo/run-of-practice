-- ROP-Scheduling-Addendum.md: recurring schedules, team colors, planned
-- absences. See supabase/migrations/README.md for migration conventions.

alter table public.teams
  add column color_primary text,
  add column color_secondary text;

alter table public.practices
  add column sublocation_id uuid references public.sublocations(id),
  add column scheduled_duration_minutes int;

alter table public.practices drop constraint practices_status_check;
alter table public.practices add constraint practices_status_check
  check (status in ('draft', 'scheduled', 'completed', 'cancelled'));

-- A series is metadata remembering the recurrence pattern ("Tue/Thu 6pm")
-- for bulk this-and-future edits and display. The generated `practices`
-- rows are the source of truth for actual occurrences -- recurrence is
-- materialized up front, never dynamically expanded.
create table public.practice_series (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  days_of_week int[] not null,
  start_time time not null,
  duration_minutes int not null,
  location_id uuid references public.locations(id),
  sublocation_id uuid references public.sublocations(id),
  range_start date not null,
  range_end date not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index practice_series_team_id_idx on public.practice_series (team_id);

alter table public.practices add column series_id uuid references public.practice_series(id);

alter table public.practice_series enable row level security;

create policy "practice_series_select_access" on public.practice_series
  for select using (public.can_access_team(team_id));
create policy "practice_series_insert_manage" on public.practice_series
  for insert with check (public.can_manage_team(team_id) and created_by = auth.uid());
create policy "practice_series_update_manage" on public.practice_series
  for update using (public.can_manage_team(team_id));

grant select, insert, update on public.practice_series to authenticated;

-- The coach recording what they were told in advance -- not a parent input
-- surface (see addendum's positioning boundary). Per-practice rows
-- deliberately, no date-range table: a multi-select in the UI just creates
-- N rows. The historical truth of who actually attended lives in
-- session_attendance, not here -- this table is only the advance notice.
create table public.planned_absences (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  noted_by uuid not null references public.profiles(id),
  note text,
  created_at timestamptz not null default now(),
  unique (practice_id, player_id)
);
create index planned_absences_practice_id_idx on public.planned_absences (practice_id);
create index planned_absences_player_id_idx on public.planned_absences (player_id);

alter table public.planned_absences enable row level security;

-- Gated on can_access_practice (reused from chunk3), not a narrower
-- can-manage check -- helpers may both see and record, matching the
-- attendance-marking precedent.
create policy "planned_absences_select_access" on public.planned_absences
  for select using (public.can_access_practice(practice_id));
create policy "planned_absences_insert_access" on public.planned_absences
  for insert with check (public.can_access_practice(practice_id) and noted_by = auth.uid());
create policy "planned_absences_delete_access" on public.planned_absences
  for delete using (public.can_access_practice(practice_id));

grant select, insert, delete on public.planned_absences to authenticated;

-- Atomically creates the series row + every generated practices row.
-- security invoker (like link_preview_to_live_session) with an explicit
-- can_manage_team guard, not security definer -- this is an authenticated
-- write path, not an anon read path. Occurrence timestamps are computed
-- with `AT TIME ZONE`, which is DST-correct for the specific date, so a
-- 6pm practice stays 6pm team-local across the spring/fall transitions.
-- Hard caps (range <= 400 days, occurrences <= 150) are the backstop the
-- addendum asks for -- the client must never loop inserts itself.
create or replace function public.create_practice_series(
  p_team_id uuid,
  p_days_of_week int[],
  p_start_time time,
  p_duration_minutes int,
  p_range_start date,
  p_range_end date,
  p_location_id uuid default null,
  p_sublocation_id uuid default null,
  p_deselected_dates date[] default '{}'
)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_tz text;
  v_series_id uuid;
  v_dates date[];
  v_count int;
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'not authorized';
  end if;
  if p_range_end < p_range_start then
    raise exception 'range_end must be on or after range_start';
  end if;
  if p_range_end - p_range_start > 400 then
    raise exception 'range too large (max 400 days)';
  end if;
  if p_days_of_week is null or array_length(p_days_of_week, 1) is null then
    raise exception 'days_of_week must not be empty';
  end if;

  select timezone into v_tz from public.teams where id = p_team_id;
  v_tz := coalesce(v_tz, 'UTC');

  select array_agg(d::date) into v_dates
  from generate_series(p_range_start::timestamp, p_range_end::timestamp, interval '1 day') d
  where extract(dow from d)::int = any(p_days_of_week)
    and d::date <> all(coalesce(p_deselected_dates, '{}'));

  v_count := coalesce(array_length(v_dates, 1), 0);
  if v_count = 0 then
    raise exception 'no occurrences generated for the given days/range';
  end if;
  if v_count > 150 then
    raise exception 'too many occurrences (max 150, got %)', v_count;
  end if;

  insert into public.practice_series
    (team_id, days_of_week, start_time, duration_minutes, location_id, sublocation_id, range_start, range_end, created_by)
  values
    (p_team_id, p_days_of_week, p_start_time, p_duration_minutes, p_location_id, p_sublocation_id, p_range_start, p_range_end, auth.uid())
  returning id into v_series_id;

  insert into public.practices (team_id, location_id, sublocation_id, scheduled_at, scheduled_duration_minutes, series_id, status)
  select p_team_id, p_location_id, p_sublocation_id, (d + p_start_time) at time zone v_tz, p_duration_minutes, v_series_id, 'scheduled'
  from unnest(v_dates) as d;

  return jsonb_build_object('series_id', v_series_id, 'count', v_count);
end;
$$;

grant execute on function public.create_practice_series(uuid, int[], time, int, date, date, uuid, uuid, date[]) to authenticated;
