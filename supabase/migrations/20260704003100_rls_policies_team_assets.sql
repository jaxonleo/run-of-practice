-- Replace the chunk 2 asset policies with team-aware versions. The
-- practice_activity_equipment / station_equipment insert policies don't need
-- any change here -- they already call can_link_asset_to_practice_activity /
-- can_link_asset_to_station by name, and those were just redefined in place
-- via CREATE OR REPLACE in the previous migration.

drop policy if exists "assets_select_access" on public.assets;
create policy "assets_select_access" on public.assets
  for select using (public.can_access_asset_owned(organization_id, owner_user_id, team_id));

drop policy if exists "assets_insert_manage" on public.assets;
create policy "assets_insert_manage" on public.assets
  for insert with check (public.can_manage_asset_owned(organization_id, owner_user_id, team_id));

drop policy if exists "assets_update_manage" on public.assets;
create policy "assets_update_manage" on public.assets
  for update using (public.can_manage_asset_owned(organization_id, owner_user_id, team_id));
