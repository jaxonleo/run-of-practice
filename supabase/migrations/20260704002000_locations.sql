-- Same coach-or-org ownership pattern as assets/activity_library. Orgs
-- pre-load locations; coaches can add their own on top.
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint location_has_owner check (organization_id is not null or owner_user_id is not null)
);

create table public.sublocations (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.sublocations is
  'A specific spot within a location (e.g. "Field 2, left corner") -- what stations actually reference.';

create index locations_organization_id_idx on public.locations (organization_id);
create index locations_owner_user_id_idx on public.locations (owner_user_id);
create index sublocations_location_id_idx on public.sublocations (location_id);
