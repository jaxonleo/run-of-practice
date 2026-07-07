-- Roster entries. Players are records, not users -- user_id is nullable today
-- and reserved for future player logins (gear notifications, feedback, workout
-- tracking are roadmap, not launch).
create table public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  jersey_number text,
  positions text[] not null default '{}',
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.players is
  'positions is an array per the addendum decision (players routinely play multiple positions, especially at younger levels).';

create index players_team_id_idx on public.players (team_id);
create index team_staff_team_id_idx on public.team_staff (team_id);
