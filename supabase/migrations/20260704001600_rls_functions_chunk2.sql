-- Generic versions of the owner-access pattern already used on teams, but
-- taking organization_id/owner_user_id directly as arguments rather than
-- looking up a specific table -- reusable across assets, activity_library,
-- and org/coach-scoped skill_tags without repeating the same EXISTS logic
-- three times.

create function public.can_access_owned(p_organization_id uuid, p_owner_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    p_owner_user_id = auth.uid()
    or (p_organization_id is not null and public.is_org_member(p_organization_id));
$$;

-- Narrower than access: personal owner, or an org ADMIN (not just any org
-- member) -- this is what enforces "org-shared library items are curated
-- top-down, only org admins can add to them."
create function public.can_manage_owned(p_organization_id uuid, p_owner_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    p_owner_user_id = auth.uid()
    or (p_organization_id is not null and public.is_org_admin(p_organization_id));
$$;

-- Lookup variants for join tables (activity_library_equipment, drill_tags)
-- that need to check permissions via the activity_library row they point at.
create function public.can_access_activity(p_activity_library_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.can_access_owned(a.organization_id, a.owner_user_id)
  from public.activity_library a
  where a.id = p_activity_library_id;
$$;

create function public.can_manage_activity(p_activity_library_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.can_manage_owned(a.organization_id, a.owner_user_id)
  from public.activity_library a
  where a.id = p_activity_library_id;
$$;

-- Which assets are valid on which drill:
--   org-owned drill   -> only assets owned by that SAME org (never personal,
--                         never a different org's assets)
--   personal drill     -> the coach's own personal assets, OR assets from any
--                         org that coach belongs to (so they're not forced to
--                         re-enter gear the org already has)
create function public.can_link_asset_to_activity(p_activity_library_id uuid, p_asset_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    case
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

-- Same reasoning as can_link_asset_to_activity: org-owned drills may only use
-- global or that-same-org's tags (never someone's private coach-scoped tag,
-- which would be invisible to the drill's other viewers). Personal drills may
-- use global tags, the coach's own private tags, or tags from any org they
-- belong to.
create function public.can_link_tag_to_activity(p_activity_library_id uuid, p_skill_tag_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    case
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
