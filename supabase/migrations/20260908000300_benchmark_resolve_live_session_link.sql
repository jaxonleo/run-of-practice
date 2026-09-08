-- resolve_benchmark_assessment: when a recorder joins an assessment that was
-- created earlier (e.g. a "Record Results" panel that mounted before the live
-- session row settled, or a second station in a shared occurrence), backfill
-- live_session_id / practice_id if they were not known at creation time. This
-- keeps the "source practice" link on a benchmark assessment accurate even
-- when recording starts a beat after the run begins. Idempotent get-or-create
-- semantics and all other behaviour are unchanged.

create or replace function public.resolve_benchmark_assessment(
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
        v_throwaway := v_assessment_id;
        select assessment_id into v_assessment_id from public.benchmark_assessment_sources where occurrence_key = p_occurrence_key;
        delete from public.benchmark_assessments where id = v_throwaway;
      end;
    end if;
  end if;

  -- Backfill the source-practice link on an existing, still-recording row.
  if not v_created and v_assessment_id is not null then
    update public.benchmark_assessments
      set live_session_id = coalesce(live_session_id, p_live_session_id),
          practice_id = coalesce(practice_id, p_practice_id)
      where id = v_assessment_id and state = 'recording'
        and (live_session_id is null or practice_id is null);
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
