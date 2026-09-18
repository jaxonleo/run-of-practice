-- Entitlement architecture, part 1 of 6: the feature registry.
--
-- Replaces the July/August pricing-brief scaffolding (user_entitlements,
-- src/entitlements.js's PLAN_LIMITS/can()) with a real, data-driven
-- entitlement system per Run_of_Practice_Entitlement_Architecture_Handoff.md.
-- That prior work was deliberately inert (BILLING_ENABLED stayed false) and
-- never wired to anything -- this replaces it outright rather than adapting
-- it in place, since the only caller (PricingPage.jsx) reads FEATURE_FLAGS
-- only, never PLAN_LIMITS/can(), and the one real user base today is small
-- enough that a clean cutover (see part 3) is safe and clearly better than
-- carrying the old shape forward.
--
-- A feature is a stable, gateable capability with its own identifier and
-- display metadata, independent of which plan/bundle currently includes it
-- (handoff §1 -- "benchmarks.history should exist independently of whether
-- it currently belongs to Free, Pro, or another package"). Assigning a
-- feature to a bundle is a separate table (bundle_features, part 2) --
-- this table never mentions a plan by name.
create table public.features (
  feature_key text primary key,
  display_name text not null,
  category text not null,
  description text,
  upgrade_copy text,
  -- The presentation state used when no bundle/cohort/override says
  -- otherwise (see resolve_entitlement, part 5). Lets a genuinely
  -- undecided feature (e.g. a future native-only capability) exist in the
  -- registry today without having to backfill every current bundle with an
  -- opinion about it -- exactly the handoff's "do not invent limits yet
  -- unless needed to establish the architecture" instruction.
  default_state text not null default 'hidden'
    check (default_state in ('full', 'preview', 'locked', 'hidden')),
  preview_supported boolean not null default false,
  hideable boolean not null default true,
  -- 'toggle': access is on/off, no numeric cap (limit_value is always null
  -- for this feature everywhere). 'count': access is capped by a number
  -- (null limit_value on a bundle_features row means uncapped on that
  -- bundle specifically), matching PLAN_LIMITS' existing boolean-vs-null-
  -- capped-number split one-for-one.
  limit_type text not null default 'toggle' check (limit_type in ('toggle', 'count')),
  created_at timestamptz not null default now()
);

comment on table public.features is
  'The complete registry of gateable capabilities, independent of plan/bundle assignment. See bundle_features for what each plan/cohort actually includes.';

alter table public.features enable row level security;

-- Read-only, any signed-in user -- the client needs this to render
-- upgrade/locked copy for a feature it doesn't have. No insert/update/
-- delete grant for authenticated: registry changes ship as migrations for
-- now (an admin-editable-copy RPC is a reasonable future addition, not
-- needed for this phase).
create policy "features_select_authenticated" on public.features
  for select using (true);

grant select on public.features to authenticated;
grant select, insert, update, delete on public.features to service_role;

-- Seed: the ten currently-packaged capabilities, ported 1:1 from
-- src/entitlements.js's PLAN_LIMITS/ACTION_LIMITS (see part 3 for the
-- historical mapping), plus two illustrative registry-only entries proving
-- the registry works independently of any bundle assignment -- exactly
-- the handoff's own worked example (benchmarks.history) and a genuinely
-- undecided future one (native.live_activities), neither of which gets a
-- bundle_features row anywhere; both resolve via default_state alone.
insert into public.features
  (feature_key, display_name, category, description, upgrade_copy, default_state, preview_supported, hideable, limit_type)
values
  ('teams.personal_count', 'Personal teams', 'Teams & roster',
    'How many active personal teams a coach can run at once.',
    'Upgrade to run more teams at the same time.', 'locked', false, false, 'count'),
  ('teams.assistants', 'Assistant coaches per team', 'Teams & roster',
    'How many assistant coaches can be added to one team.',
    'Upgrade to add more assistant coaches.', 'locked', false, false, 'count'),
  ('library.personal_drills', 'Personal drill library size', 'Library',
    'How many personal (non-catalog) drills a coach can save.',
    'Upgrade to save unlimited drills.', 'locked', false, false, 'count'),
  ('library.personal_templates', 'Saved templates', 'Library',
    'How many practice templates a coach can save.',
    'Upgrade to save unlimited templates.', 'locked', false, false, 'count'),
  ('library.full_catalog', 'Full drill library', 'Library',
    'Access to the complete public drill catalog, not a limited preview.',
    'Upgrade for full library access.', 'locked', true, false, 'toggle'),
  ('history.practice_history', 'Practice history depth', 'Planning & scheduling',
    'How many completed practices remain visible in history.',
    'Upgrade to see your entire practice history.', 'locked', false, false, 'count'),
  ('goals.access', 'Goals & Insights', 'Goals & Insights',
    'Access to the Goals & Insights tab at all (independent of the per-team can_build_practices role check).',
    'Upgrade to set goals and track insights.', 'locked', true, true, 'toggle'),
  ('goals.insights_depth', 'Insights depth', 'Goals & Insights',
    'Deeper analytics within Goals & Insights, beyond the basic view.',
    'Upgrade for deeper practice insights.', 'locked', true, false, 'toggle'),
  ('live.concurrent_sessions', 'Concurrent live practices', 'Live sessions',
    'How many practices this account can run live at the same time.',
    'Upgrade to run more practices live at once.', 'locked', false, false, 'count'),
  ('delegation.practice_planning', 'Delegated practice planning', 'Planning & scheduling',
    'How many assistants per team can be granted can_build_practices (write access to plan practices/stations).',
    'Upgrade to delegate practice planning to your assistants.', 'locked', false, false, 'count'),
  -- Registry-only, no bundle_features rows anywhere (see part 2): resolves
  -- via default_state on every subject until a real packaging decision is
  -- made and bundle rows are added.
  ('benchmarks.history', 'Benchmark history', 'Benchmarks & Performance History',
    'Historical benchmark results and comparisons.',
    null, 'full', false, false, 'toggle'),
  ('native.live_activities', 'iPhone Live Activities', 'Future Native Capabilities',
    'Lock Screen / Dynamic Island live practice display (not built yet).',
    null, 'hidden', false, true, 'toggle');
