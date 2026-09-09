-- Benchmarks stage 7: reporting RPCs for Goals & Insights and PlayerProfile.
-- Spec: ROP-Benchmarks handoff sections 7 and 8.
--
-- Division of labour (handoff 7): these RPCs are the AUTHORITATIVE gate and
-- shaper -- they enforce history access (the same gate as team development
-- history, can_view_benchmark_history_for_team = can_view_goals_for_team),
-- filter to eligible assessments, and return canonical attempt values. The
-- one shared deterministic scoring / comparison implementation is
-- src/benchmarks.js, golden-fixture tested; every report surface computes
-- official results, team performance, matched improvement and target
-- attainment from that same module. There is no second, diverging formula in
-- SQL.

-- Every finalized OR still-recording (not archived) assessment for one team
-- benchmark, with full participant + non-superseded attempt detail, target
-- revisions and the stored baseline. `p_benchmark_id` null => overview: every
-- adopted benchmark with just its latest finalized assessment.
create function public.get_team_benchmark_report(
  p_team_id uuid, p_benchmark_id uuid default null, p_limit integer default 25, p_before timestamptz default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_result jsonb;
begin
  if not public.can_view_benchmark_history_for_team(p_team_id) then
    return jsonb_build_object('error', 'not_authorized');
  end if;

  if p_benchmark_id is null then
    -- Overview: one row per adopted benchmark, latest finalized assessment only.
    select jsonb_build_object('mode', 'overview', 'benchmarks', coalesce(jsonb_agg(bmrow), '[]'::jsonb))
      into v_result
    from (
      select jsonb_build_object(
        'team_benchmark_id', tb.id,
        'benchmark', jsonb_build_object('id', b.id, 'title', b.title, 'sport', b.sport, 'subject_mode', b.subject_mode, 'archived', b.archived_at is not null),
        'adopted_version_id', tb.adopted_version_id,
        'baseline_assessment_id', tb.baseline_assessment_id,
        'finalized_count', (select count(*) from public.benchmark_assessments a where a.team_id = p_team_id and a.benchmark_id = b.id and a.state = 'finalized'),
        'recording_count', (select count(*) from public.benchmark_assessments a where a.team_id = p_team_id and a.benchmark_id = b.id and a.state = 'recording'),
        'latest', (
          select public._benchmark_assessment_json(a.id)
          from public.benchmark_assessments a
          where a.team_id = p_team_id and a.benchmark_id = b.id and a.state = 'finalized'
          order by a.measured_at desc limit 1
        ),
        'version', (select public._benchmark_version_json(tb.adopted_version_id))
      ) as bmrow
      from public.team_benchmarks tb
      join public.benchmarks b on b.id = tb.benchmark_id
      where tb.team_id = p_team_id and tb.archived_at is null
      order by b.title
    ) s;
    return v_result;
  end if;

  -- Detail: assessment history (finalized + recording), full detail.
  select jsonb_build_object(
    'mode', 'detail',
    'benchmark', (select jsonb_build_object('id', b.id, 'title', b.title, 'sport', b.sport, 'subject_mode', b.subject_mode, 'archived', b.archived_at is not null) from public.benchmarks b where b.id = p_benchmark_id),
    'team_benchmark', (
      select jsonb_build_object('id', tb.id, 'adopted_version_id', tb.adopted_version_id, 'baseline_assessment_id', tb.baseline_assessment_id)
      from public.team_benchmarks tb where tb.team_id = p_team_id and tb.benchmark_id = p_benchmark_id
    ),
    'versions', (
      select coalesce(jsonb_agg(public._benchmark_version_json(bv.id) order by bv.version_number desc), '[]'::jsonb)
      from public.benchmark_versions bv where bv.benchmark_id = p_benchmark_id
    ),
    'targets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', tr.id, 'protocol_version_id', tr.protocol_version_id, 'threshold_value', tr.threshold_value,
        'threshold_proportion', tr.threshold_proportion, 'threshold_level_order', tr.threshold_level_order,
        'attainment_percent', tr.attainment_percent, 'season_label', tr.season_label,
        'effective_at', tr.effective_at) order by tr.effective_at desc), '[]'::jsonb)
      from public.benchmark_target_revisions tr
      join public.team_benchmarks tb on tb.id = tr.team_benchmark_id
      where tb.team_id = p_team_id and tb.benchmark_id = p_benchmark_id
    ),
    'season', (select jsonb_build_object('start', t.start_date, 'end', t.end_date, 'label', t.season_label) from public.teams t where t.id = p_team_id),
    'assessments', (
      select coalesce(jsonb_agg(public._benchmark_assessment_json(a.id) order by a.measured_at desc), '[]'::jsonb)
      from (
        select a.id, a.measured_at from public.benchmark_assessments a
        where a.team_id = p_team_id and a.benchmark_id = p_benchmark_id
          and a.state in ('finalized', 'recording')
          and (p_before is null or a.measured_at < p_before)
        order by a.measured_at desc
        limit greatest(1, least(coalesce(p_limit, 25), 100))
      ) a
    )
  ) into v_result;
  return v_result;
end;
$$;

-- One player's individual benchmark history: their participant rows + attempts
-- across finalized assessments, grouped by benchmark/version. Collective
-- results are never presented as a personal achievement (handoff 2.1), so this
-- only returns rows where the player has a non-team-subject participant record.
create function public.get_player_benchmark_report(p_team_id uuid, p_player_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_result jsonb;
begin
  if not public.can_view_benchmark_history_for_team(p_team_id) then
    return jsonb_build_object('error', 'not_authorized');
  end if;
  with player_benchmarks as (
    select distinct bb.id
    from public.benchmarks bb
    join public.benchmark_assessments aa on aa.benchmark_id = bb.id
    join public.benchmark_participants pp on pp.assessment_id = aa.id
    where aa.team_id = p_team_id and pp.player_id = p_player_id and not pp.is_team_subject
  ),
  obs as (
    select a.benchmark_id, a.measured_at,
      jsonb_build_object(
        'assessment_id', a.id, 'protocol_version_id', a.protocol_version_id,
        'measured_local_date', a.measured_local_date, 'label', a.label, 'state', a.state,
        'excluded_from_comparisons', a.excluded_from_comparisons, 'under_correction', a.under_correction,
        'practice_id', a.practice_id, 'status', bp.status,
        'attempts', coalesce((
          select jsonb_agg(jsonb_build_object('slot_index', bat.slot_index, 'value_numeric', bat.value_numeric,
            'successes', bat.successes, 'opportunities', bat.opportunities, 'rubric_level_id', bat.rubric_level_id, 'valid', bat.valid)
            order by bat.slot_index)
          from public.benchmark_attempts bat where bat.participant_id = bp.id and bat.superseded_at is null
        ), '[]'::jsonb)
      ) as obj
    from public.benchmark_participants bp
    join public.benchmark_assessments a on a.id = bp.assessment_id
    where bp.player_id = p_player_id and not bp.is_team_subject
      and a.team_id = p_team_id and a.state in ('finalized', 'recording')
  )
  select jsonb_build_object(
    'player_id', p_player_id,
    'benchmarks', coalesce(jsonb_agg(jsonb_build_object(
      'benchmark', jsonb_build_object('id', b.id, 'title', b.title, 'subject_mode', b.subject_mode),
      'versions', (
        select coalesce(jsonb_agg(public._benchmark_version_json(bv.id) order by bv.version_number desc), '[]'::jsonb)
        from public.benchmark_versions bv where bv.benchmark_id = b.id
      ),
      'observations', coalesce((
        select jsonb_agg(o.obj order by o.measured_at) from obs o where o.benchmark_id = b.id
      ), '[]'::jsonb)
    ) order by b.title), '[]'::jsonb)
  ) into v_result
  from player_benchmarks pb
  join public.benchmarks b on b.id = pb.id;
  return v_result;
end;
$$;

-- Shared shapers (SECURITY DEFINER context inherited from the callers above).
create function public._benchmark_version_json(p_version_id uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', bv.id, 'version_number', bv.version_number, 'metric_type', bv.metric_type, 'direction', bv.direction,
    'result_rule', bv.result_rule, 'scored_attempts', bv.scored_attempts, 'opportunities_per_set', bv.opportunities_per_set,
    'rubric_levels', bv.rubric_levels, 'score_min', bv.score_min, 'score_max', bv.score_max, 'score_increment', bv.score_increment,
    'display_unit', bv.display_unit, 'instructions', bv.instructions, 'title_snapshot', bv.title_snapshot,
    'tag_snapshot', bv.tag_snapshot)
  from public.benchmark_versions bv where bv.id = p_version_id;
$$;

create function public._benchmark_assessment_json(p_assessment_id uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', a.id, 'protocol_version_id', a.protocol_version_id, 'label', a.label,
    'measured_at', a.measured_at, 'measured_local_date', a.measured_local_date, 'timezone', a.timezone,
    'state', a.state, 'under_correction', a.under_correction,
    'excluded_from_comparisons', a.excluded_from_comparisons, 'excluded_reason', a.excluded_reason,
    'conditions_note', a.conditions_note, 'practice_id', a.practice_id, 'live_session_id', a.live_session_id,
    'finalized_at', a.finalized_at,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', bp.id, 'player_id', bp.player_id, 'is_team_subject', bp.is_team_subject,
        'name', bp.player_name_snapshot, 'jersey', bp.jersey_snapshot, 'status', bp.status,
        'participating_player_ids', bp.participating_player_ids, 'player_count', bp.player_count,
        'attempts', coalesce((
          select jsonb_agg(jsonb_build_object('slot_index', bat.slot_index, 'value_numeric', bat.value_numeric,
            'successes', bat.successes, 'opportunities', bat.opportunities, 'rubric_level_id', bat.rubric_level_id, 'valid', bat.valid)
            order by bat.slot_index)
          from public.benchmark_attempts bat where bat.participant_id = bp.id and bat.superseded_at is null
        ), '[]'::jsonb)
      ) order by bp.is_team_subject desc, bp.player_name_snapshot)
      from public.benchmark_participants bp where bp.assessment_id = a.id
    ), '[]'::jsonb)
  )
  from public.benchmark_assessments a where a.id = p_assessment_id;
$$;

grant execute on function public.get_team_benchmark_report(uuid, uuid, integer, timestamptz) to authenticated;
grant execute on function public.get_player_benchmark_report(uuid, uuid) to authenticated;
revoke execute on function public._benchmark_version_json(uuid) from public;
revoke execute on function public._benchmark_assessment_json(uuid) from public;
