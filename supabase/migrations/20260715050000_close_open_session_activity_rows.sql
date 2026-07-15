-- Goals feature (ROP-Goals-TeamNav-Handoff.md §2.6, decision D3). Today
-- nothing closes a dangling session_activity_log row (ended_at stays null
-- forever) if a coach ends the practice without explicitly advancing past
-- the last activity. Confirmed against the live frontend (CommandScreen.jsx)
-- that the end-practice path always writes status='completed' together with
-- practice_live_sessions.ended_at in the same update, and that abandoned
-- sessions never transition to 'completed' at all (they're simply never
-- eligible for actuals per D2/§3.1 rule 8) -- so this trigger only needs to
-- fire on the transition into 'completed'.
create function public.close_open_session_activity_rows()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    update public.session_activity_log
      set ended_at = coalesce(new.ended_at, now())
      where session_id = new.id and ended_at is null;
  end if;
  return new;
end;
$$;

create trigger practice_live_sessions_close_open_rows
  after update on public.practice_live_sessions
  for each row execute function public.close_open_session_activity_rows();

-- One-time backfill for historical dangles that predate this trigger.
update public.session_activity_log sal
  set ended_at = pls.ended_at
  from public.practice_live_sessions pls
  where pls.id = sal.session_id
    and sal.ended_at is null
    and pls.ended_at is not null;
