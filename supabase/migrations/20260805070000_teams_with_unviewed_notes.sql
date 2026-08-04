-- Direct feedback: a coach with unreviewed practice notes had no reason to
-- ever open Goals & Insights' History tab to find out -- Home should call
-- their attention to it. Batch, same convention as
-- fetch_teams_recent_completed_session, so Home can check every visible
-- team in one round trip instead of one query per team. Mirrors
-- get_team_session_history's own has_unviewed_notes criteria exactly
-- (a non-archived, unviewed note on a practice with a completed session).
create or replace function public.get_teams_with_unviewed_notes(p_team_ids uuid[])
returns uuid[]
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(distinct p.team_id), '{}')
  from public.practices p
  join public.practice_live_sessions pls on pls.practice_id = p.id and pls.status = 'completed'
  join public.notes n on n.practice_id = p.id and n.archived_at is null and n.viewed_at is null
  where p.team_id = any(p_team_ids) and p.archived_at is null and public.can_access_team(p.team_id)
$function$;

grant execute on function public.get_teams_with_unviewed_notes(uuid[]) to authenticated;
