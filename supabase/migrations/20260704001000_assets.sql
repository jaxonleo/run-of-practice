-- Equipment registry: covers both team equipment (pitching machine, L-screen)
-- and player gear, distinguished by `type`. Hard sport-scoped per Jax's call --
-- a basketball drill should never see lacrosse gear in its picker, so there's
-- no cross-sport or "any sport" fallback here.
--
-- No quantity/count field on purpose -- these are named items ("L-Screen"),
-- not inventory with stock levels.
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  sport text not null,
  type text not null check (type in ('team_equipment', 'player_gear')),
  name text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint asset_has_owner check (organization_id is not null or owner_user_id is not null)
);

comment on table public.assets is
  'Coach-personal or org-shared equipment/gear. When building a drill, a coach picks from existing assets for that sport, or types a new one -- which both attaches it to the drill and adds it to their library for next time.';

create index assets_organization_id_idx on public.assets (organization_id);
create index assets_owner_user_id_idx on public.assets (owner_user_id);
create index assets_sport_idx on public.assets (sport);
