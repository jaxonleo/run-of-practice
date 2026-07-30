-- Org-owned teams didn't surface which org they belonged to anywhere on
-- Home or the Teams list, for a simple RLS reason: organizations_select_
-- member only let a director (org_staff member) or the org's creator read
-- the row -- an assistant/head coach who's plain team_staff on one of that
-- org's teams, but not personally an org_staff member, couldn't see the
-- org's own name row at all. Extending visibility to "anyone who can
-- access a team owned by this org" is the minimal grant that makes "show
-- the org name next to the team name" possible -- it's just a name/color,
-- not membership or financial data, and matches the same can_access_team
-- check every other team-scoped read already uses.
drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member" on public.organizations
  for select using (
    created_by = auth.uid()
    or public.is_org_member(id)
    or exists (
      select 1 from public.teams t
      where t.organization_id = organizations.id and public.can_access_team(t.id)
    )
  );
