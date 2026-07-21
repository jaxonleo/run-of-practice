-- Org Experience handoff, part 2: org-scoped team creation & staffing.
-- Unaffiliated teams (organization_id is null) are untouched -- they keep
-- using the existing direct insert (teams_insert_own_or_org's personal
-- branch) and add_team_staff/players_insert_manage exactly as before. These
-- three RPCs are the org-scoped counterparts: each is an explicit, single
-- purpose entry point gated on org_staff membership, per handoff Sec 2 and
-- design principle 0 (no ad hoc client writes for org-authorized actions).
--
-- Note: can_manage_team/players_insert_manage already allow a director to
-- write directly today (is_org_admin is one of can_manage_team's branches),
-- so these RPCs don't change what's *possible* under RLS -- they give
-- org-scoped writes one clear, auditable code path instead of leaving the
-- client to reconstruct the same authorization logic ad hoc. The underlying
-- RLS policies are intentionally left as-is (not narrowed to block direct
-- writes), since narrowing them further wasn't asked for and isn't a
-- security fix -- flagging that distinction rather than silently expanding
-- scope.

create function public.org_create_team(
  p_organization_id uuid,
  p_name text,
  p_sport text,
  p_season_label text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_timezone text default null,
  p_color_primary text default null,
  p_color_secondary text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'not authorized';
  end if;

  insert into public.teams (
    organization_id, name, sport, season_label, start_date, end_date,
    timezone, color_primary, color_secondary
  )
  values (
    p_organization_id, p_name, p_sport, p_season_label, p_start_date, p_end_date,
    p_timezone, p_color_primary, p_color_secondary
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.org_create_team(
  uuid, text, text, text, date, date, text, text, text
) to authenticated;

-- Assign an existing org member (already has an org_staff row) onto a
-- specific team's staff. Deliberately distinct from add_team_staff: that
-- RPC is the email-invite path for someone who may not have an account yet
-- and works for personal teams too; this one only ever moves someone who is
-- *already* in the org onto one of that org's teams -- no email lookup, no
-- pending-invite state, since org membership already establishes the
-- account link.
create function public.org_assign_team_staff(
  p_team_id uuid,
  p_user_id uuid,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_first_name text;
  v_last_name text;
  v_revive_id uuid;
  v_id uuid;
begin
  select organization_id into v_org_id from public.teams where id = p_team_id;
  if v_org_id is null then
    raise exception 'team is not org-scoped; use add_team_staff for unaffiliated teams';
  end if;
  if not public.is_org_admin(v_org_id) then
    raise exception 'not authorized';
  end if;
  if not exists (
    select 1 from public.org_staff
    where organization_id = v_org_id and user_id = p_user_id and archived_at is null
  ) then
    raise exception 'user is not a member of this organization';
  end if;

  select first_name, last_name into v_first_name, v_last_name
  from public.profiles where id = p_user_id;

  select id into v_revive_id from public.team_staff
  where team_id = p_team_id and user_id = p_user_id and archived_at is not null
  limit 1;

  if v_revive_id is not null then
    update public.team_staff
    set role = p_role, archived_at = null, added_by = auth.uid(),
        first_name = v_first_name, last_name = coalesce(v_last_name, '')
    where id = v_revive_id
    returning id into v_id;
  else
    insert into public.team_staff (team_id, user_id, first_name, last_name, role, added_by)
    values (p_team_id, p_user_id, v_first_name, coalesce(v_last_name, ''), p_role, auth.uid())
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.org_assign_team_staff(uuid, uuid, text) to authenticated;

-- Org-scoped player-roster add. can_manage_team already permits this
-- directly for org-admins (and any head_coach already on the team's
-- staff) via players_insert_manage, so this RPC is the same explicit-entry-
-- point convention as org_create_team, not a widened permission.
create function public.org_assign_player(
  p_team_id uuid,
  p_first_name text,
  p_last_name text,
  p_jersey_number text default null,
  p_positions text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_id uuid;
begin
  select organization_id into v_org_id from public.teams where id = p_team_id;
  if v_org_id is null then
    raise exception 'team is not org-scoped; use the direct players insert for unaffiliated teams';
  end if;
  if not public.can_manage_team(p_team_id) then
    raise exception 'not authorized';
  end if;

  insert into public.players (team_id, first_name, last_name, jersey_number, positions)
  values (p_team_id, p_first_name, p_last_name, p_jersey_number, coalesce(p_positions, '{}'))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.org_assign_player(uuid, text, text, text, text[]) to authenticated;
