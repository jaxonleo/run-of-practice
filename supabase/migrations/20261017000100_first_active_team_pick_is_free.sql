-- Fix (new-coach E2E, 2026-10-17): after a downgrade, the blocking chooser's
-- first pick started the 30-day switch clock, so a coach who picked the
-- wrong team was locked into it for a month with no warning. The first
-- pick now leaves active_team_changed_at empty, which makes the next switch
-- free; every switch after that starts the 30-day clock as before. So a
-- coach gets one correction, and get_my_team_plan_status reports
-- next_switch_at as null (switch available now) until they use it.
-- Otherwise the body matches 20261014000400.
create or replace function public.set_active_personal_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current uuid;
  v_changed_at timestamptz;
  v_resolved jsonb;
begin
  if not exists (
    select 1 from public.teams
    where id = p_team_id and owner_user_id = auth.uid()
      and organization_id is null and archived_at is null
  ) then
    raise exception 'not authorized';
  end if;

  select active_personal_team_id, active_team_changed_at into v_current, v_changed_at
  from public.entitlement_plan_state
  where subject_type = 'user' and user_id = auth.uid();

  if v_current is not distinct from p_team_id then
    return;
  end if;

  v_resolved := public.resolve_entitlement('user', auth.uid(), null, 'teams.personal_count');
  if v_resolved ->> 'limit_value' is not null
     and v_current is not null
     and v_changed_at is not null
     and v_changed_at > now() - interval '30 days' then
    perform public.raise_entitlement_limit('teams.personal_count', (v_resolved ->> 'limit_value')::integer, null);
  end if;

  update public.entitlement_plan_state
    set active_personal_team_id = p_team_id,
        active_team_changed_at = case when v_current is null then null else now() end,
        updated_at = now()
    where subject_type = 'user' and user_id = auth.uid();
end;
$$;
