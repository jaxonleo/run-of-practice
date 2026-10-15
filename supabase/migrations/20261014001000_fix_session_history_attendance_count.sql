-- Fix: get_team_session_history's attendance_count reported 1 for a run
-- with no attendance rows at all. The attendance CTE left-joins each
-- session to its latest "present" rows and counted count(*), which counts
-- the single all-null row a left join produces when nothing matches. Now
-- count(latest.player_id), so a run nobody was marked present for reads 0.
-- Body otherwise identical to the deployed version (including the
-- history-visibility cutoff from 20261014000600).
CREATE OR REPLACE FUNCTION public.get_team_session_history(p_team_id uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
  v_cutoff timestamptz;
begin
  if not public.can_view_goals_for_team(p_team_id) then
    raise exception 'not authorized';
  end if;

  -- history.practice_history (packaging Phase B): only the N most recent
  -- completed runs are browsable on a capped plan.
  v_cutoff := public.team_history_cutoff(p_team_id);

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
      and (v_cutoff is null or coalesce(pls.ended_at, pls.created_at) >= v_cutoff)
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
    select s.session_id, count(latest.player_id) as present_count
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
