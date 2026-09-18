-- Entitlement architecture, part 5 of 6: the resolution engine.
--
-- One authoritative answer to "can this subject access this feature,"
-- server-side, per the handoff's canonical canAccess(user, feature) ask.
-- Precedence (most-specific source wins outright -- never merged/maxed
-- across sources, so behavior stays predictable and auditable):
--   1. entitlement_overrides   (can grant OR explicitly revoke)
--   2. entitlement_cohort_assignments (permanent grandfathering)
--   3. entitlement_plan_state -> bundle_features (active plan/org bundle)
--   4. features.default_state (registry floor, for anything not seeded
--      into any bundle at all -- e.g. benchmarks.history, native.*)
--
-- Written as `security definer stable` functions per this schema's own
-- established pattern (can_manage_team, can_view_goals_for_team, etc.):
-- small composable helpers, reusable directly inside a future RLS policy
-- or BEFORE INSERT trigger, not just a read-only summary endpoint. Nothing
-- calls these from a real gate yet (that's Phase 3 of the handoff's own
-- sequencing) -- but they're built capable of it now rather than needing a
-- rewrite when something first does.

create function public.resolve_entitlement(
  p_subject_type text,
  p_user_id uuid,
  p_organization_id uuid,
  p_feature_key text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_state text;
  v_limit integer;
  v_default_state text;
begin
  -- 1. Individual override.
  select o.state, o.limit_value into v_state, v_limit
  from public.entitlement_overrides o
  where o.feature_key = p_feature_key
    and o.subject_type = p_subject_type
    and ((p_subject_type = 'user' and o.user_id = p_user_id)
      or (p_subject_type = 'organization' and o.organization_id = p_organization_id))
    and (o.expires_at is null or o.expires_at > now());
  if found then
    return jsonb_build_object('state', v_state, 'limit_value', v_limit, 'source', 'override');
  end if;

  -- 2. Cohort / grandfathered bundle.
  select bf.state, bf.limit_value into v_state, v_limit
  from public.entitlement_cohort_assignments ca
  join public.bundle_features bf
    on bf.bundle_key = ca.cohort_bundle_key and bf.feature_key = p_feature_key
  where ca.subject_type = p_subject_type
    and ((p_subject_type = 'user' and ca.user_id = p_user_id)
      or (p_subject_type = 'organization' and ca.organization_id = p_organization_id));
  if found then
    return jsonb_build_object('state', v_state, 'limit_value', v_limit, 'source', 'cohort');
  end if;

  -- 3. Active plan bundle.
  select bf.state, bf.limit_value into v_state, v_limit
  from public.entitlement_plan_state ps
  join public.bundle_features bf
    on bf.bundle_key = ps.plan_bundle_key and bf.feature_key = p_feature_key
  where ps.subject_type = p_subject_type
    and ((p_subject_type = 'user' and ps.user_id = p_user_id)
      or (p_subject_type = 'organization' and ps.organization_id = p_organization_id));
  if found then
    return jsonb_build_object('state', v_state, 'limit_value', v_limit, 'source', 'plan');
  end if;

  -- 4. Registry default floor. Always resolves (features.feature_key is
  -- the FK target for all three tables above, so an unknown feature_key
  -- would already have failed earlier with a real FK error, not landed
  -- here silently).
  select f.default_state into v_default_state
  from public.features f where f.feature_key = p_feature_key;

  return jsonb_build_object('state', v_default_state, 'limit_value', null, 'source', 'default');
end;
$$;

revoke all on function public.resolve_entitlement(text, uuid, uuid, text) from public;
grant execute on function public.resolve_entitlement(text, uuid, uuid, text) to authenticated;

-- Boolean convenience wrapper for the signed-in user, meant to be called
-- directly from inside a future RLS `with check`/`using` clause or another
-- SECURITY DEFINER RPC -- e.g. `and public.can_access_feature('library.full_catalog')`.
-- 'preview' counts as accessible here on purpose: a preview state means
-- "let them in, at reduced capability" (handoff State 3), not "block them" --
-- any actual capability reduction for a preview feature is the calling
-- code's own job (e.g. reading limit_value), same as it already is for a
-- count-type feature under a plan cap.
create function public.can_access_feature(p_feature_key text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (public.resolve_entitlement('user', auth.uid(), null, p_feature_key) ->> 'state') in ('full', 'preview');
$$;

revoke all on function public.can_access_feature(text) from public;
grant execute on function public.can_access_feature(text) to authenticated;

-- Same idea, scoped to a specific organization -- returns false (never
-- raises) for a non-member, since this is meant to compose inside a
-- boolean check, not to be the caller's only authorization gate.
create function public.can_access_org_feature(p_organization_id uuid, p_feature_key text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when not public.is_org_member(p_organization_id) then false
    else (public.resolve_entitlement('organization', null, p_organization_id, p_feature_key) ->> 'state') in ('full', 'preview')
  end;
$$;

revoke all on function public.can_access_org_feature(uuid, text) from public;
grant execute on function public.can_access_org_feature(uuid, text) to authenticated;

-- Client-facing: the caller's full resolved feature map in one round trip,
-- fetched once per session (mirrors checkIsAdmin()'s existing usage
-- pattern) and used to drive every Locked/Preview/Hidden UI decision
-- without a network call per feature check.
create function public.get_my_entitlements()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select coalesce(jsonb_object_agg(f.feature_key, public.resolve_entitlement('user', auth.uid(), null, f.feature_key)), '{}'::jsonb)
  into v_result
  from public.features f;
  return v_result;
end;
$$;

revoke all on function public.get_my_entitlements() from public;
grant execute on function public.get_my_entitlements() to authenticated;

-- Same shape for a specific organization the caller belongs to -- unlike
-- can_access_org_feature, this one raises for a non-member: it's a direct,
-- explicit request for that org's data (an org workspace screen calling
-- this for "the org I'm currently viewing"), not a boolean composed into a
-- broader check, so failing loudly is the right behavior.
create function public.get_organization_entitlements(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'not authorized';
  end if;

  select coalesce(jsonb_object_agg(f.feature_key, public.resolve_entitlement('organization', null, p_organization_id, f.feature_key)), '{}'::jsonb)
  into v_result
  from public.features f;
  return v_result;
end;
$$;

revoke all on function public.get_organization_entitlements(uuid) from public;
grant execute on function public.get_organization_entitlements(uuid) to authenticated;
