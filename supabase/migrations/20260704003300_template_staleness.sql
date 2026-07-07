-- Minimal staleness detection: no version-history table, just a timestamp
-- comparison. activity_library auto-bumps updated_at on any edit; each
-- template_activity/template_station that copied from a drill snapshots that
-- drill's updated_at at copy time. "Stale" = synced_at is older than the
-- drill's current updated_at -- a simple comparison the frontend can run
-- directly, no separate view needed.
alter table public.activity_library add column updated_at timestamptz not null default now();

create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_activity_library_updated_at
  before update on public.activity_library
  for each row execute function public.touch_updated_at();

alter table public.template_activities add column library_activity_synced_at timestamptz;
alter table public.template_stations add column library_activity_synced_at timestamptz;

comment on column public.template_activities.library_activity_synced_at is
  'Snapshot of the source drill''s updated_at at the moment it was copied in (or last "update to newest" applied). Stale if this is older than activity_library.updated_at for that drill. Null if library_activity_id is null or has never been synced.';
