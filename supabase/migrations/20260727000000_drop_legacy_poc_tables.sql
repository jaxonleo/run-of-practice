-- Drop the three pre-rewrite POC tables (app_data, coaches, live_sessions).
-- All three predate the current schema/migration history entirely -- they
-- were created for the original no-auth prototype, before Postgres RLS/auth
-- existed in this app, and still carry their original wide-open anon-era
-- RLS (USING(true) WITH CHECK(true)) plus a later authenticated grant
-- (20260707020000_authenticated_grants_poc_tables.sql) added only so the
-- rewrite could keep reading/writing them during the cutover period.
--
-- Confirmed safe to drop before applying this:
-- - Zero references anywhere in src/ (app_data was the last client-side
--   consumer -- App.jsx's legacy data/update() state, traced and removed
--   2026-07-27; see BUILD-STATUS.md Decision History).
-- - Row counts (5 / 2 / 76) match the orphaned-POC-data snapshot already
--   documented in BUILD-STATUS.md.
-- - app_data's 5 keys are all old POC-era ids (e.g. 'coach_coach_demo_wwql',
--   'coach_coach_jaxon_g03l') -- not a single one matches the real coach's
--   actual auth.users uuid, confirming none of it is live-app data that was
--   ever written by the current (now-removed) app_data client path.
drop table if exists public.app_data;
drop table if exists public.coaches;
drop table if exists public.live_sessions;
