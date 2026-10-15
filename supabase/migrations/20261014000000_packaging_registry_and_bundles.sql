-- Free / Pro / Organization packaging, Phase A part 1 of 4 (ROP Free Pro
-- Organization Packaging handoff, 2026-10-14): feature registry, bundle
-- values, Pro+ retirement, the Club / Club + Development org bundles, and
-- the founding_coach cohort bundle.
--
-- Nothing observable changes for any real coach: every user subject still
-- resolves through a cohort that grants every feature at full/unlimited
-- (the cohort reassignment itself is part 2, 20261014000100), and both org
-- bundles keep everything a live org can do today.
--
-- Key reuse (handoff "step zero"). Three registry keys from 2026-09-18
-- already mean exactly what a new handoff key means, and none of them is
-- read by any RPC, policy, or screen yet, so they are reused under their
-- existing names rather than duplicated:
--   handoff teams.owned_active        -> existing teams.personal_count
--   handoff library.templates         -> existing library.personal_templates
--   handoff history.visible_sessions  -> existing history.practice_history
-- Every other handoff key that already exists (goals.access,
-- delegation.practice_planning, library.personal_drills, teams.assistants,
-- benchmarks.history) keeps its name. Legacy keys the handoff does not
-- mention (goals.insights_depth, live.concurrent_sessions,
-- native.live_activities) are left untouched.

-- 1. Bundle retirement support. Bundles are never deleted (live plan,
-- cohort, and historical rows reference them by FK); retired_at marks one
-- as no longer assignable as a plan.
alter table public.entitlement_bundles add column retired_at timestamptz;

comment on column public.entitlement_bundles.retired_at is
  'Set when a bundle is retired from sale. admin_set_plan refuses a retired bundle and /admin/entitlements hides it from the plan picker. Never delete a bundle.';

-- 2. Registry: new keys.
insert into public.features
  (feature_key, display_name, category, description, upgrade_copy, default_state, preview_supported, hideable, limit_type)
values
  ('library.drill_insights', 'Drill Insights', 'Library',
    'Per-drill usage and planned vs. actual run time (Library ellipsis menu).',
    null, 'locked', false, false, 'toggle'),
  ('library.suggested_sort', 'Suggested drill sort', 'Library',
    'Library sort option ordering drills by the team''s largest goal gaps.',
    null, 'locked', false, false, 'toggle'),
  ('goals.window_config', 'Goal window length', 'Goals & Insights',
    'Choosing the Target vs. Planned vs. Actual window (1 to 12 weeks). Locked means a fixed 4-week window; the stored teams.goals_window_weeks is kept for an upgrade.',
    null, 'locked', false, false, 'toggle'),
  ('goals.next_practice_guidance', 'Next Practice Guidance', 'Goals & Insights',
    'Every below-target category with library drills. Preview shows the top priority only.',
    null, 'preview', true, false, 'toggle'),
  ('goals.builder_projection', 'Builder goal projection', 'Goals & Insights',
    'Builder Goal Guidance draft mix and projected impact. Preview shows current priorities only.',
    null, 'preview', true, false, 'toggle'),
  ('goals.trends', 'Skill-Development Trends', 'Goals & Insights',
    'Week-by-week actual vs. goal charts per category.',
    null, 'preview', true, false, 'toggle'),
  ('goals.execution_scorecard', 'Practice Execution Scorecard', 'Goals & Insights',
    'How closely a completed practice followed its plan, drill by drill.',
    null, 'locked', false, false, 'toggle'),
  ('players.development_path', 'Player development path', 'Players',
    'Achieved-focus history per player. Registered only; not built yet, nothing renders.',
    null, 'hidden', false, true, 'toggle'),
  ('benchmarks.access', 'Benchmarks', 'Benchmarks & Performance History',
    'Creating, adopting, and recording benchmarks. Existing results stay readable without it.',
    null, 'locked', true, false, 'toggle'),
  ('org.teams', 'Contracted organization teams', 'Organizations',
    'Contracted team count for an organization. Null = uncapped; set per org through an admin override. Enforcement allows a 10% grace margin, rounded up.',
    null, 'full', false, false, 'count'),
  ('org.development_suite', 'Club development suite', 'Organizations',
    'Org-wide benchmark library, development standards, and cross-team reporting (roadmap).',
    null, 'locked', false, true, 'toggle');

-- Reused keys: refresh their descriptions to the handoff semantics.
update public.features set
  display_name = 'Active personal teams',
  description = 'Non-archived personal teams (organization_id is null) the coach owns. Org teams never count. (Handoff key teams.owned_active.)'
where feature_key = 'teams.personal_count';
update public.features set
  description = 'Non-archived personal templates (organization_id is null) the coach owns. Org templates are uncapped. (Handoff key library.templates.)'
where feature_key = 'library.personal_templates';
update public.features set
  display_name = 'Browsable practice history',
  description = 'How many of a team''s most recent completed practices are browsable. A read cap only: older practices are hidden, never deleted, and every derived calculation still uses all data. (Handoff key history.visible_sessions.)'
where feature_key = 'history.practice_history';
update public.features set
  description = 'Assistant coaches per team, counting non-archived assistant_coach staff rows (excluding the owner) plus pending invites.'
where feature_key = 'teams.assistants';

-- 3. Org bundles. org_standard keeps its key (live org rows reference it)
-- and becomes "Club"; org_development is everything in Club plus the
-- development suite.
update public.entitlement_bundles
  set display_name = 'Club', description = 'Organization package: Pro on every club team, plus directors, Club Library, and central equipment. Org team count is contracted per org via an org.teams override.'
where bundle_key = 'org_standard';

insert into public.entitlement_bundles (bundle_key, display_name, is_plan, description) values
  ('org_development', 'Club + Development', true, 'Everything in Club, plus the org development suite (org-wide benchmark library, development standards, cross-team reporting).'),
  ('founding_coach', 'Founding Coach', false, 'Cohort-only. Every coach who signed up before the founding cutoff (entitlement_settings.founding_cohort_cutoff). Resolves every feature at full and unlimited. Post-launch terms not decided yet.');

-- 4. Bundle values for the free and pro plans (null limit = unlimited).
insert into public.bundle_features (bundle_key, feature_key, state, limit_value) values
  ('free', 'library.drill_insights', 'locked', null),
  ('free', 'library.suggested_sort', 'locked', null),
  ('free', 'goals.window_config', 'locked', null),
  ('free', 'goals.next_practice_guidance', 'preview', null),
  ('free', 'goals.builder_projection', 'preview', null),
  ('free', 'goals.trends', 'preview', null),
  ('free', 'goals.execution_scorecard', 'locked', null),
  ('free', 'players.development_path', 'locked', null),
  ('free', 'benchmarks.access', 'locked', null),
  ('free', 'benchmarks.history', 'locked', null),
  ('free', 'org.development_suite', 'locked', null),

  ('pro', 'library.drill_insights', 'full', null),
  ('pro', 'library.suggested_sort', 'full', null),
  ('pro', 'goals.window_config', 'full', null),
  ('pro', 'goals.next_practice_guidance', 'full', null),
  ('pro', 'goals.builder_projection', 'full', null),
  ('pro', 'goals.trends', 'full', null),
  ('pro', 'goals.execution_scorecard', 'full', null),
  ('pro', 'players.development_path', 'full', null),
  ('pro', 'benchmarks.access', 'full', null),
  ('pro', 'benchmarks.history', 'full', null),
  ('pro', 'org.development_suite', 'locked', null);

-- Changed values on existing free/pro rows.
update public.bundle_features set limit_value = 2
  where bundle_key = 'free' and feature_key = 'library.personal_templates';      -- was 3
update public.bundle_features set state = 'full', limit_value = null
  where bundle_key = 'free' and feature_key = 'goals.access';                    -- was locked
update public.bundle_features set state = 'full', limit_value = null
  where bundle_key = 'free' and feature_key = 'library.full_catalog';            -- full Public Library on every plan
update public.bundle_features set state = 'full', limit_value = null
  where bundle_key = 'pro' and feature_key = 'delegation.practice_planning';     -- Pro+ folded into Pro

-- 5. Every all-access bundle (both org bundles, founding_coach, and the
-- now-unassigned early_access_all_access kept for history) carries an
-- explicit full/unlimited row for every registry key that it does not
-- already have. resolve_entitlement falls through a cohort to the plan
-- when the cohort bundle has no row for a key, so a missing row here would
-- silently drop a founding coach to Free on that key.
insert into public.bundle_features (bundle_key, feature_key, state, limit_value)
select b.bundle_key, f.feature_key, 'full', null
from public.entitlement_bundles b
cross join public.features f
where b.bundle_key in ('org_standard', 'org_development', 'founding_coach', 'early_access_all_access')
on conflict (bundle_key, feature_key) do nothing;

-- The development suite is the one thing Club does not include.
update public.bundle_features set state = 'locked'
  where bundle_key = 'org_standard' and feature_key = 'org.development_suite';

-- 6. Retire pro_plus. Move any subject on it to pro first (expected 0 on
-- production), then mark it retired. Its bundle_features rows stay as a
-- historical record.
do $$
declare
  v_plan_rows integer;
  v_cohort_rows integer;
begin
  update public.entitlement_plan_state
    set plan_bundle_key = 'pro', updated_at = now()
    where plan_bundle_key = 'pro_plus';
  get diagnostics v_plan_rows = row_count;

  update public.entitlement_cohort_assignments
    set cohort_bundle_key = 'pro'
    where cohort_bundle_key = 'pro_plus';
  get diagnostics v_cohort_rows = row_count;

  raise notice 'pro_plus retirement: moved % plan_state row(s) and % cohort row(s) to pro', v_plan_rows, v_cohort_rows;
end;
$$;

update public.entitlement_bundles
  set retired_at = now(), display_name = 'Pro+ (retired)',
      description = 'Retired 2026-10-14; folded into Pro. Kept for history only.'
where bundle_key = 'pro_plus';

-- 7. admin_set_plan refuses a retired bundle (and a cohort-only bundle,
-- which was never meant to be a plan). Same signature, same is_admin()
-- re-check as before.
create or replace function public.admin_set_plan(
  p_subject_type text,
  p_user_id uuid,
  p_organization_id uuid,
  p_bundle_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_subject_type not in ('user', 'organization') then
    raise exception 'invalid subject_type';
  end if;
  if not exists (
    select 1 from public.entitlement_bundles b
    where b.bundle_key = p_bundle_key and b.is_plan and b.retired_at is null
  ) then
    raise exception 'bundle % is retired or is not a plan', p_bundle_key;
  end if;

  if p_subject_type = 'user' then
    insert into public.entitlement_plan_state (subject_type, user_id, plan_bundle_key, updated_at)
    values ('user', p_user_id, p_bundle_key, now())
    on conflict (user_id) where subject_type = 'user'
    do update set plan_bundle_key = excluded.plan_bundle_key, updated_at = now();
  else
    insert into public.entitlement_plan_state (subject_type, organization_id, plan_bundle_key, updated_at)
    values ('organization', p_organization_id, p_bundle_key, now())
    on conflict (organization_id) where subject_type = 'organization'
    do update set plan_bundle_key = excluded.plan_bundle_key, updated_at = now();
  end if;
end;
$$;

revoke all on function public.admin_set_plan(text, uuid, uuid, text) from public;
grant execute on function public.admin_set_plan(text, uuid, uuid, text) to authenticated;
