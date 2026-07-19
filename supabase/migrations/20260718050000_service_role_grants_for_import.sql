-- Same gap as 20260710030000_service_role_grants_for_notify_fn.sql: service_role
-- has never been granted access to any app table by default in this schema --
-- it only matters the moment something actually queries via the service_role
-- key through PostgREST/supabase-js (BYPASSRLS skips RLS policies, not table
-- grants). The public-library import script (scripts/import-public-library.mjs)
-- is the second such caller. Least-privilege: only what it actually reads/writes.
grant select, insert, update on public.content_catalogs to service_role;
grant select, insert on public.assets to service_role;
grant select, insert, update on public.activity_library to service_role;
grant select, insert, delete on public.activity_library_equipment to service_role;
grant select, insert, delete on public.drill_tags to service_role;
grant select on public.skill_categories to service_role;
grant select on public.skill_tags to service_role;
