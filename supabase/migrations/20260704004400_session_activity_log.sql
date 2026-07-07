-- The actual historical-truth record: real start/end per activity (or per
-- individual station within a block, which run simultaneously and each get
-- their own log entry) plus a snapshot of who was actually present at that
-- moment -- captured directly as an array, not derived later by joining
-- session_attendance as of some timestamp, since "can't backfill, capture
-- from day 1" was the explicit requirement.
create table public.session_activity_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_live_sessions(id) on delete cascade,
  practice_activity_id uuid references public.practice_activities(id),
  station_id uuid references public.stations(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  present_player_ids uuid[] not null default '{}',
  constraint session_activity_log_exactly_one_target check (
    (practice_activity_id is not null and station_id is null)
    or (practice_activity_id is null and station_id is not null)
  )
);

create index session_activity_log_session_id_idx on public.session_activity_log (session_id);
