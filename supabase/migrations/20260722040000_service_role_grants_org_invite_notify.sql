-- Real gap found live, same class as the 2026-07-10 session's discovery
-- for notify-team-staff-added: service_role bypasses RLS but NOT base
-- table grants. notify-org-invite is the first thing to ever query
-- org_invites/organizations directly with the service-role key (everything
-- else goes through SECURITY DEFINER RPCs, which don't need grants at all
-- since they run as the function owner) -- confirmed via
-- information_schema.role_table_grants that service_role had no SELECT on
-- either table (profiles already did, from the earlier function).
grant select on public.org_invites to service_role;
grant select on public.organizations to service_role;
