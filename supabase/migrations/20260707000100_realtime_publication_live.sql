-- Enable Supabase Realtime (postgres_changes) for tables the frontend needs to
-- subscribe to. No migration in chunks 1-5 added any new table to the
-- supabase_realtime publication, so postgres_changes has never fired for any
-- of the new schema regardless of RLS correctness — confirmed via a live
-- smoke test (subscribed + authenticated write produced zero events until
-- this migration).
--
-- practice_live_sessions: coach multi-device sync during a live session
-- (stage 5 CommandScreen dependency, per handoff section 6).
alter publication supabase_realtime add table public.practice_live_sessions;

-- profiles: added to validate the publication+RLS mechanism end-to-end with
-- a disposable test user (no org/team/practice scaffolding required). Harmless
-- to keep enabled going forward -- own-row profile changes reflecting live is
-- a reasonable thing to want later too.
alter publication supabase_realtime add table public.profiles;
