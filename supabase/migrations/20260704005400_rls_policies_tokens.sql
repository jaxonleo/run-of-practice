alter table public.session_access_tokens enable row level security;

-- anon gets NO policy here at all -- the table is invisible to anon
-- entirely. Anonymous access only ever happens through the SECURITY
-- DEFINER functions in the next migration, which read this table as their
-- own owner, bypassing RLS by design.

create policy "session_access_tokens_select_access" on public.session_access_tokens
  for select using (public.can_access_token(id));

create policy "session_access_tokens_insert_coach" on public.session_access_tokens
  for insert with check (
    created_by = auth.uid()
    and (
      (scope = 'preview' and public.can_coach_practice(
        (select ps.practice_id from public.preview_sessions ps where ps.id = preview_session_id)
      ))
      or (scope in ('helper_read', 'helper_attendance') and public.can_coach_session(live_session_id))
    )
  );

-- Update is for revocation only (setting revoked_at) -- gated to coaching
-- authority, not just access, same as everything control-adjacent.
create policy "session_access_tokens_update_coach" on public.session_access_tokens
  for update using (public.can_coach_token(id));
