-- Delegated Planning spec, part 2: Goals & Insights view access, and
-- switching location team-availability from automatic to explicit opt-in.
--
-- Goals & Insights today (confirmed directly against the live schema, not
-- assumed) is gated purely on can_access_team -- any rostered team_staff
-- row, including a plain 'helper' with no build delegation, can already
-- read every report/history RPC, and the client renders Run Now/Save as
-- Template unconditionally regardless of role. The new spec requires: head
-- coach edits, a build-delegate (can_build_practices) reads, anyone else
-- sees nothing at all, not even the nav item. This function is the single
-- new authorization gate every Goals & Insights RPC below is switched to.
create function public.can_view_goals_for_team(p_team_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_team(p_team_id) or public.can_build_practice_for_team(p_team_id);
$$;

create or replace function public.get_team_goal_report(p_team_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_window int;
  v_result jsonb;
begin
  if not public.can_view_goals_for_team(p_team_id) then
    raise exception 'not authorized';
  end if;

  select goals_window_weeks into v_window from public.teams where id = p_team_id;
  v_window := coalesce(v_window, 4);

  with
  resolved_goals as (
    select skill_category_id, target_pct
    from public.team_goals
    where team_id = p_team_id and archived_at is null
  ),
  actual_sessions as (
    select pls.id as session_id, pls.created_at as session_started_at, pls.ended_at as session_ended_at
    from public.practice_live_sessions pls
    join public.practices p on p.id = pls.practice_id
    where p.team_id = p_team_id
      and pls.status = 'completed'
      and pls.excluded_at is null
      and pls.ended_at >= now() - (v_window || ' weeks')::interval
  ),
  actual_log_rows as (
    select
      sal.id as log_id, sal.session_id,
      pa.type as pa_type,
      coalesce(pa.library_activity_id, stn.library_activity_id) as library_activity_id,
      coalesce(pa.tag_snapshot, stn.tag_snapshot) as tag_snapshot,
      stn.station_block_id,
      extract(epoch from (
        least(coalesce(sal.ended_at, s.session_ended_at, now()), coalesce(s.session_ended_at, now()))
        - sal.started_at
      )) / 60.0 as raw_minutes
    from public.session_activity_log sal
    join actual_sessions s on s.session_id = sal.session_id
    left join public.practice_activities pa on pa.id = sal.practice_activity_id
    left join public.stations stn on stn.id = sal.station_id
  ),
  usable_actual_sessions as (
    select count(distinct session_id) as n from actual_log_rows where raw_minutes > 0
  ),
  actual_station_counts as (
    select session_id, station_block_id, count(*) as n_stations
    from actual_log_rows where station_block_id is not null
    group by session_id, station_block_id
  ),
  actual_attributed as (
    select
      lr.log_id, lr.session_id, lr.pa_type, lr.library_activity_id, lr.tag_snapshot,
      case when lr.station_block_id is not null
        then lr.raw_minutes / nullif(sc.n_stations, 0)
        else lr.raw_minutes
      end as minutes
    from actual_log_rows lr
    left join actual_station_counts sc
      on sc.session_id = lr.session_id and sc.station_block_id = lr.station_block_id
  ),
  planned_practices as (
    select p.id
    from public.practices p
    where p.team_id = p_team_id
      and p.status in ('draft','scheduled')
      and p.scheduled_at between now() and now() + (v_window || ' weeks')::interval
      and not exists (
        select 1 from public.practice_live_sessions pls
        where pls.practice_id = p.id and pls.status = 'completed' and pls.excluded_at is null
      )
  ),
  planned_activity_rows as (
    select pa.id as pa_id, pa.type as pa_type, pa.library_activity_id, pa.tag_snapshot, pa.duration_minutes::numeric as minutes
    from public.practice_activities pa
    join planned_practices pp on pp.id = pa.practice_id
    where pa.archived_at is null and pa.type <> 'station_block'
  ),
  planned_station_rows as (
    select stn.id as pa_id, 'activity'::text as pa_type, stn.library_activity_id, stn.tag_snapshot,
           coalesce(sb.station_duration_seconds,0)/60.0 as minutes
    from public.stations stn
    join public.station_blocks sb on sb.id = stn.station_block_id
    join public.practice_activities pa on pa.id = sb.practice_activity_id
    join planned_practices pp on pp.id = pa.practice_id
    where stn.archived_at is null
  ),
  planned_all as (
    select * from planned_activity_rows
    union all
    select * from planned_station_rows
  ),
  tag_counts as (
    select activity_library_id, count(*) as n_tags from public.drill_tags group by activity_library_id
  ),
  -- Category attribution, live-tags-first, snapshot-fallback-only-when-the-
  -- source-drill-is-gone (see 20260822000000's own comment on tag_snapshot
  -- for why the fallback never fires while the drill still exists).
  actual_categories as (
    select st.category_id as skill_category_id, sum(a.minutes / nullif(tc.n_tags,0)) as minutes
    from actual_attributed a
    join public.drill_tags dt on dt.activity_library_id = a.library_activity_id
    join tag_counts tc on tc.activity_library_id = a.library_activity_id
    join public.skill_tags st on st.id = dt.skill_tag_id
    where a.pa_type is distinct from 'break' and a.pa_type is distinct from 'checklist'
    group by st.category_id
    union all
    select st.category_id as skill_category_id, sum(a.minutes / nullif(array_length(a.tag_snapshot,1),0)) as minutes
    from actual_attributed a
    join public.skill_tags st on st.id = any(a.tag_snapshot)
    where a.pa_type is distinct from 'break' and a.pa_type is distinct from 'checklist'
      and a.library_activity_id is null and a.tag_snapshot is not null and array_length(a.tag_snapshot,1) > 0
    group by st.category_id
  ),
  planned_categories as (
    select st.category_id as skill_category_id, sum(pr.minutes / nullif(tc.n_tags,0)) as minutes
    from planned_all pr
    join public.drill_tags dt on dt.activity_library_id = pr.library_activity_id
    join tag_counts tc on tc.activity_library_id = pr.library_activity_id
    join public.skill_tags st on st.id = dt.skill_tag_id
    where pr.pa_type is distinct from 'break' and pr.pa_type is distinct from 'checklist'
    group by st.category_id
    union all
    select st.category_id as skill_category_id, sum(pr.minutes / nullif(array_length(pr.tag_snapshot,1),0)) as minutes
    from planned_all pr
    join public.skill_tags st on st.id = any(pr.tag_snapshot)
    where pr.pa_type is distinct from 'break' and pr.pa_type is distinct from 'checklist'
      and pr.library_activity_id is null and pr.tag_snapshot is not null and array_length(pr.tag_snapshot,1) > 0
    group by st.category_id
  ),
  actual_categories_summed as (
    select skill_category_id, sum(minutes) as minutes from actual_categories group by skill_category_id
  ),
  planned_categories_summed as (
    select skill_category_id, sum(minutes) as minutes from planned_categories group by skill_category_id
  ),
  actual_denom as (
    select coalesce(sum(minutes),0) as total from (
      select distinct log_id, minutes from actual_attributed where pa_type is distinct from 'break' and pa_type is distinct from 'checklist'
    ) x
  ),
  planned_denom as (
    select coalesce(sum(minutes),0) as total from (
      select distinct pa_id, minutes from planned_all where pa_type is distinct from 'break' and pa_type is distinct from 'checklist'
    ) x
  ),
  session_wall as (
    select s.session_id,
      extract(epoch from (s.session_ended_at - s.session_started_at))/60.0 as wall_minutes,
      coalesce((select sum(minutes) from actual_attributed a where a.session_id = s.session_id), 0) as attributed_minutes
    from actual_sessions s
  ),
  other_transitions as (
    select coalesce(sum(greatest(wall_minutes - attributed_minutes, 0)),0) as minutes from session_wall
  ),
  goal_categories as (
    select skill_category_id from resolved_goals
    union
    select skill_category_id from actual_categories_summed
    union
    select skill_category_id from planned_categories_summed
  ),
  practice_counts as (
    select
      (select count(*) from planned_practices) as planned_count,
      (select count(*) from actual_sessions) as completed_session_count,
      (select count(*) from public.practice_live_sessions pls join public.practices p on p.id=pls.practice_id
        where p.team_id = p_team_id and pls.status='completed' and pls.excluded_at is not null
        and pls.ended_at >= now() - (v_window || ' weeks')::interval) as excluded_session_count
  )
  select jsonb_build_object(
    'window_weeks', v_window,
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object(
        'skill_category_id', gc.skill_category_id,
        'name', sc.name,
        'target_pct', tg.target_pct,
        'planned_minutes', round(coalesce(pt.minutes,0), 2),
        'planned_pct', case when pd.total > 0 then round((coalesce(pt.minutes,0) / pd.total * 100), 1) else 0 end,
        'actual_minutes', round(coalesce(atg.minutes,0), 2),
        'actual_pct', case when ad.total > 0 then round((coalesce(atg.minutes,0) / ad.total * 100), 1) else 0 end
      ) order by sc.sort_order)
      from goal_categories gc
      join public.skill_categories sc on sc.id = gc.skill_category_id
      left join resolved_goals tg on tg.skill_category_id = gc.skill_category_id
      left join planned_categories_summed pt on pt.skill_category_id = gc.skill_category_id
      left join actual_categories_summed atg on atg.skill_category_id = gc.skill_category_id
      cross join planned_denom pd
      cross join actual_denom ad
    ), '[]'::jsonb),
    'untagged', jsonb_build_object(
      'planned_minutes', round((pd2.total - coalesce((select sum(minutes) from planned_categories_summed), 0)), 2),
      'planned_pct', case when pd2.total > 0 then round(((pd2.total - coalesce((select sum(minutes) from planned_categories_summed),0)) / pd2.total * 100),1) else 0 end,
      'actual_minutes', round((ad2.total - coalesce((select sum(minutes) from actual_categories_summed), 0)), 2),
      'actual_pct', case when ad2.total > 0 then round(((ad2.total - coalesce((select sum(minutes) from actual_categories_summed),0)) / ad2.total * 100),1) else 0 end
    ),
    'denominators', jsonb_build_object(
      'planned_minutes_total', round(pd2.total, 2),
      'actual_minutes_total', round(ad2.total, 2)
    ),
    'other_transition_minutes', round((select minutes from other_transitions), 2),
    'practices', jsonb_build_object(
      'planned_count', pc.planned_count,
      'completed_session_count', pc.completed_session_count,
      'excluded_session_count', pc.excluded_session_count,
      'usable_actual_session_count', coalesce((select n from usable_actual_sessions), 0)
    )
  ) into v_result
  from planned_denom pd2, actual_denom ad2, practice_counts pc;

  return v_result;
end;
$$;

grant execute on function public.get_team_goal_report(uuid) to authenticated;

-- Only the auth-check line changes for these two; bodies are otherwise
-- byte-identical to their current live definitions (confirmed via
-- pg_get_functiondef before writing this migration, per this project's own
-- documented drift-checking convention).
create or replace function public.get_team_goal_trends(p_team_id uuid, p_window_weeks integer default null::integer)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
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

grant execute on function public.get_team_goal_trends(uuid, integer) to authenticated;

create or replace function public.get_team_session_history(p_team_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_result jsonb;
begin
  if not public.can_view_goals_for_team(p_team_id) then
    raise exception 'not authorized';
  end if;

  with sessions as (
    select pls.id as session_id, pls.practice_id, pls.status, pls.created_at as session_started_at,
           pls.ended_at as session_ended_at, pls.excluded_at
    from public.practice_live_sessions pls
    join public.practices p on p.id = pls.practice_id
    where p.team_id = p_team_id and p.archived_at is null
      and (
        pls.status = 'completed'
        or (
          pls.status = 'abandoned'
          and pls.setup_confirmed_at is not null
          and exists (select 1 from public.session_activity_log sal0 where sal0.session_id = pls.id)
        )
      )
    order by pls.ended_at desc nulls last
    limit p_limit
  ),
  log_rows as (
    select
      sal.id as log_id, sal.session_id,
      pa.type as pa_type,
      coalesce(pa.library_activity_id, stn.library_activity_id) as library_activity_id,
      stn.station_block_id,
      sal.adjusted_at is not null as is_adjusted,
      extract(epoch from (least(coalesce(sal.ended_at, s.session_ended_at, now()), coalesce(s.session_ended_at, now())) - sal.started_at))/60.0 as raw_minutes
    from public.session_activity_log sal
    join sessions s on s.session_id = sal.session_id
    left join public.practice_activities pa on pa.id = sal.practice_activity_id
    left join public.stations stn on stn.id = sal.station_id
  ),
  station_counts as (
    select session_id, station_block_id, count(*) as n from log_rows where station_block_id is not null group by session_id, station_block_id
  ),
  attributed as (
    select lr.session_id, lr.log_id, lr.pa_type, lr.library_activity_id, lr.is_adjusted,
      case when lr.station_block_id is not null then lr.raw_minutes/nullif(sc.n,0) else lr.raw_minutes end as minutes
    from log_rows lr
    left join station_counts sc on sc.session_id=lr.session_id and sc.station_block_id=lr.station_block_id
  ),
  tag_counts as (select activity_library_id, count(*) as n_tags from public.drill_tags group by activity_library_id),
  session_tags as (
    select a.session_id, dt.skill_tag_id, sum(a.minutes/nullif(tc.n_tags,0)) as minutes
    from attributed a
    join public.drill_tags dt on dt.activity_library_id = a.library_activity_id
    join tag_counts tc on tc.activity_library_id = a.library_activity_id
    where a.pa_type is distinct from 'break'
    group by a.session_id, dt.skill_tag_id
  ),
  top_skills as (
    select session_id, jsonb_agg(jsonb_build_object('skill_tag_id',skill_tag_id,'name',name,'minutes',round(minutes,1)) order by minutes desc) as skills
    from (
      select st.session_id, st.skill_tag_id, sk.name, st.minutes,
        row_number() over (partition by st.session_id order by st.minutes desc) as rn
      from session_tags st
      join public.skill_tags sk on sk.id = st.skill_tag_id
    ) ranked
    where rn <= 3
    group by session_id
  ),
  session_adjusted as (
    select session_id, bool_or(is_adjusted) as any_adjusted from attributed group by session_id
  ),
  attendance as (
    select s.session_id, count(*) as present_count
    from sessions s
    left join lateral (
      select distinct on (sa.player_id) sa.player_id, sa.status
      from public.session_attendance sa where sa.session_id = s.session_id
      order by sa.player_id, sa.created_at desc
    ) latest on latest.status = 'present'
    group by s.session_id
  )
  select jsonb_agg(jsonb_build_object(
    'session_id', s.session_id,
    'practice_id', s.practice_id,
    'status', s.status,
    'ended_at', s.session_ended_at,
    'wall_minutes', round(extract(epoch from (coalesce(s.session_ended_at, now()) - s.session_started_at))/60.0, 1),
    'excluded', s.excluded_at is not null,
    'adjusted', coalesce(sa2.any_adjusted, false),
    'attendance_count', coalesce(att.present_count, 0),
    'top_skills', coalesce(ts.skills, '[]'::jsonb),
    'has_unviewed_notes', exists (
      select 1 from public.notes n
      where n.practice_id = s.practice_id and n.archived_at is null and n.viewed_at is null
    )
  ) order by s.session_ended_at desc nulls last)
  into v_result
  from sessions s
  left join session_adjusted sa2 on sa2.session_id = s.session_id
  left join attendance att on att.session_id = s.session_id
  left join top_skills ts on ts.session_id = s.session_id;

  return coalesce(v_result, '[]'::jsonb);
end;
$function$;

grant execute on function public.get_team_session_history(uuid, integer) to authenticated;

-- get_session_execution_scorecard: same treatment, one line for the auth
-- check plus the two row()::activity_minute_row casts widened for the new
-- attribute (see the companion attribution-durability migration).
create or replace function public.get_session_execution_scorecard(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
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

grant execute on function public.get_session_execution_scorecard(uuid) to authenticated;

-- Location team-availability: explicit opt-in, replacing the automatic
-- "any team_staff member's location is auto-usable by a build-delegate"
-- rule. can_access_location (personal ownership, or already-used-in-a-
-- practice-I-can-see) is untouched -- this only narrows what a *delegate*
-- can additionally pick for a *new* practice.
create or replace function public.can_use_location_for_team(p_location_id uuid, p_team_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    public.can_access_location(p_location_id)
    or (
      public.can_build_practice_for_team(p_team_id)
      and exists (
        select 1 from public.locations l
        join public.team_staff ts on ts.user_id = l.owner_user_id
        where l.id = p_location_id
          and ts.team_id = p_team_id
          and ts.archived_at is null
          and l.available_to_team_planners
      )
    );
$$;

-- Self-service toggle, owner-only (mirrors set_own_library_share's exact
-- shape) -- a coach opting their own location in or out for their team's
-- planners. Org-owned locations don't need this (already team-wide visible/
-- usable via can_access_owned), so this only ever meaningfully applies to
-- owner_user_id-owned rows.
create function public.set_location_team_availability(p_location_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.locations
  set available_to_team_planners = p_available
  where id = p_location_id and owner_user_id = auth.uid();

  if not found then
    raise exception 'not authorized';
  end if;
end;
$$;

grant execute on function public.set_location_team_availability(uuid, boolean) to authenticated;
