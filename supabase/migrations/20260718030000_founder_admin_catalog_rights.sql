-- Public drill library, part 2: extend the existing founder-admin role
-- (admin_users/is_admin(), 20260717000000_founder_admin_gate.sql -- today
-- scoped only to the founder-metrics dashboard) to also manage public-
-- catalog drills/equipment and the global skill-tag taxonomy, plus the
-- extensibility path for granting that same right to more users later.

-- content_catalogs: admin-authored/edited only.
create policy "content_catalogs_insert_admin" on public.content_catalogs
  for insert with check (public.is_admin());
create policy "content_catalogs_update_admin" on public.content_catalogs
  for update using (public.is_admin()) with check (public.is_admin());

-- activity_library: admin can create/edit catalog-owned rows (organization_id
-- and owner_user_id both null, source_catalog_id set) alongside the existing
-- personal/org-admin ownership path.
drop policy if exists "activity_library_insert_manage" on public.activity_library;
create policy "activity_library_insert_manage" on public.activity_library
  for insert with check (
    public.can_manage_owned(organization_id, owner_user_id)
    or (source_catalog_id is not null and public.is_admin())
  );

drop policy if exists "activity_library_update_manage" on public.activity_library;
create policy "activity_library_update_manage" on public.activity_library
  for update using (
    public.can_manage_owned(organization_id, owner_user_id)
    or (source_catalog_id is not null and public.is_admin())
  )
  with check (
    (public.can_manage_owned(organization_id, owner_user_id)
      and (shared_with_organization_id is null or public.is_org_member(shared_with_organization_id)))
    or (source_catalog_id is not null and public.is_admin())
  );

-- assets: same catalog-owned branch for system equipment. Live policies use
-- can_manage_asset_owned(organization_id, owner_user_id, team_id) (assets
-- later gained team-owned equipment, not present when the spec doc was
-- written) -- preserved here, not reverted to the simpler can_manage_owned.
drop policy if exists "assets_insert_manage" on public.assets;
create policy "assets_insert_manage" on public.assets
  for insert with check (
    public.can_manage_asset_owned(organization_id, owner_user_id, team_id)
    or (source_catalog_id is not null and public.is_admin())
  );

drop policy if exists "assets_update_manage" on public.assets;
create policy "assets_update_manage" on public.assets
  for update using (
    public.can_manage_asset_owned(organization_id, owner_user_id, team_id)
    or (source_catalog_id is not null and public.is_admin())
  );

-- can_manage_activity gates activity_library_equipment/drill_tags insert+delete.
create or replace function public.can_manage_activity(p_activity_library_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.can_manage_owned(a.organization_id, a.owner_user_id)
    or (a.source_catalog_id is not null and public.is_admin())
  from public.activity_library a
  where a.id = p_activity_library_id;
$$;

-- Which assets/tags a catalog drill may link: only that SAME catalog's own
-- equipment, and only scope='global' tags (spec §2.4 -- public-catalog
-- drills use global tags exclusively, never a personal/org one that would
-- be invisible to other viewers).
create or replace function public.can_link_asset_to_activity(p_activity_library_id uuid, p_asset_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    case
      when a.source_catalog_id is not null then ast.source_catalog_id = a.source_catalog_id
      when a.organization_id is not null then ast.organization_id = a.organization_id
      else (
        ast.owner_user_id = a.owner_user_id
        or (ast.organization_id is not null and public.is_org_member(ast.organization_id))
      )
    end
  from public.activity_library a, public.assets ast
  where a.id = p_activity_library_id
    and ast.id = p_asset_id;
$$;

create or replace function public.can_link_tag_to_activity(p_activity_library_id uuid, p_skill_tag_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    case
      when a.source_catalog_id is not null then t.scope = 'global'
      when a.organization_id is not null then (
        t.scope = 'global'
        or (t.scope = 'org' and t.organization_id = a.organization_id)
      )
      else (
        t.scope = 'global'
        or (t.scope = 'coach' and t.owner_user_id = a.owner_user_id)
        or (t.scope = 'org' and t.organization_id is not null and public.is_org_member(t.organization_id))
      )
    end
  from public.activity_library a, public.skill_tags t
  where a.id = p_activity_library_id
    and t.id = p_skill_tag_id;
$$;

-- skill_categories: was read-only/service-role-only (see original migration's
-- comment). Add archived_at -- everything else here archives, not hard-
-- deletes, and a real delete would cascade-drop every tag underneath, too
-- dangerous to expose through the app. Founder-admin gets insert/update
-- (archive-via-update), same as everywhere else in this schema.
alter table public.skill_categories add column archived_at timestamptz;

create policy "skill_categories_insert_admin" on public.skill_categories
  for insert with check (public.is_admin());
create policy "skill_categories_update_admin" on public.skill_categories
  for update using (public.is_admin()) with check (public.is_admin());

-- skill_tags: global rows were previously only insertable/updatable via
-- service role (no owner to match either existing branch). Admin can now
-- create/archive them directly.
drop policy if exists "skill_tags_insert_scoped" on public.skill_tags;
create policy "skill_tags_insert_scoped" on public.skill_tags
  for insert with check (
    (scope = 'coach' and owner_user_id = auth.uid())
    or (scope = 'org' and organization_id is not null and public.is_org_admin(organization_id))
    or (scope = 'global' and public.is_admin())
  );

drop policy if exists "skill_tags_update_manage" on public.skill_tags;
create policy "skill_tags_update_manage" on public.skill_tags
  for update using (
    public.can_manage_owned(organization_id, owner_user_id)
    or (scope = 'global' and public.is_admin())
  );

-- admin_users stays policy-free by design (reachable only through
-- SECURITY DEFINER functions, same as is_admin() itself). These three RPCs
-- are the extensibility path: granting the founder-admin right to another
-- user later is just calling grant_admin with their email -- no schema
-- change needed.
create function public.grant_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select id into v_user_id from public.profiles where email = p_email;
  if v_user_id is null then
    raise exception 'no account found for %', p_email;
  end if;
  insert into public.admin_users (user_id) values (v_user_id) on conflict do nothing;
end;
$$;

revoke all on function public.grant_admin(text) from public;
grant execute on function public.grant_admin(text) to authenticated;

create function public.revoke_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if (select count(*) from public.admin_users) <= 1 then
    raise exception 'cannot remove the last remaining admin';
  end if;
  delete from public.admin_users where user_id = p_user_id;
end;
$$;

revoke all on function public.revoke_admin(uuid) from public;
grant execute on function public.revoke_admin(uuid) to authenticated;

create function public.list_admins()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', au.user_id,
    'email', p.email,
    'name', case when p.first_name is not null and p.last_name is not null
      then p.first_name || ' ' || p.last_name else null end,
    'created_at', au.created_at
  ) order by au.created_at), '[]'::jsonb) into v_result
  from public.admin_users au
  join public.profiles p on p.id = au.user_id;
  return v_result;
end;
$$;

revoke all on function public.list_admins() from public;
grant execute on function public.list_admins() to authenticated;
