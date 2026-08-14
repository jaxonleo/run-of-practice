-- Direct feedback, live co-testing: the Introduce Stations equipment
-- badge on HelperView (and, client-side, CommandScreen) mixed team
-- equipment and player gear into one flat, name-only list -- no way to
-- tell "cones" (something a coach sets up) from "pinnies" (something a
-- player wears) apart, and no acquired/not-acquired status either, since
-- everything downstream of this RPC only ever got jsonb_agg(a.name), a
-- bare array of strings.
--
-- Every equipment sub-select in this function now returns two keys
-- instead of one -- 'equipment' (assets.type = 'team_equipment') and
-- 'player_gear' (assets.type = 'player_gear') -- each an array of
-- {name, acquired} objects instead of bare name strings, matching what
-- the client-side (data.assets-resolved) equipment already carries for a
-- signed-in coach. No other change to this function -- see
-- 20260807080000_live_session_all_activities.sql for the version this
-- replaces.
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
