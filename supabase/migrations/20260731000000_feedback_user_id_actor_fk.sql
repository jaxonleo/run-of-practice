-- Real bug found while hard-deleting a disposable test account (same class
-- already fixed twice before, practice_series_created_by_actor_fk and
-- organizations_created_by_actor_fk): the raw REST error under the JS
-- client's opaque AuthRetryableFetchError was "update or delete on table
-- profiles violates foreign key constraint feedback_user_id_fkey ... Key
-- is still referenced from table feedback."
--
-- feedback.user_id was already nullable, but its FK had no ON DELETE
-- action at all (defaults to RESTRICT) -- unlike the established
-- actor-identity pattern elsewhere in this schema (notes.created_by,
-- practice_series.created_by, organizations.created_by: nullable + ON
-- DELETE SET NULL, "historical record that should outlive the author's
-- account"). Any coach who ever submitted authenticated feedback (Send
-- Feedback, or the new Request a Consultation form) would hit this same
-- block if their account were ever deleted. Bringing it in line fixes that.
alter table public.feedback drop constraint feedback_user_id_fkey;
alter table public.feedback add constraint feedback_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;
