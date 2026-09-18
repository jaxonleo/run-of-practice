-- Entitlement architecture, Phase 3: shared helpers for wiring real gates.
--
-- Two problems every count-limited or team-scoped feature check needs
-- solved, solved once here rather than per call site:
--
-- 1. A count-type feature (library.personal_drills, delegation.practice_planning,
--    ...) needs "is this subject under their limit" evaluated against a
--    caller-supplied current usage count -- can_use_counted_feature.
--
-- 2. A team-scoped feature (goals.access, delegation.practice_planning, ...)
--    must resolve against the team's actual owning subject, not the calling
--    coach: an assistant coach's own personal plan is irrelevant to whether
--    *the team they're helping* has Goals & Insights, and an org-owned
--    team's plan comes from the org, never an individual member (the
--    original entitlements.js comment's own rule, "organization membership
--    must not silently grant Pro benefits to unrelated personal teams,"
--    cuts both ways: a personal team's plan must not leak from some
--    unrelated org the viewer happens to belong to, either).
--    team_entitlement_subject/team_can_access_feature/
--    team_can_use_counted_feature solve this once, reused by every
--    per-team gate from here on.

create function public.can_use_counted_feature(
  p_feature_key text,
  p_current_count integer,
  p_subject_type text default 'user',
  p_user_id uuid default auth.uid(),
  p_organization_id uuid default null
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_resolved jsonb;
  v_state text;
  v_limit integer;
begin
  v_resolved := public.resolve_entitlement(p_subject_type, p_user_id, p_organization_id, p_feature_key);
  v_state := v_resolved ->> 'state';

  if v_state in ('locked', 'hidden') then
    return false;
  end if;

  if v_resolved ->> 'limit_value' is null then
    return true; -- uncapped on this bundle
  end if;

  v_limit := (v_resolved ->> 'limit_value')::integer;
  return p_current_count < v_limit;
end;
$$;

revoke all on function public.can_use_counted_feature(text, integer, text, uuid, uuid) from public;
grant execute on function public.can_use_counted_feature(text, integer, text, uuid, uuid) to authenticated;

-- Which entitlement subject actually governs a given team: its
-- organization (if org-owned) or its personal owner (if not) -- never the
-- calling coach. Mirrors can_manage_owned's own organization_id/
-- owner_user_id shape, just resolved to a resolve_entitlement()-ready
-- subject instead of a permission boolean.
create function public.team_entitlement_subject(p_team_id uuid)
returns table (subject_type text, user_id uuid, organization_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select
    case when t.organization_id is not null then 'organization' else 'user' end,
    case when t.organization_id is not null then null else t.owner_user_id end,
    t.organization_id
  from public.teams t
  where t.id = p_team_id;
$$;

create function public.team_can_access_feature(p_team_id uuid, p_feature_key text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (public.resolve_entitlement(s.subject_type, s.user_id, s.organization_id, p_feature_key) ->> 'state') in ('full', 'preview')
  from public.team_entitlement_subject(p_team_id) s;
$$;

revoke all on function public.team_can_access_feature(uuid, text) from public;
grant execute on function public.team_can_access_feature(uuid, text) to authenticated;

create function public.team_can_use_counted_feature(p_team_id uuid, p_feature_key text, p_current_count integer)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  s record;
begin
  select * into s from public.team_entitlement_subject(p_team_id);
  return public.can_use_counted_feature(p_feature_key, p_current_count, s.subject_type, s.user_id, s.organization_id);
end;
$$;

revoke all on function public.team_can_use_counted_feature(uuid, text, integer) from public;
grant execute on function public.team_can_use_counted_feature(uuid, text, integer) to authenticated;
