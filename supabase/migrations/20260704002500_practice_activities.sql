-- Full copy of whatever drill/template-activity this came from -- every
-- field duplicated here, not a live reference. library_activity_id and
-- template_activity_id are lineage pointers only; editing the source later
-- never changes a practice that already copied it.
create table public.practice_activities (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  position int not null,
  type text not null check (type in ('activity', 'station_block')),
  name text,
  duration_minutes int,
  description text,
  coaching_points text,
  grouping text check (grouping in ('whole', 'partners', 'groups')),
  num_groups int,
  library_activity_id uuid references public.activity_library(id),
  template_activity_id uuid references public.template_activities(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- Always concrete -- no abstract requirement branch here. Whatever a coach
-- attaches at practice-build time is inherently resolved already, regardless
-- of whether it came from a template's abstract slot or a personal drill's
-- concrete default.
create table public.practice_activity_equipment (
  id uuid primary key default gen_random_uuid(),
  practice_activity_id uuid not null references public.practice_activities(id) on delete cascade,
  asset_id uuid not null references public.assets(id),
  created_at timestamptz not null default now(),
  unique (practice_activity_id, asset_id)
);

create index practice_activities_practice_id_idx on public.practice_activities (practice_id);
create index practice_activity_equipment_activity_id_idx on public.practice_activity_equipment (practice_activity_id);
create index practice_activity_equipment_asset_id_idx on public.practice_activity_equipment (asset_id);
