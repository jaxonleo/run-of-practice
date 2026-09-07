-- Scrimmage in the live-session and preview RPCs (ROP-Scrimmage-Handoff.md
-- section 6). Both functions are replaced whole (CREATE OR REPLACE) from
-- their current live definitions -- byte-checked against staging's
-- pg_get_functiondef first, per the drift convention -- with the scrimmage
-- additions spliced in and nothing else changed.
--
-- get_live_session_view:
--   * top-level scrimmage_round_idx (mirrors current_rotation_number)
--   * top-level scrimmage_staff: { team_staff_id: full name } so a client
--     can label a team_staff assignee (coaches are shown in full, not
--     minimized -- section 3.10); players are labelled from the existing
--     minimized `roster` array, and helper_name rides the board jsonb.
--   * current_activity.scrimmage: { config, rounds, round_idx, round_label }
--     where `rounds` prefers the latest session_scrimmage_boards override
--     over the plan (precedence: session board -> plan -> []).
--   * a `scrimmage` object on every upcoming_activities / all_activities row
--     (config + rounds only) for the Up Next preview and the navigator.
--
-- get_preview_view: each activity row gains a `scrimmage` object with the
--   round count, round label, and coach-role definitions (no board -- the
--   pre-practice rundown does not need one, section 6.3).

create or replace function public.get_live_session_view(p_token uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
    'practice_id', ls.practice_id,
    'status', ls.status,
    'current_practice_activity_id', ls.current_practice_activity_id,
    'current_rotation_number', ls.current_rotation_number,
    'scrimmage_round_idx', ls.scrimmage_round_idx,
    'scrimmage_staff', coalesce((
      select jsonb_object_agg(tstf.id::text, nullif(trim(concat(tstf.first_name, ' ', tstf.last_name)), ''))
      from public.team_staff tstf
      join public.practices prc on prc.id = ls.practice_id
      where tstf.team_id = prc.team_id and tstf.archived_at is null
    ), '{}'::jsonb),
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
        'scrimmage', case when pa.type = 'scrimmage' then jsonb_build_object(
          'config', pa.scrimmage_config,
          'rounds', coalesce(
            (select ssb.rounds from public.session_scrimmage_boards ssb
             where ssb.live_session_id = ls.id and ssb.practice_activity_id = pa.id
             order by ssb.created_at desc limit 1),
            pa.scrimmage_rounds, '[]'::jsonb),
          'round_idx', ls.scrimmage_round_idx,
          'round_label', coalesce(pa.scrimmage_config->>'roundLabel', 'Half-Inning')
        ) else null end,
        'coach_name', nullif(trim(concat(ts.first_name, ' ', ts.last_name)), ''),
        'equipment', coalesce((
          select jsonb_agg(jsonb_build_object('name', a.name, 'acquired', a.acquired))
          from public.practice_activity_equipment pae
          join public.assets a on a.id = pae.asset_id
          where pae.practice_activity_id = pa.id and a.type = 'team_equipment'
        ), '[]'::jsonb),
        'player_gear', coalesce((
          select jsonb_agg(jsonb_build_object('name', a.name, 'acquired', a.acquired))
          from public.practice_activity_equipment pae
          join public.assets a on a.id = pae.asset_id
          where pae.practice_activity_id = pa.id and a.type = 'player_gear'
        ), '[]'::jsonb),
        'items', case when pa.type = 'checklist' then coalesce((
          select jsonb_agg(jsonb_build_object('id', ci.id, 'text', ci.text) order by ci.position)
          from public.practice_activity_checklist_items ci
          where ci.practice_activity_id = pa.id
        ), '[]'::jsonb) else null end,
        'station_duration_seconds', sb.station_duration_seconds,
        'transition_duration_seconds', sb.transition_duration_seconds,
        'rotate', sb.rotate,
        'skill_tags', coalesce((
          select jsonb_agg(st.name)
          from public.drill_tags dt
          join public.skill_tags st on st.id = dt.skill_tag_id
          where dt.activity_library_id = pa.library_activity_id
        ), '[]'::jsonb),
        'player_focus', coalesce((
          select jsonb_object_agg(pfa.player_id::text, pfa.note)
          from public.player_focus_areas pfa
          join public.players pfp on pfp.id = pfa.player_id
          join public.practices pfprac on pfprac.id = ls.practice_id
          where pfp.team_id = pfprac.team_id
            and pfa.note is not null and pfa.note <> ''
            and pfa.category_id in (
              select distinct st2.category_id from public.drill_tags dt2
              join public.skill_tags st2 on st2.id = dt2.skill_tag_id
              where dt2.activity_library_id = pa.library_activity_id
            )
        ), '{}'::jsonb)
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
          select jsonb_agg(jsonb_build_object('name', a2.name, 'acquired', a2.acquired))
          from public.station_equipment se
          join public.assets a2 on a2.id = se.asset_id
          where se.station_id = s.id and a2.type = 'team_equipment'
        ), '[]'::jsonb),
        'player_gear', coalesce((
          select jsonb_agg(jsonb_build_object('name', a2.name, 'acquired', a2.acquired))
          from public.station_equipment se
          join public.assets a2 on a2.id = se.asset_id
          where se.station_id = s.id and a2.type = 'player_gear'
        ), '[]'::jsonb),
        'skill_tags', coalesce((
          select jsonb_agg(st3.name)
          from public.drill_tags dt3
          join public.skill_tags st3 on st3.id = dt3.skill_tag_id
          where dt3.activity_library_id = s.library_activity_id
        ), '[]'::jsonb),
        'player_focus', coalesce((
          select jsonb_object_agg(pfa2.player_id::text, pfa2.note)
          from public.player_focus_areas pfa2
          join public.players pfp2 on pfp2.id = pfa2.player_id
          join public.practices pfprac2 on pfprac2.id = ls.practice_id
          where pfp2.team_id = pfprac2.team_id
            and pfa2.note is not null and pfa2.note <> ''
            and pfa2.category_id in (
              select distinct st4.category_id from public.drill_tags dt4
              join public.skill_tags st4 on st4.id = dt4.skill_tag_id
              where dt4.activity_library_id = s.library_activity_id
            )
        ), '{}'::jsonb)
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
        'description', pa2.description, 'coaching_points', pa2.coaching_points,
        'sublocation_name', sl2.name,
        'scrimmage', case when pa2.type = 'scrimmage' then jsonb_build_object(
          'config', pa2.scrimmage_config,
          'rounds', coalesce(pa2.scrimmage_rounds, '[]'::jsonb)
        ) else null end,
        'station_duration_seconds', sb2.station_duration_seconds,
        'transition_duration_seconds', sb2.transition_duration_seconds,
        'rotate', sb2.rotate,
        'station_count', (select count(*) from public.stations s2 where s2.station_block_id = sb2.id and s2.archived_at is null),
        'equipment', coalesce((
          select jsonb_agg(jsonb_build_object('name', a3.name, 'acquired', a3.acquired))
          from public.practice_activity_equipment pae2
          join public.assets a3 on a3.id = pae2.asset_id
          where pae2.practice_activity_id = pa2.id and a3.type = 'team_equipment'
        ), '[]'::jsonb),
        'player_gear', coalesce((
          select jsonb_agg(jsonb_build_object('name', a3.name, 'acquired', a3.acquired))
          from public.practice_activity_equipment pae2
          join public.assets a3 on a3.id = pae2.asset_id
          where pae2.practice_activity_id = pa2.id and a3.type = 'player_gear'
        ), '[]'::jsonb),
        'stations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', s3.name, 'sublocation_name', ssl2.name,
            'coach_name', coalesce(nullif(trim(concat(usts.first_name, ' ', usts.last_name)), ''), s3.helper_name),
            'equipment', coalesce((
              select jsonb_agg(jsonb_build_object('name', a4.name, 'acquired', a4.acquired))
              from public.station_equipment se2
              join public.assets a4 on a4.id = se2.asset_id
              where se2.station_id = s3.id and a4.type = 'team_equipment'
            ), '[]'::jsonb),
            'player_gear', coalesce((
              select jsonb_agg(jsonb_build_object('name', a4.name, 'acquired', a4.acquired))
              from public.station_equipment se2
              join public.assets a4 on a4.id = se2.asset_id
              where se2.station_id = s3.id and a4.type = 'player_gear'
            ), '[]'::jsonb),
            'player_ids', coalesce(to_jsonb(s3.assignments), '[]'::jsonb)
          ) order by s3.position)
          from public.stations s3
          left join public.sublocations ssl2 on ssl2.id = s3.sublocation_id
          left join public.team_staff usts on usts.id = s3.team_staff_id
          where s3.station_block_id = sb2.id and s3.archived_at is null
        ), '[]'::jsonb)
      ) order by pa2.position)
      from public.practice_activities pa2
      left join public.sublocations sl2 on sl2.id = pa2.sublocation_id
      left join public.station_blocks sb2 on sb2.practice_activity_id = pa2.id
      where pa2.practice_id = ls.practice_id and pa2.archived_at is null
        and pa2.position > coalesce((select position from public.practice_activities where id = ls.current_practice_activity_id), -1)
    ), '[]'::jsonb),
    'all_activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pa3.id, 'position', pa3.position,
        'type', pa3.type, 'name', pa3.name, 'duration_minutes', pa3.duration_minutes,
        'description', pa3.description, 'coaching_points', pa3.coaching_points,
        'sublocation_name', sl3.name,
        'scrimmage', case when pa3.type = 'scrimmage' then jsonb_build_object(
          'config', pa3.scrimmage_config,
          'rounds', coalesce(pa3.scrimmage_rounds, '[]'::jsonb)
        ) else null end,
        'station_duration_seconds', sb3.station_duration_seconds,
        'transition_duration_seconds', sb3.transition_duration_seconds,
        'rotate', sb3.rotate,
        'station_count', (select count(*) from public.stations s5 where s5.station_block_id = sb3.id and s5.archived_at is null),
        'equipment', coalesce((
          select jsonb_agg(jsonb_build_object('name', a5.name, 'acquired', a5.acquired))
          from public.practice_activity_equipment pae3
          join public.assets a5 on a5.id = pae3.asset_id
          where pae3.practice_activity_id = pa3.id and a5.type = 'team_equipment'
        ), '[]'::jsonb),
        'player_gear', coalesce((
          select jsonb_agg(jsonb_build_object('name', a5.name, 'acquired', a5.acquired))
          from public.practice_activity_equipment pae3
          join public.assets a5 on a5.id = pae3.asset_id
          where pae3.practice_activity_id = pa3.id and a5.type = 'player_gear'
        ), '[]'::jsonb),
        'stations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', s6.name, 'sublocation_name', ssl3.name,
            'coach_name', coalesce(nullif(trim(concat(usts2.first_name, ' ', usts2.last_name)), ''), s6.helper_name),
            'equipment', coalesce((
              select jsonb_agg(jsonb_build_object('name', a6.name, 'acquired', a6.acquired))
              from public.station_equipment se3
              join public.assets a6 on a6.id = se3.asset_id
              where se3.station_id = s6.id and a6.type = 'team_equipment'
            ), '[]'::jsonb),
            'player_gear', coalesce((
              select jsonb_agg(jsonb_build_object('name', a6.name, 'acquired', a6.acquired))
              from public.station_equipment se3
              join public.assets a6 on a6.id = se3.asset_id
              where se3.station_id = s6.id and a6.type = 'player_gear'
            ), '[]'::jsonb),
            'player_ids', coalesce(to_jsonb(s6.assignments), '[]'::jsonb)
          ) order by s6.position)
          from public.stations s6
          left join public.sublocations ssl3 on ssl3.id = s6.sublocation_id
          left join public.team_staff usts2 on usts2.id = s6.team_staff_id
          where s6.station_block_id = sb3.id and s6.archived_at is null
        ), '[]'::jsonb)
      ) order by pa3.position)
      from public.practice_activities pa3
      left join public.sublocations sl3 on sl3.id = pa3.sublocation_id
      left join public.station_blocks sb3 on sb3.practice_activity_id = pa3.id
      where pa3.practice_id = ls.practice_id and pa3.archived_at is null
    ), '[]'::jsonb)
  ) into v_result
  from public.practice_live_sessions ls
  where ls.id = v_live_session_id;

  return v_result;
end;
$function$;

create or replace function public.get_preview_view(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'pre_practice_notes', p.pre_practice_notes,
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
        'scrimmage', case when pa.type = 'scrimmage' then jsonb_build_object(
          'round_count', coalesce((pa.scrimmage_config->>'rounds')::int, 0),
          'round_label', coalesce(pa.scrimmage_config->>'roundLabel', 'Half-Inning'),
          'abs_per_hitter', coalesce((pa.scrimmage_config->>'absPerHitter')::int, 2),
          'coach_roles', coalesce(pa.scrimmage_config->'coachRoles', '[]'::jsonb)
        ) else null end,
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

