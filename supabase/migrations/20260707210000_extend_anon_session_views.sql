-- Stage 6: the first-pass get_preview_view/get_live_session_view (migration
-- 20260704005600) only ever returned name/duration_minutes/type for
-- activities and a bare station name/description/coaching_points -- no
-- equipment, no coaching points on regular activities, no location or
-- coach names, and preview didn't even break station blocks into their
-- individual stations. Confirmed with Jax this was an unfinished first
-- pass, not a deliberate privacy boundary -- none of that is sensitive
-- information, unlike player identity. The one real privacy rule (player
-- names minimized to first name + last initial) is unchanged here.
--
-- get_preview_view also had no scheduled_at at all, which isn't a
-- richness gap but a functional one -- PreviewView's whole countdown
-- feature is meaningless without it.

create or replace function public.get_preview_view(p_token uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_preview_session_id uuid;
  v_practice_id uuid;
  v_result jsonb;
begin
  select vt.preview_session_id into v_preview_session_id
  from public.validate_token(p_token, array['preview']) vt;

  if v_preview_session_id is null then
    return jsonb_build_object('error', 'invalid_or_expired_token');
  end if;

  select ps.practice_id into v_practice_id
  from public.preview_sessions ps where ps.id = v_preview_session_id;

  select jsonb_build_object(
    'practice_name', p.name,
    'team_name', t.name,
    'sport', t.sport,
    'scheduled_at', p.scheduled_at,
    'location_name', l.name,
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', pa.type,
        'name', pa.name,
        'duration_minutes', pa.duration_minutes,
        'description', pa.description,
        'coaching_points', pa.coaching_points,
        'sublocation_name', sl.name,
        'coach_name', nullif(trim(concat(ts.first_name, ' ', ts.last_name)), ''),
        'equipment', coalesce((
          select jsonb_agg(a.name)
          from public.practice_activity_equipment pae
          join public.assets a on a.id = pae.asset_id
          where pae.practice_activity_id = pa.id
        ), '[]'::jsonb),
        'station_block', case when pa.type = 'station_block' then (
          select jsonb_build_object(
            'rotate', sb.rotate,
            'station_duration_seconds', sb.station_duration_seconds,
            'transition_duration_seconds', sb.transition_duration_seconds,
            'stations', coalesce((
              select jsonb_agg(jsonb_build_object(
                'name', s.name,
                'description', s.description,
                'coaching_points', s.coaching_points,
                'sublocation_name', ssl.name,
                'coach_name', nullif(trim(concat(sts.first_name, ' ', sts.last_name)), ''),
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
              where s.station_block_id = sb.id and s.archived_at is null
            ), '[]'::jsonb)
          )
          from public.station_blocks sb where sb.practice_activity_id = pa.id
        ) else null end
      ) order by pa.position)
      from public.practice_activities pa
      left join public.sublocations sl on sl.id = pa.sublocation_id
      left join public.team_staff ts on ts.id = pa.team_staff_id
      where pa.practice_id = p.id and pa.archived_at is null
    ), '[]'::jsonb)
  ) into v_result
  from public.practices p
  join public.teams t on t.id = p.team_id
  left join public.locations l on l.id = p.location_id
  where p.id = v_practice_id;

  return v_result;
end;
$$;

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
    -- Full detail for every station in the CURRENT block, so tapping into
    -- any one of them is instant -- no extra round trip per tap.
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'description', s.description, 'coaching_points', s.coaching_points,
        'sublocation_name', ssl.name,
        'coach_name', nullif(trim(concat(sts.first_name, ' ', sts.last_name)), ''),
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
    -- Most recent group batch for the current activity -- matches the
    -- "current = latest created_at" convention from session_groups itself.
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group_number', sg.group_number,
        'players', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pl.id, 'first_name', pl.first_name, 'last_initial', left(pl.last_name, 1)
          ))
          from public.session_group_members sgm
          join public.players pl on pl.id = sgm.player_id
          where sgm.group_id = sg.id
        ), '[]'::jsonb)
      ) order by sg.group_number)
      from public.session_groups sg
      where sg.session_id = ls.id
        and sg.practice_activity_id = ls.current_practice_activity_id
        and sg.created_at = (
          select max(created_at) from public.session_groups
          where session_id = ls.id and practice_activity_id = ls.current_practice_activity_id
        )
    ), '[]'::jsonb)
  ) into v_result
  from public.practice_live_sessions ls
  where ls.id = v_live_session_id;

  return v_result;
end;
$$;
