-- Real bug found via empirical testing (a genuine second "assistant coach,
-- not owner" login testing the teams table's own SELECT policy for the
-- first time -- every prior stage's two-user testing exercised org-based
-- sharing or table access via a FK to teams from a different table, never
-- team_staff-based access to teams itself).
--
-- teams_select_access/teams_update_manage's EXISTS subqueries wrote
-- `where ts.team_id = id`, intending the bare `id` to mean the outer
-- teams.id. But team_staff (aliased ts) also has its own `id` primary key
-- column, and per SQL scoping rules the innermost enclosing scope (the
-- subquery's own FROM) wins an unqualified reference -- so `id` silently
-- resolved to ts.id, not teams.id. The condition was effectively
-- `ts.team_id = ts.id`, comparing a staff row's team_id against its own
-- unrelated primary key, which is never true. Result: any coach who is
-- team_staff but NOT the team's owner (and not an org co-member) could
-- never see the team at all via this policy -- confirmed with a live
-- non-owner coach login returning zero teams.
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
  );

drop policy if exists "teams_update_manage" on public.teams;
create policy "teams_update_manage" on public.teams
  for update using (
    owner_user_id = auth.uid()
    or (organization_id is not null and public.is_org_admin(organization_id))
    or exists (
      select 1 from public.team_staff ts
      where ts.team_id = teams.id
        and ts.user_id = auth.uid()
        and ts.role = 'head_coach'
        and ts.archived_at is null
    )
  );
