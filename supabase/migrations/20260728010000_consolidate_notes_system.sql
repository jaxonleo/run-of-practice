-- Correction, same day as 20260728000000_session_notes.sql: that migration
-- built a parallel notes system without noticing a real one already
-- existed -- `notes` (20260714000000_notes_table.sql), already wired into
-- the live CommandScreen's quick-note/end-of-practice UI and into both
-- HistoryViewer and SessionHistoryDetail's read paths. The handoff doc's
-- framing ("notes were built once and removed") was about the deleted
-- app_data-era NotesTab, a different, unrelated feature -- not this table.
-- Zero rows existed in either session_notes or notes at the time this was
-- caught, so this is a clean swap, not a data migration.
--
-- Drops the just-added parallel system entirely...
drop function if exists public.submit_session_note_by_token(uuid, text, uuid, text, uuid[]);
drop function if exists public.create_session_note(uuid, uuid, text, uuid[]);
drop table if exists public.note_player_tags;
drop table if exists public.session_notes;

-- ...and extends the real one instead: author identity (for anonymous
-- helper writes, a first for this app -- handoff §0.2) plus @mention
-- tagging (handoff §2.4), added onto the existing table rather than a
-- second one keyed on session_id instead of practice_id.
alter table public.notes add column author_kind text not null default 'staff' check (author_kind in ('staff', 'anonymous'));
alter table public.notes add column author_label text;
alter table public.notes add column submitted_via_token_id uuid references public.session_access_tokens(id) on delete set null;
-- Length cap confirmed by Jax before migrating (handoff §2.2) -- safe to
-- add as a hard constraint since the table is empty today.
alter table public.notes add constraint notes_text_length check (char_length(text) between 1 and 500);
create index notes_token_id_idx on public.notes(submitted_via_token_id);

-- Archive-only "edit" -- notes had no UPDATE policy at all before (quick-
-- capture-only, per the original migration's own comment); this adds
-- exactly the same archive-don't-delete convention every other table
-- uses, no more. Client only ever sends {archived_at}, same discipline as
-- every other archiveX()-style function in this codebase.
create policy notes_update_archive on public.notes for update
  using (public.can_access_practice(practice_id))
  with check (public.can_access_practice(practice_id));

create table public.note_player_tags (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (note_id, player_id)
);
create index note_player_tags_player_id_idx on public.note_player_tags(player_id);

alter table public.note_player_tags enable row level security;

create policy note_player_tags_select on public.note_player_tags for select
  using (exists (
    select 1 from public.notes n
    where n.id = note_player_tags.note_id and public.can_access_practice(n.practice_id)
  ));
-- Tags are only ever inserted by whoever is creating the note itself (the
-- client inserts the note, then its tags, in the same flow) -- narrower
-- than "anyone who can see the practice," matching who's actually allowed
-- to originate this data.
create policy note_player_tags_insert on public.note_player_tags for insert
  with check (exists (
    select 1 from public.notes n
    where n.id = note_player_tags.note_id and n.created_by = auth.uid()
  ));

grant select, insert on public.note_player_tags to authenticated;

-- Anonymous write path -- the actual first-for-this-app surface (handoff
-- §0.2). Token validated server-side via validate_token(), same as every
-- other anon RPC; never a client-asserted author. practice_activity_id and
-- station_id both accepted (matching the existing per-drill/per-station
-- grain notes already support), both null = end-of-practice.
create function public.submit_practice_note_by_token(
  p_token uuid, p_body text, p_practice_activity_id uuid, p_station_id uuid,
  p_author_label text, p_player_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_live_session_id uuid;
  v_practice_id uuid;
  v_team_id uuid;
  v_note_id uuid;
  v_count int;
  v_pid uuid;
begin
  select vt.live_session_id into v_live_session_id
  from public.validate_token(p_token, array['helper_read', 'helper_attendance']) vt;

  if v_live_session_id is null then
    return jsonb_build_object('error', 'invalid_or_expired_token');
  end if;
  if p_body is null or char_length(trim(p_body)) = 0 then
    return jsonb_build_object('error', 'empty_body');
  end if;
  if char_length(p_body) > 500 then
    return jsonb_build_object('error', 'body_too_long');
  end if;

  -- Rate limit confirmed by Jax before migrating (handoff §2.2). Flat cap
  -- per token, not a rolling window -- a fresh share link
  -- (createHelperShareToken) is a fresh token/fresh cap, so this only ever
  -- bites actual spam within one link's lifetime.
  select count(*) into v_count from public.notes where submitted_via_token_id = p_token;
  if v_count >= 40 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  select ls.practice_id into v_practice_id from public.practice_live_sessions ls where ls.id = v_live_session_id;

  if p_practice_activity_id is not null and not exists (
    select 1 from public.practice_activities where id = p_practice_activity_id and practice_id = v_practice_id
  ) then
    return jsonb_build_object('error', 'activity_not_in_practice');
  end if;
  if p_station_id is not null and not exists (
    select 1 from public.stations s
    join public.station_blocks sb on sb.id = s.station_block_id
    where s.id = p_station_id and sb.practice_activity_id = p_practice_activity_id
  ) then
    return jsonb_build_object('error', 'station_not_in_activity');
  end if;

  select team_id into v_team_id from public.practices where id = v_practice_id;

  insert into public.notes (practice_id, practice_activity_id, station_id, text, author_kind, author_label, submitted_via_token_id)
  values (v_practice_id, p_practice_activity_id, p_station_id, p_body, 'anonymous', nullif(left(trim(coalesce(p_author_label, '')), 100), ''), p_token)
  returning id into v_note_id;

  foreach v_pid in array coalesce(p_player_ids, '{}') loop
    if exists (select 1 from public.players where id = v_pid and team_id = v_team_id) then
      insert into public.note_player_tags (note_id, player_id) values (v_note_id, v_pid)
      on conflict do nothing;
    end if;
  end loop;

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.submit_practice_note_by_token(uuid, text, uuid, uuid, text, uuid[]) to anon, authenticated;
