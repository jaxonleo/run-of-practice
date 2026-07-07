-- Same append-only principle as attendance: a reshuffle inserts a fresh
-- batch of groups rather than editing the existing one. "Current" grouping
-- for a station block = the most recent created_at batch for that
-- practice_activity_id -- determined by the query, not an is_current flag,
-- so this table never needs UPDATE either.
create table public.session_groups (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_live_sessions(id) on delete cascade,
  practice_activity_id uuid not null references public.practice_activities(id),
  group_number int not null,
  created_at timestamptz not null default now()
);

create table public.session_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.session_groups(id) on delete cascade,
  player_id uuid not null references public.players(id),
  created_at timestamptz not null default now()
);

create index session_groups_session_activity_idx on public.session_groups (session_id, practice_activity_id, created_at);
create index session_group_members_group_id_idx on public.session_group_members (group_id);
