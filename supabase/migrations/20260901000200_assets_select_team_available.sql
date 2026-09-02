-- Companion to 20260901000000. That migration added
-- assets.available_to_team_planners and the link/eligibility functions, but
-- assets_select_access (last fully rewritten in
-- 20260813160000_assets_practice_station_visibility.sql) still has no
-- branch that makes an opted-in asset VISIBLE on its own -- only via an
-- already-shared drill/template or an already-built practice/station. The
-- "add team equipment to my library" picker (ModalLayer's drill editor)
-- needs to list a teammate's opted-in equipment before it has been used
-- anywhere, so it needs its own select branch.
--
-- The new branch: an asset is visible if its owner flipped
-- available_to_team_planners on AND the viewer shares at least one
-- non-archived team_staff roster with that owner. Deliberately a plain
-- "shared team" check, not a can_build_practice check -- seeing that the
-- equipment exists is harmless; can_link_asset_to_* (tightened in
-- 20260901000000) is still the gate on actually attaching it to a practice
-- or station. All eight existing branches are reproduced verbatim from the
-- live definition (confirmed via pg_get_expr before writing this).
drop policy if exists "assets_select_access" on public.assets;
create policy "assets_select_access" on public.assets
  for select using (
    public.can_access_owned(organization_id, owner_user_id)
    or exists (
      select 1 from public.activity_library_equipment ale
      join public.activity_library_org_shares s on s.activity_library_id = ale.activity_library_id
      where ale.asset_id = assets.id
        and public.is_org_member(s.organization_id)
    )
    or exists (
      select 1 from public.activity_library_equipment ale
      join public.activity_library la on la.id = ale.activity_library_id
      where ale.asset_id = assets.id
        and not la.is_private
        and public.is_library_peer(la.owner_user_id)
    )
    or exists (
      select 1 from public.template_activity_equipment tae
      join public.template_activities ta on ta.id = tae.template_activity_id
      join public.templates t on t.id = ta.template_id
      where tae.asset_id = assets.id
        and t.shared_with_organization_id is not null
        and public.is_org_member(t.shared_with_organization_id)
    )
    or exists (
      select 1 from public.template_station_equipment tse
      join public.template_stations ts on ts.id = tse.template_station_id
      join public.template_station_blocks tsb on tsb.id = ts.template_station_block_id
      join public.template_activities ta2 on ta2.id = tsb.template_activity_id
      join public.templates t2 on t2.id = ta2.template_id
      where tse.asset_id = assets.id
        and t2.shared_with_organization_id is not null
        and public.is_org_member(t2.shared_with_organization_id)
    )
    or (assets.source_catalog_id is not null and exists (
      select 1 from public.content_catalogs c where c.id = assets.source_catalog_id and c.visibility = 'public'
    ))
    or exists (
      select 1 from public.practice_activity_equipment pae
      where pae.asset_id = assets.id
        and public.can_access_practice_activity(pae.practice_activity_id)
    )
    or exists (
      select 1 from public.station_equipment se
      where se.asset_id = assets.id
        and public.can_access_station(se.station_id)
    )
    or (
      assets.available_to_team_planners
      and assets.owner_user_id is not null
      and exists (
        select 1
        from public.team_staff mine
        join public.team_staff theirs on theirs.team_id = mine.team_id
        where mine.user_id = auth.uid()
          and mine.archived_at is null
          and theirs.user_id = assets.owner_user_id
          and theirs.archived_at is null
      )
    )
  );
