alter table public.assets enable row level security;
alter table public.skill_categories enable row level security;
alter table public.skill_tags enable row level security;
alter table public.activity_library enable row level security;
alter table public.activity_library_equipment enable row level security;
alter table public.drill_tags enable row level security;

-- assets: same owner pattern as teams/activity_library. Org-scoped assets
-- follow the same org-admin-only write rule as the library, for the same
-- reason (org equipment stays curated, not a free-for-all).
create policy "assets_select_access" on public.assets
  for select using (public.can_access_owned(organization_id, owner_user_id));

create policy "assets_insert_manage" on public.assets
  for insert with check (public.can_manage_owned(organization_id, owner_user_id));

create policy "assets_update_manage" on public.assets
  for update using (public.can_manage_owned(organization_id, owner_user_id));

-- skill_categories: read-only reference data for any signed-in user. No
-- insert/update policy -- curated by Jax directly via the dashboard/service
-- role, not user-writable through the app.
create policy "skill_categories_select_authenticated" on public.skill_categories
  for select using (auth.uid() is not null);

-- skill_tags: global tags visible to everyone; org/coach tags via the usual
-- owner check. Insert only succeeds for 'coach' (self) or 'org' (org admin) --
-- 'global' rows have no owner to match either branch, so they're only
-- insertable via service role, same as skill_categories.
create policy "skill_tags_select_access" on public.skill_tags
  for select using (
    scope = 'global'
    or public.can_access_owned(organization_id, owner_user_id)
  );

create policy "skill_tags_insert_scoped" on public.skill_tags
  for insert with check (
    (scope = 'coach' and owner_user_id = auth.uid())
    or (scope = 'org' and organization_id is not null and public.is_org_admin(organization_id))
  );

create policy "skill_tags_update_manage" on public.skill_tags
  for update using (public.can_manage_owned(organization_id, owner_user_id));

-- activity_library
create policy "activity_library_select_access" on public.activity_library
  for select using (public.can_access_owned(organization_id, owner_user_id));

create policy "activity_library_insert_manage" on public.activity_library
  for insert with check (public.can_manage_owned(organization_id, owner_user_id));

create policy "activity_library_update_manage" on public.activity_library
  for update using (public.can_manage_owned(organization_id, owner_user_id));

-- activity_library_equipment / drill_tags: pure associations, not historical
-- entities, so unlike the rest of this schema these DO get real delete
-- policies -- removing "this drill uses an L-Screen" is a normal edit, not
-- something that erases completed-practice history (that's a separate copy,
-- made later in chunk 3).
create policy "activity_library_equipment_select_access" on public.activity_library_equipment
  for select using (public.can_access_activity(activity_library_id));

create policy "activity_library_equipment_insert_manage" on public.activity_library_equipment
  for insert with check (
    public.can_manage_activity(activity_library_id)
    and public.can_link_asset_to_activity(activity_library_id, asset_id)
  );

create policy "activity_library_equipment_delete_manage" on public.activity_library_equipment
  for delete using (public.can_manage_activity(activity_library_id));

create policy "drill_tags_select_access" on public.drill_tags
  for select using (public.can_access_activity(activity_library_id));

create policy "drill_tags_insert_manage" on public.drill_tags
  for insert with check (
    public.can_manage_activity(activity_library_id)
    and public.can_link_tag_to_activity(activity_library_id, skill_tag_id)
  );

create policy "drill_tags_delete_manage" on public.drill_tags
  for delete using (public.can_manage_activity(activity_library_id));
