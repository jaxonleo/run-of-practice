-- Equipment team-availability: explicit per-owner opt-in, the same shape
-- locations.available_to_team_planners got in the fifty-sixth session
-- (20260822000000_delegated_planning_schema.sql +
-- 20260822000200_goals_access_and_location_availability_rls.sql).
--
-- Why: a real production bug (AZBC 10U, assistant coach Chris Prieto).
-- assets_select_access has been widened twice -- 20260801090000
-- (peer-shared drill's equipment) and 20260813160000 (equipment used in a
-- practice/station on a team I coach) -- so an assistant can now SEE the
-- head coach's personal equipment in shared contexts. But
-- can_link_asset_to_activity was never widened to match, so selecting that
-- equipment on a drill in the assistant's OWN library failed the
-- activity_library_equipment insert with an RLS error (42501). The
-- library-side fix is client-only (the drill equipment picker stops
-- offering equipment the coach doesn't own; a separate "add team equipment
-- to my library" flow copies it into their own pool first -- see the
-- session notes). This migration is the practice/station side: today
-- can_link_asset_to_practice_activity / can_link_asset_to_station link ANY
-- non-archived team_staff member's asset into that team's practices
-- automatically -- the exact automatic rule, and the exact privacy
-- concern, that the fifty-sixth session replaced for locations
-- ("a coach may have sensitive locations, including home addresses";
-- equipment is milder but the "same shape as locations" consistency and
-- the "leaving a team should revoke access" behavior both want the opt-in).

-- 1. The flag. Only ever meaningful for coach-owned (owner_user_id) assets
-- -- an org- or team-owned asset is already team-wide visible/usable via
-- can_access_asset_owned -- but left unconstrained at the column level,
-- exactly as locations.available_to_team_planners was, since those rows
-- simply never have it checked.
alter table public.assets
  add column available_to_team_planners boolean not null default false;

-- 2. Backfill: preserve every currently-working delegate/equipment pairing
-- so tightening the RLS rule below doesn't retroactively break a delegate
-- mid-plan. Any coach-owned asset already linked to a non-archived
-- practice_activity or station (i.e. usable under today's automatic rule)
-- is opted in going forward; anything unused stays opt-in only. Mirrors
-- 20260822000100_delegated_planning_backfill.sql's location backfill.
update public.assets a
set available_to_team_planners = true
where a.owner_user_id is not null
  and a.available_to_team_planners = false
  and (
    exists (
      select 1
      from public.practice_activity_equipment pae
      join public.practice_activities pa on pa.id = pae.practice_activity_id
      join public.practices p on p.id = pa.practice_id
      where pae.asset_id = a.id
        and pa.archived_at is null
        and p.archived_at is null
    )
    or exists (
      select 1
      from public.station_equipment se
      join public.stations stn on stn.id = se.station_id
      join public.station_blocks sb on sb.id = stn.station_block_id
      join public.practice_activities pa on pa.id = sb.practice_activity_id
      join public.practices p on p.id = pa.practice_id
      where se.asset_id = a.id
        and stn.archived_at is null
        and pa.archived_at is null
        and p.archived_at is null
    )
  );

-- 3. Owner-only self-service toggle, byte-for-byte the shape of
-- set_location_team_availability (20260822000200).
create or replace function public.set_asset_team_availability(p_asset_id uuid, p_available boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.assets
  set available_to_team_planners = p_available
  where id = p_asset_id and owner_user_id = auth.uid();

  if not found then
    raise exception 'not authorized';
  end if;
end;
$$;

grant execute on function public.set_asset_team_availability(uuid, boolean) to authenticated;

-- 4. Picker/eligibility helper: "can this coach put this asset in a NEW
-- practice for this team". Not wired into any RLS policy (equipment has no
-- single column on practices the way location_id does -- the authoritative
-- gate stays can_link_asset_to_*); this exists so the client picker and
-- the "browse & add team equipment" flow can offer exactly what the gate
-- below will accept, and no more. The own/team/org branches mirror
-- can_link_asset_to_practice_activity; the opt-in branch additionally
-- requires the caller to actually be a planner for the team
-- (can_manage_team or can_build_practice_for_team) -- the same guard
-- can_use_location_for_team puts on its equivalent branch, and needed here
-- because this helper has no upstream practice-management check the way the
-- link gates do.
create or replace function public.can_use_asset_for_team(p_asset_id uuid, p_team_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((
    select
      ast.owner_user_id = auth.uid()
      or ast.team_id = p_team_id
      or (tm.organization_id is not null and ast.organization_id = tm.organization_id)
      or (
        ast.available_to_team_planners
        and (public.can_manage_team(p_team_id) or public.can_build_practice_for_team(p_team_id))
        and exists (
          select 1 from public.team_staff ts
          where ts.team_id = p_team_id
            and ts.user_id = ast.owner_user_id
            and ts.archived_at is null
        )
      )
    from public.assets ast
    join public.teams tm on tm.id = p_team_id
    where ast.id = p_asset_id
  ), false);
$$;

grant execute on function public.can_use_asset_for_team(uuid, uuid) to authenticated;

-- 5. Tighten the two link gates. Only the team_staff branch changes: it now
-- also requires ast.available_to_team_planners. The other three branches
-- (team-owned, caller-owned, same-org) are byte-identical to the live
-- definitions (confirmed via pg_get_functiondef before writing this, per
-- this project's drift-checking convention). A delegate's own equipment
-- still links freely (owner_user_id = auth.uid()), which is the path
-- Builder's resolve-into-own-pool flow already uses.
create or replace function public.can_link_asset_to_practice_activity(p_practice_activity_id uuid, p_asset_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    ast.team_id = tm.id
    or ast.owner_user_id = auth.uid()
    or (tm.organization_id is not null and ast.organization_id = tm.organization_id)
    or (
      ast.available_to_team_planners
      and exists (
        select 1 from public.team_staff ts
        where ts.team_id = tm.id
          and ts.user_id = ast.owner_user_id
          and ts.archived_at is null
      )
    )
  from public.practice_activities pa
  join public.practices p on p.id = pa.practice_id
  join public.teams tm on tm.id = p.team_id
  join public.assets ast on ast.id = p_asset_id
  where pa.id = p_practice_activity_id;
$$;

create or replace function public.can_link_asset_to_station(p_station_id uuid, p_asset_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    ast.team_id = tm.id
    or ast.owner_user_id = auth.uid()
    or (tm.organization_id is not null and ast.organization_id = tm.organization_id)
    or (
      ast.available_to_team_planners
      and exists (
        select 1 from public.team_staff ts
        where ts.team_id = tm.id
          and ts.user_id = ast.owner_user_id
          and ts.archived_at is null
      )
    )
  from public.stations s
  join public.station_blocks sb on sb.id = s.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  join public.teams tm on tm.id = p.team_id
  join public.assets ast on ast.id = p_asset_id
  where s.id = p_station_id;
$$;
