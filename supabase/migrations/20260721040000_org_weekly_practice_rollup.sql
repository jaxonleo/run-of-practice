-- Org Experience handoff, part 5: Org Home page data (Sec 4.3). Weekly
-- count of completed live practices across every team in one org --
-- deliberately much smaller than get_founder_metrics_summary (no signups/
-- WAC/repeat-rate breakdown, this isn't a founder dashboard), same
-- generate_series-of-weeks shape reused since it's already the right tool.
-- Gated by is_org_member (any org member can see their own org's activity),
-- not is_admin -- this has nothing to do with the founder-metrics gate.
create function public.get_org_weekly_practice_rollup(p_organization_id uuid, p_weeks integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'not authorized';
  end if;

  with
  weeks as (
    select generate_series(
      date_trunc('week', now()) - ((p_weeks - 1) || ' weeks')::interval,
      date_trunc('week', now()),
      interval '1 week'
    ) as wk
  ),
  org_team_ids as (
    select id from public.teams where organization_id = p_organization_id
  ),
  completed_by_week as (
    select date_trunc('week', pls.ended_at) wk, count(*) n
    from public.practice_live_sessions pls
    join public.practices p on p.id = pls.practice_id
    where pls.status = 'completed'
      and pls.excluded_at is null
      and p.team_id in (select id from org_team_ids)
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'wk', w.wk, 'live_practices', coalesce(c.n, 0)
  ) order by w.wk), '[]'::jsonb)
  into v_result
  from weeks w
  left join completed_by_week c on c.wk = w.wk;

  return v_result;
end;
$$;

grant execute on function public.get_org_weekly_practice_rollup(uuid, integer) to authenticated;
