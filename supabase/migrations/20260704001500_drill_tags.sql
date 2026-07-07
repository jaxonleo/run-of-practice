create table public.drill_tags (
  id uuid primary key default gen_random_uuid(),
  activity_library_id uuid not null references public.activity_library(id) on delete cascade,
  skill_tag_id uuid not null references public.skill_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (activity_library_id, skill_tag_id)
);

comment on table public.drill_tags is
  'Which skill_tags a library drill is tagged with. Same skill_tags table is reused for player focus areas (chunk 6), per the shared-taxonomy decision.';

create index drill_tags_activity_id_idx on public.drill_tags (activity_library_id);
create index drill_tags_skill_tag_id_idx on public.drill_tags (skill_tag_id);
