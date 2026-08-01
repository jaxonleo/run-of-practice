-- Closes the gap flagged when the equipment-mismatch dialogs shipped
-- earlier today: assets_select_access was deliberately left untouched when
-- is_library_peer() was introduced, so a peer-shared drill's equipment was
-- invisible under RLS even though the drill itself was visible -- neither
-- equipment-mismatch dialog could even detect a gap for that case, and a
-- peer-shared drill's "Needs:" list resolved to nothing in the UI.
--
-- Same shape as the existing org-share branch just below it (an asset is
-- visible if it's linked to a drill visible via org sharing), swapping in
-- the peer mechanism: an asset is visible if it's linked to a drill
-- visible via is_library_peer(), respecting is_private the same way
-- activity_library_select_access already does. Templates are untouched --
-- peer sharing was scoped to drill libraries only (Jax's own framing:
-- "a coach's drill library item is default shared with peers"), not
-- templates, which keep their existing org-only shared_with_organization_id
-- model.
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
  );
