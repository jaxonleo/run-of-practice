-- Founder metrics needs goal_created/goal_viewed events (handoff §1.2,
-- §2 "Value delivered" -- goals adoption). Neither is currently logged:
-- team_goals has no insert trigger into user_events, unlike
-- teams/practices/practice_live_sessions.

create function public.log_goal_created_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_events (user_id, event_type, entity_type, entity_id)
  values (auth.uid(), 'goal_created', 'team_goal', new.id);
  return new;
end;
$$;

create trigger on_goal_created_log_event
  after insert on public.team_goals
  for each row execute function public.log_goal_created_event();

-- goal_viewed has no natural INSERT to hook a trigger onto, same situation
-- as helper_join (20260704006000_user_events_triggers.sql) -- explicit RPC
-- instead, meant to be called once when the Goals tab first loads for a
-- team, not on every re-render.
create function public.log_goal_viewed_event(p_team_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_access_team(p_team_id) then
    return jsonb_build_object('error', 'not_authorized');
  end if;

  insert into public.user_events (user_id, event_type, entity_type, entity_id)
  values (auth.uid(), 'goal_viewed', 'team', p_team_id);

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.log_goal_viewed_event(uuid) from public;
grant execute on function public.log_goal_viewed_event(uuid) to authenticated;
