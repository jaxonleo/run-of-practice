-- Scrimmage practice component (Everyone Rotates), data model.
-- Spec: ROP-Scrimmage-Handoff.md sections 5 and 6.1.
--
-- A scrimmage block is a single practice_activities/template_activities row
-- with type = 'scrimmage'. Unlike a station block it has no child tables --
-- its whole config and its generated board both live in jsonb on the
-- activity row (config on both tables; the generated board, which is
-- roster-specific, on practices only, matching the decision that templates
-- keep config and drop roster data).
--
-- `format` is carried from day one so a future "Three Teams" format is a
-- second generator and board on the same tile, not a second tile. Nothing
-- in table or column names is called "everyone rotates" or "rotation
-- scrimmage" -- those are format values, not the feature name (spec §10).

-- ── Plan columns ────────────────────────────────────────────────────────────
alter table public.practice_activities  add column if not exists scrimmage_config jsonb;
alter table public.template_activities  add column if not exists scrimmage_config jsonb;
-- Templates never carry assignments, so scrimmage_rounds is practices-only.
alter table public.practice_activities  add column if not exists scrimmage_rounds jsonb;

comment on column public.practice_activities.scrimmage_config is
  'Scrimmage block config (format, rounds, roundLabel, slots, hittersPerRound, absPerHitter, catcherHold, pitcherRoundsMax, perRoundTimer, roundTimerSeconds, coachRoles, locks, seed). See ROP-Scrimmage-Handoff.md section 5.1.';
comment on column public.practice_activities.scrimmage_rounds is
  'Generated board: array of {slots:{SLOT:{player_id|team_staff_id|helper_name}|null}, coachRoles:{roleId:assignee|null}}. Practices only. See ROP-Scrimmage-Handoff.md section 5.1.';
comment on column public.template_activities.scrimmage_config is
  'Scrimmage block config, same shape as practice_activities.scrimmage_config. Templates keep config, drop the generated board.';

-- ── Activity type allow-list ───────────────────────────────────────────────
-- Constraint names verified against the live schema on 2026-07-15
-- (practice_activities_type_check / template_activities_type_check), last
-- changed by 20260715060000_break_activity_type.sql which set the current
-- ('activity','station_block','checklist','break') list.
alter table public.practice_activities drop constraint practice_activities_type_check;
alter table public.practice_activities add constraint practice_activities_type_check
  check (type in ('activity', 'station_block', 'checklist', 'break', 'scrimmage'));

alter table public.template_activities drop constraint template_activities_type_check;
alter table public.template_activities add constraint template_activities_type_check
  check (type in ('activity', 'station_block', 'checklist', 'break', 'scrimmage'));

-- ── Session-scoped board override ──────────────────────────────────────────
-- Mirrors session_groups exactly: append-only snapshots, latest row per
-- (session, activity) wins, never updated. Practice Setup writes a row on
-- Repair/Regenerate/manual edit; live pick-up-and-drop does too. Precedence
-- everywhere: latest session board -> plan scrimmage_rounds -> empty.
create table public.session_scrimmage_boards (
  id uuid primary key default gen_random_uuid(),
  live_session_id uuid not null references public.practice_live_sessions(id) on delete cascade,
  practice_activity_id uuid not null references public.practice_activities(id),
  rounds jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index session_scrimmage_boards_session_activity_idx
  on public.session_scrimmage_boards (live_session_id, practice_activity_id, created_at desc);

alter table public.session_scrimmage_boards enable row level security;

-- RLS shape copied from session_groups (20260704004700_rls_policies_chunk4a.sql
-- + 20260704005000_session_groups_activity_log_actor_columns.sql): viewable
-- by anyone who can access the session, insertable by a coach who can run it
-- while it is active, actor column enforced against auth.uid(). No update or
-- delete policy -- append-only.
create policy "session_scrimmage_boards_select_access" on public.session_scrimmage_boards
  for select using (public.can_access_session(live_session_id));

create policy "session_scrimmage_boards_insert_coach" on public.session_scrimmage_boards
  for insert with check (
    public.can_coach_session(live_session_id)
    and public.is_session_active(live_session_id)
    and created_by = auth.uid()
  );

grant select, insert on public.session_scrimmage_boards to authenticated;

-- ── Live round position ────────────────────────────────────────────────────
-- Rides the session row so it syncs with zero new machinery, the same way
-- current_rotation_number does for station blocks. Reset to 0 whenever
-- current_practice_activity_id changes, in the same client code path that
-- resets the station rotation index (spec §5.2).
alter table public.practice_live_sessions
  add column if not exists scrimmage_round_idx integer not null default 0;

comment on column public.practice_live_sessions.scrimmage_round_idx is
  'Current half-inning index (0-based) for a live scrimmage block. Reset to 0 on every current_practice_activity_id change, alongside current_rotation_number.';
