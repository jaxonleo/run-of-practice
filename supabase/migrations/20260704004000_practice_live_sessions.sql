-- One practice may produce multiple practice_live_sessions over time (test runs,
-- abandoned attempts, completed runs, "Run Again") -- practice_id is
-- deliberately not unique. "In progress" is derived from an active
-- live_session existing, not tracked as a separate practices.status value.
create table public.practice_live_sessions (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),

  -- Single controller at a time. Set at creation to whoever started the
  -- session; changed only via an explicit "take control" action.
  controller_user_id uuid not null references public.profiles(id),
  version int not null default 1,

  -- Where we are in the plan right now.
  current_practice_activity_id uuid references public.practice_activities(id),
  current_rotation_number int,
  in_transition boolean not null default false,
  in_block_intro boolean not null default false,

  -- Timestamp-based timer, per the build notes: no per-second elapsed
  -- writes. Client computes elapsed = now() - current_phase_started_at -
  -- total_paused_seconds locally; the server only persists the moments
  -- things changed, not a ticking counter.
  current_phase_started_at timestamptz,
  paused_at timestamptz,
  total_paused_seconds int not null default 0,

  -- Small JSONB for transient UI-only flags not worth their own column
  -- (e.g. buzzer warned/buzzed guards) -- not a substitute for the
  -- relational tables below.
  state jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  ended_at timestamptz
);

comment on table public.practice_live_sessions is
  'A single live run of a practice. Historical truth (attendance, groups, activity timing) lives in the tables below, not in this row or the state blob.';

create index practice_live_sessions_practice_id_idx on public.practice_live_sessions (practice_id);
create index practice_live_sessions_status_idx on public.practice_live_sessions (status);
