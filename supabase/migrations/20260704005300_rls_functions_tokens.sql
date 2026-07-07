create function public.can_coach_token(p_token_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when sat.preview_session_id is not null then
        public.can_coach_practice((select ps.practice_id from public.preview_sessions ps where ps.id = sat.preview_session_id))
      else
        public.can_coach_session(sat.live_session_id)
    end
  from public.session_access_tokens sat
  where sat.id = p_token_id;
$$;

create function public.can_access_token(p_token_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when sat.preview_session_id is not null then
        public.can_access_practice((select ps.practice_id from public.preview_sessions ps where ps.id = sat.preview_session_id))
      else
        public.can_access_session(sat.live_session_id)
    end
  from public.session_access_tokens sat
  where sat.id = p_token_id;
$$;

-- Internal only -- deliberately NOT granted to anon (see grants file).
-- Anon-facing functions call this while running as their own owner
-- (security definer), so the revoke doesn't block them, only a direct
-- outside call.
create function public.validate_token(p_token uuid, p_required_scopes text[])
returns table (preview_session_id uuid, live_session_id uuid, scope text)
language sql security definer stable set search_path = public as $$
  select sat.preview_session_id, sat.live_session_id, sat.scope
  from public.session_access_tokens sat
  where sat.id = p_token
    and sat.scope = any(p_required_scopes)
    and sat.expires_at > now()
    and sat.revoked_at is null;
$$;

revoke execute on function public.validate_token(uuid, text[]) from public;
