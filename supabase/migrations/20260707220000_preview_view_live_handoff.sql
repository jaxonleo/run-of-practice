-- PreviewView needs to detect when the coach starts the practice and
-- redirect to the live view. The live_session_id itself is never meant to
-- be a public-facing identifier (session_access_tokens exists specifically
-- so raw table PKs aren't used as URLs -- see that table's own comment),
-- so this can't just return preview_sessions.live_session_id. Instead it
-- looks up an existing helper_read token for that live session -- the
-- coach mints one via link_preview_to_live_session (below) at the moment
-- they start the practice, guaranteeing one always exists once is_live
-- flips true.
create or replace function public.get_preview_view(p_token uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_preview_session_id uuid;
  v_practice_id uuid;
  v_live_session_id uuid;
  v_live_token uuid;
  v_result jsonb;
begin
  select vt.preview_session_id into v_preview_session_id
  from public.validate_token(p_token, array['preview']) vt;

  if v_preview_session_id is null then
    return jsonb_build_object('error', 'invalid_or_expired_token');
  end if;

  select ps.practice_id, ps.live_session_id into v_practice_id, v_live_session_id
  from public.preview_sessions ps where ps.id = v_preview_session_id;

  if v_live_session_id is not null then
    select sat.id into v_live_token
    from public.session_access_tokens sat
    where sat.live_session_id = v_live_session_id
      and sat.scope = 'helper_read'
      and sat.revoked_at is null
      and sat.expires_at > now()
    order by sat.created_at asc
    limit 1;
  end if;

  select jsonb_build_object(
    'practice_name', p.name,
    'team_name', t.name,
    'sport', t.sport,
    'scheduled_at', p.scheduled_at,
    'location_name', l.name,
    'is_live', v_live_session_id is not null,
    'live_token', v_live_token,
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

-- Coach-side (authenticated): links a preview_session to the live_session
-- just created for the same practice, and mints the helper_read token
-- get_preview_view needs to hand back for the redirect. Wraps both writes
-- in one call so they can't drift out of sync with each other.
create or replace function public.link_preview_to_live_session(p_practice_id uuid, p_live_session_id uuid)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_preview_session_id uuid;
begin
  if not public.can_coach_practice(p_practice_id) then
    raise exception 'not authorized';
  end if;

  select id into v_preview_session_id
  from public.preview_sessions
  where practice_id = p_practice_id and live_session_id is null
  order by created_at desc
  limit 1;

  if v_preview_session_id is null then
    return;
  end if;

  update public.preview_sessions set live_session_id = p_live_session_id where id = v_preview_session_id;

  insert into public.session_access_tokens (live_session_id, scope, created_by, expires_at)
  values (p_live_session_id, 'helper_read', auth.uid(), now() + interval '24 hours');
end;
$$;

grant execute on function public.link_preview_to_live_session(uuid, uuid) to authenticated;
