-- Entitlement architecture, Phase 5: admin lookup RPCs + a richer
-- admin_get_entitlements, backing the QA/founder entitlement simulator
-- screen (handoff §6 -- "a practical way for development and QA to
-- simulate different entitlement states").

-- Same shape as grant_admin's own email lookup, exposed generically rather
-- than duplicated inline in the simulator's own query -- and unlike
-- grant_admin, this is read-only, so no "no account found" exception; the
-- caller just gets zero rows for "not found."
create function public.admin_find_user_by_email(p_email text)
returns table (id uuid, email text, first_name text, last_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select p.id, p.email, p.first_name, p.last_name
    from public.profiles p
    where lower(p.email) = lower(p_email);
end;
$$;

revoke all on function public.admin_find_user_by_email(text) from public;
grant execute on function public.admin_find_user_by_email(text) to authenticated;

-- organizations has no admin-facing list RPC today (its own RLS is
-- member-scoped, and a founder isn't necessarily a member of every org) --
-- this is the org-picker source for the simulator's Organization subject.
create function public.admin_list_organizations()
returns table (id uuid, name text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select o.id, o.name from public.organizations o
    where o.archived_at is null
    order by o.name;
end;
$$;

revoke all on function public.admin_list_organizations() from public;
grant execute on function public.admin_list_organizations() to authenticated;

-- Widened from a bare resolved-feature-map to the full picture a simulator
-- needs to render and edit: the subject's actual stored plan/cohort keys
-- (not just what they resolve to) plus its raw override rows, alongside
-- the same resolved map as before. Safe to widen via create or replace --
-- this function has no real caller yet (Phase 2/3/4 built it but nothing
-- outside this migration set calls it until now).
create or replace function public.admin_get_entitlements(
  p_subject_type text,
  p_user_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_plan_bundle_key text;
  v_cohort_bundle_key text;
  v_overrides jsonb;
  v_resolved jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_subject_type not in ('user', 'organization') then
    raise exception 'invalid subject_type';
  end if;

  select ps.plan_bundle_key into v_plan_bundle_key
  from public.entitlement_plan_state ps
  where ps.subject_type = p_subject_type
    and ((p_subject_type = 'user' and ps.user_id = p_user_id)
      or (p_subject_type = 'organization' and ps.organization_id = p_organization_id));

  select ca.cohort_bundle_key into v_cohort_bundle_key
  from public.entitlement_cohort_assignments ca
  where ca.subject_type = p_subject_type
    and ((p_subject_type = 'user' and ca.user_id = p_user_id)
      or (p_subject_type = 'organization' and ca.organization_id = p_organization_id));

  select coalesce(jsonb_agg(jsonb_build_object(
    'feature_key', o.feature_key, 'state', o.state, 'limit_value', o.limit_value,
    'reason', o.reason, 'expires_at', o.expires_at
  ) order by o.feature_key), '[]'::jsonb) into v_overrides
  from public.entitlement_overrides o
  where o.subject_type = p_subject_type
    and ((p_subject_type = 'user' and o.user_id = p_user_id)
      or (p_subject_type = 'organization' and o.organization_id = p_organization_id));

  select coalesce(jsonb_object_agg(
    f.feature_key,
    public.resolve_entitlement(p_subject_type, p_user_id, p_organization_id, f.feature_key)
  ), '{}'::jsonb) into v_resolved
  from public.features f;

  return jsonb_build_object(
    'plan_bundle_key', v_plan_bundle_key,
    'cohort_bundle_key', v_cohort_bundle_key,
    'overrides', v_overrides,
    'resolved', v_resolved
  );
end;
$$;
