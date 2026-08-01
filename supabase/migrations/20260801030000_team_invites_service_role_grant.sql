-- service_role bypasses RLS but not base-table GRANTs (this project's own
-- documented gotcha, hit before on profiles/org_invites/organizations) --
-- missed on team_invites itself in the prior migration. The
-- notify-team-staff-added Edge Function queries team_invites directly with
-- the service_role key and would otherwise silently fail every send.
grant select on public.team_invites to service_role;
