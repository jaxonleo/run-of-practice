-- A coached team/roster for one season.
-- organization_id null = personal (coach-owned) team, the default for launch.
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  sport text not null,
  season_label text,
  start_date date,
  end_date date,
  timezone text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint team_has_owner check (organization_id is not null or owner_user_id is not null)
);

comment on table public.teams is
  'Season model kept intentionally simple: sport + season_label + start/end date + timezone, no separate season/permanent-team hierarchy. timezone has no DB default on purpose — the client should set it from the browser/device at creation time rather than us guessing one.';
