-- Development Pulse Home widget spec, focus-team priority 2: "the visible
-- Coach Mode team with the most recent non-excluded completed live
-- session." Home already renders across every visible team, so picking the
-- focus team without a per-team query (the spec's own explicit "avoid
-- Home-level N+1" requirement) needs one batch call across every candidate
-- team id, not a full goal report per team. This looks across each team's
-- entire history, not the goals report's rolling window -- recency for
-- focus-team selection is a different question than "how is this team
-- trending lately."
create function public.get_teams_recent_completed_session(p_team_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  with candidates as (
    select distinct t.id as team_id
    from unnest(p_team_ids[1:200]) as t(id)
    where public.can_access_team(t.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'team_id', c.team_id,
    'last_completed_at', last.ended_at
  )), '[]'::jsonb) into v_result
  from candidates c
  left join lateral (
    select pls.ended_at
    from public.practice_live_sessions pls
    join public.practices p on p.id = pls.practice_id
    where p.team_id = c.team_id and pls.status = 'completed' and pls.excluded_at is null
    order by pls.ended_at desc nulls last
    limit 1
  ) last on true;

  return v_result;
end;
$$;

grant execute on function public.get_teams_recent_completed_session(uuid[]) to authenticated;
