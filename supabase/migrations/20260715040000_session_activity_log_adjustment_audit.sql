-- Goals feature (ROP-Goals-TeamNav-Handoff.md §2.5, decision D2). Audit
-- columns for post-hoc timing corrections made via adjust_session_activity /
-- add_session_activity_row (§3.4/§3.5) -- e.g. the "kept running the last
-- drill until we got home" or "never advanced the phone to scrimmage" cases.
-- Rows written live by the run screen have both null; the Insights UI shows
-- an "adjusted" marker only on stamped rows.
alter table public.session_activity_log
  add column adjusted_by uuid references public.profiles(id) on delete set null,
  add column adjusted_at timestamptz;
