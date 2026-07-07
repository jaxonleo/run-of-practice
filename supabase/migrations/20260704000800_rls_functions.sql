-- Helper functions used by RLS policies below. security definer + stable so
-- they can read organization_members/team_staff without RLS recursing on
-- itself, and so the same access logic isn't copy-pasted into every policy.

create function public.is_org_member(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = p_org_id
      and om.user_id = auth.uid()
      and om.archived_at is null
  );
$$;

create function public.is_org_admin(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = p_org_id
      and om.user_id = auth.uid()
      and om.role in ('owner', 'admin')
      and om.archived_at is null
  );
$$;

-- Can the current user view this team (owner, org member, or team staff)?
create function public.can_access_team(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and (
        t.owner_user_id = auth.uid()
        or (t.organization_id is not null and public.is_org_member(t.organization_id))
        or exists (
          select 1 from public.team_staff ts
          where ts.team_id = t.id
            and ts.user_id = auth.uid()
            and ts.archived_at is null
        )
      )
  );
$$;

-- Can the current user manage (edit/add to) this team? Narrower than access:
-- personal owner, org admin/owner, or a head_coach on staff.
create function public.can_manage_team(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and (
        t.owner_user_id = auth.uid()
        or (t.organization_id is not null and public.is_org_admin(t.organization_id))
        or exists (
          select 1 from public.team_staff ts
          where ts.team_id = t.id
            and ts.user_id = auth.uid()
            and ts.role = 'head_coach'
            and ts.archived_at is null
        )
      )
  );
$$;
