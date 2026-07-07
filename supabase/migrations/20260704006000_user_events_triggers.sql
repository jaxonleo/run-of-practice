-- auth.uid() inside a trigger correctly resolves to whoever performed the
-- triggering statement (same request context) -- used directly rather than
-- inferring the actor from the row's own columns, since e.g. an org-owned
-- team has no owner_user_id at all to fall back on.

create function public.log_team_created_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_events (user_id, event_type, entity_type, entity_id)
  values (auth.uid(), 'team_created', 'team', new.id);
  return new;
end;
$$;

create trigger on_team_created_log_event
  after insert on public.teams
  for each row execute function public.log_team_created_event();

create function public.log_practice_created_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_events (user_id, event_type, entity_type, entity_id)
  values (auth.uid(), 'practice_created', 'practice', new.id);
  return new;
end;
$$;

create trigger on_practice_created_log_event
  after insert on public.practices
  for each row execute function public.log_practice_created_event();

create function public.log_session_started_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_events (user_id, event_type, entity_type, entity_id)
  values (auth.uid(), 'session_start', 'practice_live_session', new.id);
  return new;
end;
$$;

create trigger on_session_started_log_event
  after insert on public.practice_live_sessions
  for each row execute function public.log_session_started_event();

-- Status transitions, not every update -- only fires when status actually
-- CHANGES to completed/abandoned, not on every pause/advance/version bump.
create function public.log_session_status_change_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.user_events (user_id, event_type, entity_type, entity_id)
    values (auth.uid(), 'session_completed', 'practice_live_session', new.id);
  elsif new.status = 'abandoned' and old.status is distinct from 'abandoned' then
    insert into public.user_events (user_id, event_type, entity_type, entity_id)
    values (auth.uid(), 'session_abandoned', 'practice_live_session', new.id);
  end if;
  return new;
end;
$$;

create trigger on_session_status_change_log_event
  after update on public.practice_live_sessions
  for each row execute function public.log_session_status_change_event();

-- helper_join has no natural INSERT to hook a trigger onto -- a helper
-- viewing a session doesn't create any row. Explicit function instead,
-- meant to be called once when a helper's view first loads, NOT on every
-- poll cycle -- that's a frontend responsibility to get right, not
-- something this function can enforce on its own.
create function public.log_helper_join_event(p_token uuid)
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

  insert into public.user_events (event_via_token_id, event_type, entity_type, entity_id)
  values (p_token, 'helper_join', 'session_access_token', p_token);

  return jsonb_build_object('success', true);
end;
$$;
