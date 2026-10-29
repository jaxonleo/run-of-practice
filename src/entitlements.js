// Entitlements client (Run_of_Practice_Entitlement_Architecture_Handoff.md,
// 2026-09-18). Replaces the July/August pricing-brief scaffolding
// (PLAN_LIMITS/ACTION_LIMITS/can(user, action, resourceContext)) entirely --
// this file no longer carries a second copy of plan/feature logic that
// could silently drift out of sync with the database. Every actual
// decision is resolved server-side by resolve_entitlement()
// (supabase/migrations/20260918000400_entitlement_resolution_functions.sql);
// this file is just a thin, cached reader of get_my_entitlements()'s result.
//
// Packaging Phase C (2026-10-14) added the team-scoped reader
// (useTeamEntitlements), the display gates (upsellCtasVisible), and
// analytics logging below; copy lives in upsellCatalog.js.

import { useEffect, useState, useCallback } from "react";
import { fetchMyEntitlements, fetchTeamEntitlements, logEntitlementEvent, SUPABASE_URL } from "./supabase.js";

// Global product/marketing copy-display state -- what the pricing page
// says, not per-subject entitlement data. Unrelated to the resolution
// engine above; PricingPage.jsx is still the only consumer. Kept exactly
// as-is from the original scaffolding (values reflect the real current
// state, not aspirational ones -- see that file's own comment).
export const FEATURE_FLAGS = {
  // Public-site launch switches (Jax, 2026-10-17: keep the early-access
  // site until billing launches). At launch, flip both together with
  // BILLING_ENABLED: EARLY_ACCESS_ACTIVE false swaps the landing page and
  // FAQs to the Free/Pro/partner copy and shows the Partners links;
  // PRICING_PAGE_PUBLIC true links /pricing and lets search engines index it.
  EARLY_ACCESS_ACTIVE: true,
  PRICING_PAGE_PUBLIC: false,
  BILLING_ENABLED: false,
  PRO_PREVIEW_ENABLED: false, // no 14-day-preview flow built yet
  EARLY_ACCESS_OFFER_ENABLED: false, // eligibility rule not decided yet
  ORGANIZATION_LEAD_FORM_ENABLED: false, // pricing page's Org CTA is a plain mailto for now
};

// Module-level cache + a tiny pub-sub, so every component calling
// useEntitlements() shares one RPC round trip per session instead of one
// per screen. Call clearEntitlementsCache() wherever the session itself
// resets (the same onAuthStateChange handler App.jsx already has for
// session state) -- not wired there yet, see the file comment above.
let _cache = null;
let _inflight = null;
const _subscribers = new Set();

function _notify() {
  for (const fn of _subscribers) fn(_cache);
}

export function clearEntitlementsCache() {
  _cache = null;
  _inflight = null;
  _notify();
  clearTeamEntitlementsCache();
}

async function _load(force) {
  if (_cache && !force) return _cache;
  if (_inflight && !force) return _inflight;
  _inflight = fetchMyEntitlements().then((result) => {
    _cache = result || {};
    _inflight = null;
    _notify();
    return _cache;
  });
  return _inflight;
}

// `entitlements` is the exact shape get_my_entitlements() returns --
// { [featureKey]: { state, limit_value, source } } -- no client-side
// reshaping, so a UI component and a support engineer reading the raw RPC
// response are looking at the same thing.
export function useEntitlements(signedIn) {
  const [entitlements, setEntitlements] = useState(_cache);

  useEffect(() => {
    _subscribers.add(setEntitlements);
    return () => _subscribers.delete(setEntitlements);
  }, []);

  useEffect(() => {
    if (signedIn) _load(false);
    else clearEntitlementsCache();
  }, [signedIn]);

  const refresh = useCallback(() => _load(true), []);

  return { entitlements, loading: !!signedIn && !entitlements, refresh };
}

// Synchronous reader for a one-off check outside a render (an event
// handler, a non-component helper) -- pass the map from useEntitlements()
// explicitly rather than relying on the module cache when you have it.
// 'preview' counts as accessible, same convention as the server's
// can_access_feature(): a preview state means "let them in, at reduced
// capability," not "block them."
export function can(featureKey, entitlementsMap = _cache) {
  const entry = entitlementsMap && entitlementsMap[featureKey];
  if (!entry) return { allowed: false, state: "hidden", limitValue: null, source: "unresolved" };
  return {
    allowed: entry.state === "full" || entry.state === "preview",
    state: entry.state,
    limitValue: entry.limit_value,
    source: entry.source,
  };
}

// ── Team-scoped entitlements (packaging Phase C, 2026-10-14) ───────────────
// Features resolve from the team's owning subject (the owner for a personal
// team, the org for an org team), never the viewer, so an assistant on a Pro
// coach's team sees Pro there. useEntitlements() above stays for
// user-scoped caps (teams owned, drills, templates). Cached per team for the
// session; refreshTeamEntitlements() after any plan change.
const _teamCache = new Map();     // teamId -> map
const _teamInflight = new Map();  // teamId -> promise
const _teamSubscribers = new Set();

export function clearTeamEntitlementsCache() {
  _teamCache.clear();
  _teamInflight.clear();
  for (const fn of _teamSubscribers) fn();
}

function _loadTeam(teamId, force) {
  if (!teamId) return Promise.resolve(null);
  if (!force && _teamCache.has(teamId)) return Promise.resolve(_teamCache.get(teamId));
  if (!force && _teamInflight.has(teamId)) return _teamInflight.get(teamId);
  const p = fetchTeamEntitlements(teamId).then((result) => {
    _teamInflight.delete(teamId);
    if (result) _teamCache.set(teamId, result);
    for (const fn of _teamSubscribers) fn();
    return result;
  });
  _teamInflight.set(teamId, p);
  return p;
}

export function refreshTeamEntitlements(teamId) {
  return _loadTeam(teamId, true);
}

export function useTeamEntitlements(teamId) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    _teamSubscribers.add(fn);
    return () => _teamSubscribers.delete(fn);
  }, []);
  useEffect(() => { if (teamId) _loadTeam(teamId, false); }, [teamId]);
  const entitlements = teamId ? _teamCache.get(teamId) || null : null;
  const refresh = useCallback(() => _loadTeam(teamId, true), [teamId]);
  return { entitlements, loading: !!teamId && !entitlements, refresh };
}

// Count-cap helper for UX pre-checks. Fails open: an unresolved map or a
// null limit means "allowed", matching canCreatePersonalDrill(); the server
// is what actually refuses.
export function underLimit(featureKey, currentCount, entitlementsMap) {
  const entry = entitlementsMap && entitlementsMap[featureKey];
  if (!entry) return true;
  if (entry.state === "locked" || entry.state === "hidden") return false;
  if (entry.limit_value == null) return true;
  return currentCount < entry.limit_value;
}
export function limitOf(featureKey, entitlementsMap) {
  const entry = entitlementsMap && entitlementsMap[featureKey];
  return entry && entry.state !== "locked" && entry.state !== "hidden" ? entry.limit_value : 0;
}
// Fails open: an unresolved map counts as full, so nothing renders as
// locked while loading or on a transport error.
export function isFull(featureKey, entitlementsMap) {
  const entry = entitlementsMap && entitlementsMap[featureKey];
  return !entry || entry.state === "full";
}

// ── Display gates ───────────────────────────────────────────────────────────
// Limit notices and previews always show (they are functional); pricing
// CTAs and value moments only show once billing is on, or in this browser
// when an admin turned on the QA preview toggle on /admin/entitlements.
const PREVIEW_KEY = "rop.upsellPreview";
export function upsellPreviewEnabled() {
  try { return localStorage.getItem(PREVIEW_KEY) === "1"; } catch { return false; }
}
export function setUpsellPreviewEnabled(on) {
  try { if (on) localStorage.setItem(PREVIEW_KEY, "1"); else localStorage.removeItem(PREVIEW_KEY); } catch { /* storage blocked */ }
}
// Staging (and Vercel previews and local dev, which all point at the
// staging Supabase project and Stripe test mode) always shows upgrade CTAs,
// so the real purchase flow can be tried there before launch (Jax,
// 2026-10-29). Keyed off the Supabase project the build talks to, not the
// hostname: production also answers on a vercel.app address. Production
// still waits for BILLING_ENABLED.
const STAGING_PROJECT_REF = "vgryzeokdxgthpjezqns";
export function isTestEnvironmentUrl(supabaseUrl) {
  try { return new URL(supabaseUrl).hostname === STAGING_PROJECT_REF + ".supabase.co"; } catch { return false; }
}
function onTestEnvironment() {
  return isTestEnvironmentUrl(SUPABASE_URL);
}
// Launch-version legal pages: live once early access ends, and shown on
// staging/local before that (marked as a draft) so they can be reviewed.
export function launchLegalVisible() {
  return !FEATURE_FLAGS.EARLY_ACCESS_ACTIVE || onTestEnvironment();
}
export function upsellCtasVisible() {
  return FEATURE_FLAGS.BILLING_ENABLED || upsellPreviewEnabled() || onTestEnvironment();
}

// ── Analytics (entitlement_events) ──────────────────────────────────────────
// App.jsx sets the signed-in user once; components then log by catalog ID
// without threading a user id through every screen. Logged at most once per
// (event, catalog, team) per page load for impressions, so a re-render
// never inflates counts; clicks and dismissals always log.
let _analyticsUserId = null;
const _loggedImpressions = new Set();
export function setEntitlementAnalyticsUser(userId) {
  _analyticsUserId = userId || null;
  _loggedImpressions.clear();
}
export function logUpsellEvent(event, catalogId, { teamId, featureKey } = {}) {
  if (!_analyticsUserId) return;
  if (event === "limit_hit" || event === "preview_view" || event === "moment_shown") {
    const key = event + "|" + catalogId + "|" + (teamId || "");
    if (_loggedImpressions.has(key)) return;
    _loggedImpressions.add(key);
  }
  logEntitlementEvent({ userId: _analyticsUserId, teamId, event, catalogId, featureKey });
}
