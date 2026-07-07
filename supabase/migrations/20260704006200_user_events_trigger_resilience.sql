-- A failure inserting into user_events should never be able to block team/
-- practice/session creation -- that would mean a coach's ability to create
-- a team depends on an analytics side-table behaving perfectly, which is
-- backwards for a table whose entire purpose is "learn about usage, stay
-- out of the way." Standard pattern: catch any error in the logging
-- insert, downgrade it to a warning, and let the real operation proceed
-- regardless.

create or replace function public.log_team_created_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.user_events (user_id, event_type, entity_type, entity_id)
    values (auth.uid(), 'team_created', 'team', new.id);
  exception when others then
    raise warning 'user_events logging failed for team_created (team %): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.log_practice_created_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.user_events (user_id, event_type, entity_type, entity_id)
    values (auth.uid(), 'practice_created', 'practice', new.id);
  exception when others then
    raise warning 'user_events logging failed for practice_created (practice %): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.log_session_started_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.user_events (user_id, event_type, entity_type, entity_id)
    values (auth.uid(), 'session_start', 'practice_live_session', new.id);
  exception when others then
    raise warning 'user_events logging failed for session_start (session %): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.log_session_status_change_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.status = 'completed' and old.status is distinct from 'completed' then
      insert into public.user_events (user_id, event_type, entity_type, entity_id)
      values (auth.uid(), 'session_completed', 'practice_live_session', new.id);
    elsif new.status = 'abandoned' and old.status is distinct from 'abandoned' then
      insert into public.user_events (user_id, event_type, entity_type, entity_id)
      values (auth.uid(), 'session_abandoned', 'practice_live_session', new.id);
    end if;
  exception when others then
    raise warning 'user_events logging failed for session status change (session %): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- Not a trigger, so "don't block a bigger operation" doesn't directly
-- apply -- but the same principle about never leaking a raw, uncaught
-- Postgres exception to a public anon-facing endpoint does. Every other
-- anon function returns a clean JSON error; this one didn't, for the case
-- where the insert itself fails unexpectedly.
create or replace function public.log_helper_join_event(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_valid boolean;
begin
  select exists(
    select 1 from public.session_access_tokens
    where id = p_token and expires_at > now() and revoked_at is null
  ) into v_valid;

  if not v_valid then
    return jsonb_build_object('error', 'invalid_or_expired_token');
  end if;

  begin
    insert into public.user_events (event_via_token_id, event_type, entity_type, entity_id)
    values (p_token, 'helper_join', 'session_access_token', p_token);
    return jsonb_build_object('success', true);
  exception when others then
    return jsonb_build_object('error', 'logging_failed', 'detail', sqlerrm);
  end;
end;
$$;
