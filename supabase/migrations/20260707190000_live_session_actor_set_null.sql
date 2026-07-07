-- Closes out the six latent actor-deletion FK gaps flagged in
-- rop_actor_deletion_fk_gotcha memory during stage 2, deliberately deferred
-- until stage 5 since none of these tables were reachable by any code path
-- until now. Same pattern as user_events/organizations: these are audit/
-- historical-truth tables (session_attendance, session_operations,
-- session_groups, session_activity_log, session_access_tokens) that should
-- outlive their actor's account being deleted, so SET NULL, not CASCADE --
-- deleting a coach's account shouldn't erase the practice history they
-- were part of. All five were NOT NULL, so NOT NULL has to come off too
-- (matching user_events' fix, migration 20260707030000).
alter table public.session_attendance alter column marked_by drop not null;
alter table public.session_attendance drop constraint session_attendance_marked_by_fkey;
alter table public.session_attendance
  add constraint session_attendance_marked_by_fkey
  foreign key (marked_by) references public.profiles(id) on delete set null;

alter table public.session_operations alter column submitted_by drop not null;
alter table public.session_operations drop constraint session_operations_submitted_by_fkey;
alter table public.session_operations
  add constraint session_operations_submitted_by_fkey
  foreign key (submitted_by) references public.profiles(id) on delete set null;

alter table public.session_groups alter column created_by drop not null;
alter table public.session_groups drop constraint session_groups_created_by_fkey;
alter table public.session_groups
  add constraint session_groups_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.session_activity_log alter column logged_by drop not null;
alter table public.session_activity_log drop constraint session_activity_log_logged_by_fkey;
alter table public.session_activity_log
  add constraint session_activity_log_logged_by_fkey
  foreign key (logged_by) references public.profiles(id) on delete set null;

alter table public.session_access_tokens alter column created_by drop not null;
alter table public.session_access_tokens drop constraint session_access_tokens_created_by_fkey;
alter table public.session_access_tokens
  add constraint session_access_tokens_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- practice_live_sessions.controller_user_id is different in kind -- it's
-- live operational state (who currently controls this session), not pure
-- history. Still fixed the same way so deleting a user isn't blocked by an
-- active/old session they once controlled. Deliberately NOT extending the
-- take-control RLS policy to handle a null-controller recovery path (a
-- coach's account disappearing mid-session is an extreme edge case,
-- appropriately deferred) -- a session left with a null controller after
-- this fires would be stuck until a manual/future fix, which is an
-- acceptable, documented gap, not a silent one.
alter table public.practice_live_sessions alter column controller_user_id drop not null;
alter table public.practice_live_sessions drop constraint practice_live_sessions_controller_user_id_fkey;
alter table public.practice_live_sessions
  add constraint practice_live_sessions_controller_user_id_fkey
  foreign key (controller_user_id) references public.profiles(id) on delete set null;
