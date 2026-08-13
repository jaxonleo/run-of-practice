-- Same shape as the assets_select_access gap fixed in
-- 20260813160000_assets_practice_station_visibility.sql, found the same
-- session, live testing as an assistant coach: locations/sublocations were
-- also "identical shape to assets/activity_library" (the original comment's
-- own words) -- can_access_owned only, with no branch for "this location
-- is used by a practice on a team I coach." A personally-owned (non-org)
-- location was completely invisible under RLS to any other coach on the
-- team, which silently broke every area-dependent feature for an
-- assistant: the practice's own location name, every drill/station's Area,
-- Equipment Needed's area grouping, and the transition screen's area
-- summary all fell back to their "no location" paths (confirmed live: the
-- Rotate Now summary read "Station 1 to Station 2" instead of the real
-- area names the head coach saw for the exact same practice).
--
-- Fixed at the function level (can_access_location), not just the raw RLS
-- policy, so sublocations_select_access (which already calls this same
-- function) is fixed transitively with no separate edit needed.
-- can_manage_location is deliberately untouched -- seeing a location a
-- co-coach didn't create is fine, editing/deleting someone else's personal
-- location is a different, larger question this fix doesn't need to answer.
create or replace function public.can_access_location(p_location_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(public.can_access_owned(l.organization_id, l.owner_user_id), false)
    or exists (
      select 1 from public.practices p
      where p.location_id = p_location_id and public.can_access_team(p.team_id)
    )
  from public.locations l where l.id = p_location_id;
$$;

drop policy if exists "locations_select_access" on public.locations;
create policy "locations_select_access" on public.locations
  for select using (public.can_access_location(id));
