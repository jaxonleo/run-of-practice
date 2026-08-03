-- Direct feedback: the head coach currently finds out an invite was
-- accepted only by noticing the roster grew -- same gap this schema
-- already closed once in the other direction (team_departures, "you
-- weren't told when someone left"). Mirrors that table's exact shape and
-- RLS, populated inside accept_team_invite (not a separate RPC the client
-- has to remember to call) since accepting an invite and creating the
-- team_staff row already happen together in one transaction there.
create table public.team_join_notices (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  joined_user_id uuid references public.profiles(id) on delete set null,
  joined_name text not null,
  role text not null,
  joined_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

comment on table public.team_join_notices is
  'One row per accepted team_invites row, surfaced as a Home notification to whoever can_manage_team, directing them to set up Permissions (sharing/delegation) for the new coach.';

alter table public.team_join_notices enable row level security;

create policy "team_join_notices_select" on public.team_join_notices
  for select to authenticated using (public.can_manage_team(team_id));

grant select on public.team_join_notices to authenticated;

-- No direct write policy -- accept_team_invite (insert) and
-- acknowledge_team_join_notice (update) below are the only ways to touch
-- this table, same narrow-RPC pattern team_departures already established.
create or replace function public.accept_team_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_revive_id uuid;
begin
  select * into v_invite from public.team_invites where id = p_invite_id;
  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite is no longer pending';
  end if;
  if lower(v_invite.email) <> lower(auth.jwt() ->> 'email') then
    raise exception 'not authorized';
  end if;

  update public.team_invites
  set status = 'accepted', responded_at = now()
  where id = p_invite_id;

  select id into v_revive_id from public.team_staff
  where team_id = v_invite.team_id and user_id = auth.uid() and archived_at is not null
  limit 1;

  if v_revive_id is not null then
    update public.team_staff
    set role = v_invite.role, archived_at = null, added_by = v_invite.invited_by,
        first_name = v_invite.first_name, last_name = coalesce(v_invite.last_name, '')
    where id = v_revive_id;
  else
    insert into public.team_staff (team_id, user_id, first_name, last_name, role, added_by)
    values (v_invite.team_id, auth.uid(), v_invite.first_name, coalesce(v_invite.last_name, ''), v_invite.role, v_invite.invited_by);
  end if;

  insert into public.team_join_notices (team_id, joined_user_id, joined_name, role)
  values (v_invite.team_id, auth.uid(), trim(v_invite.first_name || ' ' || coalesce(v_invite.last_name, '')), v_invite.role);
end;
$$;

grant execute on function public.accept_team_invite(uuid) to authenticated;

create function public.acknowledge_team_join_notice(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from public.team_join_notices where id = p_notice_id;
  if v_team_id is null then
    raise exception 'notice not found';
  end if;
  if not public.can_manage_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  update public.team_join_notices set acknowledged_at = now() where id = p_notice_id;
end;
$$;

grant execute on function public.acknowledge_team_join_notice(uuid) to authenticated;
