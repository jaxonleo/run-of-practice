-- Real bug found via testing the §2(e) invite-notification edge function:
-- service_role had never been explicitly granted access to any app table
-- in this schema. It didn't matter until now -- every other write path
-- goes through RLS as `authenticated`/`anon`, and migrations run as the
-- Postgres superuser via the Management API, so nothing had ever actually
-- exercised service_role's own grants. This is the first thing in the
-- project to query app tables with the service_role key (an edge function
-- needs it -- there's no user JWT to act as for a database-trigger-fired
-- call). Least-privilege: only what notify-team-staff-added actually
-- reads, not a blanket grant.

grant select on public.team_staff to service_role;
grant select on public.teams to service_role;
grant select on public.profiles to service_role;
