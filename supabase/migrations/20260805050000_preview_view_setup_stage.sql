-- Direct feedback: an assistant coach couldn't reach Practice Setup, and
-- when the head coach WAS already there, going live bounced the head
-- coach's own screen into the anonymous read-only helper view (blank/
-- confusing) instead of the real coach live view. Root cause: this RPC's
-- is_live/live_token pair only ever pointed a viewer at /live/:token
-- (HelperView), with no distinction between "a coach should get the real
-- CommandScreen" and "an anonymous viewer should get the read-only one."
--
-- Two changes: (1) is_live now also requires the linked session to still
-- be status='active' (a stale link to a since-ended session no longer
-- reads as live) AND setup_confirmed_at is set -- an anonymous viewer
-- shouldn't be redirected into the live drill view while coaches are
-- still mid-setup (see 20260805040000_start_or_join_live_session.sql).
-- (2) a new has_live_session flag is true the moment ANY active session
-- exists for this practice, setup-confirmed or not -- the client uses
-- this (can_manage only) to send a coach straight into /run/:practiceId,
-- the real shared Practice Setup screen, instead of leaving them on this
-- token-based preview or bouncing them into the anonymous helper view.
create or replace function public.get_preview_view(p_token uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_preview_session_id uuid;
  v_practice_id uuid;
  v_live_session_id uuid;
  v_live_token uuid;
  v_team_id uuid;
  v_can_manage boolean;
  v_session_active boolean;
  v_setup_confirmed boolean;
  v_result jsonb;
begin
  select vt.preview_session_id into v_preview_session_id
  from public.validate_token(p_token, array['preview']) vt;

  if v_preview_session_id is null then
    return jsonb_build_object('error', 'invalid_or_expired_token');
  end if;

  select ps.practice_id, ps.live_session_id into v_practice_id, v_live_session_id
  from public.preview_sessions ps where ps.id = v_preview_session_id;

  select p.team_id into v_team_id from public.practices p where p.id = v_practice_id;
  v_can_manage := v_team_id is not null and public.can_coach_team(v_team_id);

  if v_live_session_id is not null then
    select (pls.status = 'active'), (pls.setup_confirmed_at is not null)
      into v_session_active, v_setup_confirmed
      from public.practice_live_sessions pls where pls.id = v_live_session_id;

    if v_session_active then
      select sat.id into v_live_token
      from public.session_access_tokens sat
      where sat.live_session_id = v_live_session_id
        and sat.scope = 'helper_read'
        and sat.revoked_at is null
        and sat.expires_at > now()
      order by sat.created_at asc
      limit 1;
    end if;
  end if;

  select jsonb_build_object(
    'practice_id', v_practice_id,
    'practice_name', p.name,
    'team_name', t.name,
    'sport', t.sport,
    'scheduled_at', p.scheduled_at,
    'location_name', l.name,
    'is_live', coalesce(v_session_active, false) and coalesce(v_setup_confirmed, false),
    'has_live_session', coalesce(v_session_active, false),
    'live_token', v_live_token,
    'can_manage', v_can_manage,
    'my_coach_name', case when v_can_manage then (
      select nullif(trim(concat(ts2.first_name, ' ', ts2.last_name)), '')
      from public.team_staff ts2
      where ts2.team_id = t.id and ts2.user_id = auth.uid() and ts2.archived_at is null
      limit 1
    ) else null end,
    'team_staff', case when v_can_manage then coalesce((
      select jsonb_agg(jsonb_build_object('id', ts.id, 'name', trim(concat(ts.first_name, ' ', ts.last_name))) order by ts.first_name)
      from public.team_staff ts
      where ts.team_id = t.id and ts.archived_at is null
    ), '[]'::jsonb) else null end,
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
          select jsonb_agg(jsonb_build_object('name', a.name, 'acquired', a.acquired))
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
                'id', s.id,
                'name', s.name,
                'description', s.description,
                'coaching_points', s.coaching_points,
                'sublocation_name', ssl.name,
                'team_staff_id', s.team_staff_id,
                'helper_name', s.helper_name,
                'coach_name', coalesce(nullif(trim(concat(sts.first_name, ' ', sts.last_name)), ''), s.helper_name),
                'equipment', coalesce((
                  select jsonb_agg(jsonb_build_object('name', a2.name, 'acquired', a2.acquired))
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
$function$;
