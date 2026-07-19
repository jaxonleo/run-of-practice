-- Goals redesign (Jax's call, 2026-07-19): the one-goal-at-a-time editor
-- (pick a category, pick a tag, type a percent, sum <= 100 checked only in
-- the UI) is replaced by a slider per global skill tag where the total must
-- equal exactly 100 (or exactly 0, meaning "not configured yet"). Saving is
-- now a single all-or-nothing operation instead of N separate row writes,
-- so a coach adjusting several sliders can't leave team_goals in a
-- partially-saved, over/under-100 state if one write in the middle fails.
--
-- Replaces every active goal for the team with exactly the tags in
-- p_targets: anything not present (or now zero) gets archived, everything
-- else is upserted -- same active-row-per-(team,tag) semantics as the old
-- per-goal upsertTeamGoal, just applied as one transaction.
create function public.set_team_goals(p_team_id uuid, p_targets jsonb)
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
    and skill_tag_id not in (
      select (elem->>'skill_tag_id')::uuid from jsonb_array_elements(p_targets) elem
      where (elem->>'target_pct')::numeric > 0
    );

  insert into public.team_goals (team_id, skill_tag_id, target_pct, created_by)
  select p_team_id, (elem->>'skill_tag_id')::uuid, (elem->>'target_pct')::numeric, auth.uid()
  from jsonb_array_elements(p_targets) elem
  where (elem->>'target_pct')::numeric > 0
  on conflict (team_id, skill_tag_id) where archived_at is null
  do update set target_pct = excluded.target_pct;
end;
$$;

revoke all on function public.set_team_goals(uuid, jsonb) from public;
grant execute on function public.set_team_goals(uuid, jsonb) to authenticated;
