-- A single present/absent tap during Practice Setup shouldn't be able to
-- silently lose a race against another coach's own tap landing at the same
-- moment. writeSession's normal version-checked read-modify-write (fine
-- for almost everything else in this app, where only one coach is ever
-- really driving) is the wrong tool for exactly this one case: two real
-- coaches, each computing their own "add/remove one id from the array I
-- last saw" patch from their own possibly-a-beat-stale local session
-- state, is a genuine two-writer race, not the single-client double-tap
-- writeQueueRef already handles. A version conflict there doesn't merge
-- the two edits -- it silently discards whichever write lost, which is
-- exactly the "why didn't the other coach's screen update" symptom this
-- was built to fix, not just leave slower.
--
-- toggle_setup_presence sidesteps the whole read-modify-write shape: one
-- atomic UPDATE, add-or-remove decided from the row's own current value at
-- write time under Postgres' normal row-level locking, so two concurrent
-- toggles of two different ids can never clobber each other regardless of
-- which local session snapshot either client started from. Bulk actions
-- (Mark All Present / Clear All) still go through the normal
-- writeSession/version-checked path -- rarer, deliberate, whole-array
-- replacements where "the loser just re-taps" is an acceptable, visible
-- fallback, unlike a single silently-dropped tap.
create or replace function public.toggle_setup_presence(p_session_id uuid, p_kind text, p_target_id uuid)
returns public.practice_live_sessions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_row public.practice_live_sessions;
begin
  select p.team_id into v_team_id
  from public.practice_live_sessions pls
  join public.practices p on p.id = pls.practice_id
  where pls.id = p_session_id;

  if v_team_id is null or not public.can_coach_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  if p_kind = 'player' then
    update public.practice_live_sessions
      set setup_present_player_ids = case
            when p_target_id = any(setup_present_player_ids) then array_remove(setup_present_player_ids, p_target_id)
            else array_append(setup_present_player_ids, p_target_id)
          end,
          version = version + 1
      where id = p_session_id
      returning * into v_row;
  elsif p_kind = 'coach' then
    update public.practice_live_sessions
      set setup_present_coach_ids = case
            when p_target_id = any(setup_present_coach_ids) then array_remove(setup_present_coach_ids, p_target_id)
            else array_append(setup_present_coach_ids, p_target_id)
          end,
          version = version + 1
      where id = p_session_id
      returning * into v_row;
  else
    raise exception 'invalid kind: %', p_kind;
  end if;

  if v_row.id is null then
    raise exception 'session not found';
  end if;

  return v_row;
end;
$function$;

grant execute on function public.toggle_setup_presence(uuid,text,uuid) to authenticated;
