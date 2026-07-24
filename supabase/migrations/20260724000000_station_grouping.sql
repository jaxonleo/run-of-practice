-- Equipment previously had no notion of where it lives -- a coach running
-- practices across a batting cage and a field couldn't tell which gear was
-- actually at the location they picked. No rows for an asset means it
-- travels with the coach (e.g. a ball bucket) and shows up everywhere;
-- one or more rows scopes it to just those locations.
create table public.asset_locations (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (asset_id, location_id)
);
create index asset_locations_asset_id_idx on public.asset_locations (asset_id);
create index asset_locations_location_id_idx on public.asset_locations (location_id);
alter table public.asset_locations enable row level security;
-- Reuses the same asset-ownership checks the assets table itself already
-- relies on (can_access_asset_owned/can_manage_asset_owned, added in
-- 20260704003000 for the org/personal/team-shared three-way split) rather
-- than re-deriving the rule here.
create policy asset_locations_select on public.asset_locations for select to authenticated
  using (exists (
    select 1 from public.assets a where a.id = asset_id
      and public.can_access_asset_owned(a.organization_id, a.owner_user_id, a.team_id)
  ));
create policy asset_locations_manage on public.asset_locations for all to authenticated
  using (exists (
    select 1 from public.assets a where a.id = asset_id
      and public.can_manage_asset_owned(a.organization_id, a.owner_user_id, a.team_id)
  ))
  with check (exists (
    select 1 from public.assets a where a.id = asset_id
      and public.can_manage_asset_owned(a.organization_id, a.owner_user_id, a.team_id)
  ));
grant select, insert, update, delete on public.asset_locations to authenticated;

-- Stations previously had no player-grouping concept of their own -- when a
-- drill was pulled into a station from the library, the "Partners"/"Groups"
-- split that same drill gets when added directly to a practice just wasn't
-- available. Add the same grouping/num_groups columns stations already have
-- for practice/template activities.
alter table public.stations add column grouping text not null default 'whole';
alter table public.stations add column num_groups int;
alter table public.template_stations add column grouping text not null default 'whole';
alter table public.template_stations add column num_groups int;

-- A station's internal partners/groups split needs its own session_groups
-- rows, distinct from the existing block-level "which players are at which
-- station" rows that already live under the same (session, activity) key --
-- station_id null keeps meaning the latter; a real station_id means the
-- former. Append-only "latest batch wins" convention is unchanged.
alter table public.session_groups add column station_id uuid references public.stations(id);
-- Which rotation round a station's subgroup split belongs to. Without this,
-- "latest batch for this station" would keep resolving to a stale prior
-- round's split the moment a new round starts (the players at that station
-- have changed, but nothing new has been written yet under the same
-- session+activity+station key) -- round_number makes "does this round
-- already have a split" an exact match instead of a staleness guess. Stays
-- null for the existing station_id-less rows (block rotation / single-
-- activity groups), which have no round concept.
alter table public.session_groups add column round_number int;
create index session_groups_session_activity_station_idx on public.session_groups (session_id, practice_activity_id, station_id, round_number, created_at);

-- Re-declare get_live_session_view (latest body from 20260723000000) --
-- the `groups` field must now exclude per-station subgroup rows (station_id
-- not null) or a station's internal split would clobber the block-level
-- "who's at which station" data HelperView relies on. Also surfaces
-- grouping/num_groups on each station row for parity with the coach view.
create or replace function public.get_live_session_view(p_token uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_live_session_id uuid;
  v_scope text;
  v_result jsonb;
begin
  select vt.live_session_id, vt.scope into v_live_session_id, v_scope
  from public.validate_token(p_token, array['helper_read', 'helper_attendance']) vt;

  if v_live_session_id is null then
    return jsonb_build_object('error', 'invalid_or_expired_token');
  end if;

  select jsonb_build_object(
    'status', ls.status,
    'current_practice_activity_id', ls.current_practice_activity_id,
    'current_rotation_number', ls.current_rotation_number,
    'in_transition', ls.in_transition,
    'in_block_intro', ls.in_block_intro,
    'current_phase_started_at', ls.current_phase_started_at,
    'paused_at', ls.paused_at,
    'total_paused_seconds', ls.total_paused_seconds,
    'can_mark_attendance', (v_scope = 'helper_attendance'),
    'current_activity', (
      select jsonb_build_object(
        'name', pa.name, 'duration_minutes', pa.duration_minutes, 'type', pa.type,
        'description', pa.description, 'coaching_points', pa.coaching_points,
        'sublocation_name', sl.name,
        'coach_name', nullif(trim(concat(ts.first_name, ' ', ts.last_name)), ''),
        'equipment', coalesce((
          select jsonb_agg(a.name)
          from public.practice_activity_equipment pae
          join public.assets a on a.id = pae.asset_id
          where pae.practice_activity_id = pa.id
        ), '[]'::jsonb),
        'items', case when pa.type = 'checklist' then coalesce((
          select jsonb_agg(jsonb_build_object('id', ci.id, 'text', ci.text) order by ci.position)
          from public.practice_activity_checklist_items ci
          where ci.practice_activity_id = pa.id
        ), '[]'::jsonb) else null end,
        'station_duration_seconds', sb.station_duration_seconds,
        'transition_duration_seconds', sb.transition_duration_seconds,
        'rotate', sb.rotate
      )
      from public.practice_activities pa
      left join public.sublocations sl on sl.id = pa.sublocation_id
      left join public.team_staff ts on ts.id = pa.team_staff_id
      left join public.station_blocks sb on sb.practice_activity_id = pa.id
      where pa.id = ls.current_practice_activity_id
    ),
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'description', s.description, 'coaching_points', s.coaching_points,
        'sublocation_name', ssl.name,
        'coach_name', coalesce(nullif(trim(concat(sts.first_name, ' ', sts.last_name)), ''), s.helper_name),
        'group_label', s.group_label,
        'grouping', s.grouping,
        'num_groups', s.num_groups,
        'equipment', coalesce((
          select jsonb_agg(a2.name)
          from public.station_equipment se
          join public.assets a2 on a2.id = se.asset_id
          where se.station_id = s.id
        ), '[]'::jsonb)
      ) order by s.position)
      from public.stations s
      left join public.sublocations ssl on ssl.id = s.sublocation_id
      left join public.team_staff sts on sts.id = s.team_staff_id
      join public.station_blocks sb on sb.id = s.station_block_id
      where sb.practice_activity_id = ls.current_practice_activity_id and s.archived_at is null
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group_number', sg.group_number,
        'players', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pl.id, 'first_name', pl.first_name, 'last_initial', left(pl.last_name, 1),
            'jersey_number', pl.jersey_number
          ))
          from public.session_group_members sgm
          join public.players pl on pl.id = sgm.player_id
          where sgm.group_id = sg.id
        ), '[]'::jsonb)
      ) order by sg.group_number)
      from public.session_groups sg
      where sg.session_id = ls.id
        and sg.practice_activity_id = ls.current_practice_activity_id
        and sg.station_id is null
        and sg.created_at = (
          select max(created_at) from public.session_groups
          where session_id = ls.id and practice_activity_id = ls.current_practice_activity_id and station_id is null
        )
    ), '[]'::jsonb),
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pl2.id, 'first_name', pl2.first_name, 'last_initial', left(pl2.last_name, 1),
        'jersey_number', pl2.jersey_number,
        'status', (
          select sa.status from public.session_attendance sa
          where sa.session_id = ls.id and sa.player_id = pl2.id
          order by sa.created_at desc limit 1
        )
      ) order by pl2.first_name)
      from public.players pl2
      join public.practices prac on prac.team_id = pl2.team_id
      where prac.id = ls.practice_id and pl2.archived_at is null
    ), '[]'::jsonb),
    'upcoming_activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', pa2.type, 'name', pa2.name, 'duration_minutes', pa2.duration_minutes,
        'station_duration_seconds', sb2.station_duration_seconds,
        'transition_duration_seconds', sb2.transition_duration_seconds,
        'rotate', sb2.rotate,
        'station_count', (select count(*) from public.stations s2 where s2.station_block_id = sb2.id and s2.archived_at is null)
      ) order by pa2.position)
      from public.practice_activities pa2
      left join public.station_blocks sb2 on sb2.practice_activity_id = pa2.id
      where pa2.practice_id = ls.practice_id and pa2.archived_at is null
        and pa2.position > coalesce((select position from public.practice_activities where id = ls.current_practice_activity_id), -1)
    ), '[]'::jsonb)
  ) into v_result
  from public.practice_live_sessions ls
  where ls.id = v_live_session_id;

  return v_result;
end;
$$;
