-- _benchmark_assessment_json: add practice_name and source_kind so two
-- same-day assessments can be told apart without opening and comparing
-- their averages (audit: "Same-day assessments are hard to distinguish" --
-- a station and a standalone assessment on the same date both rendered as
-- just that date in the comparison picker and history, with Measure Again's
-- own .label the only thing that ever helped). This is the one shared
-- shaper every reporting RPC already reuses (get_team_benchmark_report,
-- get_player_benchmark_report), so every caller picks this up for free with
-- no separate change per surface.
--
-- practice_name: the linked practice's own name, when it has one (practices
-- are frequently unnamed -- callers already fall back to the date/label they
-- show today when this is null).
-- source_kind: 'station' | 'practice_activity' | 'standalone', derived from
-- benchmark_assessment_sources rather than guessed from practice_id alone,
-- since a shared station occurrence carries several source rows across
-- rotations -- any one of them having a station_id is enough to call the
-- whole assessment station-sourced.
create or replace function public._benchmark_assessment_json(p_assessment_id uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', a.id, 'protocol_version_id', a.protocol_version_id, 'label', a.label,
    'measured_at', a.measured_at, 'measured_local_date', a.measured_local_date, 'timezone', a.timezone,
    'state', a.state, 'under_correction', a.under_correction,
    'excluded_from_comparisons', a.excluded_from_comparisons, 'excluded_reason', a.excluded_reason,
    'conditions_note', a.conditions_note, 'practice_id', a.practice_id, 'live_session_id', a.live_session_id,
    'finalized_at', a.finalized_at,
    'practice_name', (select p.name from public.practices p where p.id = a.practice_id),
    'source_kind', (
      select case
        when bool_or(s.station_id is not null) then 'station'
        when bool_or(s.practice_activity_id is not null) then 'practice_activity'
        else 'standalone'
      end
      from public.benchmark_assessment_sources s where s.assessment_id = a.id
    ),
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
