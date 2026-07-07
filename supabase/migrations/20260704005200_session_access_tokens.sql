-- The row's own id IS the token embedded in helper/preview URLs
-- (gen_random_uuid() gives 122 bits of randomness -- brute-forcing a valid
-- token is computationally infeasible regardless of rate limiting, so no
-- additional throttling is needed on top of the entropy itself).
--
-- A separate table from preview_sessions/practice_live_sessions
-- deliberately -- keeps revocation/expiry/scope in one place rather than
-- overloading those tables' own primary keys as public-facing identifiers.
create table public.session_access_tokens (
  id uuid primary key default gen_random_uuid(),
  preview_session_id uuid references public.preview_sessions(id) on delete cascade,
  live_session_id uuid references public.practice_live_sessions(id) on delete cascade,
  scope text not null check (scope in ('preview', 'helper_read', 'helper_attendance')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint session_access_tokens_target_matches_scope check (
    (scope = 'preview' and preview_session_id is not null and live_session_id is null)
    or (scope in ('helper_read', 'helper_attendance') and live_session_id is not null and preview_session_id is null)
  )
);

create index session_access_tokens_preview_session_idx on public.session_access_tokens (preview_session_id);
create index session_access_tokens_live_session_idx on public.session_access_tokens (live_session_id);
