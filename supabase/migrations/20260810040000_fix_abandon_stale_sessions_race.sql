-- Real concurrency bug found live testing the version from
-- 20260810030000_auto_abandon_stale_sessions.sql: fetchActiveLiveSessions
-- polls every 20s, and a browser tab freshly mounting Home can fire two
-- overlapping calls close together (confirmed live: a seeded stale session
-- ended up with ended_at == created_at -- the "no dangling row found"
-- fallback -- even though it genuinely had one). The original version's
-- chained data-modifying CTEs (DELETE ... RETURNING feeding an UPDATE) all
-- read from the same `stale` snapshot computed once at statement start, so
-- two concurrent calls could both see the same row as eligible before
-- either commits; whichever call's DELETE loses the race finds the
-- dangling row already gone and falls back to the wrong ended_at, silently
-- clobbering the correct value the other call had just written.
--
-- Rewritten with the standard Postgres pattern for exactly this shape (a
-- worker sweep that must not double-process a row two concurrent callers
-- both picked up): `for update skip locked` per row, in an explicit loop.
-- A second concurrent call simply skips any row still locked by the first
-- call's in-flight transaction rather than racing it -- each stale session
-- is fully processed by exactly one call.
create or replace function public.abandon_stale_live_sessions()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_cutoff timestamptz := now() - interval '6 hours';
  v_count int := 0;
  v_session record;
  v_last_started timestamptz;
begin
  for v_session in
    select id, created_at from public.practice_live_sessions
    where status = 'active' and created_at < v_cutoff
    for update skip locked
  loop
    select max(started_at) into v_last_started
    from public.session_activity_log
    where session_id = v_session.id and ended_at is null;

    delete from public.session_activity_log
    where session_id = v_session.id and ended_at is null;

    update public.practice_live_sessions
    set status = 'abandoned',
        ended_at = coalesce(v_last_started, v_session.created_at),
        paused_at = null
    where id = v_session.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
