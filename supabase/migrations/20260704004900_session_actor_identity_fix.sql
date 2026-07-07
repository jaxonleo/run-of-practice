-- Three columns exist specifically to record "who did this" -- but none of
-- the insert/update policies actually required the column to match the
-- real requester. As written, any qualifying coach/helper could insert a
-- row claiming a DIFFERENT person marked attendance, submitted an
-- operation, or -- the serious one -- became the session's controller
-- without that person's own action. controller_user_id is the entire
-- enforcement mechanism behind "control is self-appointed, never assigned
-- by someone else" -- this was silently unenforced.

drop policy if exists "session_attendance_insert_access" on public.session_attendance;
create policy "session_attendance_insert_access" on public.session_attendance
  for insert with check (
    public.can_access_session(session_id)
    and public.is_session_active(session_id)
    and marked_by = auth.uid()
  );

drop policy if exists "session_operations_insert_coach" on public.session_operations;
create policy "session_operations_insert_coach" on public.session_operations
  for insert with check (
    public.can_coach_session(session_id)
    and public.is_session_active(session_id)
    and submitted_by = auth.uid()
  );

-- controller_user_id = auth.uid() covers both legitimate cases at once:
-- a normal advance/pause by the current controller leaves the column
-- unchanged, and it already equals their own auth.uid(); a genuine
-- take-control sets it to the new controller's own id. It only blocks the
-- illegitimate case -- assigning someone ELSE as controller.
drop policy if exists "practice_live_sessions_insert_coach" on public.practice_live_sessions;
create policy "practice_live_sessions_insert_coach" on public.practice_live_sessions
  for insert with check (
    public.can_coach_practice(practice_id)
    and controller_user_id = auth.uid()
  );

drop policy if exists "practice_live_sessions_update_coach" on public.practice_live_sessions;
create policy "practice_live_sessions_update_coach" on public.practice_live_sessions
  for update using (public.can_coach_practice(practice_id))
  with check (
    public.can_coach_practice(practice_id)
    and controller_user_id = auth.uid()
  );
