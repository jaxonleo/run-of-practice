-- Preview is derived live from the practice's current plan (still
-- draft/scheduled at this point, so there's no historical-truth tension
-- yet) -- no denormalized snapshot needed here, just a pointer to the
-- practice and, once the coach actually starts it, the resulting
-- live_session.
create table public.preview_sessions (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id),
  live_session_id uuid references public.practice_live_sessions(id),
  created_at timestamptz not null default now()
);

create index preview_sessions_practice_id_idx on public.preview_sessions (practice_id);
