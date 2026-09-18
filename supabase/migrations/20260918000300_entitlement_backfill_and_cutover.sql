-- Entitlement architecture, part 4 of 6: backfill and cutover.
--
-- Every current profile and organization already got a default row from
-- the two new triggers (part 3) at the moment this migration's own INSERTs
-- into profiles/organizations... no -- those triggers only fire on INSERT,
-- and every existing profile/organization was inserted long before this
-- migration ran, so nothing has fired for them yet. This migration backfills
-- both explicitly, then retires the old scaffolding outright.
--
-- Clean cutover, not expand/contract: the only reader of the old
-- user_entitlements table was src/entitlements.js's now-deleted can()/
-- PLAN_LIMITS (never actually called from the app -- confirmed via repo-wide
-- grep before writing this), and the real user base today is small and
-- entirely covered by the early_access_all_access cohort regardless of
-- which table backs it. Carrying the old table forward as a "just in case"
-- would only reintroduce the exact two-sources-of-truth risk this whole
-- migration exists to remove.

-- Backfill: every existing profile's real plan_type carries forward
-- unchanged (free/pro/pro_plus all exist as bundle_keys already, part 2 --
-- a 1:1 rename, not a remapping), and every existing profile gets the
-- early_access_all_access cohort explicitly, replacing the global
-- FEATURE_FLAGS.EARLY_ACCESS_ACTIVE boolean with a real per-user record.
insert into public.entitlement_plan_state
  (subject_type, user_id, plan_bundle_key, billing_status, trial_started_at, trial_ends_at,
   early_access_eligible, early_access_offer_redeemed)
select 'user', ue.user_id, ue.plan_type, ue.billing_status, ue.trial_started_at, ue.trial_ends_at,
   ue.early_access_eligible, ue.early_access_offer_redeemed
from public.user_entitlements ue
on conflict (user_id) where subject_type = 'user' do update set
  plan_bundle_key = excluded.plan_bundle_key,
  billing_status = excluded.billing_status,
  trial_started_at = excluded.trial_started_at,
  trial_ends_at = excluded.trial_ends_at,
  early_access_eligible = excluded.early_access_eligible,
  early_access_offer_redeemed = excluded.early_access_offer_redeemed;

-- Any profile that somehow predates user_entitlements entirely (shouldn't
-- exist -- that table backfilled 100% of profiles on 2026-07-31 -- but this
-- keeps the invariant "every profile has a plan_state row" true regardless).
insert into public.entitlement_plan_state (subject_type, user_id, plan_bundle_key)
select 'user', p.id, 'free' from public.profiles p
on conflict (user_id) where subject_type = 'user' do nothing;

insert into public.entitlement_cohort_assignments (subject_type, user_id, cohort_bundle_key, assigned_reason)
select 'user', id, 'early_access_all_access', 'legacy_early_access_migration'
from public.profiles
on conflict (user_id) where subject_type = 'user' do nothing;

-- Every existing organization gets the standard org bundle -- matches
-- src/entitlements.js's can() organization short-circuit exactly (always
-- allowed:true), just as a real row instead of a code branch.
insert into public.entitlement_plan_state (subject_type, organization_id, plan_bundle_key)
select 'organization', id, 'org_standard' from public.organizations
on conflict (organization_id) where subject_type = 'organization' do nothing;

-- Retire the old scaffolding. Order matters: trigger before function
-- before table.
drop trigger if exists on_profile_created_entitlements on public.profiles;
drop function if exists public.handle_new_profile_entitlements();
drop table public.user_entitlements;
