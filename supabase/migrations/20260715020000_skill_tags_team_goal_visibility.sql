-- Goals feature (ROP-Goals-TeamNav-Handoff.md §2.3, decision D1). A
-- coach-scoped skill_tags row is normally only visible to its owner
-- (skill_tags_select_access). Once it's referenced by an active team_goals
-- row, every coach who can access that team (assistants/helpers included)
-- needs to be able to resolve its name in the Goals + Insights tab.
--
-- SECURITY DEFINER function, same pattern as can_access_team/is_org_member
-- (reads across ownership boundaries without RLS recursing on itself).
-- This function only ever widens skill_tags SELECT -- it grants read of the
-- tag row (name/category) only, never edit, never use-in-tagging elsewhere.
create function public.tag_visible_via_team_goal(p_tag_id uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.team_goals tg
    where tg.skill_tag_id = p_tag_id
      and tg.archived_at is null
      and public.can_access_team(tg.team_id)
  );
$$;

grant execute on function public.tag_visible_via_team_goal(uuid) to authenticated;

-- Policies OR together (Postgres RLS semantics) -- this adds a second path to
-- SELECT without touching skill_tags_select_access, skill_tags_insert_scoped,
-- or skill_tags_update_manage.
create policy skill_tags_select_via_team_goal on public.skill_tags
  for select to authenticated
  using (public.tag_visible_via_team_goal(id));
