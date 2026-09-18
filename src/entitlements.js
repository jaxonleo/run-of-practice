// Entitlements client (Run_of_Practice_Entitlement_Architecture_Handoff.md,
// 2026-09-18). Replaces the July/August pricing-brief scaffolding
// (PLAN_LIMITS/ACTION_LIMITS/can(user, action, resourceContext)) entirely --
// this file no longer carries a second copy of plan/feature logic that
// could silently drift out of sync with the database. Every actual
// decision is resolved server-side by resolve_entitlement()
// (supabase/migrations/20260918000400_entitlement_resolution_functions.sql);
// this file is just a thin, cached reader of get_my_entitlements()'s result.
//
// Not wired into any screen yet, on purpose -- this is Phase 2 of the
// handoff's own sequencing (schema + resolution engine). Phase 3 wires a
// few representative real features through useEntitlements()/can() below;
// until then this stays real, callable, and unused, same as the scaffolding
// it replaces was for its first two months.

import { useEffect, useState, useCallback } from "react";
import { fetchMyEntitlements } from "./supabase.js";

// Global product/marketing copy-display state -- what the pricing page
// says, not per-subject entitlement data. Unrelated to the resolution
// engine above; PricingPage.jsx is still the only consumer. Kept exactly
// as-is from the original scaffolding (values reflect the real current
// state, not aspirational ones -- see that file's own comment).
export const FEATURE_FLAGS = {
  EARLY_ACCESS_ACTIVE: true,
  PRICING_PAGE_PUBLIC: false, // not linked from nav/landing yet, still under review
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
