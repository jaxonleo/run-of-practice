-- Same actor-identity gap as session_attendance/session_operations/
-- practice_live_sessions, just one step further back: these two tables
-- didn't even HAVE a "who did this" column to enforce. Adding them now,
-- while both tables are empty and nothing real depends on the shape yet.
alter table public.session_groups
  add column created_by uuid not null references public.profiles(id);

alter table public.session_activity_log
  add column logged_by uuid not null references public.profiles(id);
-- Represents whoever started logging this activity -- required at insert,
-- same as the other three actor columns. The UPDATE that later sets
-- ended_at deliberately does NOT re-check this column (see below): ending
-- an activity is a coaching action gated by can_coach_session, and
-- requiring the same person to close it out would create a real problem
-- if control legitimately changes hands mid-activity.

drop policy if exists "session_groups_insert_coach" on public.session_groups;
create policy "session_groups_insert_coach" on public.session_groups
  for insert with check (
    public.can_coach_session(session_id)
    and public.is_session_active(session_id)
    and created_by = auth.uid()
  );

drop policy if exists "session_activity_log_insert_coach" on public.session_activity_log;
create policy "session_activity_log_insert_coach" on public.session_activity_log
  for insert with check (
    public.can_coach_session(session_id)
    and public.is_session_active(session_id)
    and logged_by = auth.uid()
  );

-- session_activity_log_update_coach deliberately left unchanged -- ending
-- an activity is a coaching action gated by can_coach_session, not tied to
-- whoever logged its start.
