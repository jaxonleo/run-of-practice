-- Direct feedback: an assistant coach clicking "Run Practice" while the head
-- coach was already mid-setup for the same practice silently created a
-- SECOND live session and took control, displacing the head coach's screen
-- -- there was no server-side guard against two coaches racing to start the
-- same practice, since the client only checked "does an active session
-- exist" before creating one (a classic check-then-act race, not atomic).
--
-- This also lays the groundwork for "Practice Setup" becoming the real
-- first stage of an actual live session (rather than a separate token-based
-- screen): setup_confirmed_at is null the moment a session is created and
-- only gets set once a coach clicks "Start Practice" for real, so a second
-- coach reaching /run/:practiceId while setup is still in progress finds
-- and joins that same in-setup session instead of creating a competing one.

alter table public.practice_live_sessions add column setup_confirmed_at timestamptz;

-- Only one row per practice can be 'active' at a time -- status transitions
-- (completed/abandoned) already exist and are the only way out of this,
-- so a fresh "Run Now" on a practice whose prior run finished is
-- unaffected (that prior row is no longer 'active').
create unique index practice_live_sessions_one_active_per_practice
  on public.practice_live_sessions(practice_id) where status = 'active';

-- Atomic create-or-join: the insert's own unique-violation exception
-- handler is what actually closes the race (not the pre-check, which is
-- just an optimization to skip a doomed insert in the common case) --
-- two simultaneous callers can both pass the pre-check, but only one of
-- their inserts will ever succeed, and the loser's exception handler
-- re-selects and returns the winner's row instead of erroring out.
create or replace function public.start_or_join_live_session(p_practice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_row public.practice_live_sessions;
  v_created boolean := false;
  v_first_activity_id uuid;
  v_first_is_block boolean;
begin
  select team_id into v_team_id from public.practices where id = p_practice_id;
  if v_team_id is null or not public.can_coach_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  select * into v_row from public.practice_live_sessions
    where practice_id = p_practice_id and status = 'active'
    order by created_at desc limit 1;

  if not found then
    select pa.id, (pa.type = 'station_block') into v_first_activity_id, v_first_is_block
      from public.practice_activities pa
      where pa.practice_id = p_practice_id and pa.archived_at is null
      order by pa.position asc limit 1;

    begin
      insert into public.practice_live_sessions(
        practice_id, status, controller_user_id, version,
        current_practice_activity_id, current_rotation_number,
        in_transition, in_block_intro,
        current_phase_started_at, paused_at, total_paused_seconds
      ) values (
        p_practice_id, 'active', auth.uid(), 1,
        v_first_activity_id, 0,
        false, coalesce(v_first_is_block, false),
        now(), null, 0
      )
      returning * into v_row;
      v_created := true;
    exception when unique_violation then
      select * into v_row from public.practice_live_sessions
        where practice_id = p_practice_id and status = 'active'
        order by created_at desc limit 1;
      v_created := false;
    end;
  end if;

  return jsonb_build_object('session', to_jsonb(v_row), 'created', v_created);
end;
$function$;

grant execute on function public.start_or_join_live_session(uuid) to authenticated;
