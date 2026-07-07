-- No grants on user_events itself for authenticated or anon -- every write
-- happens via SECURITY DEFINER triggers/functions, which bypass table
-- grants and RLS both by running as their owner. Only the one anon-facing
-- function needs an explicit grant.
grant execute on function public.log_helper_join_event(uuid) to anon;
