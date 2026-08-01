-- "Share Practice Planning": lets a head coach delegate building/editing a
-- team's scheduled practices to one assistant/helper (can_build_practices,
-- capped at one per team by team_staff_one_delegate_per_team). Deliberately
-- touches only the practice-tree-specific functions/policies below, never
-- can_manage_team itself -- that also gates team settings, roster
-- management, and staff administration, none of which this delegation
-- should grant.
--
-- Every one of these already independently re-derives access from
-- can_manage_team(team_id) via its own join up to practices/teams (found by
-- grepping for that exact shape) -- a shared helper keeps the new OR clause
-- consistent across all of them instead of six slightly-different copies.
create function public.can_build_practice_for_team(p_team_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.team_staff ts
    where ts.team_id = p_team_id
      and ts.user_id = auth.uid()
      and ts.can_build_practices
      and ts.archived_at is null
  );
$$;

create or replace function public.can_manage_practice(p_practice_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_team(p.team_id) or public.can_build_practice_for_team(p.team_id)
  from public.practices p where p.id = p_practice_id;
$$;

create or replace function public.can_manage_practice_activity(p_practice_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_team(p.team_id) or public.can_build_practice_for_team(p.team_id)
  from public.practice_activities pa
  join public.practices p on p.id = pa.practice_id
  where pa.id = p_practice_activity_id;
$$;

create or replace function public.can_manage_station_block(p_station_block_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_team(p.team_id) or public.can_build_practice_for_team(p.team_id)
  from public.station_blocks sb
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  where sb.id = p_station_block_id;
$$;

create or replace function public.can_manage_station(p_station_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_team(p.team_id) or public.can_build_practice_for_team(p.team_id)
  from public.stations s
  join public.station_blocks sb on sb.id = s.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  where s.id = p_station_id;
$$;

-- practices itself is gated directly on can_manage_team(team_id) in its own
-- policy (not routed through can_manage_practice, which only exists for
-- already-created rows -- insert has no practice_id yet to check it
-- against), so the same OR clause needs adding here too.
drop policy if exists "practices_insert_manage" on public.practices;
create policy "practices_insert_manage" on public.practices
  for insert with check (
    (public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id))
    and (location_id is null or public.can_access_location(location_id))
  );

drop policy if exists "practices_update_manage" on public.practices;
create policy "practices_update_manage" on public.practices
  for update using (public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id))
  with check (
    (public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id))
    and (location_id is null or public.can_access_location(location_id))
  );
