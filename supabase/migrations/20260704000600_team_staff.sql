-- Coaching staff for a team, kept separate from the player roster (see players.sql).
-- May exist before signup: invite_email set, user_id null, linked once they create
-- an account -- same nullable-user_id pattern used for players.
create table public.team_staff (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  invite_email text,
  first_name text not null,
  last_name text not null,
  role text not null check (role in ('head_coach', 'assistant_coach', 'helper')),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint staff_identifiable check (user_id is not null or invite_email is not null)
);

comment on table public.team_staff is
  'Coaching staff, split out from players: different fields (no jersey/positions), different auth relationship, cleaner RLS. first_name/last_name stored directly so we never need cross-user profile reads to show a staff directory.';
