-- The old POC tables (app_data, live_sessions, coaches) were only ever
-- granted to the `anon` role, matching the old no-auth app. Now that the
-- frontend-rewire branch runs on real Supabase Auth sessions, every
-- authenticated request hits Postgres as `authenticated`, not `anon` --
-- confirmed via a live test: an authenticated coach got
-- "permission denied for table app_data" (42501) the moment they signed in,
-- even though the RLS policy itself is permissive.
--
-- This matters right now, not just at cutover: practices, locations,
-- library, templates, and notes all still live in app_data until their own
-- stage of the rewire replaces them, so without this grant every one of
-- those screens silently fails to persist for a signed-in coach.
--
-- Table structure/policies are untouched (still the same permissive
-- anon-era RLS) -- only adding the equivalent grant for `authenticated`,
-- consistent with the branch rule that these tables aren't otherwise
-- touched until cutover.
grant select, insert, update on public.app_data to authenticated;
grant select, insert, update on public.live_sessions to authenticated;
grant select, insert on public.coaches to authenticated;
