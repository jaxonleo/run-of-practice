grant select, insert, update on public.session_access_tokens to authenticated;

-- The entire anonymous surface, deliberately narrow: three functions,
-- nothing else. No table grants to anon anywhere in this schema.
grant execute on function public.get_preview_view(uuid) to anon;
grant execute on function public.get_live_session_view(uuid) to anon;
grant execute on function public.submit_helper_attendance(uuid, uuid, text) to anon;
