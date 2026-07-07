-- practices: add location_id compatibility check. Insert had no WITH CHECK
-- beyond USING before; update had none at all (first time a per-column
-- check is needed here).
drop policy if exists "practices_insert_manage" on public.practices;
create policy "practices_insert_manage" on public.practices
  for insert with check (
    public.can_manage_team(team_id)
    and (location_id is null or public.can_access_location(location_id))
  );

drop policy if exists "practices_update_manage" on public.practices;
create policy "practices_update_manage" on public.practices
  for update using (public.can_manage_team(team_id))
  with check (
    public.can_manage_team(team_id)
    and (location_id is null or public.can_access_location(location_id))
  );

-- templates: same location_id check, layered onto the existing share-target
-- check from the library sharing addendum (update_manage already has a
-- WITH CHECK from that migration; insert_manage didn't need one until now).
drop policy if exists "templates_insert_manage" on public.templates;
create policy "templates_insert_manage" on public.templates
  for insert with check (
    public.can_manage_owned(organization_id, owner_user_id)
    and (location_id is null or public.can_access_location(location_id))
  );

drop policy if exists "templates_update_manage" on public.templates;
create policy "templates_update_manage" on public.templates
  for update using (public.can_manage_owned(organization_id, owner_user_id))
  with check (
    public.can_manage_owned(organization_id, owner_user_id)
    and (shared_with_organization_id is null or public.is_org_member(shared_with_organization_id))
    and (location_id is null or public.can_access_location(location_id))
  );

-- practice_activities: team_staff_id must belong to the practice's own
-- team; sublocation_id must be in an accessible location. Update gets an
-- explicit WITH CHECK for the first time (previously just USING, since
-- there was nothing on this table worth validating at update time before).
drop policy if exists "practice_activities_insert_manage" on public.practice_activities;
create policy "practice_activities_insert_manage" on public.practice_activities
  for insert with check (
    public.can_manage_practice(practice_id)
    and (library_activity_id is null or public.can_link_drill_to_practice(library_activity_id))
    and (team_staff_id is null or public.staff_belongs_to_practice_team(practice_id, team_staff_id))
    and (sublocation_id is null or public.can_access_sublocation(sublocation_id))
  );

drop policy if exists "practice_activities_update_manage" on public.practice_activities;
create policy "practice_activities_update_manage" on public.practice_activities
  for update using (public.can_manage_practice(practice_id))
  with check (
    public.can_manage_practice(practice_id)
    and (team_staff_id is null or public.staff_belongs_to_practice_team(practice_id, team_staff_id))
    and (sublocation_id is null or public.can_access_sublocation(sublocation_id))
  );

-- template_activities: sublocation_id accessibility only -- no team_staff_id
-- column exists here (templates aren't team-scoped).
drop policy if exists "template_activities_insert_manage" on public.template_activities;
create policy "template_activities_insert_manage" on public.template_activities
  for insert with check (
    public.can_manage_template(template_id)
    and (library_activity_id is null or public.can_link_drill_to_template(template_id, library_activity_id))
    and (sublocation_id is null or public.can_access_sublocation(sublocation_id))
  );

drop policy if exists "template_activities_update_manage" on public.template_activities;
create policy "template_activities_update_manage" on public.template_activities
  for update using (public.can_manage_template(template_id))
  with check (
    public.can_manage_template(template_id)
    and (sublocation_id is null or public.can_access_sublocation(sublocation_id))
  );
