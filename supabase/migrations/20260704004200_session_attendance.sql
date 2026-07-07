-- Append-only: attendance CHANGES are new rows, never edits to old ones.
-- Current status for a player = the most recent row for them in this
-- session. This is what actually captures "3 kids didn't show and the
-- coach pivoted" as a real, timestamped fact, rather than overwriting the
-- original plan's assumption. No UPDATE policy needed on this table at
-- all -- it's pure insert, which sidesteps the immutability-after-
-- completion question entirely for this one.
create table public.session_attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_live_sessions(id) on delete cascade,
  player_id uuid not null references public.players(id),
  status text not null check (status in ('present', 'absent', 'left_early')),
  marked_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index session_attendance_session_id_idx on public.session_attendance (session_id);
create index session_attendance_player_id_idx on public.session_attendance (player_id);
