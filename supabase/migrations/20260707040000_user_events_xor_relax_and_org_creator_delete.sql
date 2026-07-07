-- Fixing the FK alone (previous migration) wasn't enough: setting
-- user_events.user_id to null on actor deletion now violates
-- user_events_actor_xor, which required *exactly one* of
-- (user_id, event_via_token_id) -- never both null. That rule made sense
-- as an INSERT-time guarantee (every event must be attributed to someone
-- when it's created) but CHECK constraints apply to every state a row can
-- ever be in, including after a legitimate later UPDATE. A user being
-- deleted has to be able to leave a "we no longer know who did this"
-- historical row behind -- relaxing to "at most one, both null is fine"
-- keeps the real guarantee (never claim to be both a real user AND an
-- anonymous token) while allowing that state.
alter table public.user_events drop constraint user_events_actor_xor;
alter table public.user_events add constraint user_events_actor_xor check (
  user_id is null or event_via_token_id is null
);

-- organizations.created_by had no ON DELETE behavior at all (defaults to
-- NO ACTION), which would block deleting any user who ever created an
-- org -- same latent bug as user_events, just not yet hit because no
-- current UI creates organizations. An org outliving the specific person
-- who created it is clearly correct (it's a shared, multi-member entity,
-- not personal data), so SET NULL here, not CASCADE.
alter table public.organizations drop constraint organizations_created_by_fkey;
alter table public.organizations
  add constraint organizations_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
