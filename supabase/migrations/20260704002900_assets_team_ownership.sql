-- Adding team as a third ownership option, alongside org and personal.
-- Reasoning: a team with no organization and more than one staff member had
-- no shared equipment pool at all -- one coach's personal asset was invisible
-- in detail to a co-coach. Given "multi-coach live view" is a real product
-- tier, this isn't a rare edge case, so fixing it now while no real data
-- depends on the two-option model is cheap; it only gets more expensive later.
alter table public.assets add column team_id uuid references public.teams(id) on delete cascade;

alter table public.assets drop constraint asset_has_owner;

-- Exactly one of the three, not "at least one" -- ambiguity about which
-- owner actually governs management would be confusing.
alter table public.assets add constraint asset_has_exactly_one_owner check (
  (organization_id is not null)::int + (owner_user_id is not null)::int + (team_id is not null)::int = 1
);

create index assets_team_id_idx on public.assets (team_id);

comment on column public.assets.team_id is
  'Shared team equipment bag, managed by whoever can already manage the team (owner, org admin, or head coach). Only relevant for practices/stations -- drills and templates stay personal/org-scoped only, since a cross-team-reusable drill shouldn''t depend on one specific team''s private gear.';
