-- Real bug found live testing with two real coaches: player present/absent
-- toggles and coach-presence during Practice Setup (the pre-live "attend"
-- stage) were pure client-side useState in PracticeSetupScreen -- never
-- written anywhere, so a second coach's screen never saw them, and a
-- coach's own "I'm here" default (seeded from team.coaches locally) never
-- reflected on anyone else's screen either. Modeled as two plain array
-- columns on the session row itself, not the append-only session_attendance
-- table (that one is the real historical record, meant for the final
-- committed snapshot submitted once "Run Practice" is tapped -- these two
-- are just an ephemeral in-progress draft, irrelevant the moment the
-- practice actually starts). Living on practice_live_sessions means every
-- toggle rides the exact same sync machinery every other live-session field
-- already uses (writeSession's version-checked queue, the realtime
-- subscription, the reconcile poll) -- no new sync code needed at all,
-- just new columns to sync.
alter table public.practice_live_sessions
  add column setup_present_player_ids uuid[] not null default '{}'::uuid[],
  add column setup_present_coach_ids uuid[] not null default '{}'::uuid[];

-- start_or_join_live_session, extended:
-- - On create: default setup_present_player_ids to the whole roster minus
--   anyone with a planned absence for this practice (same default the
--   client used to compute locally, moved server-side so it's a single
--   source of truth from the first moment the row exists), and mark the
--   creating coach present as a coach immediately.
-- - On join (setup not yet confirmed): add the joining coach to
--   setup_present_coach_ids if they're not in it yet -- "a coach lands on
--   Setup and is marked present by default" now actually persists and
--   syncs, instead of being local-only state nobody else ever saw. Never
--   touches player ids on join (only the creating coach's default applies;
--   a later joiner shouldn't silently re-mark someone who was toggled out).
-- - Once setup is confirmed (session is live), joining never touches either
--   array -- they stop being "draft" state the moment the practice starts.
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
  v_my_staff_id uuid;
  v_default_present uuid[];
begin
  select team_id into v_team_id from public.practices where id = p_practice_id;
  if v_team_id is null or not public.can_coach_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  select id into v_my_staff_id from public.team_staff
    where team_id = v_team_id and user_id = auth.uid() and archived_at is null
    limit 1;

  select * into v_row from public.practice_live_sessions
    where practice_id = p_practice_id and status = 'active'
    order by created_at desc limit 1;

  if not found then
    select pa.id, (pa.type = 'station_block') into v_first_activity_id, v_first_is_block
      from public.practice_activities pa
      where pa.practice_id = p_practice_id and pa.archived_at is null
      order by pa.position asc limit 1;

    select coalesce(array_agg(p.id), '{}'::uuid[]) into v_default_present
      from public.players p
      where p.team_id = v_team_id and p.archived_at is null
        and not exists (
          select 1 from public.planned_absences pab
          where pab.practice_id = p_practice_id and pab.player_id = p.id
        );

    begin
      insert into public.practice_live_sessions(
        practice_id, status, controller_user_id, version,
        current_practice_activity_id, current_rotation_number,
        in_transition, in_block_intro,
        current_phase_started_at, paused_at, total_paused_seconds,
        setup_present_player_ids, setup_present_coach_ids
      ) values (
        p_practice_id, 'active', auth.uid(), 1,
        v_first_activity_id, 0,
        false, coalesce(v_first_is_block, false),
        now(), null, 0,
        v_default_present, case when v_my_staff_id is not null then array[v_my_staff_id] else '{}'::uuid[] end
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

  if not v_created and v_row.setup_confirmed_at is null and v_my_staff_id is not null
     and not (v_my_staff_id = any(v_row.setup_present_coach_ids)) then
    update public.practice_live_sessions
      set setup_present_coach_ids = array_append(setup_present_coach_ids, v_my_staff_id),
          version = version + 1
      where id = v_row.id
      returning * into v_row;
  end if;

  return jsonb_build_object('session', to_jsonb(v_row), 'created', v_created);
end;
$function$;
