create table public.station_blocks (
  id uuid primary key default gen_random_uuid(),
  practice_activity_id uuid not null unique references public.practice_activities(id) on delete cascade,
  rotate boolean not null default true,
  station_duration_seconds int,
  transition_duration_seconds int,
  created_at timestamptz not null default now()
);

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  station_block_id uuid not null references public.station_blocks(id) on delete cascade,
  position int not null,
  name text,
  description text,
  coaching_points text,
  team_staff_id uuid references public.team_staff(id), -- assigned coach for this station
  sublocation_id uuid references public.sublocations(id),
  library_activity_id uuid references public.activity_library(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.station_equipment (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  asset_id uuid not null references public.assets(id),
  created_at timestamptz not null default now(),
  unique (station_id, asset_id)
);

create index stations_station_block_id_idx on public.stations (station_block_id);
create index stations_team_staff_id_idx on public.stations (team_staff_id);
create index station_equipment_station_id_idx on public.station_equipment (station_id);
create index station_equipment_asset_id_idx on public.station_equipment (asset_id);
