-- Top-level org (e.g. a rec league or club) that can own teams and a shared library.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.organizations is
  'Org layer, present from day 1 but optional at launch — most coaches will have no organization_id and own their teams personally.';
