-- Benchmark participant reservations: a live "who is actively recording this
-- participant right now" indicator (ROP Design System v1, section 11), layered
-- on top of benchmark_participants with zero change to its own status/
-- completion columns or to any scoring/save behavior. Mirrors this table's
-- existing dual author path (author_user_id / recording_grant_id on
-- benchmark_attempts) rather than inventing a new identity model: a
-- reservation is held by either an authenticated coach (reserved_by_user_id)
-- or an anonymous helper's grant (reserved_by_grant_id, loose uuid, same as
-- benchmark_attempts.recording_grant_id -- no hard FK, validated by the RPCs).
--
-- A reservation is a short heartbeat, not a lock: reserved_expires_at is set
-- ~90 seconds out and renewed by the client while a tester keeps a participant
-- open, so a closed tab or dropped connection releases it on its own within
-- that window with no explicit cleanup required, the same staleness
-- tolerance this app already relies on elsewhere (live-session reconcile,
-- grant expiry).
alter table public.benchmark_participants
  add column reserved_by_user_id uuid references public.profiles(id) on delete set null,
  add column reserved_by_grant_id uuid,
  add column reserved_label text,
  add column reserved_at timestamptz,
  add column reserved_expires_at timestamptz;

-- Only ever read/written through the reservation RPCs below (same pattern as
-- every other write path on this table); no RLS or grant change needed here
-- since benchmark_participants already has select-only for authenticated and
-- the anon tier never sees this table directly.
create index benchmark_participants_active_reservation_idx
  on public.benchmark_participants (id) where reserved_expires_at is not null;

comment on column public.benchmark_participants.reserved_by_user_id is 'Authenticated coach currently recording this participant, if any. Cleared by release or superseded by take-over.';
comment on column public.benchmark_participants.reserved_by_grant_id is 'Anonymous helper grant currently recording this participant, if any. Loose reference, same convention as benchmark_attempts.recording_grant_id.';
comment on column public.benchmark_participants.reserved_label is 'Display label snapshot for the current holder (coach name or grant attribution_label) so readers never need a second lookup.';
comment on column public.benchmark_participants.reserved_expires_at is 'Heartbeat expiry, ~90s from last reserve call. A reservation past this instant is treated as free regardless of the other reserved_* columns.';
