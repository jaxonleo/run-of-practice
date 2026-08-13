-- Real bug found live testing as an assistant coach: the Equipment Needed
-- section, and every per-drill/per-station equipment pill, was silently
-- empty on the assistant's own Practice Setup screen for a practice built
-- by the head coach. Root-caused to assets_select_access having no branch
-- at all for "this asset is linked to a practice_activity/station on a
-- team I can access" -- only own/org-owned, org-shared-via-drill-library,
-- peer-shared-via-drill-library, and org-shared-via-template assets were
-- visible. practice_activity_equipment/station_equipment's own SELECT
-- policies already grant any team co-coach the join-row itself (asset_id
-- included) via can_access_practice_activity/can_access_station, so the
-- client already had the right ids -- resolving those ids against the
-- assets table (equipNamesFor, CommandScreen.jsx) is what silently
-- produced nothing, since a personally-owned asset used directly in a
-- practice (not through a shared drill) was invisible under RLS to any
-- other coach on the same team, even one fully authorized to view and
-- run that practice.
--
-- Same shape as the existing org/peer-share branches just above, using
-- the same can_access_practice_activity/can_access_station checks their
-- own join-table policies already use.
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
  );
