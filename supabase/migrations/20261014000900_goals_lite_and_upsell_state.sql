-- Free / Pro / Organization packaging, Phase D: Goals lite server pieces.
--
-- 1. get_team_goal_report measures a fixed 4-week window when the team's
--    plan lacks goals.window_config (body otherwise identical to the
--    deployed version). Still uncapped otherwise: it reads every run, so
--    Development Pulse and the glance view keep using all data.
-- 2. get_team_completed_session_count: the team's total completed runs,
--    for the V1 / V2 / V5 value-moment triggers (2nd, 11th, 5th run).
-- 3. update_upsell_state: the one write path for profiles.upsell_state
--    (value-moment impressions, dismissals and snoozes, plus small trigger
--    counters and markers), so throttling carries across devices.

create function public.get_team_completed_session_count(p_team_id uuid)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select case when public.can_access_team(p_team_id) then (
    select count(*)::integer
    from public.practice_live_sessions pls
    join public.practices p on p.id = pls.practice_id
    where p.team_id = p_team_id and p.archived_at is null and pls.status = 'completed'
  ) end;
$$;

revoke all on function public.get_team_completed_session_count(uuid) from public;
grant execute on function public.get_team_completed_session_count(uuid) to authenticated;

-- Shape of profiles.upsell_state:
--   moments:     { <catalog id>: { active, shown_at, dismissals, snoozed_until } }
--   impressions: [ timestamps of new value-moment impressions, last 7 days ]
--   counters:    { <key>: [ timestamps, last 30 days, at most 50 ] }
--   markers:     { <key>: short string }
-- Actions: moment_shown, moment_dismiss (1st snoozes 30 days, 2nd retires),
-- track (append now() to a counter), set_marker.
create function public.update_upsell_state(p_action text, p_key text, p_value text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
  v_moment jsonb;
  v_list jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_]{1,32}$' then
    raise exception 'invalid key';
  end if;
  if p_value is not null and length(p_value) > 200 then
    raise exception 'value too long';
  end if;

  select coalesce(upsell_state, '{}'::jsonb) into v_state
  from public.profiles where id = auth.uid() for update;
  if not found then
    raise exception 'profile not found';
  end if;
  v_state := jsonb_build_object(
    'moments', coalesce(v_state -> 'moments', '{}'::jsonb),
    'impressions', coalesce(v_state -> 'impressions', '[]'::jsonb),
    'counters', coalesce(v_state -> 'counters', '{}'::jsonb),
    'markers', coalesce(v_state -> 'markers', '{}'::jsonb)
  );

  if p_action = 'moment_shown' then
    v_moment := coalesce(v_state -> 'moments' -> p_key, '{}'::jsonb)
      || jsonb_build_object('active', true, 'shown_at', now());
    v_state := jsonb_set(v_state, array['moments', p_key], v_moment);
    select coalesce(jsonb_agg(t), '[]'::jsonb) into v_list
    from (
      select t from jsonb_array_elements_text(v_state -> 'impressions') t
      where t::timestamptz > now() - interval '7 days'
      union all select now()::text
    ) x;
    v_state := jsonb_set(v_state, '{impressions}', v_list);

  elsif p_action = 'moment_dismiss' then
    v_moment := coalesce(v_state -> 'moments' -> p_key, '{}'::jsonb);
    v_moment := v_moment || jsonb_build_object(
      'active', false,
      'dismissals', coalesce((v_moment ->> 'dismissals')::integer, 0) + 1,
      'snoozed_until', now() + interval '30 days');
    v_state := jsonb_set(v_state, array['moments', p_key], v_moment);

  elsif p_action = 'track' then
    select coalesce(jsonb_agg(t), '[]'::jsonb) into v_list
    from (
      select t from (
        select t from jsonb_array_elements_text(coalesce(v_state -> 'counters' -> p_key, '[]'::jsonb)) t
        where t::timestamptz > now() - interval '30 days'
        union all select now()::text
      ) recent
      order by t desc limit 50
    ) x;
    v_state := jsonb_set(v_state, array['counters', p_key], v_list);

  elsif p_action = 'set_marker' then
    v_state := jsonb_set(v_state, array['markers', p_key], to_jsonb(coalesce(p_value, '')));

  else
    raise exception 'invalid action';
  end if;

  -- The guard trigger lets this one update through, then the flag goes
  -- straight back off so nothing later in the same transaction rides it.
  perform set_config('rop.upsell_state_write', 'on', true);
  update public.profiles set upsell_state = v_state where id = auth.uid();
  perform set_config('rop.upsell_state_write', 'off', true);
  return v_state;
end;
$$;

revoke all on function public.update_upsell_state(text, text, text) from public;
grant execute on function public.update_upsell_state(text, text, text) to authenticated;

-- get_team_goal_report: deployed body plus the window lock above.
CREATE OR REPLACE FUNCTION public.get_team_goal_report(p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_window int;
  v_result jsonb;
begin
  if not public.can_view_goals_for_team(p_team_id) then
    raise exception 'not authorized';
  end if;

  select goals_window_weeks into v_window from public.teams where id = p_team_id;
  v_window := coalesce(v_window, 4);
  -- goals.window_config (packaging Phase D): a plan without it measures a
  -- fixed 4-week window. The stored teams.goals_window_weeks is left
  -- untouched so an upgrade restores the coach's own choice.
  if not public.team_feature_is_full(p_team_id, 'goals.window_config') then
    v_window := 4;
  end if;

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
$function$;
