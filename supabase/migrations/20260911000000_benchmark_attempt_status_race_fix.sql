-- _benchmark_apply_attempt: fix a real race that let a participant's saved
-- attempts disagree with their completion status (audit: "Saved attempts can
-- disagree with completion status" -- two attempts saved seconds apart via
-- normal tab/type entry left status stuck on 'partial' even though both
-- slots were Saved and the provisional result was already complete).
--
-- Root cause: two concurrent calls for the SAME participant but DIFFERENT
-- slots (e.g. attempt 1 and attempt 2, saved via rapid tab navigation) each
-- insert into benchmark_attempts (no shared lock -- different rows), then
-- each independently calls _benchmark_participant_completeness and UPDATEs
-- benchmark_participants.status. Under READ COMMITTED, when the second
-- UPDATE blocks on the first's row lock and then proceeds after the first
-- commits, Postgres re-evaluates the row being updated against its latest
-- version, but per-statement snapshot rules for OTHER tables read inside
-- that same statement (here, the count(*) over benchmark_attempts inside
-- the stable completeness function) are not guaranteed to reflect the
-- just-committed sibling attempt -- see "Read Committed Isolation Level" in
-- the Postgres docs: a re-checked UPDATE sees the concurrently-updated row's
-- new version, but other table reads in the same query keep the original
-- snapshot. The second call can therefore compute completeness from a
-- stale count and permanently persist 'partial' even though both attempts
-- now exist.
--
-- Fix: take an explicit row lock on the participant BEFORE computing
-- completeness, as its own statement (not folded into the status UPDATE).
-- A concurrent call for the same participant now blocks on this lock
-- statement itself; once it is granted (after the other transaction
-- commits), the completeness count that follows is a brand-new statement
-- with a fresh snapshot, so it correctly sees every committed sibling
-- attempt. Different participants never share a lock, so unrelated
-- attempts are unaffected.
create or replace function public._benchmark_apply_attempt(
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

  -- Serialize the read-then-write completeness cycle per participant: block
  -- here (as its own statement) until any concurrent attempt save for this
  -- SAME participant (a different slot) has fully committed, so the count
  -- below always reflects every attempt saved so far, not a stale snapshot.
  perform 1 from public.benchmark_participants where id = p_participant_id for update;

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
