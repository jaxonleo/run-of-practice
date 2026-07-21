-- Org Experience handoff, part 3: multi-org drill sharing
-- (ROP-Org-Experience-Handoff.md Sec 3.2-3.3).
--
-- Scope note: this migration touches activity_library (drills) only, not
-- templates/locations, which have their own single-column
-- shared_with_organization_id and are untouched here -- that's a separate,
-- parallel mechanism not in scope of what was asked (multi-org drill
-- sharing specifically). can_access_owned_or_shared stays exactly as-is for
-- templates' continued use.
--
-- Why a join table instead of activity_library.shared_with_organization_id:
-- a coach can be director of Org A while also coaching a team in Org B (the
-- whole point of the scoped-role-matrix in Sec 1), so a single-org column
-- can't represent "share this drill with every org I have a real
-- relationship to." activity_library_org_shares is many-to-many instead.

create table public.activity_library_org_shares (
  id uuid primary key default gen_random_uuid(),
  activity_library_id uuid not null references public.activity_library(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shared_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (activity_library_id, organization_id)
);

comment on table public.activity_library_org_shares is
  'Which orgs a personal drill has been shared into for cross-team browsing (handoff Sec 3.2). Many-to-many by design -- a coach may share into more than one org. Write-only via set_drill_org_shares; no direct insert/update/delete policy, per handoff design principle 0.';

create index activity_library_org_shares_org_idx on public.activity_library_org_shares (organization_id);

alter table public.activity_library_org_shares enable row level security;

create policy "activity_library_org_shares_select" on public.activity_library_org_shares
  for select to authenticated using (
    public.can_manage_activity(activity_library_id)
    or public.is_org_member(organization_id)
  );

grant select on public.activity_library_org_shares to authenticated;

-- Gates which orgs a drill may be shared into: the sharing coach must have
-- an actual relationship to that org already (a team_staff seat on one of
-- its teams, or org_staff membership) -- not an arbitrary org they picked
-- off a list.
create function public.can_share_drill_to_org(p_owner_user_id uuid, p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1 from public.org_staff os
      where os.organization_id = p_organization_id
        and os.user_id = p_owner_user_id
        and os.archived_at is null
    )
    or exists (
      select 1 from public.team_staff ts
      join public.teams t on t.id = ts.team_id
      where ts.user_id = p_owner_user_id
        and ts.archived_at is null
        and t.organization_id = p_organization_id
    );
$$;

-- can_access_activity / activity_library_select_access: drop the
-- shared_with_organization_id branch, add the join-table equivalent.
-- Catalog (public-library) branch is untouched.
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
  from public.activity_library a
  where a.id = p_activity_library_id;
$$;

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
  );

-- activity_library_update_manage's WITH CHECK previously guarded
-- shared_with_organization_id directly on this row; that state no longer
-- lives here, so the guard is dropped -- the join table's own RLS (insert
-- only via set_drill_org_shares, which independently checks
-- can_share_drill_to_org) is what polices sharing now.
drop policy if exists "activity_library_update_manage" on public.activity_library;
create policy "activity_library_update_manage" on public.activity_library
  for update using (
    public.can_manage_owned(organization_id, owner_user_id)
    or (source_catalog_id is not null and public.is_admin())
  )
  with check (
    public.can_manage_owned(organization_id, owner_user_id)
    or (source_catalog_id is not null and public.is_admin())
  );

-- assets_select_access: only the activity_library_equipment branch changes
-- (drill sharing moved off the column); the two template branches and the
-- catalog branch are untouched.
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

-- Copy-lineage compatibility (same class of fix as the library-sharing
-- addendum originally made): a coach copying a drill they can only see via
-- an org share, not ownership, into their own practice/template.
create or replace function public.can_link_drill_to_practice(p_library_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    public.can_access_owned(la.organization_id, la.owner_user_id)
    or exists (
      select 1 from public.activity_library_org_shares s
      where s.activity_library_id = la.id and public.is_org_member(s.organization_id)
    )
  from public.activity_library la where la.id = p_library_activity_id;
$$;

create or replace function public.can_link_drill_to_template(p_template_id uuid, p_library_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when t.organization_id is not null then la.organization_id = t.organization_id
      else (
        la.owner_user_id = t.owner_user_id
        or (la.organization_id is not null and public.is_org_member(la.organization_id))
        or exists (
          select 1 from public.activity_library_org_shares s
          where s.activity_library_id = la.id and public.is_org_member(s.organization_id)
        )
      )
    end
  from public.templates t
  join public.activity_library la on la.id = p_library_activity_id
  where t.id = p_template_id;
$$;

create or replace function public.can_link_drill_to_template_station(p_template_station_block_id uuid, p_library_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when t.organization_id is not null then la.organization_id = t.organization_id
      else (
        la.owner_user_id = t.owner_user_id
        or (la.organization_id is not null and public.is_org_member(la.organization_id))
        or exists (
          select 1 from public.activity_library_org_shares s
          where s.activity_library_id = la.id and public.is_org_member(s.organization_id)
        )
      )
    end
  from public.template_station_blocks b
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  join public.activity_library la on la.id = p_library_activity_id
  where b.id = p_template_station_block_id;
$$;

-- Batch share-set RPC (handoff Sec 3.2: "all-or-nothing ownership check").
-- Replaces the full share set for each drill_id with exactly
-- p_organization_ids -- pass an empty/null array to unshare entirely.
create function public.set_drill_org_shares(p_drill_ids uuid[], p_organization_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_drill_ids is null or array_length(p_drill_ids, 1) is null then
    return;
  end if;

  if exists (
    select 1 from unnest(p_drill_ids) d(id)
    where not public.can_manage_activity(d.id)
  ) then
    raise exception 'not authorized for one or more drills';
  end if;

  if p_organization_ids is not null and array_length(p_organization_ids, 1) is not null then
    if exists (
      select 1 from unnest(p_organization_ids) o(id)
      where not public.can_share_drill_to_org(auth.uid(), o.id)
    ) then
      raise exception 'not authorized to share into one or more organizations';
    end if;
  end if;

  delete from public.activity_library_org_shares
  where activity_library_id = any(p_drill_ids)
    and not (organization_id = any(coalesce(p_organization_ids, '{}'::uuid[])));

  if p_organization_ids is not null and array_length(p_organization_ids, 1) is not null then
    insert into public.activity_library_org_shares (activity_library_id, organization_id, shared_by)
    select d.id, o.id, auth.uid()
    from unnest(p_drill_ids) d(id), unnest(p_organization_ids) o(id)
    on conflict (activity_library_id, organization_id) do nothing;
  end if;
end;
$$;

grant execute on function public.set_drill_org_shares(uuid[], uuid[]) to authenticated;

-- Fork RPC (handoff Sec 3.3): director's "Copy to org library" on a drill
-- they can currently see (own, org-owned, or org-shared). Full copy, not a
-- reference -- same full-copy-over-reference pattern as
-- practice_activities/activity_library, per design principle 0. Equipment
-- and skill tags only carry over where they'd remain link-compatible with
-- an org-owned drill (can_link_asset_to_activity/can_link_tag_to_activity's
-- org branches: org-owned assets, global tags, or that same org's tags) --
-- a personal drill's own equipment/tags usually won't qualify, so the fork
-- commonly lands with an empty equipment/tag list for the director to
-- redo, rather than silently creating a row referencing incompatible items.
create function public.promote_drill_to_org_library(p_drill_id uuid, p_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'not authorized';
  end if;
  if not public.can_access_activity(p_drill_id) then
    raise exception 'drill not found or not accessible';
  end if;

  insert into public.activity_library (
    organization_id, owner_user_id, sport, name, duration_minutes, description,
    coaching_points, grouping, num_groups
  )
  select p_organization_id, null, sport, name, duration_minutes, description,
    coaching_points, grouping, num_groups
  from public.activity_library
  where id = p_drill_id
  returning id into v_id;

  insert into public.activity_library_equipment (activity_library_id, asset_id)
  select v_id, ale.asset_id
  from public.activity_library_equipment ale
  join public.assets ast on ast.id = ale.asset_id
  where ale.activity_library_id = p_drill_id
    and ast.organization_id = p_organization_id
  on conflict do nothing;

  insert into public.drill_tags (activity_library_id, skill_tag_id)
  select v_id, dt.skill_tag_id
  from public.drill_tags dt
  join public.skill_tags st on st.id = dt.skill_tag_id
  where dt.activity_library_id = p_drill_id
    and (st.scope = 'global' or (st.scope = 'org' and st.organization_id = p_organization_id))
  on conflict do nothing;

  return v_id;
end;
$$;

grant execute on function public.promote_drill_to_org_library(uuid, uuid) to authenticated;

-- shared_with_organization_id is fully superseded by the join table above
-- for activity_library specifically (templates keeps its own column,
-- untouched). Confirmed no remaining reference: activity_library's select/
-- update policies, can_access_activity, and the three can_link_drill_to_*
-- functions were all rewritten above; nothing else in the schema reads this
-- column off activity_library.
alter table public.activity_library drop column shared_with_organization_id;
