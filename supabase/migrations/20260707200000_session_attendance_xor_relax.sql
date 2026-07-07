-- Same bug class as user_events_actor_xor (see migration 20260707040000):
-- session_attendance.marked_by was made nullable + ON DELETE SET NULL in
-- migration 20260707190000 (stage 5 actor-deletion cleanup), but nobody
-- relaxed session_attendance_actor_xor, which still required *exactly one*
-- of (marked_by, marked_via_token_id). That CHECK made sense at INSERT time
-- (every attendance mark must be attributed to a real coach or a valid
-- helper token) but applies to every state the row can ever be in --
-- deleting a coach's account has to be able to leave "we no longer know
-- which coach marked this" behind, not be permanently blocked. Found via a
-- real delete-user repro during stage 5 empirical testing (deleting the
-- coach who ran the stage-5 test practice failed with
-- "new row for relation session_attendance violates check constraint
-- session_attendance_actor_xor"), not discovered by reading the schema.
alter table public.session_attendance drop constraint session_attendance_actor_xor;
alter table public.session_attendance add constraint session_attendance_actor_xor check (
  marked_by is null or marked_via_token_id is null
);
