-- teams_select_access and teams_update_manage delegate to
-- can_access_team(id)/can_manage_team(id) -- but those functions look up
-- the teams table BY id, which is self-referential specifically when
-- called from teams' own policies (id = teams.id here). Same shape of bug
-- already fixed for template_activities/practice_activities in
-- 20260704003200 -- just never caught here, since teams predates that
-- pattern and was never revisited once the pattern was recognized.
--
-- Concretely, this broke INSERT ... RETURNING on teams specifically: the
-- INSERT's WITH CHECK passes fine (it only reads the new row's own column
-- values, no lookup needed), but RETURNING requires evaluating the SELECT
-- policy on the just-inserted row, and can_access_team's self-referential
-- subquery doesn't reliably see that row within the same command --
-- reported by Postgres as "new row violates row-level security policy"
-- even though the row itself would otherwise be fine.
--
-- can_access_team/can_manage_team themselves are untouched -- they're
-- correct and still used by every other table (team_staff, players,
-- practices, the station chain) where the lookup is against teams from a
-- DIFFERENT table via a foreign key column, which isn't self-referential.

drop policy if exists "teams_select_access" on public.teams;
create policy "teams_select_access" on public.teams
  for select using (
    owner_user_id = auth.uid()
    or (organization_id is not null and public.is_org_member(organization_id))
    or exists (
      select 1 from public.team_staff ts
      where ts.team_id = id
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
      where ts.team_id = id
        and ts.user_id = auth.uid()
        and ts.role = 'head_coach'
        and ts.archived_at is null
    )
  );
