-- The only one of five foreign keys pointing at practice_live_sessions that
-- was missing ON DELETE CASCADE. Unlike practice_live_sessions ->
-- practices (deliberately non-cascading, to protect real session history),
-- preview_sessions is a disposable pre-start artifact with no standalone
-- value once its target session is gone -- cascading here doesn't
-- compromise the historical-truth principle, it's just correct cleanup.
alter table public.preview_sessions
  drop constraint preview_sessions_live_session_id_fkey;

alter table public.preview_sessions
  add constraint preview_sessions_live_session_id_fkey
  foreign key (live_session_id) references public.practice_live_sessions(id) on delete cascade;
