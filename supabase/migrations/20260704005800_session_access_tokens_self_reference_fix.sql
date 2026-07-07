-- Same bug as teams_select_access, in a brand-new table: can_access_token
-- looked itself up in session_access_tokens by id, self-referentially,
-- called from that same table's own select policy. RETURNING on the
-- INSERT triggers an implicit SELECT-policy check on the just-inserted
-- row, which the self-referential lookup can't reliably see.
--
-- Fix: check the row's own preview_session_id/live_session_id columns
-- directly (available immediately, no lookup needed) rather than
-- re-querying session_access_tokens by id. can_access_token/can_coach_token
-- are dropped entirely, not just unused -- keeping them around as
-- self-referential functions would just be a loaded footgun for the next
-- table that reaches for them.

drop policy if exists "session_access_tokens_select_access" on public.session_access_tokens;
drop policy if exists "session_access_tokens_update_coach" on public.session_access_tokens;
drop function if exists public.can_access_token(uuid);
drop function if exists public.can_coach_token(uuid);

create function public.can_access_token_by_target(p_preview_session_id uuid, p_live_session_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when p_preview_session_id is not null then
        public.can_access_practice((select ps.practice_id from public.preview_sessions ps where ps.id = p_preview_session_id))
      else
        public.can_access_session(p_live_session_id)
    end;
$$;

create function public.can_coach_token_by_target(p_preview_session_id uuid, p_live_session_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when p_preview_session_id is not null then
        public.can_coach_practice((select ps.practice_id from public.preview_sessions ps where ps.id = p_preview_session_id))
      else
        public.can_coach_session(p_live_session_id)
    end;
$$;

create policy "session_access_tokens_select_access" on public.session_access_tokens
  for select using (public.can_access_token_by_target(preview_session_id, live_session_id));

create policy "session_access_tokens_update_coach" on public.session_access_tokens
  for update using (public.can_coach_token_by_target(preview_session_id, live_session_id));
