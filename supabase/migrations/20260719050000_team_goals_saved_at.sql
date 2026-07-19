-- "Last saved" timestamp for Goals (Jax's call, 2026-07-19). Lives on teams,
-- not derived from team_goals rows -- a coach clearing every goal (total=0,
-- every row archived) is still a real save that should show a real
-- timestamp, which max(updated_at) over active rows alone couldn't give
-- once there are zero active rows left.
alter table public.teams add column goals_saved_at timestamptz;

create or replace function public.set_team_goals(p_team_id uuid, p_targets jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'not authorized';
  end if;

  select coalesce(sum((elem->>'target_pct')::numeric), 0) into v_total
  from jsonb_array_elements(p_targets) elem
  where (elem->>'target_pct')::numeric > 0;

  if v_total not in (0, 100) then
    raise exception 'targets must sum to exactly 100 (or 0 to clear), got %', v_total;
  end if;

  update public.team_goals
  set archived_at = now()
  where team_id = p_team_id and archived_at is null
    and skill_category_id not in (
      select (elem->>'skill_category_id')::uuid from jsonb_array_elements(p_targets) elem
      where (elem->>'target_pct')::numeric > 0
    );

  insert into public.team_goals (team_id, skill_category_id, target_pct, created_by)
  select p_team_id, (elem->>'skill_category_id')::uuid, (elem->>'target_pct')::numeric, auth.uid()
  from jsonb_array_elements(p_targets) elem
  where (elem->>'target_pct')::numeric > 0
  on conflict (team_id, skill_category_id) where archived_at is null
  do update set target_pct = excluded.target_pct;

  update public.teams set goals_saved_at = now() where id = p_team_id;
end;
$$;

grant execute on function public.set_team_goals(uuid, jsonb) to authenticated;
