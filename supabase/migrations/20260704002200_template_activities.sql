create table public.template_activities (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates(id) on delete cascade,
  position int not null,
  type text not null check (type in ('activity', 'station_block')),
  name text,
  duration_minutes int,
  description text,
  coaching_points text,
  grouping text check (grouping in ('whole', 'partners', 'groups')),
  num_groups int,
  library_activity_id uuid references public.activity_library(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.template_activities is
  'library_activity_id is lineage only, not a live binding -- editing the source library drill later never retroactively changes a template that already used it. type=station_block rows carry their block config in template_station_blocks below.';

-- Each equipment slot is EITHER a concrete asset OR an abstract description
-- ("6 cones"), never both, never a persisted resolution mapping between the
-- two. Abstract slots on an org template get resolved fresh every time a
-- coach builds a practice from it (chunk 6); a coach's own template can be
-- edited to point at concrete assets directly, which is the only way
-- resolution stops being needed going forward.
create table public.template_activity_equipment (
  id uuid primary key default gen_random_uuid(),
  template_activity_id uuid not null references public.template_activities(id) on delete cascade,
  asset_id uuid references public.assets(id),
  requirement_name text,
  requirement_quantity int,
  created_at timestamptz not null default now(),
  constraint template_activity_equipment_concrete_xor_abstract check (
    (asset_id is not null and requirement_name is null)
    or (asset_id is null and requirement_name is not null)
  )
);

create index template_activities_template_id_idx on public.template_activities (template_id);
create index template_activity_equipment_activity_id_idx on public.template_activity_equipment (template_activity_id);
create index template_activity_equipment_asset_id_idx on public.template_activity_equipment (asset_id);
