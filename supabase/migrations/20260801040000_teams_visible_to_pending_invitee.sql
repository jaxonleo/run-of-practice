-- Real bug found live testing the new team_invites consent flow: the Home
-- accept/decline card rendered "You've been invited to join as an
-- Assistant Coach" with the team name missing entirely. team_invites_select
-- correctly lets the invitee see their own invite row, but the client's
-- `teams(id, name)` embed on that query hits teams' own SELECT RLS
-- separately -- and a not-yet-accepted invitee has no team_staff row, no
-- org membership, and isn't the owner, so teams_select_access blocked it.
-- Same class of gap as organizations_select_member's earlier relaxation
-- ("org name shown on team cards"), same fix shape: a narrow additional
-- OR clause, not a broad access grant -- this only exposes a team row (not
-- its roster/practices/anything else) to someone with a genuine pending
-- invite addressed to their own verified email.
drop policy if exists "teams_select_access" on public.teams;
create policy "teams_select_access" on public.teams
  for select using (
    owner_user_id = auth.uid()
    or (organization_id is not null and public.is_org_member(organization_id))
    or exists (
      select 1 from public.team_staff ts
      where ts.team_id = teams.id
        and ts.user_id = auth.uid()
        and ts.archived_at is null
    )
    or exists (
      select 1 from public.team_invites ti
      where ti.team_id = teams.id
        and ti.status = 'pending'
        and lower(ti.email) = lower(auth.jwt() ->> 'email')
    )
  );
