-- Free / Pro / Organization packaging, Phase B part 3 of 4: browsable
-- history cap (history.practice_history, handoff key
-- history.visible_sessions). A read cap only: on a capped plan, runs older
-- than the team's Nth most recent completed run are hidden from the
-- history list, the session detail reads, and that practice's notes and
-- attendance. Nothing is deleted, and the derived calculations that must
-- stay uncapped (get_team_goal_report, Development Pulse inputs,
-- attendance-derived numbers, get_teams_with_unviewed_notes) are all
-- SECURITY DEFINER readers that RLS never touches, so they keep using all
-- data.
--
-- Deviation from the handoff: get_team_session_history keeps returning a
-- bare JSON array (the deployed client depends on that shape), and the
-- hidden count comes from a separate get_team_history_hidden_count RPC
-- instead of a new hidden_count field, so this ships expand-only.

-- Timestamp of the team's Nth most recent completed run, or null when the
-- team's plan is uncapped or it has fewer than N completed runs. A run is
-- visible when its end (or start, for a run with no end) is at or after
-- this cutoff, which also hides aborted runs older than the Nth completed.
create function public.team_history_cutoff(p_team_id uuid)
returns timestamptz
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_resolved jsonb;
  v_limit integer;
  v_cutoff timestamptz;
begin
  v_resolved := public.team_resolve_entitlement(p_team_id, 'history.practice_history');
  if v_resolved ->> 'limit_value' is null and v_resolved ->> 'state' in ('full', 'preview') then
    return null;
  end if;
  v_limit := greatest(coalesce((v_resolved ->> 'limit_value')::integer, 0), 0);
  if v_limit = 0 then
    return 'infinity'::timestamptz;
  end if;

  select pls.ended_at into v_cutoff
  from public.practice_live_sessions pls
  join public.practices p on p.id = pls.practice_id
  where p.team_id = p_team_id and p.archived_at is null and pls.status = 'completed'
  order by pls.ended_at desc nulls last
  offset v_limit - 1 limit 1;

  return v_cutoff;
end;
$$;

revoke all on function public.team_history_cutoff(uuid) from public;

create function public.session_history_visible(p_session_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select c.cutoff is null or coalesce(pls.ended_at, pls.created_at) >= c.cutoff
     from public.practice_live_sessions pls
     join public.practices p on p.id = pls.practice_id
     cross join lateral (select public.team_history_cutoff(p.team_id) as cutoff) c
     where pls.id = p_session_id),
    true);
$$;

revoke all on function public.session_history_visible(uuid) from public;
grant execute on function public.session_history_visible(uuid) to authenticated;

create function public.can_view_session(p_session_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.can_access_session(p_session_id), false)
     and public.session_history_visible(p_session_id);
$$;

revoke all on function public.can_view_session(uuid) from public;
grant execute on function public.can_view_session(uuid) to authenticated;

-- A practice is hidden only when it has completed runs and every one of
-- them is older than the cutoff (and it is not running right now). A
-- practice that was never run, or is scheduled, always stays visible.
create function public.practice_history_visible(p_practice_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select c.cutoff is null
    or not exists (select 1 from public.practice_live_sessions s
                   where s.practice_id = p_practice_id and s.status = 'completed')
    or exists (select 1 from public.practice_live_sessions s
               where s.practice_id = p_practice_id
                 and (s.status = 'active' or coalesce(s.ended_at, s.created_at) >= c.cutoff))
  from public.practices p
  cross join lateral (select public.team_history_cutoff(p.team_id) as cutoff) c
  where p.id = p_practice_id;
$$;

revoke all on function public.practice_history_visible(uuid) from public;
grant execute on function public.practice_history_visible(uuid) to authenticated;

-- Notes and attendance follow the cap. Policies are otherwise unchanged.
drop policy "notes_select" on public.notes;
create policy "notes_select" on public.notes
  for select using (
    public.can_access_practice(practice_id)
    and coalesce(public.practice_history_visible(practice_id), true)
  );

drop policy "session_attendance_select_access" on public.session_attendance;
create policy "session_attendance_select_access" on public.session_attendance
  for select using (public.can_view_session(session_id));

-- Hidden-run count for the history list footer (catalog H1). Same row set
-- get_team_session_history would list, minus the visible ones.
create function public.get_team_history_hidden_count(p_team_id uuid)
returns integer
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_cutoff timestamptz;
begin
  if not public.can_view_goals_for_team(p_team_id) then
    raise exception 'not authorized';
  end if;
  v_cutoff := public.team_history_cutoff(p_team_id);
  if v_cutoff is null then
    return 0;
  end if;
  return (
    select count(*)::integer
    from public.practice_live_sessions pls
    join public.practices p on p.id = pls.practice_id
    where p.team_id = p_team_id and p.archived_at is null
      and (
        pls.status = 'completed'
        or (pls.status = 'abandoned' and pls.setup_confirmed_at is not null
            and exists (select 1 from public.session_activity_log sal0 where sal0.session_id = pls.id))
      )
      and coalesce(pls.ended_at, pls.created_at) < v_cutoff
  );
end;
$$;

revoke all on function public.get_team_history_hidden_count(uuid) from public;
grant execute on function public.get_team_history_hidden_count(uuid) to authenticated;

-- Player Practice Notes (PlayerProfile). Replaces the direct
-- note_player_tags -> notes embed: visible notes plus a count of notes
-- about this player saved on practices outside the visible history.
create function public.get_player_notes(p_player_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_team_id uuid;
  v_notes jsonb;
  v_hidden integer;
begin
  select team_id into v_team_id from public.players where id = p_player_id;
  if v_team_id is null or not public.can_access_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  with tagged as (
    select n.*, coalesce(public.practice_history_visible(n.practice_id), true) as visible
    from public.note_player_tags t
    join public.notes n on n.id = t.note_id
    where t.player_id = p_player_id and n.archived_at is null
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'practice_id', practice_id, 'practice_activity_id', practice_activity_id,
      'station_id', station_id, 'text', text, 'author_kind', author_kind,
      'author_label', author_label, 'created_by', created_by, 'created_at', created_at
    ) order by created_at desc) filter (where visible), '[]'::jsonb),
    count(*) filter (where not visible)::integer
  into v_notes, v_hidden
  from tagged;

  return jsonb_build_object('notes', v_notes, 'hidden_count', coalesce(v_hidden, 0));
end;
$$;

revoke all on function public.get_player_notes(uuid) from public;
grant execute on function public.get_player_notes(uuid) to authenticated;

-- get_team_session_history: body identical to the deployed version except
-- the visible-cutoff filter on the sessions CTE.
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
