-- Public drill library, part 1: content_catalogs + public visibility
-- (ROP-Public-Library-Spec.md §2.2-2.4). One row per sport's public catalog
-- to start (publisher_type 'system'), shape already supports an org or a
-- coach publishing their own catalog later without redesign.
create table public.content_catalogs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sport text not null,
  publisher_name text not null,
  publisher_type text not null check (publisher_type in ('system', 'org', 'coach', 'provider')),
  visibility text not null check (visibility in ('public', 'private')),
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.content_catalogs is
  'A named, publishable set of drills (a sport''s public library today; org/coach-published catalogs later). Visibility gates whether non-admins can browse it at all.';

create index content_catalogs_sport_idx on public.content_catalogs (sport);

alter table public.content_catalogs enable row level security;

create policy "content_catalogs_select_access" on public.content_catalogs
  for select using (visibility = 'public' or public.is_admin());

-- Catalog-owned rows have no organization_id/owner_user_id -- attribution
-- comes from content_catalogs.publisher_name instead, so there's no need
-- for a fake system profile/auth account (spec §2.3's original proposal).
-- Smaller blast radius, same effect.
alter table public.activity_library drop constraint activity_has_owner;
alter table public.activity_library add constraint activity_has_owner
  check (organization_id is not null or owner_user_id is not null or source_catalog_id is not null);

-- assets' actual live constraint is asset_has_exactly_one_owner (it later
-- gained a team_id column, checked as EXACTLY one of the three, not "at
-- least one" like activity_library) -- widen to exactly one of four.
alter table public.assets add column source_catalog_id uuid references public.content_catalogs(id);
alter table public.assets drop constraint asset_has_exactly_one_owner;
alter table public.assets add constraint asset_has_exactly_one_owner
  check (
    (
      (organization_id is not null)::int
      + (owner_user_id is not null)::int
      + (team_id is not null)::int
      + (source_catalog_id is not null)::int
    ) = 1
  );

-- Select-visibility additions: same shape as the existing org-sharing
-- branches in these exact policies (20260707070000_library_sharing_rls_policies.sql)
-- -- hardcoded directly on the policy, not folded into can_access_owned_or_shared,
-- since templates/locations/skill_tags reuse that helper and have no catalog concept.
drop policy if exists "activity_library_select_access" on public.activity_library;
create policy "activity_library_select_access" on public.activity_library
  for select using (
    public.can_access_owned_or_shared(organization_id, owner_user_id, shared_with_organization_id)
    or (source_catalog_id is not null and exists (
      select 1 from public.content_catalogs c where c.id = source_catalog_id and c.visibility = 'public'
    ))
  );

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
    or (assets.source_catalog_id is not null and exists (
      select 1 from public.content_catalogs c where c.id = assets.source_catalog_id and c.visibility = 'public'
    ))
  );

-- can_access_activity gates activity_library_equipment/drill_tags SELECT --
-- same catalog branch so equipment/tag join rows are visible while browsing
-- a public drill, not just the drill row itself.
create or replace function public.can_access_activity(p_activity_library_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.can_access_owned_or_shared(a.organization_id, a.owner_user_id, a.shared_with_organization_id)
    or (a.source_catalog_id is not null and exists (
      select 1 from public.content_catalogs c where c.id = a.source_catalog_id and c.visibility = 'public'
    ))
  from public.activity_library a
  where a.id = p_activity_library_id;
$$;
