-- Direct feedback: Insights (Goals & Insights' Untagged row, and Home's
-- Development Pulse "data quality" state in particular) was reading
-- non-station "Practice Components" -- Intro/Closer/Checklist/Water
-- Break/Stretch/Other, added via addComponentType() in App.jsx, always
-- saved as practice_activities.type='checklist' -- as untagged practice
-- time needing a skill tag. These are administrative/structural entries,
-- never real library drills (no library_activity_id, never taggable at
-- all), so counting them in the attribution denominator both inflated
-- "untagged" and understated every real category's percentage -- e.g. 10
-- minutes of admin time in a 60-minute practice where 25 minutes went to
-- one category should read as that category being ~50% of *measured*
-- practice time (25 of 50 attributable minutes), not ~42% (25 of 60).
--
-- practice_activities.type already has a 'break' value that every
-- attribution query already excludes from its denominator entirely
-- (20260715060000_break_activity_type.sql) -- it was simply never wired
-- up from the Builder UI, which always writes 'checklist' for every
-- non-station component regardless of which of the 7 types was picked.
-- Rather than repurpose 'checklist' into 'break' client-side (checklist
-- item-tracking/"N/M covered" rendering elsewhere in the app keys off
-- type==='checklist' and would break), this extends every existing
-- 'break' exclusion to also exclude 'checklist', server-side only.
--
-- Two call sites: the shared attribution helpers
-- (20260802000000_goal_attribution_shared_helpers.sql), which
-- get_team_goal_trends/get_session_execution_scorecard/Drill Insights all
-- compose on top of and therefore need no changes of their own; and
-- get_team_goal_report's own inline CTEs (not built on the shared
-- helpers -- it predates them), copied here verbatim from its current
-- live definition (20260804000000_goal_report_usable_session_count.sql,
-- confirmed via pg_get_functiondef before writing this, per this
-- project's own documented migration-drift history) with only the
-- pa_type filters changed. get_team_session_history's own 'break' filter
-- (session_tags, used for top_skills only) needs no change -- a
-- checklist-type row already has no library_activity_id and so never
-- joins drill_tags in the first place; the filter there is already a
-- no-op for this case.

create or replace function public.category_minutes_from_rows(p_rows public.activity_minute_row[])
returns table(skill_category_id uuid, minutes numeric)
language sql stable security definer set search_path = public as $$
  with tag_counts as (
    select activity_library_id, count(*) as n_tags from public.drill_tags group by activity_library_id
  ),
  base as (select (r).library_activity_id, (r).pa_type, (r).minutes from unnest(p_rows) as r)
  select st.category_id as skill_category_id, sum(b.minutes / nullif(tc.n_tags, 0)) as minutes
  from base b
  join public.drill_tags dt on dt.activity_library_id = b.library_activity_id
  join tag_counts tc on tc.activity_library_id = b.library_activity_id
  join public.skill_tags st on st.id = dt.skill_tag_id
  where b.pa_type is distinct from 'break' and b.pa_type is distinct from 'checklist'
  group by st.category_id;
$$;

create or replace function public.total_attributable_minutes(p_rows public.activity_minute_row[])
returns numeric
language sql immutable security definer set search_path = public as $$
  select coalesce(sum((r).minutes), 0) from unnest(p_rows) as r
  where (r).pa_type is distinct from 'break' and (r).pa_type is distinct from 'checklist';
$$;

create or replace function public.get_team_goal_report(p_team_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_window int;
  v_result jsonb;
begin
  if not public.can_access_team(p_team_id) then
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
      lr.log_id, lr.session_id, lr.pa_type, lr.library_activity_id,
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
    select pa.id as pa_id, pa.type as pa_type, pa.library_activity_id, pa.duration_minutes::numeric as minutes
    from public.practice_activities pa
    join planned_practices pp on pp.id = pa.practice_id
    where pa.archived_at is null and pa.type <> 'station_block'
  ),
  planned_station_rows as (
    select stn.id as pa_id, 'activity'::text as pa_type, stn.library_activity_id,
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
  actual_categories as (
    select st.category_id as skill_category_id, sum(a.minutes / nullif(tc.n_tags,0)) as minutes
    from actual_attributed a
    join public.drill_tags dt on dt.activity_library_id = a.library_activity_id
    join tag_counts tc on tc.activity_library_id = a.library_activity_id
    join public.skill_tags st on st.id = dt.skill_tag_id
    where a.pa_type is distinct from 'break' and a.pa_type is distinct from 'checklist'
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
    select skill_category_id from actual_categories
    union
    select skill_category_id from planned_categories
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
      left join planned_categories pt on pt.skill_category_id = gc.skill_category_id
      left join actual_categories atg on atg.skill_category_id = gc.skill_category_id
      cross join planned_denom pd
      cross join actual_denom ad
    ), '[]'::jsonb),
    'untagged', jsonb_build_object(
      'planned_minutes', round((pd2.total - coalesce((select sum(minutes) from planned_categories), 0)), 2),
      'planned_pct', case when pd2.total > 0 then round(((pd2.total - coalesce((select sum(minutes) from planned_categories),0)) / pd2.total * 100),1) else 0 end,
      'actual_minutes', round((ad2.total - coalesce((select sum(minutes) from actual_categories), 0)), 2),
      'actual_pct', case when ad2.total > 0 then round(((ad2.total - coalesce((select sum(minutes) from actual_categories),0)) / ad2.total * 100),1) else 0 end
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
