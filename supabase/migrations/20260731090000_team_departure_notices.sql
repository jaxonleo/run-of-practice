-- Direct feedback: leave_team was deliberately "silent to the head coach
-- beyond the roster reflecting it" (see 20260710040000's own comment) --
-- now asked to mirror the existing "you were added to X" welcome card
-- (team_staff.welcomed_at) in the other direction, so a head coach finds
-- out an assistant/helper left instead of just noticing a shorter roster.
-- A separate table, not another team_staff column: the departing row gets
-- archived and excluded from every existing team_staff fetch (`archived_at
-- is null`), so there'd be nowhere for the head coach's own client to see
-- it -- the roster shrinking is the whole problem being fixed here.
create table public.team_departures (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  departed_user_id uuid references public.profiles(id) on delete set null,
  departed_name text not null,
  role text not null,
  left_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

comment on table public.team_departures is
  'One row per assistant coach/helper who self-left a team via leave_team, surfaced as a Home notification to whoever can_manage_team. Not populated by archiveStaff (a head-coach-initiated removal the head coach already knows about firsthand) -- only self-initiated departures.';

alter table public.team_departures enable row level security;

-- Visible to whoever could manage this team (head coach or org admin) --
-- same authority leave_team itself already defers to via can_manage_team.
create policy "team_departures_select" on public.team_departures
  for select to authenticated using (public.can_manage_team(team_id));

grant select on public.team_departures to authenticated;

-- No direct write policy -- leave_team (insert) and
-- acknowledge_team_departure (update) below are the only ways to touch
-- this table, same narrow-RPC pattern as the rest of this schema.

create or replace function public.leave_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff record;
begin
  if exists (select 1 from public.teams where id = p_team_id and owner_user_id = auth.uid()) then
    raise exception 'team owners cannot leave their own team';
  end if;

  select * into v_staff from public.team_staff
  where team_id = p_team_id and user_id = auth.uid() and archived_at is null;

  if v_staff is null then
    return;
  end if;

  update public.team_staff
  set archived_at = now()
  where id = v_staff.id;

  insert into public.team_departures (team_id, departed_user_id, departed_name, role)
  values (p_team_id, auth.uid(), trim(v_staff.first_name || ' ' || coalesce(v_staff.last_name, '')), v_staff.role);
end;
$$;

grant execute on function public.leave_team(uuid) to authenticated;

create function public.acknowledge_team_departure(p_departure_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from public.team_departures where id = p_departure_id;
  if v_team_id is null then
    raise exception 'departure notice not found';
  end if;
  if not public.can_manage_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  update public.team_departures set acknowledged_at = now() where id = p_departure_id;
end;
$$;

grant execute on function public.acknowledge_team_departure(uuid) to authenticated;
