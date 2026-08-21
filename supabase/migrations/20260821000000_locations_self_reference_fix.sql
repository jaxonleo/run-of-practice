-- Same self-referential-RETURNING bug class as teams_self_reference_fix,
-- organizations_self_reference_fix, org_members_self_reference_fix, and
-- session_access_tokens_self_reference_fix -- found live, fifty-fifth
-- session, while building a safe way to test the location delete
-- confirmation: INSERT INTO locations ... RETURNING (what .insert().select()
-- sends) fails with "new row violates row-level security policy for table
-- locations", 42501, even though the exact same insert with no .select()
-- succeeds, and a separate follow-up SELECT on the just-created row, in the
-- same transaction, correctly sees it.
--
-- locations_select_access delegates to can_access_location(p_location_id),
-- which re-queries locations by id inside itself -- a lookup against the
-- very table its own policy protects, the same self-referential shape
-- already fixed for teams/organizations/org_members/session_access_tokens.
-- Confirmed via supabase db query --linked, isolating each piece: the
-- INSERT policy's own check (can_manage_owned) passes fine on its own, so
-- RETURNING's SELECT-policy re-evaluation of can_access_location is what
-- actually rejects the new row.
--
-- Fix mirrors teams_self_reference_fix's own pattern exactly: give
-- locations' own SELECT policy a direct, lookup-free branch reading the
-- row's own organization_id/owner_user_id/id, instead of routing through a
-- function that queries locations by id. can_access_location itself is
-- deliberately left untouched here -- it's correct and still needed by
-- every other caller that looks up locations from a DIFFERENT table via a
-- foreign key column, which isn't self-referential: sublocations_select_
-- access (location_id), can_access_sublocation, the practice_location_
-- staff policies gating practices.location_id, and
-- delegated_planner_location_access. None of those change shape here, and
-- none needed to -- verified live after this migration that sublocations
-- (which never actually had this bug, since createSublocation never
-- requested .select() in the first place) is still correctly
-- visible/insertable, and that a second coach on the team still sees a
-- personally-owned location used by a shared practice.
drop policy if exists "locations_select_access" on public.locations;
create policy "locations_select_access" on public.locations
  for select using (
    public.can_access_owned(organization_id, owner_user_id)
    or exists (
      select 1 from public.practices p
      where p.location_id = locations.id and public.can_access_team(p.team_id)
    )
  );
