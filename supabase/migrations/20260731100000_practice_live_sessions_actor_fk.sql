-- Real bug found live while hard-deleting a disposable test account: deleting
-- a team (which cascades to its practices) failed with "update or delete on
-- table practices violates foreign key constraint
-- practice_live_sessions_practice_id_fkey" -- practice_live_sessions.practice_id
-- had no ON DELETE action at all (defaults to RESTRICT), unlike
-- practice_activities.practice_id (already "on delete cascade") and every
-- other practice-scoped child table in this schema. Same gap on
-- preview_sessions.practice_id, found by inspection. Both are pure content
-- rows scoped to a practice -- if the practice is gone, there's nothing left
-- for either to describe, so cascade is correct (matching practice_activities'
-- own precedent), not the nullable + SET NULL "historical record" pattern
-- used for actor-identity columns elsewhere.
alter table public.practice_live_sessions drop constraint practice_live_sessions_practice_id_fkey;
alter table public.practice_live_sessions add constraint practice_live_sessions_practice_id_fkey
  foreign key (practice_id) references public.practices(id) on delete cascade;

alter table public.preview_sessions drop constraint preview_sessions_practice_id_fkey;
alter table public.preview_sessions add constraint preview_sessions_practice_id_fkey
  foreign key (practice_id) references public.practices(id) on delete cascade;

-- preview_sessions.live_session_id: not the row being cascaded above (that's
-- practice_id), but the same account-deletion path can still hit it if a
-- live session is ever deleted independently of its practice. Already
-- nullable, so SET NULL rather than CASCADE -- losing the pointer back to a
-- session doesn't invalidate the preview row itself.
alter table public.preview_sessions drop constraint preview_sessions_live_session_id_fkey;
alter table public.preview_sessions add constraint preview_sessions_live_session_id_fkey
  foreign key (live_session_id) references public.practice_live_sessions(id) on delete set null;

-- controller_user_id is the fourth instance this session of the same
-- actor-identity bug class already fixed on practice_series.created_by,
-- organizations.created_by, and feedback.user_id: nullable + ON DELETE SET
-- NULL, "historical record that should outlive the author's account" (this
-- table's own comment: "Historical truth ... lives in the tables below, not
-- in this row" -- the session row itself isn't the source of truth being
-- protected, so there's no reason for it to block deleting the account that
-- once controlled it). Was NOT NULL, so drop that too.
alter table public.practice_live_sessions alter column controller_user_id drop not null;
alter table public.practice_live_sessions drop constraint practice_live_sessions_controller_user_id_fkey;
alter table public.practice_live_sessions add constraint practice_live_sessions_controller_user_id_fkey
  foreign key (controller_user_id) references public.profiles(id) on delete set null;
