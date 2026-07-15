-- Goals feature (ROP-Goals-TeamNav-Handoff.md §3.3-3.5). Post-hoc history
-- editing: exclude a test-run session from actuals, adjust an activity's
-- logged timing, or add a row for an activity that was never advanced to
-- (e.g. a scrimmage the coach forgot to tap into). All three are security
-- definer with the permission check as the first real statement, matching
-- this file's own established RPC pattern (create_practice_series). Each
-- writes to a table whose normal RLS insert/update policy is scoped to an
-- *active* session (session_activity_log_insert_coach/update_coach,
-- practice_live_sessions has no exclusion-column update policy at all) --
-- these functions deliberately bypass that via security definer, since
-- post-hoc editing of completed-session history is the entire point and
-- widening the base RLS policies would also open live-session mutation
-- paths that should stay narrower.

create function public.set_session_exclusion(p_session_id uuid, p_excluded boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid;
begin
  select p.team_id into v_team_id
  from public.practice_live_sessions pls
  join public.practices p on p.id = pls.practice_id
  where pls.id = p_session_id;

  if v_team_id is null then
    raise exception 'session not found';
  end if;
  if not public.can_manage_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  update public.practice_live_sessions
    set excluded_at = case when p_excluded then now() else null end,
        excluded_by = case when p_excluded then auth.uid() else null end
    where id = p_session_id;
end;
$$;

grant execute on function public.set_session_exclusion(uuid, boolean) to authenticated;

-- Sane-bounds window is anchored on the session's created_at (the closest
-- thing this schema has to a session "started_at" -- practice_live_sessions
-- has no separate start-time column). Generous on both sides: the
-- "kept running the last drill until I got home 2 hours later" case means a
-- coach will typically be *shortening* an absurd ended_at, but the window
-- allows room either direction rather than assuming which way an edit goes.
create function public.adjust_session_activity(p_log_id uuid, p_started_at timestamptz, p_ended_at timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid;
  v_session_created_at timestamptz;
begin
  select p.team_id, pls.created_at into v_team_id, v_session_created_at
  from public.session_activity_log sal
  join public.practice_live_sessions pls on pls.id = sal.session_id
  join public.practices p on p.id = pls.practice_id
  where sal.id = p_log_id;

  if v_team_id is null then
    raise exception 'log row not found';
  end if;
  if not public.can_manage_team(v_team_id) then
    raise exception 'not authorized';
  end if;
  if p_ended_at <= p_started_at then
    raise exception 'ended_at must be after started_at';
  end if;
  if p_started_at < v_session_created_at - interval '1 hour'
     or p_ended_at > v_session_created_at + interval '12 hours' then
    raise exception 'timing is outside plausible bounds for this session';
  end if;

  update public.session_activity_log
    set started_at = p_started_at, ended_at = p_ended_at,
        adjusted_by = auth.uid(), adjusted_at = now()
    where id = p_log_id;
end;
$$;

grant execute on function public.adjust_session_activity(uuid, timestamptz, timestamptz) to authenticated;

-- For the "never advanced the phone to scrimmage" case -- there's no log
-- row for the activity at all, so adjustment alone can't fix it. Mirrors
-- session_activity_log_exactly_one_target's own check constraint before
-- insert (fail with a clear message instead of letting the DB constraint
-- reject it blind) and verifies the target actually belongs to this
-- session's practice, since neither practice_activity_id nor station_id
-- alone guarantees that.
create function public.add_session_activity_row(
  p_session_id uuid,
  p_practice_activity_id uuid,
  p_station_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid;
  v_practice_id uuid;
  v_new_id uuid;
begin
  select p.team_id, p.id into v_team_id, v_practice_id
  from public.practice_live_sessions pls
  join public.practices p on p.id = pls.practice_id
  where pls.id = p_session_id;

  if v_team_id is null then
    raise exception 'session not found';
  end if;
  if not public.can_manage_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  if (p_practice_activity_id is null) = (p_station_id is null) then
    raise exception 'exactly one of practice_activity_id or station_id is required';
  end if;
  if p_ended_at is null then
    raise exception 'ended_at is required';
  end if;
  if p_ended_at <= p_started_at then
    raise exception 'ended_at must be after started_at';
  end if;

  if p_practice_activity_id is not null then
    if not exists (
      select 1 from public.practice_activities
      where id = p_practice_activity_id and practice_id = v_practice_id
    ) then
      raise exception 'practice_activity does not belong to this session''s practice';
    end if;
  else
    if not exists (
      select 1 from public.stations stn
      join public.station_blocks sb on sb.id = stn.station_block_id
      join public.practice_activities pa on pa.id = sb.practice_activity_id
      where stn.id = p_station_id and pa.practice_id = v_practice_id
    ) then
      raise exception 'station does not belong to this session''s practice';
    end if;
  end if;

  insert into public.session_activity_log
    (session_id, practice_activity_id, station_id, started_at, ended_at, logged_by, adjusted_by, adjusted_at)
  values
    (p_session_id, p_practice_activity_id, p_station_id, p_started_at, p_ended_at, auth.uid(), auth.uid(), now())
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.add_session_activity_row(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;
