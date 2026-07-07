-- Library sharing addendum, part 3: policy rewrites. Everything that goes
-- through a wrapper function (can_access_activity, can_access_template and
-- its nested template_activity/template_station_block/template_station
-- variants, can_link_drill_to_*) already picked up the shared branch from
-- the previous migration's function replacements -- no policy change
-- needed there. Only policies that inline the ownership check directly
-- need rewriting here.

drop policy if exists "activity_library_select_access" on public.activity_library;
create policy "activity_library_select_access" on public.activity_library
  for select using (public.can_access_owned_or_shared(organization_id, owner_user_id, shared_with_organization_id));

drop policy if exists "activity_library_update_manage" on public.activity_library;
create policy "activity_library_update_manage" on public.activity_library
  for update using (public.can_manage_owned(organization_id, owner_user_id))
  with check (
    public.can_manage_owned(organization_id, owner_user_id)
    and (shared_with_organization_id is null or public.is_org_member(shared_with_organization_id))
  );

drop policy if exists "templates_select_access" on public.templates;
create policy "templates_select_access" on public.templates
  for select using (public.can_access_owned_or_shared(organization_id, owner_user_id, shared_with_organization_id));

drop policy if exists "templates_update_manage" on public.templates;
create policy "templates_update_manage" on public.templates
  for update using (public.can_manage_owned(organization_id, owner_user_id))
  with check (
    public.can_manage_owned(organization_id, owner_user_id)
    and (shared_with_organization_id is null or public.is_org_member(shared_with_organization_id))
  );

-- assets: viewers of a shared drill/template need to read the names of its
-- linked equipment too, even though they don't own those asset rows.
-- Widened with an EXISTS per equipment-join context (drill, template
-- activity slot, template station slot) rather than one combined query --
-- clearer to read and each already has an indexed asset_id column.
drop policy if exists "assets_select_access" on public.assets;
create policy "assets_select_access" on public.assets
  for select using (
    public.can_access_owned(organization_id, owner_user_id)
    or exists (
      select 1 from public.activity_library_equipment ale
      join public.activity_library a on a.id = ale.activity_library_id
      where ale.asset_id = assets.id
        and a.shared_with_organization_id is not null
        and public.is_org_member(a.shared_with_organization_id)
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
  );

-- Attribution for shared items ("Shared by ___"). profiles has no
-- cross-user reads anywhere else in this schema by design -- this is a
-- narrow, purpose-built exception (Jax's call, 2026-07-07) scoped strictly
-- to fellow org members, not a general profile-read relaxation. Exposes
-- only the existing first_name/last_name/email columns, no new columns.
create policy "profiles_select_org_co_member" on public.profiles
  for select using (
    exists (
      select 1 from public.organization_members me
      join public.organization_members them
        on them.organization_id = me.organization_id
      where me.user_id = auth.uid()
        and them.user_id = profiles.id
        and me.archived_at is null and them.archived_at is null
    )
  );
