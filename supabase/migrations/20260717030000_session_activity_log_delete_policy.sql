-- session_activity_log: allow the coach running an active session to delete
-- a log row entirely (not just close it). Needed by the jump-navigation
-- fix in CommandScreen -- rapidly tapping through the Overview list used to
-- leave a real, permanent zero-duration row behind for every activity
-- passed through on the way to the one actually wanted. The client now
-- deletes a row instead of closing it when it was open for under 3s, but
-- that only works with an explicit delete policy (there wasn't one before;
-- RLS defaults to deny). Scoped identically to the existing update policy:
-- same coaching-authority check, and only while the session is still active,
-- so completed-session history stays immutable exactly as before.
create policy "session_activity_log_delete_coach" on public.session_activity_log
  for delete using (
    public.can_coach_session(session_id)
    and public.is_session_active(session_id)
  );
