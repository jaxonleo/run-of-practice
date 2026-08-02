-- Enhancement 1, Skill-Development Trends. One batch RPC returning every
-- configured goal category's weekly Planned/Actual/Target for the team's
-- rolling window, bucketed Monday-Sunday in the *team's* timezone (never
-- device timezone, never bare UTC truncation -- same rule this schema
-- already follows everywhere else, see localDateStr()/scheduledAtToTeamLocal
-- in the client).
--
-- Deliberate difference from get_team_goal_report, documented per the
-- spec's own instruction: get_team_goal_report's "planned" bucket is
-- forward-looking (currently scheduled practices in the window), because
-- its job is "what's coming up." Trends' planned bucket is backward-looking
-- instead -- the plan that was actually saved for each *completed* session,
-- via practice_activity_planned_minutes(session's own practice_id) -- so
-- Planned and Actual compare the exact same practice cohort per the spec's
-- "Weekly dataset" section, rather than mixing a past-actual week against a
-- present-tense "what's scheduled now" planned figure.
--
-- Only categories with a currently-saved goal are returned (spec: "Display
-- one compact card per configured goal category"), sorted by
-- skill_categories.sort_order -- the same order the Goals editor and
-- get_team_goal_report's own skill list already use.
create function public.get_team_goal_trends(p_team_id uuid, p_window_weeks int default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
  if not public.can_access_team(p_team_id) then
    raise exception 'not authorized';
  end if;

  select goals_window_weeks, coalesce(timezone, 'UTC') into v_window, v_tz
  from public.teams where id = p_team_id;
  -- Same 1-12 cap get_team_goal_report/the Goals editor already enforce.
  v_window := greatest(1, least(12, coalesce(p_window_weeks, v_window, 4)));

  v_local_today := (now() at time zone v_tz)::date;
  -- Monday of the current local week: extract(dow) is Sunday=0..Saturday=6,
  -- so (dow+6)%7 gives days-since-Monday for every day including Sunday.
  v_current_week_start := v_local_today - (((extract(dow from v_local_today)::int + 6) % 7));
  v_first_week_start := v_current_week_start - ((v_window - 1) * 7);
  -- Interpreting a bare local date as midnight in the team's own zone (not
  -- UTC) before converting to a real instant -- DST-safe the same way
  -- create_practice_series's own AT TIME ZONE math already is.
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
      coalesce((select array_agg(row(m.library_activity_id, m.pa_type, m.minutes)::public.activity_minute_row)
                from public.session_activity_minutes(s.session_id) m), '{}'::public.activity_minute_row[]) as rows
    from sessions s
  ),
  planned_rows as (
    select s.session_id, s.week_start_local,
      coalesce((select array_agg(row(m.library_activity_id, m.pa_type, m.minutes)::public.activity_minute_row)
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
$$;

grant execute on function public.get_team_goal_trends(uuid, int) to authenticated;
