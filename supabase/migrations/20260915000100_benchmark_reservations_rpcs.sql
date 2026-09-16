-- Reservation RPCs for the Benchmark capture redesign (ROP Design System v1,
-- section 11): a tester selecting a participant calls reserve_*, the client
-- re-calls it every ~30s while that participant stays open (a heartbeat, not
-- a lock), and calls release_* on save/skip/unable/close. A second tester
-- reading the same participant sees reserved_label/reserved_expires_at
-- (added to get_benchmark_assessment / get_benchmark_recording_view_by_token
-- below) and can force p_take_over := true after an explicit confirmation in
-- the client -- there is no server-side "stale reservation" cleanup job,
-- since an expired reserved_expires_at already reads as free everywhere.
--
-- This never touches benchmark_participants.status, benchmark_attempts, or
-- any scoring/finalization logic -- purely a live "who's looking at this
-- right now" signal layered on top.

create function public.reserve_benchmark_participant(p_participant_id uuid, p_take_over boolean default false) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_assessment uuid; v_team uuid; v_state text; v_name text; v_cur record;
begin
  select assessment_id into v_assessment from public.benchmark_participants where id = p_participant_id;
  if v_assessment is null then return jsonb_build_object('error', 'not_found'); end if;
  select team_id, state into v_team, v_state from public.benchmark_assessments where id = v_assessment;
  if not public.can_record_benchmark_assessment(v_assessment) then return jsonb_build_object('error', 'not_authorized'); end if;
  if v_state <> 'recording' then return jsonb_build_object('error', 'assessment_closed'); end if;

  select reserved_by_user_id, reserved_label, reserved_expires_at into v_cur
    from public.benchmark_participants where id = p_participant_id for update;

  if v_cur.reserved_expires_at > now() and v_cur.reserved_by_user_id is distinct from auth.uid() and not p_take_over then
    return jsonb_build_object('reserved', false, 'held_by', v_cur.reserved_label, 'expires_at', v_cur.reserved_expires_at);
  end if;

  select coalesce(nullif(trim(concat(first_name, ' ', last_name)), ''), 'A coach') into v_name
    from public.team_staff where team_id = v_team and user_id = auth.uid() and archived_at is null
    order by created_at limit 1;

  update public.benchmark_participants set
    reserved_by_user_id = auth.uid(), reserved_by_grant_id = null,
    reserved_label = coalesce(v_name, 'A coach'), reserved_at = now(), reserved_expires_at = now() + interval '90 seconds'
  where id = p_participant_id;

  return jsonb_build_object('reserved', true, 'expires_at', now() + interval '90 seconds');
end;
$$;

create function public.release_benchmark_participant(p_participant_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  update public.benchmark_participants set
    reserved_by_user_id = null, reserved_by_grant_id = null, reserved_label = null,
    reserved_at = null, reserved_expires_at = null
  where id = p_participant_id and reserved_by_user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

create function public.reserve_benchmark_participant_by_token(p_token text, p_participant_id uuid, p_take_over boolean default false) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_g record; v_state text; v_cur record; v_label text;
begin
  select * into v_g from public.validate_benchmark_grant(p_token);
  if v_g.grant_id is null then return jsonb_build_object('error', 'invalid_or_expired_token'); end if;
  select state into v_state from public.benchmark_assessments where id = v_g.assessment_id;
  if v_state <> 'recording' then return jsonb_build_object('error', 'assessment_closed'); end if;

  if not exists (
    select 1 from public.benchmark_participants bp
    where bp.id = p_participant_id and bp.assessment_id = v_g.assessment_id
      and (v_g.subject_scope = 'team' and bp.is_team_subject
           or v_g.subject_scope = 'players' and bp.player_id = any(v_g.permitted_player_ids))
  ) then return jsonb_build_object('error', 'participant_not_in_scope'); end if;

  select reserved_by_grant_id, reserved_label, reserved_expires_at into v_cur
    from public.benchmark_participants where id = p_participant_id for update;

  if v_cur.reserved_expires_at > now() and v_cur.reserved_by_grant_id is distinct from v_g.grant_id and not p_take_over then
    return jsonb_build_object('reserved', false, 'held_by', v_cur.reserved_label, 'expires_at', v_cur.reserved_expires_at);
  end if;

  v_label := coalesce(nullif(trim(v_g.attribution_label), ''), 'A helper');
  update public.benchmark_participants set
    reserved_by_user_id = null, reserved_by_grant_id = v_g.grant_id,
    reserved_label = v_label, reserved_at = now(), reserved_expires_at = now() + interval '90 seconds'
  where id = p_participant_id;

  return jsonb_build_object('reserved', true, 'expires_at', now() + interval '90 seconds');
end;
$$;

create function public.release_benchmark_participant_by_token(p_token text, p_participant_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_g record;
begin
  select * into v_g from public.validate_benchmark_grant(p_token);
  if v_g.grant_id is null then return jsonb_build_object('error', 'invalid_or_expired_token'); end if;
  update public.benchmark_participants set
    reserved_by_user_id = null, reserved_by_grant_id = null, reserved_label = null,
    reserved_at = null, reserved_expires_at = null
  where id = p_participant_id and reserved_by_grant_id = v_g.grant_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Full grant history for the new Helpers sheet (design system v1 SS11):
-- get_benchmark_assessment's own active_grants stays as-is (non-revoked,
-- non-expired only, used by the live recording panel); this is the
-- superset -- active, expired, and revoked -- for a real admin surface.
create function public.list_benchmark_recording_grants(p_assessment_id uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_team uuid;
begin
  select team_id into v_team from public.benchmark_assessments where id = p_assessment_id;
  if v_team is null or not (public.can_manage_team(v_team) or public.can_build_practice_for_team(v_team)) then
    return jsonb_build_object('error', 'not_authorized');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'subject_scope', g.subject_scope, 'permitted_player_ids', g.permitted_player_ids,
      'attribution_label', g.attribution_label, 'created_at', g.created_at, 'expires_at', g.expires_at,
      'revoked_at', g.revoked_at, 'is_active', (g.revoked_at is null and g.expires_at > now()))
      order by g.created_at desc)
    from public.benchmark_recording_grants g
    where g.assessment_id = p_assessment_id
  ), '[]'::jsonb);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Add reserved_label / reserved_expires_at / reserved_by_me to the two
-- existing read RPCs. Additive fields only -- every other field and the
-- overall shape is unchanged, so no existing consumer breaks.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_benchmark_assessment(p_assessment_id uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_team uuid; v_result jsonb;
begin
  select team_id into v_team from public.benchmark_assessments where id = p_assessment_id;
  if v_team is null or not public.can_coach_team(v_team) then return jsonb_build_object('error', 'not_authorized'); end if;

  select jsonb_build_object(
    'assessment', to_jsonb(ba) - 'participant_roster_snapshot',
    'benchmark', (select jsonb_build_object('id', b.id, 'title', b.title, 'sport', b.sport, 'subject_mode', b.subject_mode)
                  from public.benchmarks b where b.id = ba.benchmark_id),
    'version', (select to_jsonb(bv) from public.benchmark_versions bv where bv.id = ba.protocol_version_id),
    'can_finalize', public.can_finalize_benchmark_assessment(p_assessment_id),
    'can_manage', public.can_manage_team(v_team),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', bp.id, 'player_id', bp.player_id, 'is_team_subject', bp.is_team_subject,
        'name', bp.player_name_snapshot, 'jersey', bp.jersey_snapshot, 'status', bp.status,
        'conditions_note', bp.conditions_note,
        'participating_player_ids', bp.participating_player_ids, 'player_count', bp.player_count,
        'completeness', public._benchmark_participant_completeness(bp.id),
        'reserved_label', bp.reserved_label, 'reserved_expires_at', bp.reserved_expires_at,
        'reserved_by_me', (bp.reserved_by_user_id = auth.uid()),
        'attempts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'slot_index', a.slot_index, 'value_numeric', a.value_numeric,
            'successes', a.successes, 'opportunities', a.opportunities, 'rubric_level_id', a.rubric_level_id,
            'valid', a.valid, 'invalid_reason', a.invalid_reason, 'row_version', a.row_version,
            'author_user_id', a.author_user_id, 'recording_grant_id', a.recording_grant_id)
            order by a.slot_index)
          from public.benchmark_attempts a where a.participant_id = bp.id and a.superseded_at is null
        ), '[]'::jsonb))
        order by bp.is_team_subject desc, bp.player_name_snapshot)
      from public.benchmark_participants bp where bp.assessment_id = p_assessment_id
    ), '[]'::jsonb),
    'active_grants', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'subject_scope', g.subject_scope,
        'permitted_player_ids', g.permitted_player_ids, 'attribution_label', g.attribution_label,
        'expires_at', g.expires_at))
      from public.benchmark_recording_grants g
      where g.assessment_id = p_assessment_id and g.revoked_at is null and g.expires_at > now()
    ), '[]'::jsonb)
  ) into v_result
  from public.benchmark_assessments ba where ba.id = p_assessment_id;
  return v_result;
end;
$$;

create or replace function public.get_benchmark_recording_view_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_g record; v_state text; v_ver record; v_result jsonb;
begin
  select * into v_g from public.validate_benchmark_grant(p_token);
  if v_g.grant_id is null then return jsonb_build_object('error', 'invalid_or_expired_token'); end if;
  select state into v_state from public.benchmark_assessments where id = v_g.assessment_id;

  select bv.metric_type, bv.direction, bv.result_rule, bv.scored_attempts, bv.opportunities_per_set,
         bv.rubric_levels, bv.score_min, bv.score_max, bv.score_increment, bv.display_unit, bv.instructions
    into v_ver
  from public.benchmark_assessments ba join public.benchmark_versions bv on bv.id = ba.protocol_version_id
  where ba.id = v_g.assessment_id;

  select jsonb_build_object(
    'assessment_state', v_state,
    'closed', (v_state <> 'recording'),
    'attribution_label', v_g.attribution_label,
    'protocol', jsonb_build_object(
      'metric_type', v_ver.metric_type, 'direction', v_ver.direction, 'result_rule', v_ver.result_rule,
      'scored_attempts', v_ver.scored_attempts, 'opportunities_per_set', v_ver.opportunities_per_set,
      'rubric_levels', v_ver.rubric_levels, 'score_min', v_ver.score_min, 'score_max', v_ver.score_max,
      'score_increment', v_ver.score_increment, 'display_unit', v_ver.display_unit, 'instructions', v_ver.instructions),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', bp.id,
        'is_team_subject', bp.is_team_subject,
        'name', bp.player_name_snapshot,
        'jersey', bp.jersey_snapshot,
        'status', bp.status,
        'reserved_label', bp.reserved_label, 'reserved_expires_at', bp.reserved_expires_at,
        'reserved_by_me', (bp.reserved_by_grant_id = v_g.grant_id),
        'attempts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'slot_index', a.slot_index, 'value_numeric', a.value_numeric, 'successes', a.successes,
            'opportunities', a.opportunities, 'rubric_level_id', a.rubric_level_id, 'valid', a.valid,
            'row_version', a.row_version, 'mine', (a.recording_grant_id = v_g.grant_id))
            order by a.slot_index)
          from public.benchmark_attempts a
          where a.participant_id = bp.id and a.superseded_at is null
        ), '[]'::jsonb))
        order by bp.is_team_subject desc, bp.player_name_snapshot)
      from public.benchmark_participants bp
      where bp.assessment_id = v_g.assessment_id
        and (v_g.subject_scope = 'team' and bp.is_team_subject
             or v_g.subject_scope = 'players' and bp.player_id = any(v_g.permitted_player_ids))
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.reserve_benchmark_participant(uuid, boolean) to authenticated;
grant execute on function public.release_benchmark_participant(uuid) to authenticated;
grant execute on function public.list_benchmark_recording_grants(uuid) to authenticated;
grant execute on function public.reserve_benchmark_participant_by_token(text, uuid, boolean) to anon, authenticated;
grant execute on function public.release_benchmark_participant_by_token(text, uuid) to anon, authenticated;
