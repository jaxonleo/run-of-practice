-- Enhancement 5, Practice Execution Scorecard: "Logged but not originally
-- captured" needs a real signal, not a guess. adjusted_by/adjusted_at alone
-- can't tell a row apart -- both a genuinely live-captured row that was
-- later corrected (adjust_session_activity) and a row that never existed
-- during the run at all (add_session_activity_row) end up with those two
-- columns set, since both RPCs stamp them the same way. A dedicated flag,
-- set only by add_session_activity_row's insert and never touched by
-- adjust_session_activity's update, is the only reliable way to make this
-- distinction rather than reporting a guessed classification as fact.
-- Existing rows default to false (historically correct for anything logged
-- live; any already-existing manually-added row from before this column
-- existed simply won't get the special badge -- an honest simplification,
-- not a wrong answer, and documented in BUILD-STATUS).
alter table public.session_activity_log add column manually_added boolean not null default false;

create or replace function public.add_session_activity_row(
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
    (session_id, practice_activity_id, station_id, started_at, ended_at, logged_by, adjusted_by, adjusted_at, manually_added)
  values
    (p_session_id, p_practice_activity_id, p_station_id, p_started_at, p_ended_at, auth.uid(), auth.uid(), now(), true)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.add_session_activity_row(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;
