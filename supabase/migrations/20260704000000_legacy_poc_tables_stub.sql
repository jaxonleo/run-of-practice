-- app_data/live_sessions/coaches were created directly in the Supabase
-- dashboard during the original no-auth prototype, before this migration
-- folder existed -- no migration anywhere creates them, only grants them
-- (20260707020000) and later drops them (20260727000000). That silently
-- broke a from-scratch replay of this folder (confirmed live, 2026-09-12,
-- first attempt at a local Docker environment: `supabase start` failed at
-- 20260707020000 with "relation app_data does not exist"), which is
-- presumably also why staging was seeded from a pg_dump instead.
--
-- Guarded to be a no-op on staging/production, where these tables are
-- already correctly gone: only creates the stubs if `profiles` (created by
-- the very next migration) doesn't exist yet, i.e. only on a genuinely
-- empty database being bootstrapped from scratch. Never intended to be
-- pushed to an already-bootstrapped environment.
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'profiles') then
    create table if not exists public.app_data (id text primary key, data jsonb);
    create table if not exists public.live_sessions (id text primary key, data jsonb);
    create table if not exists public.coaches (id text primary key, data jsonb);
  end if;
end $$;
