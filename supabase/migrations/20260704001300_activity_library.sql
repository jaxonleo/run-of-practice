-- Reusable library drills. organization_id null = personal drill (default);
-- organization_id set = org-shared drill, insertable by org admins only (per
-- Jax's call -- keeps the shared library curated top-down rather than
-- degrading into the same noise a personal library would have).
--
-- player_gear is NOT a separate free-text field here, unlike the original
-- target schema listing -- it's the same `assets` table as team equipment,
-- differentiated by assets.type and linked via activity_library_equipment.
-- One picker mechanism, two contexts, no duplicated logic.
create table public.activity_library (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  sport text not null,
  name text not null,
  duration_minutes int,
  description text,
  coaching_points text,
  grouping text check (grouping in ('whole', 'partners', 'groups')),
  num_groups int,
  source_catalog_id uuid, -- nullable lineage hook for chunk 6 curated catalogs; unused until then
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint activity_has_owner check (organization_id is not null or owner_user_id is not null)
);

comment on table public.activity_library is
  'Reusable drill definitions. Copied (not referenced) into practice_activities when used in an actual practice -- chunk 3.';

create index activity_library_organization_id_idx on public.activity_library (organization_id);
create index activity_library_owner_user_id_idx on public.activity_library (owner_user_id);
create index activity_library_sport_idx on public.activity_library (sport);
