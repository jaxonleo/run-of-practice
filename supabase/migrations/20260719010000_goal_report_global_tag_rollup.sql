-- Goals noise fix (Jax's call, 2026-07-19): before this, actual_tags/
-- planned_tags/goal_tags grouped strictly by the raw drill_tags.skill_tag_id.
-- Baseball/Basketball coaches have BOTH a scope='coach' personal copy of
-- each tag (seeded per-coach, 20260711000000_seed_default_skill_tags.sql)
-- AND, since this session's public-library work, a real scope='global' row
-- with the identical name -- two different tag ids, same name. A drill
-- tagged with the coach-scope copy and a goal set on the global tag would
-- silently show as two separate, half-empty report rows instead of one.
--
-- Fix: resolve every skill_tag_id encountered (drill tags AND existing
-- goals) to its scope='global' equivalent by (category_id, name) match
-- before aggregating, so a coach's personal duplicate rolls up under the
-- same line as the canonical global tag. A tag with no global counterpart
-- (a genuinely custom personal tag, or an org tag) resolves to itself --
-- nothing changes for those, they just don't get merged with anything.
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
  tag_resolution as (
    select t.id as raw_tag_id, coalesce(g.id, t.id) as resolved_tag_id
    from public.skill_tags t
    left join public.skill_tags g
      on g.category_id = t.category_id and g.name = t.name and g.scope = 'global' and g.archived_at is null
  ),
  -- Defensive dedup: the frontend now only lets a coach add a goal on a
  -- global tag (and excludes one whose global equivalent is already
  -- goaled), so this shouldn't ever produce more than one row per
  -- resolved_tag_id -- max() is just a deterministic tie-break in case it
  -- ever does, not a meaningful business rule.
  resolved_goals as (
    select resolved_tag_id, max(target_pct) as target_pct
    from (
      select tr.resolved_tag_id, tg.target_pct
      from public.team_goals tg
      join tag_resolution tr on tr.raw_tag_id = tg.skill_tag_id
      where tg.team_id = p_team_id and tg.archived_at is null
    ) x
    group by resolved_tag_id
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
  actual_tags as (
    select tr.resolved_tag_id, sum(a.minutes / nullif(tc.n_tags,0)) as minutes
    from actual_attributed a
    join public.drill_tags dt on dt.activity_library_id = a.library_activity_id
    join tag_counts tc on tc.activity_library_id = a.library_activity_id
    join tag_resolution tr on tr.raw_tag_id = dt.skill_tag_id
    where a.pa_type is distinct from 'break'
    group by tr.resolved_tag_id
  ),
  planned_tags as (
    select tr.resolved_tag_id, sum(pr.minutes / nullif(tc.n_tags,0)) as minutes
    from planned_all pr
    join public.drill_tags dt on dt.activity_library_id = pr.library_activity_id
    join tag_counts tc on tc.activity_library_id = pr.library_activity_id
    join tag_resolution tr on tr.raw_tag_id = dt.skill_tag_id
    where pr.pa_type is distinct from 'break'
    group by tr.resolved_tag_id
  ),
  actual_denom as (
    select coalesce(sum(minutes),0) as total from (
      select distinct log_id, minutes from actual_attributed where pa_type is distinct from 'break'
    ) x
  ),
  planned_denom as (
    select coalesce(sum(minutes),0) as total from (
      select distinct pa_id, minutes from planned_all where pa_type is distinct from 'break'
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
  goal_tags as (
    select resolved_tag_id from resolved_goals
    union
    select resolved_tag_id from actual_tags
    union
    select resolved_tag_id from planned_tags
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
        'skill_tag_id', gt.resolved_tag_id,
        'name', st.name,
        'target_pct', tg.target_pct,
        'planned_minutes', round(coalesce(pt.minutes,0), 2),
        'planned_pct', case when pd.total > 0 then round((coalesce(pt.minutes,0) / pd.total * 100), 1) else 0 end,
        'actual_minutes', round(coalesce(atg.minutes,0), 2),
        'actual_pct', case when ad.total > 0 then round((coalesce(atg.minutes,0) / ad.total * 100), 1) else 0 end
      ) order by st.name)
      from goal_tags gt
      join public.skill_tags st on st.id = gt.resolved_tag_id
      left join resolved_goals tg on tg.resolved_tag_id = gt.resolved_tag_id
      left join planned_tags pt on pt.resolved_tag_id = gt.resolved_tag_id
      left join actual_tags atg on atg.resolved_tag_id = gt.resolved_tag_id
      cross join planned_denom pd
      cross join actual_denom ad
    ), '[]'::jsonb),
    'untagged', jsonb_build_object(
      'planned_minutes', round((pd2.total - coalesce((select sum(minutes) from planned_tags), 0)), 2),
      'planned_pct', case when pd2.total > 0 then round(((pd2.total - coalesce((select sum(minutes) from planned_tags),0)) / pd2.total * 100),1) else 0 end,
      'actual_minutes', round((ad2.total - coalesce((select sum(minutes) from actual_tags), 0)), 2),
      'actual_pct', case when ad2.total > 0 then round(((ad2.total - coalesce((select sum(minutes) from actual_tags),0)) / ad2.total * 100),1) else 0 end
    ),
    'denominators', jsonb_build_object(
      'planned_minutes_total', round(pd2.total, 2),
      'actual_minutes_total', round(ad2.total, 2)
    ),
    'other_transition_minutes', round((select minutes from other_transitions), 2),
    'practices', jsonb_build_object(
      'planned_count', pc.planned_count,
      'completed_session_count', pc.completed_session_count,
      'excluded_session_count', pc.excluded_session_count
    )
  ) into v_result
  from planned_denom pd2, actual_denom ad2, practice_counts pc;

  return v_result;
end;
$$;

grant execute on function public.get_team_goal_report(uuid) to authenticated;
