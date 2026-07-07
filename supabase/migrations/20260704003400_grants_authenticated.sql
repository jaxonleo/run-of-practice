-- Every migration so far enabled RLS and wrote policies, but never granted
-- the underlying table-level privileges to the `authenticated` role. RLS
-- policies only take effect once a role already has base access to a table;
-- without this, every table in the schema is completely inaccessible to any
-- real (non-superuser) connection, regardless of how correct the RLS
-- policies are. This should have been in each table's own migration -- it
-- wasn't, on any of them. Fixing that here, in one place, rather than
-- retrofitting 26 separate files.
--
-- No `anon` grants anywhere in this file -- nothing here is meant to be
-- publicly accessible yet (that's a deliberate future decision for
-- anonymous helper links in chunk 4, not an oversight).
--
-- No DELETE grants except on the join-shaped tables that already have a
-- DELETE policy (activity_library_equipment, drill_tags,
-- template_activity_equipment, template_station_equipment,
-- practice_activity_equipment, station_equipment) -- everything else is
-- archive-only by design, so granting DELETE on it would be misleading even
-- though RLS has no DELETE policy to actually allow it.

-- profiles: no INSERT grant -- only the handle_new_user trigger inserts,
-- and it runs as the function owner (security definer), not as
-- `authenticated`, so it doesn't need this grant to work.
grant select, update on public.profiles to authenticated;

grant select, insert, update on public.organizations to authenticated;
grant select, insert, update on public.organization_members to authenticated;
grant select, insert, update on public.teams to authenticated;
grant select, insert, update on public.team_staff to authenticated;
grant select, insert, update on public.players to authenticated;

grant select, insert, update on public.assets to authenticated;
grant select on public.skill_categories to authenticated;
grant select, insert, update on public.skill_tags to authenticated;
grant select, insert, update on public.activity_library to authenticated;
grant select, insert, delete on public.activity_library_equipment to authenticated;
grant select, insert, delete on public.drill_tags to authenticated;

grant select, insert, update on public.locations to authenticated;
grant select, insert, update on public.sublocations to authenticated;
grant select, insert, update on public.templates to authenticated;
grant select, insert, update on public.template_activities to authenticated;
grant select, insert, delete on public.template_activity_equipment to authenticated;
grant select, insert, update on public.template_station_blocks to authenticated;
grant select, insert, update on public.template_stations to authenticated;
grant select, insert, delete on public.template_station_equipment to authenticated;
grant select, insert, update on public.practices to authenticated;
grant select, insert, update on public.practice_activities to authenticated;
grant select, insert, delete on public.practice_activity_equipment to authenticated;
grant select, insert, update on public.station_blocks to authenticated;
grant select, insert, update on public.stations to authenticated;
grant select, insert, delete on public.station_equipment to authenticated;
