alter table public.practice_live_sessions enable row level security;
alter table public.session_operations enable row level security;
alter table public.session_attendance enable row level security;
alter table public.session_groups enable row level security;
alter table public.session_group_members enable row level security;
alter table public.session_activity_log enable row level security;
alter table public.preview_sessions enable row level security;

-- practice_live_sessions: anyone with team access can view (including helpers).
-- Starting a session and updating it (advancing, pausing, taking control)
-- both require coaching authority -- helpers can watch, not drive.
-- Optimistic-concurrency (matching the version column) is NOT enforced
-- here -- that's a plain WHERE id = ? AND version = ? on the UPDATE
-- statement itself, ordinary SQL semantics, not an RLS concern.
create policy "practice_live_sessions_select_access" on public.practice_live_sessions
  for select using (public.can_access_practice(practice_id));

create policy "practice_live_sessions_insert_coach" on public.practice_live_sessions
  for insert with check (public.can_coach_practice(practice_id));

create policy "practice_live_sessions_update_coach" on public.practice_live_sessions
  for update using (public.can_coach_practice(practice_id));

-- session_operations: the idempotency/audit ledger for control actions
-- specifically. Scoped to coaching authority on both sides -- this table
-- isn't for attendance/notes, which have their own simpler tables below.
create policy "session_operations_select_access" on public.session_operations
  for select using (public.can_access_session(session_id));

create policy "session_operations_insert_coach" on public.session_operations
  for insert with check (
    public.can_coach_session(session_id)
    and public.is_session_active(session_id)
  );

-- session_attendance: viewable by anyone with team access; markable by
-- anyone with team access too (including registered helpers) -- taking
-- attendance is explicitly broader than session control. Append-only, no
-- update policy at all. Blocked once the session is no longer active.
create policy "session_attendance_select_access" on public.session_attendance
  for select using (public.can_access_session(session_id));

create policy "session_attendance_insert_access" on public.session_attendance
  for insert with check (
    public.can_access_session(session_id)
    and public.is_session_active(session_id)
  );

-- session_groups / session_group_members: viewable broadly; reshuffling is
-- a live-execution decision, gated to coaching authority. Append-only.
create policy "session_groups_select_access" on public.session_groups
  for select using (public.can_access_session(session_id));

create policy "session_groups_insert_coach" on public.session_groups
  for insert with check (
    public.can_coach_session(session_id)
    and public.is_session_active(session_id)
  );

create policy "session_group_members_select_access" on public.session_group_members
  for select using (
    exists (
      select 1 from public.session_groups sg
      where sg.id = group_id and public.can_access_session(sg.session_id)
    )
  );

create policy "session_group_members_insert_coach" on public.session_group_members
  for insert with check (
    exists (
      select 1 from public.session_groups sg
      where sg.id = group_id
        and public.can_coach_session(sg.session_id)
        and public.is_session_active(sg.session_id)
    )
  );

-- session_activity_log: viewable broadly; starting/ending an activity's
-- timing is a coaching action. This one DOES get an update policy (to set
-- ended_at when an activity finishes) -- also blocked once the session is
-- no longer active, which is what actually makes completed-session history
-- immutable.
create policy "session_activity_log_select_access" on public.session_activity_log
  for select using (public.can_access_session(session_id));

create policy "session_activity_log_insert_coach" on public.session_activity_log
  for insert with check (
    public.can_coach_session(session_id)
    and public.is_session_active(session_id)
  );

create policy "session_activity_log_update_coach" on public.session_activity_log
  for update using (
    public.can_coach_session(session_id)
    and public.is_session_active(session_id)
  );

-- preview_sessions
create policy "preview_sessions_select_access" on public.preview_sessions
  for select using (public.can_access_practice(practice_id));

create policy "preview_sessions_insert_coach" on public.preview_sessions
  for insert with check (public.can_coach_practice(practice_id));

create policy "preview_sessions_update_coach" on public.preview_sessions
  for update using (public.can_coach_practice(practice_id));
