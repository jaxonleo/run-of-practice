-- Global, curated, sport-scoped top-level taxonomy (Hitting, Fielding,
-- Conditioning, etc). This is what team/L3 reporting rolls up to, so it stays
-- meaningful regardless of how granular individual coaches get underneath it
-- in skill_tags. No owner columns -- this table is curated centrally, not
-- something coaches create through the app (no INSERT policy is defined for
-- it; see rls_policies file).
create table public.skill_categories (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.skill_categories is
  'Curated, fixed taxonomy top-level. Seeded/maintained by Jax directly (service role), not user-writable.';

create index skill_categories_sport_idx on public.skill_categories (sport);
