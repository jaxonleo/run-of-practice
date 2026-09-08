-- Benchmarks: lifecycle RPCs (create / version / adopt / resolve occurrence /
-- join / save attempt / participant status / finalize / reopen / archive /
-- target / baseline / exclusion / recording grants), plus the token-scoped
-- helper RPCs. Spec: ROP-Benchmarks handoff sections 3, 4, 5, 6, 9.2.
--
-- Every function is SECURITY DEFINER and authorizes the caller itself; per-table
-- RLS from 20260908000000 is the floor, these are the only write path. The
-- server computes and authorizes, never the client (handoff 5.4). Idempotency
-- is by client_operation_id; concurrent edits to the same slot surface a
-- visible conflict with the authoritative row.

-- ─────────────────────────────────────────────────────────────────────────────
-- Internal helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- Completeness of one participant's scored slots: 'none' | 'partial' |
-- 'complete', measured against the version's required valid attempt/set count.
create function public._benchmark_participant_completeness(p_participant_id uuid) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare v_needed int; v_valid int;
begin
  select bv.scored_attempts into v_needed
  from public.benchmark_participants bp
  join public.benchmark_assessments ba on ba.id = bp.assessment_id
  join public.benchmark_versions bv on bv.id = ba.protocol_version_id
  where bp.id = p_participant_id;
  if v_needed is null then return 'none'; end if;
  select count(*) into v_valid from public.benchmark_attempts
   where participant_id = p_participant_id and superseded_at is null and valid = true;
  if v_valid = 0 then return 'none';
  elsif v_valid >= v_needed then return 'complete';
  else return 'partial';
  end if;
end;
$$;

-- Shared attempt write: idempotent replay, expected-row-version conflict
-- detection, supersede-then-insert (the partial unique index allows only one
-- live row per slot), participant status recompute, append-only audit.
create function public._benchmark_apply_attempt(
  p_participant_id uuid, p_slot int, p_value numeric, p_successes int, p_opportunities int,
  p_rubric_level_id text, p_valid boolean, p_invalid_reason text,
  p_author uuid, p_grant_id uuid, p_client_op uuid, p_expected_row_version int
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_existing public.benchmark_attempts;
  v_prev public.benchmark_attempts;
  v_had_prev boolean := false;
  v_new public.benchmark_attempts;
  v_assessment_id uuid;
  v_status text;
begin
  select assessment_id into v_assessment_id from public.benchmark_participants where id = p_participant_id;

  select * into v_existing from public.benchmark_attempts where client_operation_id = p_client_op;
  if found then
    return jsonb_build_object('ok', true, 'idempotent', true, 'attempt', to_jsonb(v_existing),
      'participant_status', (select status from public.benchmark_participants where id = p_participant_id));
  end if;

  select * into v_prev from public.benchmark_attempts
    where participant_id = p_participant_id and slot_index = p_slot and superseded_at is null
    for update;
  v_had_prev := found;

  if v_had_prev and p_expected_row_version is not null and v_prev.row_version <> p_expected_row_version then
    return jsonb_build_object('conflict', true, 'server', to_jsonb(v_prev));
  end if;

  if v_had_prev then
    update public.benchmark_attempts set superseded_at = now() where id = v_prev.id;
  end if;

  insert into public.benchmark_attempts(
    participant_id, slot_index, value_numeric, successes, opportunities, rubric_level_id,
    valid, invalid_reason, author_user_id, recording_grant_id, client_operation_id, row_version)
  values (p_participant_id, p_slot, p_value, p_successes, p_opportunities, p_rubric_level_id,
    coalesce(p_valid, true), p_invalid_reason, p_author, p_grant_id, p_client_op,
    coalesce(v_prev.row_version, 0) + 1)
  returning * into v_new;

  if v_had_prev then
    update public.benchmark_attempts set superseded_by = v_new.id where id = v_prev.id;
  end if;

  update public.benchmark_participants bp
    set status = case
      when bp.status in ('unable', 'skipped') then bp.status
      else case public._benchmark_participant_completeness(p_participant_id)
             when 'complete' then 'complete' when 'partial' then 'partial' else 'not_measured' end
    end
    where bp.id = p_participant_id
    returning status into v_status;

  insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id, recording_grant_id, before, after)
  values (v_assessment_id, 'attempt', v_new.id, case when v_had_prev then 'attempt_revised' else 'attempt_created' end,
    p_author, p_grant_id, case when v_had_prev then to_jsonb(v_prev) else null end, to_jsonb(v_new));

  return jsonb_build_object('ok', true, 'attempt', to_jsonb(v_new), 'participant_status', v_status,
    'revised', v_had_prev);
end;
$$;

-- Insert one immutable version row from a protocol jsonb payload.
create function public._benchmark_insert_version(p_benchmark_id uuid, p_protocol jsonb, p_version_number int) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_title text;
begin
  select title into v_title from public.benchmarks where id = p_benchmark_id;
  insert into public.benchmark_versions(
    benchmark_id, version_number, metric_type, direction, result_rule, scored_attempts,
    opportunities_per_set, rubric_levels, score_min, score_max, score_increment, display_unit,
    instructions, protocol_conditions, invalid_guidance, planned_minutes,
    equipment_snapshot, skill_tag_ids, tag_snapshot, title_snapshot, created_by)
  values (
    p_benchmark_id, p_version_number,
    p_protocol->>'metric_type', p_protocol->>'direction', p_protocol->>'result_rule',
    coalesce((p_protocol->>'scored_attempts')::int, 1),
    nullif(p_protocol->>'opportunities_per_set', '')::int,
    case when jsonb_typeof(p_protocol->'rubric_levels') = 'array' then p_protocol->'rubric_levels' else null end,
    nullif(p_protocol->>'score_min', '')::numeric,
    nullif(p_protocol->>'score_max', '')::numeric,
    nullif(p_protocol->>'score_increment', '')::numeric,
    nullif(p_protocol->>'display_unit', ''),
    coalesce(p_protocol->>'instructions', ''),
    case when jsonb_typeof(p_protocol->'protocol_conditions') = 'object' then p_protocol->'protocol_conditions' else null end,
    nullif(p_protocol->>'invalid_guidance', ''),
    nullif(p_protocol->>'planned_minutes', '')::int,
    coalesce(case when jsonb_typeof(p_protocol->'equipment_snapshot') = 'array' then p_protocol->'equipment_snapshot' else null end, '[]'::jsonb),
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_protocol->'skill_tag_ids', '[]'::jsonb)) x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_protocol->'tag_snapshot', '[]'::jsonb)) x), '{}'),
    coalesce(v_title, ''),
    auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Definition + version
-- ─────────────────────────────────────────────────────────────────────────────
create function public.create_benchmark(
  p_organization_id uuid, p_sport text, p_title text, p_subject_mode text,
  p_protocol jsonb, p_source_drill_id uuid default null, p_source_benchmark_id uuid default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_owner uuid; v_bid uuid; v_vid uuid;
begin
  if p_organization_id is null then
    v_owner := auth.uid();
  else
    v_owner := null;
    if not public.is_org_admin(p_organization_id) then raise exception 'not authorized for org'; end if;
  end if;
  if p_subject_mode not in ('individual', 'team') then raise exception 'bad subject_mode'; end if;

  insert into public.benchmarks(owner_user_id, organization_id, sport, title, subject_mode, source_drill_id, source_benchmark_id, created_by)
  values (v_owner, p_organization_id, coalesce(p_sport, 'General'), p_title, p_subject_mode, p_source_drill_id, p_source_benchmark_id, auth.uid())
  returning id into v_bid;

  v_vid := public._benchmark_insert_version(v_bid, p_protocol, 1);
  insert into public.benchmark_audit(benchmark_id, entity_type, entity_id, action, actor_user_id, after)
  values (v_bid, 'benchmark', v_bid, 'created', auth.uid(), jsonb_build_object('version_id', v_vid));
  return jsonb_build_object('benchmark_id', v_bid, 'version_id', v_vid);
end;
$$;

-- A structural change: a brand new comparison series. The prior version is
-- marked superseded (existing planned occurrences stay pinned to it).
create function public.create_benchmark_version(p_benchmark_id uuid, p_protocol jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_n int; v_prev uuid; v_vid uuid;
begin
  if not public.can_manage_benchmark(p_benchmark_id) then raise exception 'not authorized'; end if;
  select coalesce(max(version_number), 0) + 1 into v_n from public.benchmark_versions where benchmark_id = p_benchmark_id;
  select id into v_prev from public.benchmark_versions where benchmark_id = p_benchmark_id order by version_number desc limit 1;
  v_vid := public._benchmark_insert_version(p_benchmark_id, p_protocol, v_n);
  if v_prev is not null then
    update public.benchmark_versions set superseded_by = v_vid where id = v_prev;
  end if;
  insert into public.benchmark_audit(benchmark_id, entity_type, entity_id, action, actor_user_id, after)
  values (p_benchmark_id, 'version', v_vid, 'version_created', auth.uid(), jsonb_build_object('version_number', v_n));
  return jsonb_build_object('version_id', v_vid, 'version_number', v_n);
end;
$$;

-- An audited wording correction on the SAME version: no new comparison series,
-- never touches a structured scoring field (handoff 3.4).
create function public.correct_benchmark_version_wording(
  p_version_id uuid, p_instructions text, p_title text, p_note text
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_bid uuid; v_before jsonb;
begin
  select benchmark_id into v_bid from public.benchmark_versions where id = p_version_id;
  if not public.can_manage_benchmark(v_bid) then raise exception 'not authorized'; end if;
  select to_jsonb(bv) into v_before from public.benchmark_versions bv where bv.id = p_version_id;
  update public.benchmark_versions
    set instructions = coalesce(p_instructions, instructions),
        title_snapshot = coalesce(p_title, title_snapshot),
        metadata_corrections = metadata_corrections || jsonb_build_object(
          'at', now(), 'by', auth.uid(), 'note', p_note,
          'from', jsonb_build_object('instructions', v_before->>'instructions', 'title_snapshot', v_before->>'title_snapshot'))
    where id = p_version_id;
  if p_title is not null then
    update public.benchmarks set title = p_title where id = v_bid;
  end if;
  insert into public.benchmark_audit(benchmark_id, entity_type, entity_id, action, actor_user_id, before, after)
  values (v_bid, 'version', p_version_id, 'wording_corrected', auth.uid(), v_before,
    (select to_jsonb(bv) from public.benchmark_versions bv where bv.id = p_version_id));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.adopt_benchmark_for_team(p_benchmark_id uuid, p_team_id uuid, p_version_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not (public.can_manage_team(p_team_id) or public.can_build_practice_for_team(p_team_id)) then raise exception 'not authorized'; end if;
  if not public.can_access_benchmark(p_benchmark_id) then raise exception 'benchmark not accessible'; end if;
  insert into public.team_benchmarks(team_id, benchmark_id, adopted_version_id, created_by)
  values (p_team_id, p_benchmark_id, p_version_id, auth.uid())
  on conflict (team_id, benchmark_id) do update set adopted_version_id = excluded.adopted_version_id, archived_at = null, updated_at = now()
  returning id into v_id;
  return jsonb_build_object('team_benchmark_id', v_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Occurrence resolution: atomic get-or-create keyed by occurrence_key
-- ─────────────────────────────────────────────────────────────────────────────
create function public.resolve_benchmark_assessment(
  p_team_id uuid, p_benchmark_id uuid, p_version_id uuid, p_occurrence_key text,
  p_practice_id uuid default null, p_practice_activity_id uuid default null, p_station_id uuid default null,
  p_live_session_id uuid default null, p_label text default null,
  p_measured_at timestamptz default now(), p_measured_local_date date default null,
  p_timezone text default null, p_join_assessment_id uuid default null, p_standalone boolean default false
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_assessment_id uuid; v_created boolean := false;
  v_subject_mode text; v_tz text; v_ld date; v_present uuid[]; v_throwaway uuid;
begin
  if p_standalone then
    if not (public.can_manage_team(p_team_id) or public.can_build_practice_for_team(p_team_id)) then raise exception 'not authorized'; end if;
    if p_measured_at > now() then raise exception 'a standalone measurement cannot be in the future'; end if;
  else
    if not public.can_coach_team(p_team_id) then raise exception 'not authorized'; end if;
  end if;

  select subject_mode into v_subject_mode from public.benchmarks where id = p_benchmark_id;
  select coalesce(p_timezone, timezone, 'UTC') into v_tz from public.teams where id = p_team_id;
  v_ld := coalesce(p_measured_local_date, (p_measured_at at time zone coalesce(v_tz, 'UTC'))::date);

  insert into public.team_benchmarks(team_id, benchmark_id, adopted_version_id, created_by)
  values (p_team_id, p_benchmark_id, p_version_id, auth.uid())
  on conflict (team_id, benchmark_id) do nothing;

  if p_join_assessment_id is not null then
    if not exists (
      select 1 from public.benchmark_assessments
      where id = p_join_assessment_id and team_id = p_team_id and protocol_version_id = p_version_id and state = 'recording'
    ) then raise exception 'cannot join that assessment (same practice / team / version, still recording)'; end if;
    v_assessment_id := p_join_assessment_id;
    insert into public.benchmark_assessment_sources(assessment_id, occurrence_key, practice_id, practice_activity_id, station_id, created_by)
    values (v_assessment_id, p_occurrence_key, p_practice_id, p_practice_activity_id, p_station_id, auth.uid())
    on conflict (occurrence_key) do nothing;
  else
    select assessment_id into v_assessment_id from public.benchmark_assessment_sources where occurrence_key = p_occurrence_key;
    if v_assessment_id is null then
      insert into public.benchmark_assessments(team_id, benchmark_id, protocol_version_id, live_session_id,
        practice_id, label, measured_at, measured_local_date, timezone, state, created_by)
      values (p_team_id, p_benchmark_id, p_version_id, p_live_session_id, p_practice_id, p_label,
        p_measured_at, v_ld, coalesce(v_tz, 'UTC'), 'recording', auth.uid())
      returning id into v_assessment_id;
      begin
        insert into public.benchmark_assessment_sources(assessment_id, occurrence_key, practice_id, practice_activity_id, station_id, created_by)
        values (v_assessment_id, p_occurrence_key, p_practice_id, p_practice_activity_id, p_station_id, auth.uid());
        v_created := true;
      exception when unique_violation then
        -- lost the race: drop the throwaway assessment, use the winner's
        v_throwaway := v_assessment_id;
        select assessment_id into v_assessment_id from public.benchmark_assessment_sources where occurrence_key = p_occurrence_key;
        delete from public.benchmark_assessments where id = v_throwaway;
      end;
    end if;
  end if;

  if v_created then
    update public.benchmark_versions set first_used_at = coalesce(first_used_at, now()) where id = p_version_id;

    if v_subject_mode = 'team' then
      insert into public.benchmark_participants(assessment_id, is_team_subject) values (v_assessment_id, true)
      on conflict do nothing;
    else
      if p_live_session_id is not null then
        select setup_present_player_ids into v_present from public.practice_live_sessions where id = p_live_session_id;
      end if;
      insert into public.benchmark_participants(assessment_id, player_id, player_name_snapshot, jersey_snapshot, status)
      select v_assessment_id, pl.id, pl.first_name || ' ' || left(pl.last_name, 1), pl.jersey_number, 'not_measured'
      from public.players pl
      where pl.team_id = p_team_id and pl.archived_at is null
        and (v_present is null or pl.id = any(v_present))
      on conflict do nothing;
    end if;

    insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id, after)
    values (v_assessment_id, 'assessment', v_assessment_id, 'created', auth.uid(),
      jsonb_build_object('occurrence_key', p_occurrence_key, 'standalone', p_standalone));
  end if;

  return jsonb_build_object('assessment_id', v_assessment_id, 'created', v_created);
end;
$$;

-- A late arrival, or an individual added after seeding (handoff 5.2). Audited.
create function public.add_benchmark_participant(p_assessment_id uuid, p_player_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_team uuid; v_id uuid;
begin
  select team_id into v_team from public.benchmark_assessments where id = p_assessment_id;
  if not public.can_record_benchmark_assessment(p_assessment_id) then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.players where id = p_player_id and team_id = v_team) then
    raise exception 'player not on this team';
  end if;
  insert into public.benchmark_participants(assessment_id, player_id, player_name_snapshot, jersey_snapshot, status)
  select p_assessment_id, pl.id, pl.first_name || ' ' || left(pl.last_name, 1), pl.jersey_number, 'not_measured'
  from public.players pl where pl.id = p_player_id
  on conflict (assessment_id, player_id) where player_id is not null do nothing
  returning id into v_id;
  insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id, after)
  values (p_assessment_id, 'participant', coalesce(v_id, p_player_id), 'participant_added', auth.uid(), jsonb_build_object('player_id', p_player_id));
  return jsonb_build_object('participant_id', v_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Recording writes
-- ─────────────────────────────────────────────────────────────────────────────
create function public.save_benchmark_attempt(
  p_assessment_id uuid, p_participant_id uuid, p_slot_index int,
  p_value_numeric numeric default null, p_successes int default null, p_opportunities int default null,
  p_rubric_level_id text default null, p_valid boolean default true, p_invalid_reason text default null,
  p_client_operation_id uuid default null, p_expected_row_version int default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_state text; v_team uuid;
begin
  if p_client_operation_id is null then raise exception 'client_operation_id required'; end if;
  select state, team_id into v_state, v_team from public.benchmark_assessments where id = p_assessment_id;
  if v_team is null or not public.can_record_benchmark_assessment(p_assessment_id) then raise exception 'not authorized'; end if;
  if v_state <> 'recording' then raise exception 'assessment is not open for recording'; end if;
  if not exists (select 1 from public.benchmark_participants where id = p_participant_id and assessment_id = p_assessment_id) then
    raise exception 'participant not in assessment';
  end if;
  return public._benchmark_apply_attempt(p_participant_id, p_slot_index, p_value_numeric, p_successes, p_opportunities,
    p_rubric_level_id, p_valid, p_invalid_reason, auth.uid(), null, p_client_operation_id, p_expected_row_version);
end;
$$;

create function public.set_benchmark_participant_status(p_participant_id uuid, p_status text, p_conditions_note text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_assessment uuid; v_before jsonb;
begin
  select assessment_id into v_assessment from public.benchmark_participants where id = p_participant_id;
  if not public.can_record_benchmark_assessment(v_assessment) then raise exception 'not authorized'; end if;
  if (select state from public.benchmark_assessments where id = v_assessment) <> 'recording' then
    raise exception 'assessment is not open for recording';
  end if;
  if p_status not in ('not_measured', 'partial', 'complete', 'unable', 'skipped') then raise exception 'bad status'; end if;
  select to_jsonb(bp) into v_before from public.benchmark_participants bp where bp.id = p_participant_id;
  update public.benchmark_participants
    set status = p_status, conditions_note = coalesce(p_conditions_note, conditions_note)
    where id = p_participant_id;
  insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id, before, after)
  values (v_assessment, 'participant', p_participant_id, 'status_set', auth.uid(), v_before,
    (select to_jsonb(bp) from public.benchmark_participants bp where bp.id = p_participant_id));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_benchmark_collective_participants(p_participant_id uuid, p_player_ids uuid[], p_note text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_assessment uuid;
begin
  select assessment_id into v_assessment from public.benchmark_participants where id = p_participant_id and is_team_subject;
  if v_assessment is null then raise exception 'not a collective subject'; end if;
  if not public.can_record_benchmark_assessment(v_assessment) then raise exception 'not authorized'; end if;
  update public.benchmark_participants
    set participating_player_ids = p_player_ids,
        player_count = coalesce(array_length(p_player_ids, 1), 0),
        conditions_note = coalesce(p_note, conditions_note)
    where id = p_participant_id;
  insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id, after)
  values (v_assessment, 'participant', p_participant_id, 'collective_participants_set', auth.uid(),
    jsonb_build_object('count', coalesce(array_length(p_player_ids, 1), 0)));
  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Assessment lifecycle
-- ─────────────────────────────────────────────────────────────────────────────
create function public.finalize_benchmark_assessment(p_assessment_id uuid, p_confirm_incomplete boolean default false) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_state text; v_complete int; v_expected int; v_partial int; v_skipped int; v_unable int; v_missing int;
begin
  select state into v_state from public.benchmark_assessments where id = p_assessment_id;
  if v_state is null then raise exception 'no such assessment'; end if;
  if not public.can_finalize_benchmark_assessment(p_assessment_id) then raise exception 'not authorized'; end if;
  if v_state <> 'recording' then raise exception 'assessment is not open for recording'; end if;

  select
    count(*) filter (where status = 'complete'),
    count(*),
    count(*) filter (where status = 'partial'),
    count(*) filter (where status = 'skipped'),
    count(*) filter (where status = 'unable'),
    count(*) filter (where status = 'not_measured')
  into v_complete, v_expected, v_partial, v_skipped, v_unable, v_missing
  from public.benchmark_participants where assessment_id = p_assessment_id;

  if v_complete = 0 then
    return jsonb_build_object('error', 'no_official_results',
      'message', 'Finalizing needs at least one complete official result. A zero-data assessment can be discarded or archived.');
  end if;
  if (v_partial + v_missing) > 0 and not p_confirm_incomplete then
    return jsonb_build_object('needs_confirmation', true,
      'counts', jsonb_build_object('complete', v_complete, 'partial', v_partial, 'skipped', v_skipped,
        'unable', v_unable, 'missing', v_missing, 'expected', v_expected));
  end if;

  update public.benchmark_assessments
    set state = 'finalized', under_correction = false, prior_state = null,
        finalized_at = now(), finalized_by = auth.uid(),
        participant_roster_snapshot = (
          select coalesce(jsonb_agg(jsonb_build_object(
            'participant_id', bp.id, 'player_id', bp.player_id, 'is_team_subject', bp.is_team_subject,
            'name', bp.player_name_snapshot, 'jersey', bp.jersey_snapshot, 'status', bp.status,
            'participating_player_ids', bp.participating_player_ids, 'player_count', bp.player_count)), '[]'::jsonb)
          from public.benchmark_participants bp where bp.assessment_id = p_assessment_id)
    where id = p_assessment_id;

  -- Finalization permanently revokes every recording grant in the same txn.
  update public.benchmark_recording_grants
    set revoked_at = now(), revoked_by = auth.uid()
    where assessment_id = p_assessment_id and revoked_at is null;

  insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id, after)
  values (p_assessment_id, 'assessment', p_assessment_id, 'finalized', auth.uid(),
    jsonb_build_object('complete', v_complete, 'partial', v_partial, 'missing', v_missing));
  return jsonb_build_object('ok', true, 'complete', v_complete, 'expected', v_expected);
end;
$$;

-- Manager-only. Back to recording, "Under correction" until refinalized; old
-- helper grants stay revoked.
create function public.reopen_benchmark_assessment(p_assessment_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_team uuid; v_state text;
begin
  select team_id, state into v_team, v_state from public.benchmark_assessments where id = p_assessment_id;
  if not public.can_manage_team(v_team) then raise exception 'not authorized'; end if;
  if v_state <> 'finalized' then raise exception 'only a finalized assessment can be reopened'; end if;
  update public.benchmark_assessments
    set state = 'recording', under_correction = true, prior_state = 'finalized',
        reopened_at = now(), reopened_by = auth.uid()
    where id = p_assessment_id;
  insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id)
  values (p_assessment_id, 'assessment', p_assessment_id, 'reopened', auth.uid());
  return jsonb_build_object('ok', true);
end;
$$;

create function public.archive_benchmark_assessment(p_assessment_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_team uuid; v_state text;
begin
  select team_id, state into v_team, v_state from public.benchmark_assessments where id = p_assessment_id;
  if not public.can_manage_team(v_team) then raise exception 'not authorized'; end if;
  update public.benchmark_assessments
    set prior_state = v_state, state = 'archived'
    where id = p_assessment_id;
  update public.benchmark_recording_grants set revoked_at = now(), revoked_by = auth.uid()
    where assessment_id = p_assessment_id and revoked_at is null;
  insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id, before)
  values (p_assessment_id, 'assessment', p_assessment_id, 'archived', auth.uid(), jsonb_build_object('prior_state', v_state));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.restore_benchmark_assessment(p_assessment_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_team uuid; v_prior text;
begin
  select team_id, prior_state into v_team, v_prior from public.benchmark_assessments where id = p_assessment_id;
  if not public.can_manage_team(v_team) then raise exception 'not authorized'; end if;
  update public.benchmark_assessments
    set state = coalesce(v_prior, 'recording'), prior_state = null
    where id = p_assessment_id and state = 'archived';
  insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id, after)
  values (p_assessment_id, 'assessment', p_assessment_id, 'restored', auth.uid(), jsonb_build_object('state', coalesce(v_prior, 'recording')));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.set_benchmark_assessment_exclusion(p_assessment_id uuid, p_excluded boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_team uuid;
begin
  select team_id into v_team from public.benchmark_assessments where id = p_assessment_id;
  if not public.can_manage_team(v_team) then raise exception 'not authorized'; end if;
  update public.benchmark_assessments
    set excluded_from_comparisons = coalesce(p_excluded, false),
        excluded_reason = case when p_excluded then p_reason else null end
    where id = p_assessment_id;
  insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id, after)
  values (p_assessment_id, 'assessment', p_assessment_id, 'exclusion_set', auth.uid(),
    jsonb_build_object('excluded', coalesce(p_excluded, false), 'reason', p_reason));
  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Targets and baseline (manager only)
-- ─────────────────────────────────────────────────────────────────────────────
create function public.set_team_benchmark_target(
  p_team_benchmark_id uuid, p_protocol_version_id uuid,
  p_threshold_value numeric default null, p_threshold_proportion numeric default null,
  p_threshold_level_order int default null, p_attainment_percent int default null, p_season_label text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_team uuid; v_id uuid;
begin
  select team_id into v_team from public.team_benchmarks where id = p_team_benchmark_id;
  if not public.can_manage_team(v_team) then raise exception 'not authorized'; end if;
  insert into public.benchmark_target_revisions(team_benchmark_id, protocol_version_id, threshold_value,
    threshold_proportion, threshold_level_order, attainment_percent, season_label, created_by)
  values (p_team_benchmark_id, p_protocol_version_id, p_threshold_value, p_threshold_proportion,
    p_threshold_level_order, p_attainment_percent, p_season_label, auth.uid())
  returning id into v_id;
  return jsonb_build_object('target_revision_id', v_id);
end;
$$;

create function public.set_team_benchmark_baseline(p_team_benchmark_id uuid, p_assessment_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_team uuid;
begin
  select team_id into v_team from public.team_benchmarks where id = p_team_benchmark_id;
  if not public.can_manage_team(v_team) then raise exception 'not authorized'; end if;
  if p_assessment_id is not null and not exists (
    select 1 from public.benchmark_assessments ba
    join public.team_benchmarks tb on tb.id = p_team_benchmark_id
    where ba.id = p_assessment_id and ba.team_id = tb.team_id and ba.benchmark_id = tb.benchmark_id
      and ba.state = 'finalized'
  ) then raise exception 'baseline must be a finalized assessment of this team benchmark'; end if;
  update public.team_benchmarks set baseline_assessment_id = p_assessment_id, updated_at = now()
    where id = p_team_benchmark_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Scoped recording grants (handoff 6.2)
-- ─────────────────────────────────────────────────────────────────────────────
create function public.create_benchmark_recording_grant(
  p_assessment_id uuid, p_subject_scope text, p_player_ids uuid[] default '{}', p_attribution_label text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_team uuid; v_state text; v_token text; v_hash text; v_id uuid; v_scoped uuid[];
begin
  select team_id, state into v_team, v_state from public.benchmark_assessments where id = p_assessment_id;
  if v_team is null then raise exception 'no such assessment'; end if;
  if not (public.can_manage_team(v_team) or public.can_build_practice_for_team(v_team)) then raise exception 'not authorized'; end if;
  if v_state <> 'recording' then raise exception 'grants can only be issued while recording'; end if;
  if p_subject_scope not in ('players', 'team') then raise exception 'bad subject_scope'; end if;

  -- Snapshot only real participant player ids; a station rotation never widens
  -- this later (handoff 6.2) -- a fresh grant is required to add players.
  if p_subject_scope = 'players' then
    select coalesce(array_agg(bp.player_id), '{}') into v_scoped
    from public.benchmark_participants bp
    where bp.assessment_id = p_assessment_id and bp.player_id = any(coalesce(p_player_ids, '{}'));
    if array_length(v_scoped, 1) is null then raise exception 'no valid participant ids in scope'; end if;
  else
    v_scoped := '{}';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  insert into public.benchmark_recording_grants(assessment_id, team_id, token_hash, subject_scope, permitted_player_ids, attribution_label, created_by)
  values (p_assessment_id, v_team, v_hash, p_subject_scope, v_scoped, nullif(trim(coalesce(p_attribution_label, '')), ''), auth.uid())
  returning id into v_id;

  insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id, after)
  values (p_assessment_id, 'grant', v_id, 'grant_created', auth.uid(),
    jsonb_build_object('subject_scope', p_subject_scope, 'player_count', coalesce(array_length(v_scoped, 1), 0)));

  -- The bearer token is returned exactly once and never stored in the clear.
  return jsonb_build_object('grant_id', v_id, 'token', v_token, 'expires_at', (now() + interval '12 hours'));
end;
$$;

create function public.revoke_benchmark_recording_grant(p_grant_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_team uuid; v_assessment uuid;
begin
  select team_id, assessment_id into v_team, v_assessment from public.benchmark_recording_grants where id = p_grant_id;
  if not (public.can_manage_team(v_team) or public.can_build_practice_for_team(v_team)) then raise exception 'not authorized'; end if;
  update public.benchmark_recording_grants set revoked_at = now(), revoked_by = auth.uid()
    where id = p_grant_id and revoked_at is null;
  insert into public.benchmark_audit(assessment_id, entity_type, entity_id, action, actor_user_id)
  values (v_assessment, 'grant', p_grant_id, 'grant_revoked', auth.uid());
  return jsonb_build_object('ok', true);
end;
$$;

-- Internal: resolve a bearer token to its live grant. Not for anon to call
-- directly; the token RPCs below call it. PUBLIC execute is revoked.
create function public.validate_benchmark_grant(p_token text)
returns table(grant_id uuid, assessment_id uuid, team_id uuid, subject_scope text, permitted_player_ids uuid[], attribution_label text)
language sql stable security definer set search_path to 'public' as $$
  select g.id, g.assessment_id, g.team_id, g.subject_scope, g.permitted_player_ids, g.attribution_label
  from public.benchmark_recording_grants g
  where g.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and g.revoked_at is null
    and g.expires_at > now();
$$;
revoke execute on function public.validate_benchmark_grant(text) from public;

-- Minimized recording payload for a helper. Returns only protocol instructions,
-- minimized names for the permitted participants, and their current results /
-- completion. Never history, analytics, full roster, or audit (handoff 6.2).
create function public.get_benchmark_recording_view_by_token(p_token text) returns jsonb
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

-- Helper attempt write. Validates grant scope / assessment state / subject
-- membership / existing row author (a helper edits only entries created under
-- this grant). Rate limited generously for repeated entry (handoff 6.2).
create function public.save_benchmark_attempt_by_token(
  p_token text, p_participant_id uuid, p_slot_index int,
  p_value_numeric numeric default null, p_successes int default null, p_opportunities int default null,
  p_rubric_level_id text default null, p_client_operation_id uuid default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_g record; v_state text; v_recent int; v_prev record;
begin
  if p_client_operation_id is null then return jsonb_build_object('error', 'client_operation_id required'); end if;
  select * into v_g from public.validate_benchmark_grant(p_token);
  if v_g.grant_id is null then return jsonb_build_object('error', 'invalid_or_expired_token'); end if;

  select state into v_state from public.benchmark_assessments where id = v_g.assessment_id;
  if v_state <> 'recording' then return jsonb_build_object('error', 'assessment_closed'); end if;

  -- subject-membership check against the grant's own snapshot
  if not exists (
    select 1 from public.benchmark_participants bp
    where bp.id = p_participant_id and bp.assessment_id = v_g.assessment_id
      and (v_g.subject_scope = 'team' and bp.is_team_subject
           or v_g.subject_scope = 'players' and bp.player_id = any(v_g.permitted_player_ids))
  ) then return jsonb_build_object('error', 'participant_not_in_scope'); end if;

  -- generous abuse ceiling: 120 writes / minute / grant
  select count(*) into v_recent from public.benchmark_audit
   where recording_grant_id = v_g.grant_id and created_at > now() - interval '1 minute';
  if v_recent >= 120 then return jsonb_build_object('error', 'rate_limited'); end if;

  -- a helper may only edit an entry created under this same grant
  select * into v_prev from public.benchmark_attempts
   where participant_id = p_participant_id and slot_index = p_slot_index and superseded_at is null;
  if found and (v_prev.recording_grant_id is distinct from v_g.grant_id or v_prev.author_user_id is not null) then
    return jsonb_build_object('error', 'read_only_entry');
  end if;

  return public._benchmark_apply_attempt(p_participant_id, p_slot_index, p_value_numeric, p_successes, p_opportunities,
    p_rubric_level_id, true, null, null, v_g.grant_id, p_client_operation_id, null);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Recorder / history read (authenticated)
-- ─────────────────────────────────────────────────────────────────────────────
create function public.get_benchmark_assessment(p_assessment_id uuid) returns jsonb
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.create_benchmark(uuid, text, text, text, jsonb, uuid, uuid) to authenticated;
grant execute on function public.create_benchmark_version(uuid, jsonb) to authenticated;
grant execute on function public.correct_benchmark_version_wording(uuid, text, text, text) to authenticated;
grant execute on function public.adopt_benchmark_for_team(uuid, uuid, uuid) to authenticated;
grant execute on function public.resolve_benchmark_assessment(uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, text, timestamptz, date, text, uuid, boolean) to authenticated;
grant execute on function public.add_benchmark_participant(uuid, uuid) to authenticated;
grant execute on function public.save_benchmark_attempt(uuid, uuid, int, numeric, int, int, text, boolean, text, uuid, int) to authenticated;
grant execute on function public.set_benchmark_participant_status(uuid, text, text) to authenticated;
grant execute on function public.set_benchmark_collective_participants(uuid, uuid[], text) to authenticated;
grant execute on function public.finalize_benchmark_assessment(uuid, boolean) to authenticated;
grant execute on function public.reopen_benchmark_assessment(uuid) to authenticated;
grant execute on function public.archive_benchmark_assessment(uuid) to authenticated;
grant execute on function public.restore_benchmark_assessment(uuid) to authenticated;
grant execute on function public.set_benchmark_assessment_exclusion(uuid, boolean, text) to authenticated;
grant execute on function public.set_team_benchmark_target(uuid, uuid, numeric, numeric, int, int, text) to authenticated;
grant execute on function public.set_team_benchmark_baseline(uuid, uuid) to authenticated;
grant execute on function public.create_benchmark_recording_grant(uuid, text, uuid[], text) to authenticated;
grant execute on function public.revoke_benchmark_recording_grant(uuid) to authenticated;
grant execute on function public.get_benchmark_assessment(uuid) to authenticated;

grant execute on function public.get_benchmark_recording_view_by_token(text) to anon, authenticated;
grant execute on function public.save_benchmark_attempt_by_token(text, uuid, int, numeric, int, int, text, uuid) to anon, authenticated;
