-- Real gap flagged forty-fourth session continued: fetchActiveLiveSessions
-- was fixed to stop *showing* a stale session as live, but nothing ever
-- actually marks the underlying practice_live_sessions row abandoned --
-- every other "is this session live" check (findActiveLiveSession,
-- PreviewView's routing, get_preview_view/get_live_session_view) is scoped
-- to one specific practice_id with no staleness awareness, so a stale
-- direct link would still route a coach into a session that was never
-- really running. Direct feedback: build the real cleanup, have it show up
-- in History as Abandoned, and don't let the interrupted drill skew Goals &
-- Insights.
--
-- No pg_cron/scheduled-function infra exists anywhere in this project (see
-- BUILD-STATUS's own note on this) -- rather than stand that up for a
-- single sweep, this is a cheap, idempotent, lazily-triggered function:
-- called opportunistically from fetchActiveLiveSessions (src/supabase.js),
-- which any signed-in coach's Home screen already polls every 20s. No auth
-- check needed -- it exposes no data back, only performs writes gated on an
-- objective staleness rule, same "no team filter needed server-side"
-- reasoning fetchActiveLiveSessions itself already documents.
--
-- The skew-prevention part: a session's *currently open* activity-log row
-- (the drill that was running when whatever killed the session happened --
-- dead battery, closed tab) has no reliable end signal. Rather than close
-- it with a fabricated duration (either "now", which could overcount by
-- hours/days, or a guessed cutoff), it's deleted outright -- this mirrors
-- CommandScreen.jsx's own existing closeCurrentLog/MIN_LOG_MS convention
-- (a barely-open row gets discarded via deleteActivityLog, not closed with
-- a duration nobody trusts). The session's own ended_at is set to that
-- deleted row's started_at (the last real signal of "something was still
-- happening"), not to whenever this cleanup happens to run -- so a
-- session's own wall-clock duration in History reflects genuine elapsed
-- practice time, not cleanup-job latency. A session abandoned in Setup
-- (setup_confirmed_at still null -- nothing ever actually ran) has no
-- activity to lose; ended_at falls back to created_at for those.
--
-- Goals & Insights itself needs no changes at all: get_team_goal_report/
-- get_team_goal_trends/session_activity_minutes already hard-filter
-- pls.status='completed' (confirmed by reading their current definitions
-- before writing this) -- an abandoned session was already fully excluded
-- from every attribution query the moment it stopped being 'active', same
-- as it always has been. The only thing that changes is that it becomes
-- visible in History, which is why the log-row deletion matters here: once
-- History starts showing abandoned sessions (below), a fabricated-duration
-- row would have been visible there even though it was never counted
-- toward any goal.
create function public.abandon_stale_live_sessions()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_cutoff timestamptz := now() - interval '6 hours';
  v_count int;
begin
  with stale as (
    select id from public.practice_live_sessions
    where status = 'active' and created_at < v_cutoff
  ),
  dangling as (
    delete from public.session_activity_log sal
    using stale s
    where sal.session_id = s.id and sal.ended_at is null
    returning sal.session_id, sal.started_at
  ),
  last_started as (
    select session_id, max(started_at) as started_at from dangling group by session_id
  ),
  updated as (
    update public.practice_live_sessions pls
    set status = 'abandoned',
        ended_at = coalesce(ls.started_at, pls.created_at),
        paused_at = null
    from stale s
    left join last_started ls on ls.session_id = s.id
    where pls.id = s.id
    returning pls.id
  )
  select count(*) into v_count from updated;

  return v_count;
end;
$$;

grant execute on function public.abandon_stale_live_sessions() to authenticated;

-- History (get_team_session_history) now also surfaces abandoned sessions,
-- not just completed ones -- previously an abandoned session (whether via
-- the existing manual Abort Practice action, or this new auto-cleanup) was
-- simply invisible in History, with no record it ever happened. Scoped to
-- real attempts only: setup_confirmed_at must be set (excludes a session
-- abandoned while still in pre-live Setup, where nothing was ever run) and
-- at least one session_activity_log row must exist (excludes a session that
-- went live but died before its very first drill was ever opened) -- same
-- "nothing worth showing" principle as the barely-open-row discard above,
-- just at session grain. Copied forward verbatim from the current live
-- definition (20260805010000_session_history_excludes_deleted_practice.sql,
-- confirmed via pg_get_functiondef before writing this, per this project's
-- own documented migration-drift-checking convention) with only the
-- `sessions` CTE's filter and a new `status` output field changed.
create or replace function public.get_team_session_history(p_team_id uuid, p_limit int default 50)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.can_access_team(p_team_id) then
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
$$;
