-- Real bug found live: a practice built from several Public Library drills
-- plus one own-library drill showed everything correctly in Builder (which
-- browses via activity_library_select_access, already public-catalog-aware
-- since the Public Library feature shipped), but "Run Now" silently saved
-- only the one own-library drill -- Practice Setup then correctly showed
-- the real, truncated DB state, not a display bug. Console during the save
-- showed the actual cause: `saveActivityTree insert activity: {code: 42501,
-- ... "new row violates row-level security policy for table
-- practice_activities"}`, once per public-library-sourced drill.
--
-- Root cause: practice_activities_insert_manage's WITH CHECK requires
-- can_link_drill_to_practice(library_activity_id) -- a *different* gate
-- from the one that lets a coach browse/add the drill to their local
-- Builder draft (activity_library_select_access), which already has a
-- public-catalog branch. can_link_drill_to_practice never got one: it was
-- written before the Public Library feature existed (20260704), and even
-- the 2026-08-01 migration that added peer-sharing to it copied the shape
-- from a sibling function (can_access_activity) that already had a
-- public-catalog branch, but the copy itself only picked up the peer
-- branch, not the public-catalog one already sitting right above it in the
-- same file. A drill being visible enough to add to a draft was never the
-- same guarantee as being linkable at save time -- this is that class of
-- gap, just on the "can I attach this to my own practice" side instead of
-- the "can I read this row" side already documented in Gotchas.
--
-- Same gap, not yet reported but certain to hit the same way, in the
-- template-linking siblings (can_link_drill_to_template/_station) -- both
-- predate Public Library entirely and never got a peer-sharing branch
-- either. Fixed all three together rather than waiting for a second report.
create or replace function public.can_link_drill_to_practice(p_library_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    public.can_access_owned(la.organization_id, la.owner_user_id)
    or exists (
      select 1 from public.activity_library_org_shares s
      where s.activity_library_id = la.id and public.is_org_member(s.organization_id)
    )
    or (la.source_catalog_id is not null and exists (
      select 1 from public.content_catalogs c where c.id = la.source_catalog_id and c.visibility = 'public'
    ))
    or (not la.is_private and public.is_library_peer(la.owner_user_id))
  from public.activity_library la where la.id = p_library_activity_id;
$$;

create or replace function public.can_link_drill_to_template(p_template_id uuid, p_library_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when t.organization_id is not null then
        la.organization_id = t.organization_id
        or (la.source_catalog_id is not null and exists (
          select 1 from public.content_catalogs c where c.id = la.source_catalog_id and c.visibility = 'public'
        ))
      else (
        la.owner_user_id = t.owner_user_id
        or (la.organization_id is not null and public.is_org_member(la.organization_id))
        or exists (
          select 1 from public.activity_library_org_shares s
          where s.activity_library_id = la.id and public.is_org_member(s.organization_id)
        )
        or (la.source_catalog_id is not null and exists (
          select 1 from public.content_catalogs c where c.id = la.source_catalog_id and c.visibility = 'public'
        ))
        or (not la.is_private and public.is_library_peer(la.owner_user_id))
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
      when t.organization_id is not null then
        la.organization_id = t.organization_id
        or (la.source_catalog_id is not null and exists (
          select 1 from public.content_catalogs c where c.id = la.source_catalog_id and c.visibility = 'public'
        ))
      else (
        la.owner_user_id = t.owner_user_id
        or (la.organization_id is not null and public.is_org_member(la.organization_id))
        or exists (
          select 1 from public.activity_library_org_shares s
          where s.activity_library_id = la.id and public.is_org_member(s.organization_id)
        )
        or (la.source_catalog_id is not null and exists (
          select 1 from public.content_catalogs c where c.id = la.source_catalog_id and c.visibility = 'public'
        ))
        or (not la.is_private and public.is_library_peer(la.owner_user_id))
      )
    end
  from public.template_station_blocks b
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  join public.activity_library la on la.id = p_library_activity_id
  where b.id = p_template_station_block_id;
$$;
