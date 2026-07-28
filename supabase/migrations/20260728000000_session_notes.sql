-- Notes system (Assistant Coach handoff §2). New, not a resurrection of the
-- old NotesTab/fetchNoteCountsForPractices (BUILD-STATUS.md Decision
-- History) -- those were a freeform per-coach list unrelated to practices,
-- deleted as dead code; nothing here reuses their shape or name.
--
-- Two grains: per-drill (practice_activity_id set) and end-of-practice
-- (null). Three authors: head coach, assistant, and anonymous token-based
-- helpers -- the last one is a first for this app (every other anonymous
-- surface is read-only), so it gets its own reviewed write path below
-- rather than being bolted onto the existing read RPCs.

create table public.session_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_live_sessions(id) on delete cascade,
  practice_activity_id uuid references public.practice_activities(id) on delete set null,
  author_kind text not null check (author_kind in ('staff', 'anonymous')),
  author_id uuid references public.profiles(id) on delete set null,
  -- Freeform display label. For anonymous notes, whatever name a helper
  -- typed -- never trusted as identity, purely display, hence no FK. For
  -- staff notes this stays null; the real name is resolved via author_id.
  author_label text,
  -- Which token an anonymous note came in on -- not "which token grants
  -- access" (that's validated at write time, not stored), but specifically
  -- for the per-token rate limit below. Null for staff notes.
  submitted_via_token_id uuid references public.session_access_tokens(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint session_notes_author_matches_kind check (
    (author_kind = 'staff' and author_id is not null and submitted_via_token_id is null)
    or (author_kind = 'anonymous' and author_id is null)
  ),
  -- Length cap confirmed by Jax before migrating (handoff §2.2) -- cheap
  -- protection against pasted junk wrecking the Goals & Insights view.
  constraint session_notes_body_length check (char_length(body) between 1 and 500)
);
create index session_notes_session_id_idx on public.session_notes(session_id);
create index session_notes_practice_activity_id_idx on public.session_notes(practice_activity_id);
create index session_notes_token_id_idx on public.session_notes(submitted_via_token_id);

-- @mention tagging (handoff §2.4). A join table, not an array column, so
-- "every note about this player" is a plain indexed query from the player
-- side (PlayerProfile), not a JSON/array containment scan.
create table public.note_player_tags (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.session_notes(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (note_id, player_id)
);
create index note_player_tags_player_id_idx on public.note_player_tags(player_id);

alter table public.session_notes enable row level security;
alter table public.note_player_tags enable row level security;

-- Same access tier as viewing the session at all (can_access_session --
-- head coach, assistant, or helper via team_staff), matching the confirmed
-- scope: everyone who can see a session can read and write its notes.
create policy session_notes_select on public.session_notes for select
  using (public.can_access_session(session_id));

create policy session_notes_insert_staff on public.session_notes for insert
  with check (
    author_kind = 'staff'
    and author_id = auth.uid()
    and public.can_access_session(session_id)
  );

-- Archive-only "edit" (project convention: never hard-delete, a coach can
-- hide a spam/junk note without destroying the audit trail). RLS can't
-- restrict which columns an UPDATE touches without a trigger; the client
-- only ever sends {archived_at}, same discipline every other
-- archiveX()-style function in this codebase already relies on.
create policy session_notes_update_archive on public.session_notes for update
  using (public.can_access_session(session_id))
  with check (public.can_access_session(session_id));

create policy note_player_tags_select on public.note_player_tags for select
  using (exists (
    select 1 from public.session_notes sn
    where sn.id = note_player_tags.note_id and public.can_access_session(sn.session_id)
  ));

-- No anon policy on either table, and no insert/update policy for
-- note_player_tags at all -- every write (staff or anonymous) goes through
-- one of the two RPCs below, both SECURITY DEFINER. Anon never gets a
-- direct table grant on anything in this schema; this isn't an exception.
grant select, insert, update on public.session_notes to authenticated;
grant select on public.note_player_tags to authenticated;

-- Staff write path. auth.uid() is the trusted actor identity (standard
-- WITH-CHECK pattern elsewhere), so this doesn't need token validation --
-- RLS on the insert already enforces it. Still an RPC, not a bare client
-- insert, so the note + its player tags land atomically (project
-- convention: no client-side insert loops for a multi-row write).
create function public.create_session_note(
  p_session_id uuid, p_practice_activity_id uuid, p_body text, p_player_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_note_id uuid;
  v_team_id uuid;
  v_pid uuid;
begin
  if not public.can_access_session(p_session_id) then
    return jsonb_build_object('error', 'no_access');
  end if;
  if p_body is null or char_length(trim(p_body)) = 0 then
    return jsonb_build_object('error', 'empty_body');
  end if;
  if char_length(p_body) > 500 then
    return jsonb_build_object('error', 'body_too_long');
  end if;
  if p_practice_activity_id is not null and not exists (
    select 1 from public.practice_activities pa
    join public.practice_live_sessions ls on ls.practice_id = pa.practice_id
    where pa.id = p_practice_activity_id and ls.id = p_session_id
  ) then
    return jsonb_build_object('error', 'activity_not_in_session');
  end if;

  select p.team_id into v_team_id
  from public.practice_live_sessions ls join public.practices p on p.id = ls.practice_id
  where ls.id = p_session_id;

  insert into public.session_notes (session_id, practice_activity_id, author_kind, author_id, body)
  values (p_session_id, p_practice_activity_id, 'staff', auth.uid(), p_body)
  returning id into v_note_id;

  -- Silently drops any id that isn't actually on this team, rather than
  -- erroring the whole note -- a stray/stale id from a client bug shouldn't
  -- block a coach's note from saving.
  foreach v_pid in array coalesce(p_player_ids, '{}') loop
    if exists (select 1 from public.players where id = v_pid and team_id = v_team_id) then
      insert into public.note_player_tags (note_id, player_id) values (v_note_id, v_pid)
      on conflict do nothing;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'note_id', v_note_id);
end;
$$;
grant execute on function public.create_session_note(uuid, uuid, text, uuid[]) to authenticated;

-- Anonymous write path -- the actual first-for-this-app surface. Token
-- validated server-side via the existing validate_token() (same function
-- every other anon RPC uses), never a client-asserted author. Accepts
-- either helper scope (read-only or attendance) -- note-writing isn't
-- gated behind attendance-marking rights, per the confirmed scope in §2.
create function public.submit_session_note_by_token(
  p_token uuid, p_body text, p_practice_activity_id uuid, p_author_label text, p_player_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session_id uuid;
  v_team_id uuid;
  v_note_id uuid;
  v_count int;
  v_pid uuid;
begin
  select vt.live_session_id into v_session_id
  from public.validate_token(p_token, array['helper_read', 'helper_attendance']) vt;

  if v_session_id is null then
    return jsonb_build_object('error', 'invalid_or_expired_token');
  end if;
  if p_body is null or char_length(trim(p_body)) = 0 then
    return jsonb_build_object('error', 'empty_body');
  end if;
  if char_length(p_body) > 500 then
    return jsonb_build_object('error', 'body_too_long');
  end if;

  -- Rate limit confirmed by Jax before migrating (handoff §2.2). Flat cap
  -- per token rather than a rolling window -- simpler, and a fresh share
  -- link (createHelperShareToken) is a fresh token/fresh cap anyway, so
  -- this only ever bites actual spam within one link's lifetime.
  select count(*) into v_count from public.session_notes where submitted_via_token_id = p_token;
  if v_count >= 40 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  if p_practice_activity_id is not null and not exists (
    select 1 from public.practice_activities pa
    join public.practice_live_sessions ls on ls.practice_id = pa.practice_id
    where pa.id = p_practice_activity_id and ls.id = v_session_id
  ) then
    return jsonb_build_object('error', 'activity_not_in_session');
  end if;

  select p.team_id into v_team_id
  from public.practice_live_sessions ls join public.practices p on p.id = ls.practice_id
  where ls.id = v_session_id;

  insert into public.session_notes (session_id, practice_activity_id, author_kind, author_label, submitted_via_token_id, body)
  values (v_session_id, p_practice_activity_id, 'anonymous', nullif(left(trim(coalesce(p_author_label, '')), 100), ''), p_token, p_body)
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
grant execute on function public.submit_session_note_by_token(uuid, text, uuid, text, uuid[]) to anon, authenticated;
