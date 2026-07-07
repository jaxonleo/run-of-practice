-- 1:1 with a template_activity of type='station_block'. Holds the
-- rotation/timing config; the individual stations live below.
create table public.template_station_blocks (
  id uuid primary key default gen_random_uuid(),
  template_activity_id uuid not null unique references public.template_activities(id) on delete cascade,
  rotate boolean not null default true,
  station_duration_seconds int,
  transition_duration_seconds int,
  created_at timestamptz not null default now()
);

create table public.template_stations (
  id uuid primary key default gen_random_uuid(),
  template_station_block_id uuid not null references public.template_station_blocks(id) on delete cascade,
  position int not null,
  name text,
  description text,
  coaching_points text,
  sublocation_id uuid references public.sublocations(id),
  library_activity_id uuid references public.activity_library(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Same concrete-or-abstract shape as template_activity_equipment.
create table public.template_station_equipment (
  id uuid primary key default gen_random_uuid(),
  template_station_id uuid not null references public.template_stations(id) on delete cascade,
  asset_id uuid references public.assets(id),
  requirement_name text,
  requirement_quantity int,
  created_at timestamptz not null default now(),
  constraint template_station_equipment_concrete_xor_abstract check (
    (asset_id is not null and requirement_name is null)
    or (asset_id is null and requirement_name is not null)
  )
);

create index template_stations_block_id_idx on public.template_stations (template_station_block_id);
create index template_station_equipment_station_id_idx on public.template_station_equipment (template_station_id);
create index template_station_equipment_asset_id_idx on public.template_station_equipment (asset_id);
