-- Free / Pro / Organization packaging, Phase B part 1 of 4: shared
-- enforcement helpers, the team-scoped entitlement read RPC, and the
-- active-personal-team model used by the inactive-team refusals.
--
-- Error convention (handoff "Cap enforcement points"): a refusal raises the
-- exception message ENTITLEMENT_LIMIT:<feature_key> (count caps) or
-- ENTITLEMENT_LOCKED:<feature_key> (boolean features), with
-- {"limit": n, "current_count": n} JSON in DETAIL. The client maps the code
-- to an upsellCatalog.js ID and never parses free text.

-- 1. Raising helpers.
create function public.raise_entitlement_limit(p_feature_key text, p_limit integer, p_current_count integer)
returns void
language plpgsql
set search_path = public
as $$
begin
  raise exception using
    message = 'ENTITLEMENT_LIMIT:' || p_feature_key,
    detail = json_build_object('limit', p_limit, 'current_count', p_current_count)::text;
end;
$$;

create function public.raise_entitlement_locked(p_feature_key text)
returns void
language plpgsql
set search_path = public
as $$
begin
  raise exception using message = 'ENTITLEMENT_LOCKED:' || p_feature_key;
end;
$$;

-- Granted to authenticated: they only ever raise, and SECURITY INVOKER
-- callers (create_practice_series) need to reach them.
revoke all on function public.raise_entitlement_limit(text, integer, integer) from public;
revoke all on function public.raise_entitlement_locked(text) from public;
grant execute on function public.raise_entitlement_limit(text, integer, integer) to authenticated;
grant execute on function public.raise_entitlement_locked(text) to authenticated;

-- 2. Team-scoped resolution. Features resolve from the team's owning
-- subject (the org for an org team, the owner for a personal team), never
-- the viewer.
create function public.team_resolve_entitlement(p_team_id uuid, p_feature_key text)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select public.resolve_entitlement(s.subject_type, s.user_id, s.organization_id, p_feature_key)
  from public.team_entitlement_subject(p_team_id) s;
$$;

revoke all on function public.team_resolve_entitlement(uuid, text) from public;

-- 'full' only. A preview state means "show a preview", never "let the
-- server do the Pro thing" (e.g. goals.trends is preview on Free and the
-- trends RPC still refuses).
create function public.team_feature_is_full(p_team_id uuid, p_feature_key text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.team_resolve_entitlement(p_team_id, p_feature_key) ->> 'state' = 'full', false);
$$;

revoke all on function public.team_feature_is_full(uuid, text) from public;
grant execute on function public.team_feature_is_full(uuid, text) to authenticated;

-- Count-cap enforcement: raises ENTITLEMENT_LIMIT unless one more is
-- allowed. A grace percentage (org.teams) widens the limit, rounded up.
create function public.enforce_counted_feature(
  p_feature_key text,
  p_current_count integer,
  p_subject_type text,
  p_user_id uuid,
  p_organization_id uuid,
  p_grace_percent integer default 0
)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_resolved jsonb;
  v_limit integer;
begin
  v_resolved := public.resolve_entitlement(p_subject_type, p_user_id, p_organization_id, p_feature_key);
  if v_resolved ->> 'state' in ('locked', 'hidden') then
    perform public.raise_entitlement_limit(p_feature_key, 0, p_current_count);
  end if;
  if v_resolved ->> 'limit_value' is null then
    return;
  end if;
  v_limit := (v_resolved ->> 'limit_value')::integer;
  if p_current_count >= ceil(v_limit * (100 + p_grace_percent) / 100.0)::integer then
    perform public.raise_entitlement_limit(p_feature_key, v_limit, p_current_count);
  end if;
end;
$$;

revoke all on function public.enforce_counted_feature(text, integer, text, uuid, uuid, integer) from public;

create function public.enforce_team_feature_full(p_team_id uuid, p_feature_key text)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.team_feature_is_full(p_team_id, p_feature_key) then
    perform public.raise_entitlement_locked(p_feature_key);
  end if;
end;
$$;

revoke all on function public.enforce_team_feature_full(uuid, text) from public;

-- 3. get_team_entitlements: the resolved feature map for a team's owning
-- subject, so an assistant on a Pro coach's team sees Pro on that team.
create function public.get_team_entitlements(p_team_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.can_access_team(p_team_id) then
    raise exception 'not authorized';
  end if;
  select coalesce(jsonb_object_agg(f.feature_key, public.team_resolve_entitlement(p_team_id, f.feature_key)), '{}'::jsonb)
  into v_result
  from public.features f;
  return v_result;
end;
$$;

revoke all on function public.get_team_entitlements(uuid) from public;
grant execute on function public.get_team_entitlements(uuid) to authenticated;

-- 4. Active personal team (downgrade model). Stored on the user's plan
-- state row; written only through set_active_personal_team.
alter table public.entitlement_plan_state
  add column active_personal_team_id uuid references public.teams(id) on delete set null,
  add column active_team_changed_at timestamptz;

comment on column public.entitlement_plan_state.active_personal_team_id is
  'The personal team a capped coach chose to keep active (downgrade chooser). Ranked first by team_is_plan_active. Written only via set_active_personal_team.';

-- Which of a coach's personal teams their plan covers. Org teams and
-- uncapped owners are always active. Otherwise the owner's non-archived
-- personal teams are ranked (chosen team first, then the team with the
-- soonest scheduled practice, then oldest) and the first <limit> are
-- active. The ranking fallback only matters before the coach has chosen.
create function public.team_is_plan_active(p_team_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_team record;
  v_resolved jsonb;
  v_limit integer;
  v_chosen uuid;
begin
  select organization_id, owner_user_id into v_team from public.teams where id = p_team_id;
  if not found or v_team.organization_id is not null or v_team.owner_user_id is null then
    return true;
  end if;

  v_resolved := public.resolve_entitlement('user', v_team.owner_user_id, null, 'teams.personal_count');
  if v_resolved ->> 'state' in ('full', 'preview') and v_resolved ->> 'limit_value' is null then
    return true;
  end if;
  v_limit := case when v_resolved ->> 'state' in ('full', 'preview') then (v_resolved ->> 'limit_value')::integer else 0 end;

  select ps.active_personal_team_id into v_chosen
  from public.entitlement_plan_state ps
  where ps.subject_type = 'user' and ps.user_id = v_team.owner_user_id;

  return exists (
    select 1 from (
      select tm.id
      from public.teams tm
      where tm.owner_user_id = v_team.owner_user_id
        and tm.organization_id is null
        and tm.archived_at is null
      order by
        (tm.id = v_chosen) desc nulls last,
        (select min(p.scheduled_at) from public.practices p
          where p.team_id = tm.id and p.archived_at is null
            and p.status = 'scheduled' and p.scheduled_at > now()) asc nulls last,
        tm.created_at asc
      limit v_limit
    ) active
    where active.id = p_team_id
  );
end;
$$;

revoke all on function public.team_is_plan_active(uuid) from public;
grant execute on function public.team_is_plan_active(uuid) to authenticated;

-- Pick the active personal team. A capped coach can switch once every 30
-- days (the first choice is always allowed); an uncapped coach any time.
create function public.set_active_personal_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current uuid;
  v_changed_at timestamptz;
  v_resolved jsonb;
begin
  if not exists (
    select 1 from public.teams
    where id = p_team_id and owner_user_id = auth.uid()
      and organization_id is null and archived_at is null
  ) then
    raise exception 'not authorized';
  end if;

  select active_personal_team_id, active_team_changed_at into v_current, v_changed_at
  from public.entitlement_plan_state
  where subject_type = 'user' and user_id = auth.uid();

  if v_current is not distinct from p_team_id then
    return;
  end if;

  v_resolved := public.resolve_entitlement('user', auth.uid(), null, 'teams.personal_count');
  if v_resolved ->> 'limit_value' is not null
     and v_current is not null
     and v_changed_at is not null
     and v_changed_at > now() - interval '30 days' then
    perform public.raise_entitlement_limit('teams.personal_count', (v_resolved ->> 'limit_value')::integer, null);
  end if;

  update public.entitlement_plan_state
    set active_personal_team_id = p_team_id, active_team_changed_at = now(), updated_at = now()
    where subject_type = 'user' and user_id = auth.uid();
end;
$$;

revoke all on function public.set_active_personal_team(uuid) from public;
grant execute on function public.set_active_personal_team(uuid) to authenticated;
