-- Free / Pro / Organization packaging, Phase B part 4 of 4: boolean
-- feature locks on the Pro-only RPCs, the delegation error-code
-- standardization, benchmarks, and the inactive-team refusals.
--
-- Every function below is redefined from its exact deployed body with only
-- the guard lines added, so behavior for an entitled team is unchanged.
--
-- Not gated, on purpose: get_drill_insight_summaries returns only usage
-- counts, which back the Library's free "Most Used" sort; only the full
-- get_drill_insights detail (the actual Drill Insights view) is Pro.
-- Live execution is never gated on an active team: start_or_join_live_session
-- refuses only to START a new run on a team the owner's plan no longer
-- covers (an already-running session can always be joined), and the
-- practices trigger lets status/archive changes through so a run that was
-- already going can always finish.

CREATE OR REPLACE FUNCTION public.get_session_execution_scorecard(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not public.can_view_goals_for_team(v_team_id) then
    raise exception 'not authorized';
  end if;
  perform public.enforce_team_feature_full(v_team_id, 'goals.execution_scorecard');
  if not public.session_history_visible(p_session_id) then
    perform public.raise_entitlement_limit('history.practice_history', null, null);
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
  actual_rows as (
    select array_agg(row(m.library_activity_id, m.pa_type, m.minutes, m.tag_ids_snapshot)::public.activity_minute_row) as rows
    from public.session_activity_minutes(p_session_id) m
  ),
  planned_rows as (
    select array_agg(row(m.library_activity_id, m.pa_type, m.minutes, m.tag_ids_snapshot)::public.activity_minute_row) as rows
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
$function$;

CREATE OR REPLACE FUNCTION public.get_team_goal_trends(p_team_id uuid, p_window_weeks integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_window int;
  v_tz text;
  v_local_today date;
  v_current_week_start date;
  v_first_week_start date;
  v_range_start_utc timestamptz;
  v_range_end_utc timestamptz;
  v_result jsonb;
begin
  if not public.can_view_goals_for_team(p_team_id) then
    raise exception 'not authorized';
  end if;
  perform public.enforce_team_feature_full(p_team_id, 'goals.trends');

  select goals_window_weeks, coalesce(timezone, 'UTC') into v_window, v_tz
  from public.teams where id = p_team_id;
  v_window := greatest(1, least(12, coalesce(p_window_weeks, v_window, 4)));

  v_local_today := (now() at time zone v_tz)::date;
  v_current_week_start := v_local_today - (((extract(dow from v_local_today)::int + 6) % 7));
  v_first_week_start := v_current_week_start - ((v_window - 1) * 7);
  v_range_start_utc := (v_first_week_start::timestamp) at time zone v_tz;
  v_range_end_utc := ((v_current_week_start + 7)::timestamp) at time zone v_tz;

  with
  categories as (
    select sc.id as skill_category_id, sc.name, sc.sort_order, tg.target_pct
    from public.skill_categories sc
    join public.team_goals tg on tg.skill_category_id = sc.id and tg.team_id = p_team_id and tg.archived_at is null
    where sc.sport = (select sport from public.teams where id = p_team_id)
  ),
  weeks as (
    select generate_series(v_first_week_start, v_current_week_start, interval '7 days')::date as week_start_local
  ),
  sessions as (
    select pls.id as session_id, pls.practice_id,
      date_trunc('week', pls.ended_at at time zone v_tz)::date as week_start_local
    from public.practice_live_sessions pls
    join public.practices p on p.id = pls.practice_id
    where p.team_id = p_team_id
      and pls.status = 'completed'
      and pls.excluded_at is null
      and pls.ended_at >= v_range_start_utc
      and pls.ended_at < v_range_end_utc
  ),
  actual_rows as (
    select s.session_id, s.week_start_local,
      coalesce((select array_agg(row(m.library_activity_id, m.pa_type, m.minutes, m.tag_ids_snapshot)::public.activity_minute_row)
                from public.session_activity_minutes(s.session_id) m), '{}'::public.activity_minute_row[]) as rows
    from sessions s
  ),
  planned_rows as (
    select s.session_id, s.week_start_local,
      coalesce((select array_agg(row(m.library_activity_id, m.pa_type, m.minutes, m.tag_ids_snapshot)::public.activity_minute_row)
                from public.practice_activity_planned_minutes(s.practice_id) m), '{}'::public.activity_minute_row[]) as rows
    from sessions s
  ),
  actual_session_totals as (
    select session_id, week_start_local, public.total_attributable_minutes(rows) as total from actual_rows
  ),
  planned_session_totals as (
    select session_id, week_start_local, public.total_attributable_minutes(rows) as total from planned_rows
  ),
  actual_session_cat as (
    select ar.session_id, ar.week_start_local, cm.skill_category_id, cm.minutes
    from actual_rows ar cross join lateral public.category_minutes_from_rows(ar.rows) cm
  ),
  planned_session_cat as (
    select pr.session_id, pr.week_start_local, cm.skill_category_id, cm.minutes
    from planned_rows pr cross join lateral public.category_minutes_from_rows(pr.rows) cm
  ),
  week_actual_totals as (
    select week_start_local, sum(total) as total, bool_or(total > 0) as has_usable
    from actual_session_totals group by week_start_local
  ),
  week_planned_totals as (
    select week_start_local, sum(total) as total from planned_session_totals group by week_start_local
  ),
  week_actual_cat as (
    select week_start_local, skill_category_id, sum(minutes) as minutes
    from actual_session_cat group by week_start_local, skill_category_id
  ),
  week_planned_cat as (
    select week_start_local, skill_category_id, sum(minutes) as minutes
    from planned_session_cat group by week_start_local, skill_category_id
  ),
  week_session_counts as (
    select week_start_local, count(*) as n from sessions group by week_start_local
  )
  select jsonb_build_object(
    'window_weeks', v_window,
    'team_timezone', v_tz,
    'has_any_completed_sessions', exists(select 1 from sessions),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'skill_category_id', c.skill_category_id,
        'skill_category_name', c.name,
        'target_pct', c.target_pct,
        'weeks', (
          select jsonb_agg(jsonb_build_object(
            'week_start_local', w.week_start_local,
            'week_end_local', w.week_start_local + 6,
            'planned_minutes', case when wpt.total is null then null else round(coalesce(wpc.minutes, 0), 2) end,
            'planned_pct', case when wpt.total is null or wpt.total = 0 then null else round(coalesce(wpc.minutes, 0) / wpt.total * 100, 1) end,
            'actual_minutes', case when wat.total is null then null else round(coalesce(wac.minutes, 0), 2) end,
            'actual_pct', case when wat.total is null or wat.total = 0 then null else round(coalesce(wac.minutes, 0) / wat.total * 100, 1) end,
            'completed_session_count', coalesce(wsc.n, 0),
            'has_usable_actual_time', coalesce(wat.has_usable, false)
          ) order by w.week_start_local)
          from weeks w
          left join week_actual_totals wat on wat.week_start_local = w.week_start_local
          left join week_planned_totals wpt on wpt.week_start_local = w.week_start_local
          left join week_actual_cat wac on wac.week_start_local = w.week_start_local and wac.skill_category_id = c.skill_category_id
          left join week_planned_cat wpc on wpc.week_start_local = w.week_start_local and wpc.skill_category_id = c.skill_category_id
          left join week_session_counts wsc on wsc.week_start_local = w.week_start_local
        )
      ) order by c.sort_order)
      from categories c
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_drill_insights(p_library_activity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner_user_id uuid;
  v_organization_id uuid;
  v_result jsonb;
begin
  select owner_user_id, organization_id into v_owner_user_id, v_organization_id
  from public.activity_library where id = p_library_activity_id;

  if v_owner_user_id is null and v_organization_id is null then
    raise exception 'drill not found';
  end if;
  if not (v_owner_user_id = auth.uid() or (v_organization_id is not null and public.is_org_admin(v_organization_id))) then
    raise exception 'not authorized';
  end if;
  if coalesce(public.resolve_entitlement(
       case when v_organization_id is not null then 'organization' else 'user' end,
       case when v_organization_id is not null then null else v_owner_user_id end,
       v_organization_id, 'library.drill_insights') ->> 'state', '') <> 'full' then
    perform public.raise_entitlement_locked('library.drill_insights');
  end if;

  with occurrences as (
    select pa.id as unit_id, 'activity'::text as unit_kind, pa.duration_minutes::numeric as planned_minutes,
      p.id as practice_id, p.team_id, pls.id as session_id, pls.ended_at
    from public.practice_activities pa
    join public.practices p on p.id = pa.practice_id
    join public.practice_live_sessions pls on pls.practice_id = p.id and pls.status = 'completed' and pls.excluded_at is null
    where pa.library_activity_id = p_library_activity_id and pa.archived_at is null
      and public.can_access_team(p.team_id)
    union all
    select stn.id, 'station', round(coalesce(sb.station_duration_seconds, 0) / 60.0, 1),
      p.id, p.team_id, pls.id, pls.ended_at
    from public.stations stn
    join public.station_blocks sb on sb.id = stn.station_block_id
    join public.practice_activities pa on pa.id = sb.practice_activity_id
    join public.practices p on p.id = pa.practice_id
    join public.practice_live_sessions pls on pls.practice_id = p.id and pls.status = 'completed' and pls.excluded_at is null
    where stn.library_activity_id = p_library_activity_id and stn.archived_at is null
      and public.can_access_team(p.team_id)
  ),
  occurrence_actuals as (
    select o.*,
      (select sum(extract(epoch from (sal.ended_at - sal.started_at))) / 60.0
       from public.session_activity_log sal
       where sal.session_id = o.session_id and sal.ended_at is not null and sal.ended_at > sal.started_at
         and (case when o.unit_kind = 'activity' then sal.practice_activity_id = o.unit_id else sal.station_id = o.unit_id end)
      ) as actual_minutes
    from occurrences o
  ),
  used as (select * from occurrence_actuals where actual_minutes is not null),
  window_counts as (
    select
      count(*) filter (where ended_at >= now() - interval '4 weeks') as n4w,
      count(*) filter (where ended_at >= now() - interval '12 weeks') as n12w,
      count(*) filter (where ended_at >= now() - interval '12 months') as n12mo,
      count(*) as n_all,
      max(ended_at) as last_used,
      avg(planned_minutes) as avg_planned,
      avg(actual_minutes) as avg_actual
    from used
  ),
  variance_counts as (
    select
      count(*) filter (where (actual_minutes * 60 - planned_minutes * 60) > 60) as n_extended,
      count(*) filter (where (planned_minutes * 60 - actual_minutes * 60) > 60) as n_shortened,
      count(*) filter (where abs(actual_minutes * 60 - planned_minutes * 60) <= 60) as n_on_plan,
      count(*) as n_total
    from used
  ),
  -- "Skipped" here means a planned occurrence in a completed session with
  -- no usable log at all -- only reliably countable, per the spec, when
  -- every occurrence for this drill is a plain activity (not inside a
  -- station block, where a missing log is ambiguous between "skipped" and
  -- "logged at the block/phase level"). Omitted (null) rather than a
  -- guessed number when any station occurrences exist.
  skip_eligible as (select bool_and(unit_kind = 'activity') as all_plain from occurrences),
  skipped as (select count(*) as n from occurrence_actuals where actual_minutes is null and unit_kind = 'activity'),
  teams_ctx as (
    select jsonb_agg(distinct jsonb_build_object('team_id', t.id, 'team_name', t.name, 'sport', t.sport)) as teams
    from occurrences o join public.teams t on t.id = o.team_id
  ),
  history as (
    select jsonb_agg(jsonb_build_object(
      'session_id', oa.session_id, 'practice_id', oa.practice_id, 'team_name', t.name,
      'ended_at', oa.ended_at, 'planned_minutes', round(oa.planned_minutes, 1),
      'actual_minutes', case when oa.actual_minutes is null then null else round(oa.actual_minutes, 1) end,
      'diff_minutes', case when oa.actual_minutes is null then null else round(oa.actual_minutes - oa.planned_minutes, 1) end
    ) order by oa.ended_at desc) as rows
    from occurrence_actuals oa join public.teams t on t.id = oa.team_id
  ),
  note_practice_ids as (select distinct practice_id from occurrences),
  recent_notes as (
    select jsonb_agg(jsonb_build_object(
      'note_id', n.id, 'text', n.text, 'created_at', n.created_at,
      'author_kind', n.author_kind, 'author_label', n.author_label,
      'author_name', coalesce(prof.first_name || ' ' || prof.last_name, ts.first_name || ' ' || ts.last_name)
    ) order by n.created_at desc) as rows
    from (
      select n.* from public.notes n
      where n.practice_id in (select practice_id from note_practice_ids)
        and n.archived_at is null
        and (
          n.practice_activity_id in (select unit_id from occurrences where unit_kind = 'activity')
          or n.station_id in (select unit_id from occurrences where unit_kind = 'station')
        )
      order by n.created_at desc
      limit 5
    ) n
    left join public.profiles prof on prof.id = n.created_by
    left join public.team_staff ts on ts.user_id = n.created_by and ts.team_id = (select team_id from occurrences o where o.practice_id = n.practice_id limit 1)
  )
  select jsonb_build_object(
    'library_activity_id', p_library_activity_id,
    'uses_last_4_weeks', coalesce((select n4w from window_counts), 0),
    'uses_last_12_weeks', coalesce((select n12w from window_counts), 0),
    'uses_trailing_12_months', coalesce((select n12mo from window_counts), 0),
    'uses_all_time', coalesce((select n_all from window_counts), 0),
    'last_used_at', (select last_used from window_counts),
    'avg_planned_minutes', (select round(avg_planned, 1) from window_counts),
    'avg_actual_minutes', (select round(avg_actual, 1) from window_counts),
    'pct_extended', case when (select n_total from variance_counts) > 0 then round((select n_extended from variance_counts)::numeric / (select n_total from variance_counts) * 100, 0) else null end,
    'pct_shortened', case when (select n_total from variance_counts) > 0 then round((select n_shortened from variance_counts)::numeric / (select n_total from variance_counts) * 100, 0) else null end,
    'pct_on_plan', case when (select n_total from variance_counts) > 0 then round((select n_on_plan from variance_counts)::numeric / (select n_total from variance_counts) * 100, 0) else null end,
    'skipped_count', case when (select all_plain from skip_eligible) then (select n from skipped) else null end,
    'teams', coalesce((select teams from teams_ctx), '[]'::jsonb),
    'usage_history', coalesce((select rows from history), '[]'::jsonb),
    'recent_notes', coalesce((select rows from recent_notes), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_practice_delegate(p_team_staff_id uuid, p_can_build boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id uuid;
  v_current_count integer;
begin
  select team_id into v_team_id from public.team_staff where id = p_team_staff_id;
  if v_team_id is null or not public.can_manage_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  if p_can_build then
    select count(*) into v_current_count from public.team_staff
    where team_id = v_team_id and can_build_practices and archived_at is null and id <> p_team_staff_id;

    if not public.team_can_use_counted_feature(v_team_id, 'delegation.practice_planning', v_current_count) then
      perform public.raise_entitlement_limit('delegation.practice_planning',
        (public.team_resolve_entitlement(v_team_id, 'delegation.practice_planning') ->> 'limit_value')::integer, v_current_count);
    end if;
  end if;

  update public.team_staff
  set can_build_practices = p_can_build
  where id = p_team_staff_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_benchmark(p_organization_id uuid, p_sport text, p_title text, p_subject_mode text, p_protocol jsonb, p_source_drill_id uuid DEFAULT NULL::uuid, p_source_benchmark_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner uuid; v_bid uuid; v_vid uuid;
begin
  if p_organization_id is null then
    v_owner := auth.uid();
  else
    v_owner := null;
    if not public.is_org_admin(p_organization_id) then raise exception 'not authorized for org'; end if;
  end if;
  if p_subject_mode not in ('individual', 'team') then raise exception 'bad subject_mode'; end if;
  if coalesce(public.resolve_entitlement(
       case when p_organization_id is not null then 'organization' else 'user' end,
       v_owner, p_organization_id, 'benchmarks.access') ->> 'state', '') <> 'full' then
    perform public.raise_entitlement_locked('benchmarks.access');
  end if;

  insert into public.benchmarks(owner_user_id, organization_id, sport, title, subject_mode, source_drill_id, source_benchmark_id, created_by)
  values (v_owner, p_organization_id, coalesce(p_sport, 'General'), p_title, p_subject_mode, p_source_drill_id, p_source_benchmark_id, auth.uid())
  returning id into v_bid;

  v_vid := public._benchmark_insert_version(v_bid, p_protocol, 1);
  insert into public.benchmark_audit(benchmark_id, entity_type, entity_id, action, actor_user_id, after)
  values (v_bid, 'benchmark', v_bid, 'created', auth.uid(), jsonb_build_object('version_id', v_vid));
  return jsonb_build_object('benchmark_id', v_bid, 'version_id', v_vid);
end;
$function$;

CREATE OR REPLACE FUNCTION public.adopt_benchmark_for_team(p_benchmark_id uuid, p_team_id uuid, p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if not (public.can_manage_team(p_team_id) or public.can_build_practice_for_team(p_team_id)) then raise exception 'not authorized'; end if;
  if not public.can_access_benchmark(p_benchmark_id) then raise exception 'benchmark not accessible'; end if;
  perform public.enforce_team_feature_full(p_team_id, 'benchmarks.access');
  insert into public.team_benchmarks(team_id, benchmark_id, adopted_version_id, created_by)
  values (p_team_id, p_benchmark_id, p_version_id, auth.uid())
  on conflict (team_id, benchmark_id) do update set adopted_version_id = excluded.adopted_version_id, archived_at = null, updated_at = now()
  returning id into v_id;
  return jsonb_build_object('team_benchmark_id', v_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_benchmark_assessment(p_team_id uuid, p_benchmark_id uuid, p_version_id uuid, p_occurrence_key text, p_practice_id uuid DEFAULT NULL::uuid, p_practice_activity_id uuid DEFAULT NULL::uuid, p_station_id uuid DEFAULT NULL::uuid, p_live_session_id uuid DEFAULT NULL::uuid, p_label text DEFAULT NULL::text, p_measured_at timestamp with time zone DEFAULT now(), p_measured_local_date date DEFAULT NULL::date, p_timezone text DEFAULT NULL::text, p_join_assessment_id uuid DEFAULT NULL::uuid, p_standalone boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_assessment_id uuid; v_created boolean := false;
  v_subject_mode text; v_tz text; v_ld date; v_present uuid[]; v_throwaway uuid;
begin
  if p_standalone then
    if not (public.can_manage_team(p_team_id) or public.can_build_practice_for_team(p_team_id)) then raise exception 'not authorized'; end if;
    if p_measured_at > now() then raise exception 'a standalone measurement cannot be in the future'; end if;
  else
    if not public.can_coach_team(p_team_id) then raise exception 'not authorized'; end if;
  end if;

  perform public.enforce_team_feature_full(p_team_id, 'benchmarks.access');

  select subject_mode into v_subject_mode from public.benchmarks where id = p_benchmark_id;
  select coalesce(p_timezone, timezone, 'UTC') into v_tz from public.teams where id = p_team_id;
  v_ld := coalesce(p_measured_local_date, (p_measured_at at time zone coalesce(v_tz, 'UTC'))::date);

  insert into public.team_benchmarks(team_id, benchmark_id, adopted_version_id, created_by)
  values (p_team_id, p_benchmark_id, p_version_id, auth.uid())
  on conflict (team_id, benchmark_id) do nothing;

  if p_join_assessment_id is not null then
    if not exists (
      select 1 from public.benchmark_assessments
      where id = p_join_assessment_id and team_id = p_team_id and protocol_version_id = p_version_id and state = 'recording'
    ) then raise exception 'cannot join that assessment (same practice / team / version, still recording)'; end if;
    v_assessment_id := p_join_assessment_id;
    insert into public.benchmark_assessment_sources(assessment_id, occurrence_key, practice_id, practice_activity_id, station_id, created_by)
    values (v_assessment_id, p_occurrence_key, p_practice_id, p_practice_activity_id, p_station_id, auth.uid())
    on conflict (occurrence_key) do nothing;
  else
    select assessment_id into v_assessment_id from public.benchmark_assessment_sources where occurrence_key = p_occurrence_key;
    if v_assessment_id is null then
      insert into public.benchmark_assessments(team_id, benchmark_id, protocol_version_id, live_session_id,
        practice_id, label, measured_at, measured_local_date, timezone, state, created_by)
      values (p_team_id, p_benchmark_id, p_version_id, p_live_session_id, p_practice_id, p_label,
        p_measured_at, v_ld, coalesce(v_tz, 'UTC'), 'recording', auth.uid())
      returning id into v_assessment_id;
      begin
        insert into public.benchmark_assessment_sources(assessment_id, occurrence_key, practice_id, practice_activity_id, station_id, created_by)
        values (v_assessment_id, p_occurrence_key, p_practice_id, p_practice_activity_id, p_station_id, auth.uid());
        v_created := true;
      exception when unique_violation then
        v_throwaway := v_assessment_id;
        select assessment_id into v_assessment_id from public.benchmark_assessment_sources where occurrence_key = p_occurrence_key;
        delete from public.benchmark_assessments where id = v_throwaway;
      end;
    end if;
  end if;

  -- Backfill the source-practice link on an existing, still-recording row.
  if not v_created and v_assessment_id is not null then
    update public.benchmark_assessments
      set live_session_id = coalesce(live_session_id, p_live_session_id),
          practice_id = coalesce(practice_id, p_practice_id)
      where id = v_assessment_id and state = 'recording'
        and (live_session_id is null or practice_id is null);
  end if;

  if v_created then
    update public.benchmark_versions set first_used_at = coalesce(first_used_at, now()) where id = p_version_id;

    if v_subject_mode = 'team' then
      insert into public.benchmark_participants(assessment_id, is_team_subject) values (v_assessment_id, true)
      on conflict do nothing;
    else
      if p_live_session_id is not null then
        select setup_present_player_ids into v_present from public.practice_live_sessions where id = p_live_session_id;
      end if;
      insert into public.benchmark_participants(assessment_id, player_id, player_name_snapshot, jersey_snapshot, status)
      select v_assessment_id, pl.id, pl.first_name || ' ' || left(pl.last_name, 1), pl.jersey_number, 'not_measured'
      from public.players pl
      where pl.team_id = p_team_id and pl.archived_at is null
        and (v_present is null or pl.id = any(v_present))
      on conflict do nothing;
    end if;

    insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id, after)
    values (v_assessment_id, 'assessment', v_assessment_id, 'created', auth.uid(),
      jsonb_build_object('occurrence_key', p_occurrence_key, 'standalone', p_standalone));
  end if;

  return jsonb_build_object('assessment_id', v_assessment_id, 'created', v_created);
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_or_join_live_session(p_practice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id uuid;
  v_row public.practice_live_sessions;
  v_created boolean := false;
  v_first_activity_id uuid;
  v_first_is_block boolean;
  v_my_staff_id uuid;
  v_default_present uuid[];
begin
  select team_id into v_team_id from public.practices where id = p_practice_id;
  if v_team_id is null or not public.can_coach_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  select id into v_my_staff_id from public.team_staff
    where team_id = v_team_id and user_id = auth.uid() and archived_at is null
    limit 1;

  select * into v_row from public.practice_live_sessions
    where practice_id = p_practice_id and status = 'active'
    order by created_at desc limit 1;

  if not found then
    if not public.team_is_plan_active(v_team_id) then
      perform public.raise_entitlement_limit('teams.personal_count', null, null);
    end if;

    select pa.id, (pa.type = 'station_block') into v_first_activity_id, v_first_is_block
      from public.practice_activities pa
      where pa.practice_id = p_practice_id and pa.archived_at is null
      order by pa.position asc limit 1;

    select coalesce(array_agg(p.id), '{}'::uuid[]) into v_default_present
      from public.players p
      where p.team_id = v_team_id and p.archived_at is null
        and not exists (
          select 1 from public.planned_absences pab
          where pab.practice_id = p_practice_id and pab.player_id = p.id
        );

    begin
      insert into public.practice_live_sessions(
        practice_id, status, controller_user_id, version,
        current_practice_activity_id, current_rotation_number,
        in_transition, in_block_intro,
        current_phase_started_at, paused_at, total_paused_seconds,
        setup_present_player_ids, setup_present_coach_ids
      ) values (
        p_practice_id, 'active', auth.uid(), 1,
        v_first_activity_id, 0,
        false, coalesce(v_first_is_block, false),
        now(), null, 0,
        v_default_present, case when v_my_staff_id is not null then array[v_my_staff_id] else '{}'::uuid[] end
      )
      returning * into v_row;
      v_created := true;
    exception when unique_violation then
      select * into v_row from public.practice_live_sessions
        where practice_id = p_practice_id and status = 'active'
        order by created_at desc limit 1;
      v_created := false;
    end;
  end if;

  if not v_created and v_row.setup_confirmed_at is null and v_my_staff_id is not null
     and not (v_my_staff_id = any(v_row.setup_present_coach_ids)) then
    update public.practice_live_sessions
      set setup_present_coach_ids = array_append(setup_present_coach_ids, v_my_staff_id),
          version = version + 1
      where id = v_row.id
      returning * into v_row;
  end if;

  return jsonb_build_object('session', to_jsonb(v_row), 'created', v_created);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_practice_series(p_team_id uuid, p_days_of_week integer[], p_start_time time without time zone, p_duration_minutes integer, p_range_start date, p_range_end date, p_location_id uuid DEFAULT NULL::uuid, p_sublocation_id uuid DEFAULT NULL::uuid, p_deselected_dates date[] DEFAULT '{}'::date[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_tz text;
  v_series_id uuid;
  v_dates date[];
  v_count int;
begin
  if not (public.can_manage_team(p_team_id) or public.can_build_practice_for_team(p_team_id)) then
    raise exception 'not authorized';
  end if;
  if not public.team_is_plan_active(p_team_id) then
    perform public.raise_entitlement_limit('teams.personal_count', null, null);
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
$function$;


-- Planning writes (savePracticeTree's practices insert/update, and any other
-- path) on a team the owner's plan no longer covers. Only creating a
-- practice or changing what/when it is counts as planning; status and
-- archive changes always go through so live runs and cleanup never break.
create function public.enforce_practice_team_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and (old.name, old.scheduled_at, old.scheduled_duration_minutes,
      old.location_id, old.sublocation_id, old.pre_practice_notes, old.team_id, old.template_id)
    is not distinct from (new.name, new.scheduled_at, new.scheduled_duration_minutes,
      new.location_id, new.sublocation_id, new.pre_practice_notes, new.team_id, new.template_id) then
    return new;
  end if;
  if not public.team_is_plan_active(new.team_id) then
    perform public.raise_entitlement_limit('teams.personal_count', null, null);
  end if;
  return new;
end;
$$;

create trigger enforce_practice_team_active
  before insert or update on public.practices
  for each row execute function public.enforce_practice_team_active();
