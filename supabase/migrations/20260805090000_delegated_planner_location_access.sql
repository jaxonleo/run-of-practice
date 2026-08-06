-- Real bug found live: a delegated planner (team_staff.can_build_practices,
-- 20260801070000_delegated_practice_planning_rls.sql) could pass the
-- practices_insert_manage/practices_update_manage policy's *team* check
-- (can_build_practice_for_team) but still get silently rejected by its
-- *location* check -- `(location_id is null or can_access_location(location_id))`
-- was never extended for delegation, so scheduling a practice at the
-- team's own regular location (routinely owned personally by the head
-- coach, not the delegate, and not an org team) failed RLS entirely.
-- Confirmed directly against production: for a real assistant with
-- can_build_practices=true, `can_manage_team`=false, `can_build_practice_for_team`
-- =true, but `can_access_location`=false for the exact location every one
-- of that team's practices already uses. A blocked UPDATE/INSERT under RLS
-- returns zero affected rows with no thrown error (PostgREST's normal
-- behavior for a with-check failure on a row that otherwise matched the
-- USING clause), which is exactly why this reported as "no error, but
-- nothing saved" rather than a visible failure.
--
-- Fix: a delegated planner can also use a location owned by any other
-- (non-archived) team_staff member of the *same* team -- covers "the
-- team's regular spot," which is who actually owns it in the overwhelming
-- majority of real setups, without broadening can_access_location itself
-- (which is used far more broadly, e.g. the standalone Locations library
-- screen, where this delegation shouldn't apply at all).
create function public.can_use_location_for_team(p_location_id uuid, p_team_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    public.can_access_location(p_location_id)
    or (
      public.can_build_practice_for_team(p_team_id)
      and exists (
        select 1 from public.locations l
        join public.team_staff ts on ts.user_id = l.owner_user_id
        where l.id = p_location_id
          and ts.team_id = p_team_id
          and ts.archived_at is null
      )
    );
$$;

drop policy if exists "practices_insert_manage" on public.practices;
create policy "practices_insert_manage" on public.practices
  for insert with check (
    (public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id))
    and (location_id is null or public.can_use_location_for_team(location_id, team_id))
  );

drop policy if exists "practices_update_manage" on public.practices;
create policy "practices_update_manage" on public.practices
  for update using (public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id))
  with check (
    (public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id))
    and (location_id is null or public.can_use_location_for_team(location_id, team_id))
  );
