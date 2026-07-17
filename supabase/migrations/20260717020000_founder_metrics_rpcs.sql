-- Founder metrics dashboard (ROP-Founder-Metrics-Handoff.md, core v1 --
-- landing-page visitor funnel, planning-time, and monetization stubs
-- deferred to a later pass). Two RPCs rather than the handoff doc's
-- "internal view + thin wrapper RPC" pattern -- this schema's house style
-- for reporting is one plpgsql function per report with an admin/access
-- check as the first statement and a single jsonb_build_object return
-- (see get_team_goal_report, get_team_session_history). Split into a fast
-- "summary" (hero cards + north-star trend) and a heavier "detail" (funnel,
-- cohorts, value metrics) so the frontend can render progressively.
--
-- Completion truth throughout is practice_live_sessions.status='completed'
-- and excluded_at is null (never practices.status -- nothing writes
-- 'completed' there in practice, confirmed in get_team_goal_report's own
-- comment). Helper identity comes from user_events.entity_id (a
-- session_access_tokens.id) joined to its live_session_id -- helpers never
-- write to session_activity_log.

create function public.get_founder_metrics_summary(p_weeks int default 12)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  with
  weeks as (
    select generate_series(
      date_trunc('week', now()) - ((p_weeks - 1) || ' weeks')::interval,
      date_trunc('week', now()),
      interval '1 week'
    ) as wk
  ),
  live_sessions_completed as (
    select id, practice_id, controller_user_id, ended_at
    from public.practice_live_sessions
    where status = 'completed' and excluded_at is null
  ),
  live_by_week as (
    select date_trunc('week', ended_at) wk, count(*) n
    from live_sessions_completed
    group by 1
  ),
  wac_by_week as (
    select date_trunc('week', created_at) wk, count(distinct user_id) n
    from public.user_events
    where event_type in ('practice_created', 'session_start')
    group by 1
  ),
  signups_by_week as (
    select date_trunc('week', created_at) wk, count(*) n
    from public.profiles
    group by 1
  ),
  helpers_by_week as (
    select date_trunc('week', created_at) wk, count(*) n
    from public.user_events
    where event_type = 'helper_join'
    group by 1
  ),
  weekly_rows as (
    select
      w.wk,
      coalesce(l.n, 0) live_practices,
      coalesce(wa.n, 0) weekly_active_coaches,
      coalesce(s.n, 0) signups,
      coalesce(h.n, 0) helper_joins
    from weeks w
    left join live_by_week l on l.wk = w.wk
    left join wac_by_week wa on wa.wk = w.wk
    left join signups_by_week s on s.wk = w.wk
    left join helpers_by_week h on h.wk = w.wk
  ),
  per_coach as (
    select controller_user_id, count(*) runs
    from live_sessions_completed
    group by 1
  ),
  repeat_coach as (
    select
      count(*) filter (where runs >= 2)::numeric / nullif(count(*), 0) repeat_rate,
      count(*) coaches_with_run
    from per_coach
  ),
  recent_sessions as (
    select id from live_sessions_completed where ended_at >= now() - interval '4 weeks'
  ),
  recent_helper_joins as (
    select count(*) n
    from public.user_events ue
    join public.session_access_tokens sat on sat.id = ue.entity_id
    where ue.event_type = 'helper_join'
      and sat.live_session_id in (select id from recent_sessions)
  ),
  planned as (
    select id from public.practices
    where status in ('scheduled', 'completed')
      and archived_at is null
      and scheduled_at is not null
      and scheduled_at <= now()
      and scheduled_at >= now() - interval '4 weeks'
  ),
  ran as (
    select distinct practice_id from live_sessions_completed
    where practice_id in (select id from planned)
  )
  select jsonb_build_object(
    'weekly', coalesce((select jsonb_agg(jsonb_build_object(
      'wk', wk, 'live_practices', live_practices, 'weekly_active_coaches', weekly_active_coaches,
      'signups', signups, 'helper_joins', helper_joins
    ) order by wk) from weekly_rows), '[]'::jsonb),
    'repeat_coach', (select jsonb_build_object('repeat_rate', repeat_rate, 'coaches_with_run', coaches_with_run) from repeat_coach),
    'helpers_per_practice_trailing4', (
      select case when (select count(*) from recent_sessions) > 0
        then round((select n from recent_helper_joins)::numeric / (select count(*) from recent_sessions), 2)
        else 0 end
    ),
    'plan_to_run_trailing4', jsonb_build_object(
      'rate', case when (select count(*) from planned) > 0
        then round((select count(*) from ran)::numeric / (select count(*) from planned), 3)
        else null end,
      'planned_count', (select count(*) from planned),
      'ran_count', (select count(*) from ran)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_founder_metrics_summary(int) from public;
grant execute on function public.get_founder_metrics_summary(int) to authenticated;

create function public.get_founder_metrics_detail(p_weeks int default 12)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  with
  cohort_profiles as (
    select id, date_trunc('week', created_at) cohort_wk, created_at
    from public.profiles
    where created_at >= now() - (p_weeks || ' weeks')::interval
  ),
  funnel_rows as (
    select
      cp.cohort_wk,
      count(*) signups,
      count(*) filter (where exists (
        select 1 from public.user_events e where e.user_id = cp.id and e.event_type = 'team_created'
          and e.created_at <= cp.created_at + interval '14 days')) made_team,
      count(*) filter (where exists (
        select 1 from public.user_events e where e.user_id = cp.id and e.event_type = 'practice_created'
          and e.created_at <= cp.created_at + interval '14 days')) made_plan,
      count(*) filter (where exists (
        select 1 from public.user_events e where e.user_id = cp.id and e.event_type = 'session_start'
          and e.created_at <= cp.created_at + interval '14 days')) ran_live
    from cohort_profiles cp
    group by 1
  ),
  activity as (
    select distinct user_id, date_trunc('week', created_at) act_wk
    from public.user_events
    where event_type in ('practice_created', 'session_start') and user_id is not null
  ),
  retention_rows as (
    select
      cp.cohort_wk,
      (extract(epoch from a.act_wk - cp.cohort_wk) / 604800)::int wk_offset,
      count(distinct cp.id) active_users
    from cohort_profiles cp
    join activity a on a.user_id = cp.id
      and a.act_wk between cp.cohort_wk and cp.cohort_wk + interval '8 weeks'
    group by 1, 2
  ),
  cohort_sizes as (
    select cohort_wk, count(*) signups from cohort_profiles group by 1
  ),
  reuse_rows as (
    select date_trunc('week', pa.created_at) wk,
      count(*) filter (where pa.library_activity_id is not null) reused,
      count(*) total
    from public.practice_activities pa
    where pa.archived_at is null
      and pa.created_at >= now() - (p_weeks || ' weeks')::interval
    group by 1
  ),
  active_teams as (
    select distinct p.team_id
    from public.practices p
    join public.user_events e on e.entity_id = p.id and e.event_type = 'practice_created'
    where e.created_at >= now() - interval '4 weeks'
  ),
  goal_teams as (
    select distinct team_id from public.team_goals where archived_at is null
  )
  select jsonb_build_object(
    'activation_funnel', coalesce((select jsonb_agg(jsonb_build_object(
      'cohort_wk', cohort_wk, 'signups', signups, 'made_team', made_team,
      'made_plan', made_plan, 'ran_live', ran_live
    ) order by cohort_wk) from funnel_rows), '[]'::jsonb),
    'retention', coalesce((select jsonb_agg(jsonb_build_object(
      'cohort_wk', cohort_wk, 'wk_offset', wk_offset, 'active_users', active_users
    ) order by cohort_wk, wk_offset) from retention_rows), '[]'::jsonb),
    'cohort_sizes', coalesce((select jsonb_agg(jsonb_build_object(
      'cohort_wk', cohort_wk, 'signups', signups
    ) order by cohort_wk) from cohort_sizes), '[]'::jsonb),
    'library_reuse', coalesce((select jsonb_agg(jsonb_build_object(
      'wk', wk,
      'reuse_rate', case when total > 0 then round(reused::numeric / total, 3) else 0 end,
      'total_activities', total
    ) order by wk) from reuse_rows), '[]'::jsonb),
    'goals_adoption', jsonb_build_object(
      'adoption_rate', case when (select count(*) from active_teams) > 0
        then round((select count(*) from active_teams at2 where at2.team_id in (select team_id from goal_teams))::numeric
          / (select count(*) from active_teams), 3)
        else null end,
      'active_team_count', (select count(*) from active_teams)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_founder_metrics_detail(int) from public;
grant execute on function public.get_founder_metrics_detail(int) to authenticated;
