-- user_events.user_id had no ON DELETE behavior (defaults to NO ACTION),
-- which blocks deleting a profile -- and therefore the underlying auth
-- user -- the moment any event references them. In practice that's nearly
-- immediately, since team_created and friends fire automatically. This
-- broke deleting a disposable test user during stage 2 testing:
-- "update or delete on table profiles violates foreign key constraint
-- user_events_user_id_fkey" (23503).
--
-- Locked product decision (Future-State handoff): user data is retained
-- indefinitely and deleted only on explicit user request -- meaning
-- deletion has to actually work when requested. Analytics history should
-- outlive the deleted account (that's the point of an event log), so
-- ON DELETE SET NULL is correct here, not CASCADE -- keep the event,
-- drop the now-dangling actor reference.
alter table public.user_events drop constraint user_events_user_id_fkey;
alter table public.user_events
  add constraint user_events_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;
