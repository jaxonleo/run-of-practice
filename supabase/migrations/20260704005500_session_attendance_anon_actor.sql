-- An anonymous helper has no profiles row and no auth.uid() at all --
-- marked_by can't represent them. Same "exactly one, never both" pattern
-- already used for equipment/tags elsewhere in this schema, applied here
-- to actor identity: either a real coach (marked_by) or a valid token
-- (marked_via_token_id), never neither, never both.
alter table public.session_attendance alter column marked_by drop not null;

alter table public.session_attendance
  add column marked_via_token_id uuid references public.session_access_tokens(id);

alter table public.session_attendance
  add constraint session_attendance_actor_xor check (
    (marked_by is not null and marked_via_token_id is null)
    or (marked_by is null and marked_via_token_id is not null)
  );
