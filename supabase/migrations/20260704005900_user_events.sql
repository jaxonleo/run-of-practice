-- Deliberately loose typing on event_type (plain text, no CHECK enum) --
-- unlike every other status/scope column in this schema. Analytics event
-- types are exactly the kind of thing that should evolve as usage is
-- observed; requiring a migration per new event type would defeat the
-- purpose.
--
-- entity_type + entity_id is a polymorphic reference (team, practice,
-- practice_live_session, ...) -- deliberately NOT a real foreign key,
-- since a single column can't reference five different tables at once.
-- This is a standard, accepted tradeoff for event/audit tables
-- specifically, not a general pattern used elsewhere in this schema.
--
-- Actor identity follows the same exactly-one pattern as
-- session_attendance: a real user, or an anonymous token, never neither,
-- never both.
create table public.user_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  event_via_token_id uuid references public.session_access_tokens(id),
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint user_events_actor_xor check (
    (user_id is not null and event_via_token_id is null)
    or (user_id is null and event_via_token_id is not null)
  )
);

create index user_events_type_created_idx on public.user_events (event_type, created_at);
create index user_events_entity_idx on public.user_events (entity_type, entity_id);

-- RLS enabled with ZERO policies defined, deliberately -- this defaults to
-- deny for every non-superuser role, including authenticated. Coaches
-- never read this table through the app; the only way anyone sees this
-- data is querying directly via the dashboard (which connects as
-- postgres/service_role, bypassing RLS entirely, as always). No grants to
-- authenticated or anon on this table either -- every write happens via
-- SECURITY DEFINER triggers/functions below, which bypass both RLS and
-- table grants by running as their owner, not the calling role.
alter table public.user_events enable row level security;
