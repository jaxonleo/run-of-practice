-- Everything anonymous helpers/preview viewers can do goes through these
-- three functions. Every player name returned is minimized to first name
-- + last initial -- never the full last name, under any code path here.

create function public.get_preview_view(p_token uuid)
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
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', pa.name, 'duration_minutes', pa.duration_minutes, 'type', pa.type
      ) order by pa.position)
      from public.practice_activities pa where pa.practice_id = p.id
    ), '[]'::jsonb)
  ) into v_result
  from public.practices p
  join public.teams t on t.id = p.team_id
  where p.id = v_practice_id;

  return v_result;
end;
$$;

create function public.get_live_session_view(p_token uuid)
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
      select jsonb_build_object('name', pa.name, 'duration_minutes', pa.duration_minutes, 'type', pa.type)
      from public.practice_activities pa where pa.id = ls.current_practice_activity_id
    ),
    -- Full detail for every station in the CURRENT block, so tapping into
    -- any one of them is instant -- no extra round trip per tap.
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'description', s.description, 'coaching_points', s.coaching_points
      ))
      from public.stations s
      join public.station_blocks sb on sb.id = s.station_block_id
      where sb.practice_activity_id = ls.current_practice_activity_id
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
      ))
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

create function public.submit_helper_attendance(p_token uuid, p_player_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_live_session_id uuid;
begin
  select vt.live_session_id into v_live_session_id
  from public.validate_token(p_token, array['helper_attendance']) vt;

  if v_live_session_id is null then
    return jsonb_build_object('error', 'invalid_token_or_insufficient_scope');
  end if;

  if not public.is_session_active(v_live_session_id) then
    return jsonb_build_object('error', 'session_not_active');
  end if;

  if p_status not in ('present', 'absent', 'left_early') then
    return jsonb_build_object('error', 'invalid_status');
  end if;

  insert into public.session_attendance (session_id, player_id, status, marked_via_token_id)
  values (v_live_session_id, p_player_id, p_status, p_token);

  return jsonb_build_object('success', true);
end;
$$;
