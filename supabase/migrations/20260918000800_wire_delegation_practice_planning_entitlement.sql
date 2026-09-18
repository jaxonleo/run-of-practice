-- Entitlement architecture, Phase 3, gate 2 of 3: delegated practice
-- planning. Closes the Known Gap flagged twice in this file (twenty-fifth
-- session's own note, restated 2026-09-18): "whether granting
-- can_build_practices requires the assistant to be Pro/org-affiliated is
-- not wired to anything." set_practice_delegate had zero cap since the
-- 2026-08-16 unlimited-delegates migration removed the old one-per-team
-- unique index entirely -- this replaces that removed cap with a real,
-- plan-driven one instead of leaving it uncapped forever.
--
-- Checked against the team's real entitlement subject (its org, or its
-- personal owner), not the head coach performing the grant -- a head
-- coach without their own "plan" in any meaningful sense still manages a
-- team whose plan is what actually governs this.
create or replace function public.set_practice_delegate(p_team_staff_id uuid, p_can_build boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_current_count integer;
begin
  select team_id into v_team_id from public.team_staff where id = p_team_staff_id;
  if v_team_id is null or not public.can_manage_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  if p_can_build then
    select count(*) into v_current_count from public.team_staff
    where team_id = v_team_id and can_build_practices and archived_at is null and id <> p_team_staff_id;

    if not public.team_can_use_counted_feature(v_team_id, 'delegation.practice_planning', v_current_count) then
      raise exception 'This team''s plan does not include delegating practice planning to another assistant. Upgrade to delegate to more assistants.';
    end if;
  end if;

  update public.team_staff
  set can_build_practices = p_can_build
  where id = p_team_staff_id;
end;
$$;
