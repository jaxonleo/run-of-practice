-- Library sharing addendum, part 2: RLS helper functions. New named
-- function rather than overloading can_access_owned -- that function is
-- reused by tables (assets, locations, skill_tags, teams-adjacent checks)
-- that have no shared_with_organization_id column at all; overloading would
-- invite ambiguity at call sites, a distinct name doesn't.
create function public.can_access_owned_or_shared(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_shared_with_organization_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.can_access_owned(p_organization_id, p_owner_user_id)
    or (p_shared_with_organization_id is not null and public.is_org_member(p_shared_with_organization_id));
$$;

-- can_access_activity: used by activity_library_equipment and drill_tags
-- policies, so org viewers of a shared drill can see its equipment/tag join
-- rows, not just the drill row itself.
create or replace function public.can_access_activity(p_activity_library_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.can_access_owned_or_shared(a.organization_id, a.owner_user_id, a.shared_with_organization_id)
  from public.activity_library a
  where a.id = p_activity_library_id;
$$;

-- Template equivalents: can_access_template plus every nested join lookup
-- that independently re-derives ownership from the templates row rather
-- than calling can_access_template (template_activities, template_stations
-- chain) -- all need the same shared branch, or an org viewer could see the
-- shared template itself but not its contents.
create or replace function public.can_access_template(p_template_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_owned_or_shared(t.organization_id, t.owner_user_id, t.shared_with_organization_id)
  from public.templates t where t.id = p_template_id;
$$;

create or replace function public.can_access_template_activity(p_template_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_owned_or_shared(t.organization_id, t.owner_user_id, t.shared_with_organization_id)
  from public.template_activities ta
  join public.templates t on t.id = ta.template_id
  where ta.id = p_template_activity_id;
$$;

create or replace function public.can_access_template_station_block(p_block_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_owned_or_shared(t.organization_id, t.owner_user_id, t.shared_with_organization_id)
  from public.template_station_blocks b
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  where b.id = p_block_id;
$$;

create or replace function public.can_access_template_station(p_station_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_owned_or_shared(t.organization_id, t.owner_user_id, t.shared_with_organization_id)
  from public.template_stations s
  join public.template_station_blocks b on b.id = s.template_station_block_id
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  where s.id = p_station_id;
$$;

-- Copy-lineage compatibility: a coach copying a drill they can only SEE via
-- sharing (not own, not org-owned) into their OWN practice/template must
-- still be allowed to record library_activity_id lineage, or the copy
-- action gets rejected even though the frontend correctly inlined the
-- drill's fields per copy-not-reference semantics.
create or replace function public.can_link_drill_to_practice(p_library_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_owned_or_shared(la.organization_id, la.owner_user_id, la.shared_with_organization_id)
  from public.activity_library la where la.id = p_library_activity_id;
$$;

-- Org-owned templates (admin-curated) deliberately do NOT get the shared
-- branch here -- pulling a coach-shared drill directly into an org's owned
-- template would be an unauthorized "promote to org library" bypass, which
-- the addendum explicitly defers to a future admin-only action. Only the
-- personal-template (else) branch gains the shared option.
create or replace function public.can_link_drill_to_template(p_template_id uuid, p_library_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when t.organization_id is not null then la.organization_id = t.organization_id
      else (
        la.owner_user_id = t.owner_user_id
        or (la.organization_id is not null and public.is_org_member(la.organization_id))
        or (la.shared_with_organization_id is not null and public.is_org_member(la.shared_with_organization_id))
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
        or (la.shared_with_organization_id is not null and public.is_org_member(la.shared_with_organization_id))
      )
    end
  from public.template_station_blocks b
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  join public.activity_library la on la.id = p_library_activity_id
  where b.id = p_template_station_block_id;
$$;
