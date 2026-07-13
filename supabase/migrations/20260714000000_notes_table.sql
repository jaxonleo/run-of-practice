-- Real table for practice notes. Notes were the one piece of data never
-- migrated off the legacy app_data JSONB blob when everything else
-- (practices, templates, library, locations) got its own table -- this
-- closes that gap. Not a data migration: existing notes stay wherever they
-- are in app_data, untouched; this is purely new infrastructure for notes
-- captured going forward, during a live drill/station or at the end of
-- practice.
--
-- practice_activity_id + station_id (both nullable, both SET NULL) capture
-- what was "current" at note-taking time without relying on a fragile
-- name-string match (the old blob's `context` field broke if two drills
-- shared a name). Both null = a general/end-of-practice note. Only
-- station_id set without practice_activity_id would be invalid, but that's
-- entirely a client-side invariant (the client always sets the station's
-- parent activity id too) -- not worth a CHECK constraint for a table with
-- no direct write path other than this app's own note-taking UI.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  practice_activity_id uuid references public.practice_activities(id) on delete set null,
  station_id uuid references public.stations(id) on delete set null,
  text text not null,
  -- Actor-identity column: nullable + ON DELETE SET NULL, not NOT NULL/CASCADE
  -- -- per rop_actor_deletion_fk_gotcha, this is historical practice truth
  -- that should outlive the author's account being deleted.
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index notes_practice_id_idx on public.notes (practice_id);
create index notes_practice_activity_id_idx on public.notes (practice_activity_id);
create index notes_station_id_idx on public.notes (station_id);

alter table public.notes enable row level security;

-- Reuses can_access_practice (chunk 3) -- any coach who can see the practice
-- (head coach, assistant, or helper; practices are team-scoped, not
-- head-coach-only) can read and add notes. No UPDATE/DELETE policy yet --
-- notes are quick-capture-only today, same as the blob version, so there's
-- no edit/delete UI to support.
create policy notes_select on public.notes for select
  using (public.can_access_practice(practice_id));

create policy notes_insert on public.notes for insert
  with check (public.can_access_practice(practice_id) and created_by = auth.uid());

grant select, insert on public.notes to authenticated;
