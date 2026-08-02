-- Enhancement 5, Practice Execution Scorecard. Structured measures, not a
-- single quality score (spec: "do not create an artificial single score").
--
-- Execution-unit grain, confirmed against the real logging model before
-- writing this (session_activity_log_exactly_one_target's own check
-- constraint, plus how the live run screen and
-- get_team_goal_report/get_team_session_history already read this table):
-- every non-station_block practice_activity is one unit, keyed by
-- practice_activity_id; every individual station inside a station_block is
-- its own unit, keyed by station_id. The station_block container itself is
-- never a loggable unit -- "skipped" is judged per station, never per
-- block, matching the spec's explicit warning not to label a whole block
-- skipped just because logs live at the station grain.
create function public.get_session_execution_scorecard(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_team_id uuid;
  v_practice_id uuid;
  v_scheduled_duration int;
  v_result jsonb;
begin
  select p.team_id, p.id, p.scheduled_duration_minutes
    into v_team_id, v_practice_id, v_scheduled_duration
  from public.practice_live_sessions pls
  join public.practices p on p.id = pls.practice_id
  where pls.id = p_session_id;

  if v_team_id is null then
    raise exception 'session not found';
  end if;
  if not public.can_access_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  with
  sess as (
    select pls.created_at, pls.ended_at, pls.excluded_at
    from public.practice_live_sessions pls where pls.id = p_session_id
  ),
  units as (
    select pa.id as unit_id, 'activity'::text as unit_kind, pa.name as unit_name,
      pa.type as pa_type, pa.duration_minutes as planned_minutes,
      (pa.duration_minutes * 60)::int as planned_seconds, pa.library_activity_id
    from public.practice_activities pa
    where pa.practice_id = v_practice_id and pa.archived_at is null and pa.type <> 'station_block'
    union all
    select stn.id, 'station', coalesce(nullif(stn.name, ''), 'Station ' || stn.position::text),
      'activity', round(coalesce(sb.station_duration_seconds, 0) / 60.0, 1),
      coalesce(sb.station_duration_seconds, 0), stn.library_activity_id
    from public.stations stn
    join public.station_blocks sb on sb.id = stn.station_block_id
    join public.practice_activities pa on pa.id = sb.practice_activity_id
    where pa.practice_id = v_practice_id and stn.archived_at is null
  ),
  unit_logs as (
    select
      coalesce(sal.practice_activity_id, sal.station_id) as unit_id,
      sal.manually_added,
      extract(epoch from (sal.ended_at - sal.started_at))::numeric as secs
    from public.session_activity_log sal
    where sal.session_id = p_session_id and sal.ended_at is not null
      and sal.ended_at > sal.started_at
  ),
  unit_actuals as (
    select unit_id, sum(secs) as actual_seconds, bool_and(manually_added) as all_manually_added, count(*) as log_count
    from unit_logs group by unit_id
  ),
  unit_tags as (
    select u.unit_id, jsonb_agg(distinct sc.name) as category_names
    from units u
    join public.drill_tags dt on dt.activity_library_id = u.library_activity_id
    join public.skill_tags st on st.id = dt.skill_tag_id
    join public.skill_categories sc on sc.id = st.category_id
    group by u.unit_id
  ),
  unit_rows as (
    select
      u.unit_id, u.unit_kind, u.unit_name, u.planned_minutes, u.planned_seconds,
      ua.actual_seconds, coalesce(ua.all_manually_added, false) as logged_but_not_captured,
      coalesce(ut.category_names, '[]'::jsonb) as category_names
    from units u
    left join unit_actuals ua on ua.unit_id = u.unit_id
    left join unit_tags ut on ut.unit_id = u.unit_id
  ),
  -- Same planned/actual category attribution the goal report uses, so the
  -- "largest differences" summary matches what Goals & Insights would say
  -- about this same practice, not a competing calculation.
  actual_rows as (
    select array_agg(row(m.library_activity_id, m.pa_type, m.minutes)::public.activity_minute_row) as rows
    from public.session_activity_minutes(p_session_id) m
  ),
  planned_rows as (
    select array_agg(row(m.library_activity_id, m.pa_type, m.minutes)::public.activity_minute_row) as rows
    from public.practice_activity_planned_minutes(v_practice_id) m
  ),
  actual_cat as (select * from public.category_minutes_from_rows((select coalesce(rows, '{}') from actual_rows))),
  planned_cat as (select * from public.category_minutes_from_rows((select coalesce(rows, '{}') from planned_rows))),
  actual_cat_total as (select public.total_attributable_minutes((select coalesce(rows, '{}') from actual_rows)) as total),
  planned_cat_total as (select public.total_attributable_minutes((select coalesce(rows, '{}') from planned_rows)) as total),
  cat_compare as (
    select coalesce(ac.skill_category_id, pc.skill_category_id) as skill_category_id,
      case when act.total > 0 then round(coalesce(ac.minutes, 0) / act.total * 100, 1) else 0 end as actual_pct,
      case when pct.total > 0 then round(coalesce(pc.minutes, 0) / pct.total * 100, 1) else 0 end as planned_pct
    from actual_cat ac
    full outer join planned_cat pc on pc.skill_category_id = ac.skill_category_id
    cross join actual_cat_total act
    cross join planned_cat_total pct
  ),
  attendance as (
    select count(*) as present_count
    from (
      select distinct on (sa.player_id) sa.player_id, sa.status
      from public.session_attendance sa where sa.session_id = p_session_id
      order by sa.player_id, sa.created_at desc
    ) latest
    where latest.status = 'present'
  ),
  roster as (
    select count(*) as roster_count from public.players pl where pl.team_id = v_team_id and pl.archived_at is null
  ),
  planned_total as (select coalesce(sum(planned_minutes), 0) as minutes from units),
  logged_total as (select coalesce(sum(actual_seconds), 0) / 60.0 as minutes from unit_rows where actual_seconds is not null)
  select jsonb_build_object(
    'session_id', p_session_id,
    'excluded', (select excluded_at is not null from sess),
    'planned_duration_minutes', v_scheduled_duration,
    'actual_wall_minutes', (select round(extract(epoch from (coalesce(ended_at, now()) - created_at)) / 60.0, 1) from sess),
    'planned_activity_minutes', round((select minutes from planned_total), 1),
    'logged_activity_minutes', round((select minutes from logged_total), 1),
    'plan_completion_count', (select count(*) from unit_rows where actual_seconds is not null),
    'plan_total_count', (select count(*) from unit_rows),
    'other_transition_minutes', round(greatest(0,
      (select round(extract(epoch from (coalesce((select ended_at from sess), now()) - (select created_at from sess))) / 60.0, 1))
      - (select minutes from logged_total)
    ), 1),
    'attendance_present_count', coalesce((select present_count from attendance), 0),
    'roster_count', coalesce((select roster_count from roster), 0),
    'category_comparison', coalesce((
      select jsonb_agg(jsonb_build_object(
        'skill_category_id', cc.skill_category_id, 'name', sc.name,
        'planned_pct', cc.planned_pct, 'actual_pct', cc.actual_pct,
        'diff_pts', round(cc.actual_pct - cc.planned_pct, 1)
      ) order by abs(cc.actual_pct - cc.planned_pct) desc)
      from cat_compare cc join public.skill_categories sc on sc.id = cc.skill_category_id
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unit_id', ur.unit_id, 'unit_kind', ur.unit_kind, 'name', ur.unit_name,
        'planned_minutes', ur.planned_minutes, 'planned_seconds', ur.planned_seconds,
        'actual_seconds', ur.actual_seconds,
        'logged_but_not_captured', ur.logged_but_not_captured,
        'category_names', ur.category_names
      ))
      from unit_rows ur
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_session_execution_scorecard(uuid) to authenticated;
