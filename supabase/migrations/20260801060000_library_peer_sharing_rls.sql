-- Peer visibility for the new library-sharing toggles, scoped to PERSONAL
-- teams only (organization_id is null) -- org-owned teams keep using their
-- own, already-complete activity_library_org_shares mechanism; mixing the
-- two would risk a director's org-admin reach picking up unrelated
-- personal-library visibility it was never meant to have.
--
-- Deliberately checks team_staff role = 'head_coach' directly here, not
-- can_manage_team -- can_manage_team's org-admin branch is exactly what
-- this needs to stay clear of for a personal-team-only mechanism.
create function public.is_library_peer(p_owner_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    -- auth.uid() head-coaches a personal team where p_owner_user_id is a
    -- non-head-coach staff member who has opted to share their library out.
    exists (
      select 1 from public.team_staff asst
      join public.team_staff hc on hc.team_id = asst.team_id
        and hc.role = 'head_coach' and hc.archived_at is null and hc.user_id = auth.uid()
      join public.teams t on t.id = asst.team_id and t.organization_id is null
      where asst.user_id = p_owner_user_id
        and asst.archived_at is null
        and asst.role <> 'head_coach'
        and asst.assistant_shares_library
    )
    or
    -- auth.uid() is a non-head-coach staff member whose head coach
    -- (p_owner_user_id) opted to share their own library out to them.
    exists (
      select 1 from public.team_staff me
      join public.team_staff hc2 on hc2.team_id = me.team_id
        and hc2.role = 'head_coach' and hc2.archived_at is null and hc2.user_id = p_owner_user_id
      join public.teams t2 on t2.id = me.team_id and t2.organization_id is null
      where me.user_id = auth.uid()
        and me.archived_at is null
        and me.role <> 'head_coach'
        and me.head_coach_shares_library
    );
$$;

-- Same duplicate-the-OR-chain convention this file's other drill-visibility
-- functions already use (activity_library_select_access / can_access_activity
-- / can_link_drill_to_practice each independently spell out the same chain,
-- per 20260721020000_multi_org_drill_sharing.sql) -- kept consistent with
-- that existing pattern rather than introducing a new "policy calls the
-- function for its own table" shape into a live security path.
drop policy if exists "activity_library_select_access" on public.activity_library;
create policy "activity_library_select_access" on public.activity_library
  for select using (
    public.can_access_owned(organization_id, owner_user_id)
    or exists (
      select 1 from public.activity_library_org_shares s
      where s.activity_library_id = activity_library.id and public.is_org_member(s.organization_id)
    )
    or (source_catalog_id is not null and exists (
      select 1 from public.content_catalogs c where c.id = source_catalog_id and c.visibility = 'public'
    ))
    or (not is_private and public.is_library_peer(owner_user_id))
  );

create or replace function public.can_access_activity(p_activity_library_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.can_access_owned(a.organization_id, a.owner_user_id)
    or exists (
      select 1 from public.activity_library_org_shares s
      where s.activity_library_id = a.id and public.is_org_member(s.organization_id)
    )
    or (a.source_catalog_id is not null and exists (
      select 1 from public.content_catalogs c where c.id = a.source_catalog_id and c.visibility = 'public'
    ))
    or (not a.is_private and public.is_library_peer(a.owner_user_id))
  from public.activity_library a
  where a.id = p_activity_library_id;
$$;

-- Makes "add their items directly to a practice, done as a copy" work for
-- a peer-shared drill, same as it already does for an org-shared one.
create or replace function public.can_link_drill_to_practice(p_library_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    public.can_access_owned(la.organization_id, la.owner_user_id)
    or exists (
      select 1 from public.activity_library_org_shares s
      where s.activity_library_id = la.id and public.is_org_member(s.organization_id)
    )
    or (not la.is_private and public.is_library_peer(la.owner_user_id))
  from public.activity_library la where la.id = p_library_activity_id;
$$;

-- Note: equipment visibility for a peer-shared drill is a known, existing
-- limitation, not a new gap introduced here -- can_link_asset_to_practice_activity's
-- own comment already flags this exact scenario ("on a personal team with
-- more than one staff member and no shared org, one coach's equipment
-- won't be visible in full detail to a co-coach. Flagged, not solved,
-- here"). Left as-is; not expanding assets_select_access in this pass.
