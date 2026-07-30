-- Real bug found while hard-deleting a disposable test account:
-- admin.deleteUser() failed with an opaque 500 ("AuthRetryableFetchError",
-- empty message) via the JS client; the raw REST error underneath was
-- actually informative -- "update or delete on table profiles violates
-- foreign key constraint practice_series_created_by_fkey ... Key is still
-- referenced from table practice_series."
--
-- practice_series.created_by was `not null references profiles(id)` with
-- no ON DELETE action at all (defaults to RESTRICT) -- unlike every other
-- actor-identity column in this schema (see notes.created_by and this
-- file's own rop_actor_deletion_fk_gotcha convention: nullable + ON DELETE
-- SET NULL, "historical practice truth that should outlive the author's
-- account being deleted"). This is very likely part of what Known Gaps
-- calls "Hard/GDPR-style account deletion -- blocked by an unresolved
-- FK-cascade ordering issue" -- any coach who ever created a recurring
-- schedule would hit this exact block if their account were ever deleted.
-- Bringing this column in line with the established pattern fixes both.
alter table public.practice_series alter column created_by drop not null;
alter table public.practice_series drop constraint practice_series_created_by_fkey;
alter table public.practice_series add constraint practice_series_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
