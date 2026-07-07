-- Which assets (team equipment or player gear) a library drill needs.
-- No quantity per Jax's call -- this is "this drill uses an L-Screen", not
-- inventory counts.
create table public.activity_library_equipment (
  id uuid primary key default gen_random_uuid(),
  activity_library_id uuid not null references public.activity_library(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (activity_library_id, asset_id)
);

comment on table public.activity_library_equipment is
  'Join table; the UI splits the picker into "team equipment" vs "player gear" sections by reading assets.type on each linked row, not via separate columns here.';

create index activity_library_equipment_activity_id_idx on public.activity_library_equipment (activity_library_id);
create index activity_library_equipment_asset_id_idx on public.activity_library_equipment (asset_id);
