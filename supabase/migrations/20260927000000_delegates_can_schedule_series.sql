-- Direct feedback: an assistant coach the head coach granted practice
-- planning (team_staff.can_build_practices) should be able to schedule a
-- practice, or a recurring series, for that team -- not just fill in plans
-- someone else scheduled. A single practice already works server-side
-- (practices_insert_manage has allowed can_build_practice_for_team since
-- 20260801070000, with the delegate-aware location check from
-- 20260805090000); only the series path was still head-coach-only, in two
-- places: create_practice_series's own up-front check, and
-- practice_series's insert/update policies (the RPC is security invoker, so
-- those policies apply to its insert too). The practices it generates keep
-- going through practices_insert_manage, location check included, exactly
-- as before.
--
-- Same OR clause every other delegated-planning gate uses. Team settings,
-- roster, and staff administration stay on can_manage_team alone.

drop policy if exists "practice_series_insert_manage" on public.practice_series;
create policy "practice_series_insert_manage" on public.practice_series
  for insert with check (
    (public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id))
    and created_by = auth.uid()
  );

drop policy if exists "practice_series_update_manage" on public.practice_series;
create policy "practice_series_update_manage" on public.practice_series
  for update using (public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id));

-- Body unchanged from 20260709000000 except the authorization check.
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
  if not (public.can_manage_team(p_team_id) or public.can_build_practice_for_team(p_team_id)) then
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
