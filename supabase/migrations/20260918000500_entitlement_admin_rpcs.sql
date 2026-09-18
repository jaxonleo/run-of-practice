-- Entitlement architecture, part 6 of 6: admin write access.
--
-- entitlement_plan_state/entitlement_cohort_assignments/entitlement_overrides
-- have no insert/update/delete grant for `authenticated` at all (part 3) --
-- these SECURITY DEFINER RPCs are the only way to write to them from the
-- client, each re-checking is_admin() inside its own body rather than
-- trusting route-level gating, matching grant_admin/revoke_admin's own
-- precedent exactly. This is also the write surface the Phase 5 QA/admin
-- entitlement simulator (handoff §6) will sit on top of -- admin_get_entitlements
-- especially, which is the read side of "view as another account."

create function public.admin_set_plan(
  p_subject_type text,
  p_user_id uuid,
  p_organization_id uuid,
  p_bundle_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_subject_type not in ('user', 'organization') then
    raise exception 'invalid subject_type';
  end if;

  if p_subject_type = 'user' then
    insert into public.entitlement_plan_state (subject_type, user_id, plan_bundle_key, updated_at)
    values ('user', p_user_id, p_bundle_key, now())
    on conflict (user_id) where subject_type = 'user'
    do update set plan_bundle_key = excluded.plan_bundle_key, updated_at = now();
  else
    insert into public.entitlement_plan_state (subject_type, organization_id, plan_bundle_key, updated_at)
    values ('organization', p_organization_id, p_bundle_key, now())
    on conflict (organization_id) where subject_type = 'organization'
    do update set plan_bundle_key = excluded.plan_bundle_key, updated_at = now();
  end if;
end;
$$;

revoke all on function public.admin_set_plan(text, uuid, uuid, text) from public;
grant execute on function public.admin_set_plan(text, uuid, uuid, text) to authenticated;

-- p_cohort_bundle_key = null removes the subject's cohort assignment
-- entirely (falls back to their plan bundle) rather than requiring a
-- separate admin_clear_cohort call.
create function public.admin_assign_cohort(
  p_subject_type text,
  p_user_id uuid,
  p_organization_id uuid,
  p_cohort_bundle_key text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_subject_type not in ('user', 'organization') then
    raise exception 'invalid subject_type';
  end if;

  if p_cohort_bundle_key is null then
    delete from public.entitlement_cohort_assignments
    where subject_type = p_subject_type
      and ((p_subject_type = 'user' and user_id = p_user_id)
        or (p_subject_type = 'organization' and organization_id = p_organization_id));
    return;
  end if;

  if p_subject_type = 'user' then
    insert into public.entitlement_cohort_assignments
      (subject_type, user_id, cohort_bundle_key, assigned_reason, assigned_by)
    values ('user', p_user_id, p_cohort_bundle_key, p_reason, auth.uid())
    on conflict (user_id) where subject_type = 'user'
    do update set cohort_bundle_key = excluded.cohort_bundle_key,
      assigned_reason = excluded.assigned_reason, assigned_by = excluded.assigned_by, assigned_at = now();
  else
    insert into public.entitlement_cohort_assignments
      (subject_type, organization_id, cohort_bundle_key, assigned_reason, assigned_by)
    values ('organization', p_organization_id, p_cohort_bundle_key, p_reason, auth.uid())
    on conflict (organization_id) where subject_type = 'organization'
    do update set cohort_bundle_key = excluded.cohort_bundle_key,
      assigned_reason = excluded.assigned_reason, assigned_by = excluded.assigned_by, assigned_at = now();
  end if;
end;
$$;

revoke all on function public.admin_assign_cohort(text, uuid, uuid, text, text) from public;
grant execute on function public.admin_assign_cohort(text, uuid, uuid, text, text) to authenticated;

create function public.admin_grant_override(
  p_subject_type text,
  p_user_id uuid,
  p_organization_id uuid,
  p_feature_key text,
  p_state text,
  p_limit_value integer default null,
  p_reason text default null,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_subject_type not in ('user', 'organization') then
    raise exception 'invalid subject_type';
  end if;

  if p_subject_type = 'user' then
    insert into public.entitlement_overrides
      (subject_type, user_id, feature_key, state, limit_value, granted_by, reason, expires_at)
    values ('user', p_user_id, p_feature_key, p_state, p_limit_value, auth.uid(), p_reason, p_expires_at)
    on conflict (user_id, feature_key) where subject_type = 'user'
    do update set state = excluded.state, limit_value = excluded.limit_value,
      granted_by = excluded.granted_by, reason = excluded.reason, expires_at = excluded.expires_at;
  else
    insert into public.entitlement_overrides
      (subject_type, organization_id, feature_key, state, limit_value, granted_by, reason, expires_at)
    values ('organization', p_organization_id, p_feature_key, p_state, p_limit_value, auth.uid(), p_reason, p_expires_at)
    on conflict (organization_id, feature_key) where subject_type = 'organization'
    do update set state = excluded.state, limit_value = excluded.limit_value,
      granted_by = excluded.granted_by, reason = excluded.reason, expires_at = excluded.expires_at;
  end if;
end;
$$;

revoke all on function public.admin_grant_override(text, uuid, uuid, text, text, integer, text, timestamptz) from public;
grant execute on function public.admin_grant_override(text, uuid, uuid, text, text, integer, text, timestamptz) to authenticated;

create function public.admin_revoke_override(
  p_subject_type text,
  p_user_id uuid,
  p_organization_id uuid,
  p_feature_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  delete from public.entitlement_overrides
  where feature_key = p_feature_key
    and subject_type = p_subject_type
    and ((p_subject_type = 'user' and user_id = p_user_id)
      or (p_subject_type = 'organization' and organization_id = p_organization_id));
end;
$$;

revoke all on function public.admin_revoke_override(text, uuid, uuid, text) from public;
grant execute on function public.admin_revoke_override(text, uuid, uuid, text) to authenticated;

-- The read side of "view this account's entitlements as an admin" -- same
-- resolved-map shape get_my_entitlements() returns, for an arbitrary
-- subject. This is the query the Phase 5 QA simulator screen will call;
-- building it now means that screen is only ever a UI on top of an
-- already-tested function, not new resolution logic.
create function public.admin_get_entitlements(
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
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_subject_type not in ('user', 'organization') then
    raise exception 'invalid subject_type';
  end if;

  select coalesce(jsonb_object_agg(
    f.feature_key,
    public.resolve_entitlement(p_subject_type, p_user_id, p_organization_id, f.feature_key)
  ), '{}'::jsonb)
  into v_result
  from public.features f;
  return v_result;
end;
$$;

revoke all on function public.admin_get_entitlements(text, uuid, uuid) from public;
grant execute on function public.admin_get_entitlements(text, uuid, uuid) to authenticated;
