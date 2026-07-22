-- Org details screen (Jax's ask): edit org name/sport/color, manage members
-- with a real role selector, remove a member. Widens org_staff.role from
-- director-only to director/admin -- same permissions as director for now
-- (no billing/permission-tier system exists yet to define a real
-- boundary), purely a distinguishing title, per Jax's explicit confirmation.
-- is_org_admin is renamed in spirit only (not in name, to avoid touching
-- every call site) to mean "org_staff member with manage rights" -- both
-- roles qualify identically.
alter table public.org_staff drop constraint org_staff_role_check;
alter table public.org_staff add constraint org_staff_role_check
  check (role in ('director', 'admin'));

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_staff os
    where os.organization_id = p_org_id
      and os.user_id = auth.uid()
      and os.role in ('director', 'admin')
      and os.archived_at is null
  );
$$;

-- Org branding (Jax's ask: "so when they're logged in to their org it looks
-- like their org") -- a color, not an uploaded image (that's the separate,
-- bigger "branded dashboard" conversation, deliberately deferred). Reuses
-- the same hex-string convention teams.color_primary already uses, no new
-- palette needed.
alter table public.organizations add column color text;

-- org_invites needs its own role column -- previously accept_org_invite
-- hardcoded 'director', which was fine when that was the only role, but
-- now the inviter needs to choose which role the invite grants.
alter table public.org_invites add column role text not null default 'director'
  check (role in ('director', 'admin'));

create or replace function public.org_invite_coach(
  p_organization_id uuid,
  p_email text,
  p_team_id uuid default null,
  p_team_role text default null,
  p_org_role text default 'director'
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
  if p_team_id is not null then
    if p_team_role is null then
      raise exception 'team_role is required when pre-assigning a team';
    end if;
    if not exists (
      select 1 from public.teams where id = p_team_id and organization_id = p_organization_id
    ) then
      raise exception 'team does not belong to this organization';
    end if;
  end if;

  insert into public.org_invites (organization_id, email, team_id, team_role, role, invited_by)
  values (p_organization_id, lower(p_email), p_team_id, p_team_role, p_org_role, auth.uid())
  on conflict (organization_id, lower(email)) where status = 'pending'
  do update set team_id = excluded.team_id, team_role = excluded.team_role,
    role = excluded.role, invited_by = excluded.invited_by, created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.org_invite_coach(uuid, text, uuid, text, text) to authenticated;

-- accept_org_invite now grants whatever role the invite specifies instead
-- of hardcoding 'director'.
create or replace function public.accept_org_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_first_name text;
  v_last_name text;
  v_revive_id uuid;
begin
  select * into v_invite from public.org_invites where id = p_invite_id;
  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite is no longer pending';
  end if;
  if lower(v_invite.email) <> lower(auth.jwt() ->> 'email') then
    raise exception 'not authorized';
  end if;

  update public.org_invites
  set status = 'accepted', responded_at = now()
  where id = p_invite_id;

  insert into public.org_staff (organization_id, user_id, role, invited_by)
  values (v_invite.organization_id, auth.uid(), v_invite.role, v_invite.invited_by)
  on conflict (organization_id, user_id) where archived_at is null do nothing;

  if v_invite.team_id is not null then
    select first_name, last_name into v_first_name, v_last_name
    from public.profiles where id = auth.uid();

    select id into v_revive_id from public.team_staff
    where team_id = v_invite.team_id and user_id = auth.uid() and archived_at is not null
    limit 1;

    if v_revive_id is not null then
      update public.team_staff
      set role = v_invite.team_role, archived_at = null, added_by = v_invite.invited_by,
          first_name = v_first_name, last_name = coalesce(v_last_name, '')
      where id = v_revive_id;
    else
      insert into public.team_staff (team_id, user_id, first_name, last_name, role, added_by)
      values (v_invite.team_id, auth.uid(), v_first_name, coalesce(v_last_name, ''), v_invite.team_role, v_invite.invited_by);
    end if;
  end if;
end;
$$;

-- Change an existing member's role. No "can't demote the last one" guard --
-- both roles carry identical permissions today, so relabeling someone
-- never actually reduces the org's protection the way removing a member
-- would.
create function public.set_org_member_role(p_org_staff_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id from public.org_staff where id = p_org_staff_id;
  if v_org_id is null then
    raise exception 'member not found';
  end if;
  if not public.is_org_admin(v_org_id) then
    raise exception 'not authorized';
  end if;

  update public.org_staff set role = p_role where id = p_org_staff_id;
end;
$$;

grant execute on function public.set_org_member_role(uuid, text) to authenticated;

-- Remove a member. Refuses to remove the last active member -- an org with
-- zero members is unreachable (nothing left with is_org_admin rights to
-- fix it), same class of guard as revoke_admin's "cannot remove the last
-- remaining admin".
create function public.remove_org_member(p_org_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id from public.org_staff where id = p_org_staff_id and archived_at is null;
  if v_org_id is null then
    raise exception 'member not found';
  end if;
  if not public.is_org_admin(v_org_id) then
    raise exception 'not authorized';
  end if;
  if (select count(*) from public.org_staff where organization_id = v_org_id and archived_at is null) <= 1 then
    raise exception 'cannot remove the last remaining org member';
  end if;

  update public.org_staff set archived_at = now() where id = p_org_staff_id;
end;
$$;

grant execute on function public.remove_org_member(uuid) to authenticated;
