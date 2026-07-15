-- Goals feature (ROP-Goals-TeamNav-Handoff.md §2.4, decision D2). Lets a
-- coach soft-exclude a session (a test run, a throwaway "Run Again") from
-- goals actuals without deleting practice history. No new UPDATE policy on
-- practice_live_sessions here -- exclusion flows only through the
-- set_session_exclusion RPC (§3.3), so the existing
-- practice_live_sessions_update_coach policy's blast radius (any coaching
-- update while a session is active) isn't widened to also cover completed
-- sessions.
alter table public.practice_live_sessions
  add column excluded_at timestamptz,
  add column excluded_by uuid references public.profiles(id) on delete set null;
