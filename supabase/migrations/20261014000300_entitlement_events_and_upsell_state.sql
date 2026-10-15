-- Free / Pro / Organization packaging, Phase A part 4 of 4: analytics
-- events and per-coach upsell display state. Both are inert until the
-- client UX phases (C/D) write to them, and nothing is shown while
-- BILLING_ENABLED is false.

-- 1. entitlement_events: insert-only analytics. A coach can insert their
-- own events (on a team they can access, or with no team); nobody but the
-- service role / founder-metrics RPCs reads them.
create table public.entitlement_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  event text not null check (event in ('limit_hit', 'preview_view', 'moment_shown', 'cta_click', 'dismiss')),
  catalog_id text,
  feature_key text,
  created_at timestamptz not null default now()
);

create index entitlement_events_created_at_idx on public.entitlement_events (created_at);
create index entitlement_events_user_idx on public.entitlement_events (user_id, created_at);

comment on table public.entitlement_events is
  'Insert-only upsell analytics (limit_hit, preview_view, moment_shown, cta_click, dismiss) keyed by upsellCatalog.js catalog_id. Read only via service role / admin RPCs.';

alter table public.entitlement_events enable row level security;
create policy "entitlement_events_insert_own" on public.entitlement_events
  for insert to authenticated with check (
    user_id = auth.uid()
    and (team_id is null or public.can_access_team(team_id))
  );
revoke all on public.entitlement_events from anon, authenticated;
grant insert on public.entitlement_events to authenticated;
grant select, insert, update, delete on public.entitlement_events to service_role;

-- 2. profiles.upsell_state: impressions, dismissals, and snoozes by catalog
-- ID, so value-moment throttling carries across devices (same idea as
-- dismissed_private_drill_warning). profiles has a table-wide own-row
-- UPDATE grant, so a guard trigger makes a narrow RPC (Phase D) the only
-- write path: the RPC sets rop.upsell_state_write for its transaction.
alter table public.profiles add column upsell_state jsonb not null default '{}'::jsonb;

create function public.guard_profiles_upsell_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.upsell_state is distinct from old.upsell_state
     and coalesce(current_setting('rop.upsell_state_write', true), '') <> 'on'
     and current_user in ('authenticated', 'anon') then
    raise exception 'profiles.upsell_state is written through its RPC only';
  end if;
  return new;
end;
$$;

create trigger guard_profiles_upsell_state
  before update of upsell_state on public.profiles
  for each row execute function public.guard_profiles_upsell_state();
