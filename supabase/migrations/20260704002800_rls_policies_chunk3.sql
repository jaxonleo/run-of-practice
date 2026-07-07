alter table public.locations enable row level security;
alter table public.sublocations enable row level security;
alter table public.templates enable row level security;
alter table public.template_activities enable row level security;
alter table public.template_activity_equipment enable row level security;
alter table public.template_station_blocks enable row level security;
alter table public.template_stations enable row level security;
alter table public.template_station_equipment enable row level security;
alter table public.practices enable row level security;
alter table public.practice_activities enable row level security;
alter table public.practice_activity_equipment enable row level security;
alter table public.station_blocks enable row level security;
alter table public.stations enable row level security;
alter table public.station_equipment enable row level security;

-- locations: identical shape to assets/activity_library
create policy "locations_select_access" on public.locations
  for select using (public.can_access_owned(organization_id, owner_user_id));
create policy "locations_insert_manage" on public.locations
  for insert with check (public.can_manage_owned(organization_id, owner_user_id));
create policy "locations_update_manage" on public.locations
  for update using (public.can_manage_owned(organization_id, owner_user_id));

-- sublocations
create policy "sublocations_select_access" on public.sublocations
  for select using (public.can_access_location(location_id));
create policy "sublocations_insert_manage" on public.sublocations
  for insert with check (public.can_manage_location(location_id));
create policy "sublocations_update_manage" on public.sublocations
  for update using (public.can_manage_location(location_id));

-- templates
create policy "templates_select_access" on public.templates
  for select using (public.can_access_owned(organization_id, owner_user_id));
create policy "templates_insert_manage" on public.templates
  for insert with check (public.can_manage_owned(organization_id, owner_user_id));
create policy "templates_update_manage" on public.templates
  for update using (public.can_manage_owned(organization_id, owner_user_id));

-- template_activities
create policy "template_activities_select_access" on public.template_activities
  for select using (public.can_access_template_activity(id));
create policy "template_activities_insert_manage" on public.template_activities
  for insert with check (public.can_manage_template_activity(id));
create policy "template_activities_update_manage" on public.template_activities
  for update using (public.can_manage_template_activity(id));

-- template_activity_equipment (join-shaped: real delete allowed, same reasoning as chunk 2)
create policy "template_activity_equipment_select_access" on public.template_activity_equipment
  for select using (public.can_access_template_activity(template_activity_id));
create policy "template_activity_equipment_insert_manage" on public.template_activity_equipment
  for insert with check (
    public.can_manage_template_activity(template_activity_id)
    and (asset_id is null or public.can_link_asset_to_template_activity(template_activity_id, asset_id))
  );
create policy "template_activity_equipment_delete_manage" on public.template_activity_equipment
  for delete using (public.can_manage_template_activity(template_activity_id));

-- template_station_blocks
create policy "template_station_blocks_select_access" on public.template_station_blocks
  for select using (public.can_access_template_activity(template_activity_id));
create policy "template_station_blocks_insert_manage" on public.template_station_blocks
  for insert with check (public.can_manage_template_activity(template_activity_id));
create policy "template_station_blocks_update_manage" on public.template_station_blocks
  for update using (public.can_manage_template_activity(template_activity_id));

-- template_stations
create policy "template_stations_select_access" on public.template_stations
  for select using (public.can_access_template_station_block(template_station_block_id));
create policy "template_stations_insert_manage" on public.template_stations
  for insert with check (public.can_manage_template_station_block(template_station_block_id));
create policy "template_stations_update_manage" on public.template_stations
  for update using (public.can_manage_template_station_block(template_station_block_id));

-- template_station_equipment
create policy "template_station_equipment_select_access" on public.template_station_equipment
  for select using (public.can_access_template_station(template_station_id));
create policy "template_station_equipment_insert_manage" on public.template_station_equipment
  for insert with check (
    public.can_manage_template_station(template_station_id)
    and (asset_id is null or public.can_link_asset_to_template_station(template_station_id, asset_id))
  );
create policy "template_station_equipment_delete_manage" on public.template_station_equipment
  for delete using (public.can_manage_template_station(template_station_id));

-- practices (no delete -- archive only, same as core tables)
create policy "practices_select_access" on public.practices
  for select using (public.can_access_team(team_id));
create policy "practices_insert_manage" on public.practices
  for insert with check (public.can_manage_team(team_id));
create policy "practices_update_manage" on public.practices
  for update using (public.can_manage_team(team_id));

-- practice_activities
create policy "practice_activities_select_access" on public.practice_activities
  for select using (public.can_access_practice_activity(id));
create policy "practice_activities_insert_manage" on public.practice_activities
  for insert with check (public.can_manage_practice_activity(id));
create policy "practice_activities_update_manage" on public.practice_activities
  for update using (public.can_manage_practice_activity(id));

-- practice_activity_equipment (join-shaped, real delete allowed)
create policy "practice_activity_equipment_select_access" on public.practice_activity_equipment
  for select using (public.can_access_practice_activity(practice_activity_id));
create policy "practice_activity_equipment_insert_manage" on public.practice_activity_equipment
  for insert with check (
    public.can_manage_practice_activity(practice_activity_id)
    and public.can_link_asset_to_practice_activity(practice_activity_id, asset_id)
  );
create policy "practice_activity_equipment_delete_manage" on public.practice_activity_equipment
  for delete using (public.can_manage_practice_activity(practice_activity_id));

-- station_blocks
create policy "station_blocks_select_access" on public.station_blocks
  for select using (public.can_access_practice_activity(practice_activity_id));
create policy "station_blocks_insert_manage" on public.station_blocks
  for insert with check (public.can_manage_practice_activity(practice_activity_id));
create policy "station_blocks_update_manage" on public.station_blocks
  for update using (public.can_manage_practice_activity(practice_activity_id));

-- stations
create policy "stations_select_access" on public.stations
  for select using (public.can_access_station_block(station_block_id));
create policy "stations_insert_manage" on public.stations
  for insert with check (public.can_manage_station_block(station_block_id));
create policy "stations_update_manage" on public.stations
  for update using (public.can_manage_station_block(station_block_id));

-- station_equipment (join-shaped, real delete allowed)
create policy "station_equipment_select_access" on public.station_equipment
  for select using (public.can_access_station(station_id));
create policy "station_equipment_insert_manage" on public.station_equipment
  for insert with check (
    public.can_manage_station(station_id)
    and public.can_link_asset_to_station(station_id, asset_id)
  );
create policy "station_equipment_delete_manage" on public.station_equipment
  for delete using (public.can_manage_station(station_id));
