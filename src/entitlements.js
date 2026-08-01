// ── Entitlements scaffolding (pricing/feature-gating brief, 2026-07-31) ─────
// Nothing in this file blocks anything yet. It exists so the pricing page
// and the eventual gate work (Phase 3 of the brief) share one definition of
// the plan structure instead of each screen inventing its own copy of the
// same numbers. Every can() call resolves to allowed:true today because
// BILLING_ENABLED is false -- see the state table in the brief's
// "Billing-state feature flags" section, which this mirrors directly.

// Reflects the real current state of the product, not aspirational values.
// Flip BILLING_ENABLED only once real plan enforcement + an upgrade path
// actually exist -- flipping it before then would start blocking the one
// real live coach with nothing on the other side of the wall to unblock them.
export const FEATURE_FLAGS = {
  EARLY_ACCESS_ACTIVE: true,
  PRICING_PAGE_PUBLIC: false, // not linked from nav/landing yet, still under review
  BILLING_ENABLED: false,
  PRO_PREVIEW_ENABLED: false, // no 14-day-preview flow built yet
  EARLY_ACCESS_OFFER_ENABLED: false, // eligibility rule not decided yet
  ORGANIZATION_LEAD_FORM_ENABLED: false, // pricing page's Org CTA is a plain mailto for now
};

// null = no plan-based cap. Organization limits aren't here at all -- they're
// governed by org agreement/org_staff, not this per-user config, per the
// brief's own entitlement matrix ("Organization team" column is "not
// applicable" or "based on organization agreement" throughout).
export const PLAN_LIMITS = {
  free: {
    activePersonalTeams: 1,
    assistants: 2,
    personalDrills: 20,
    personalTemplates: 3,
    visibleCompletedPractices: 10,
    fullDrillLibrary: false,
    goals: false,
    insights: false,
    concurrentLivePractices: 1,
    delegatedPlanningPerTeam: 0,
  },
  pro: {
    activePersonalTeams: 3,
    assistants: null,
    personalDrills: null,
    personalTemplates: null,
    visibleCompletedPractices: null,
    fullDrillLibrary: true,
    goals: true,
    insights: true,
    concurrentLivePractices: 1,
    delegatedPlanningPerTeam: 0,
  },
  // Everything Pro has, plus delegating practice planning to one assistant
  // per team and running 2 concurrent live practices. Added per a follow-up
  // request (2026-08-01) after the original brief's launch structure
  // shipped with Free/Pro/Organizations only -- pricing-page content and
  // this config entry only, same inert-until-BILLING_ENABLED treatment as
  // every other plan here, not wired into any real gate yet.
  pro_plus: {
    activePersonalTeams: 3,
    assistants: null,
    personalDrills: null,
    personalTemplates: null,
    visibleCompletedPractices: null,
    fullDrillLibrary: true,
    goals: true,
    insights: true,
    concurrentLivePractices: 2,
    delegatedPlanningPerTeam: 1,
  },
};

// Maps an action to the PLAN_LIMITS key that governs it, and to the upgrade
// prompt catalog entry a denial should surface. Verbatim from the brief's
// "Structured denials" section.
const ACTION_LIMITS = {
  create_personal_team: { limitKey: "activePersonalTeams", upgradeKey: "personal_team_limit" },
  reactivate_personal_team: { limitKey: "activePersonalTeams", upgradeKey: "personal_team_limit" },
  add_assistant: { limitKey: "assistants", upgradeKey: "assistant_limit" },
  create_personal_drill: { limitKey: "personalDrills", upgradeKey: "personal_drill_limit" },
  reactivate_personal_drill: { limitKey: "personalDrills", upgradeKey: "personal_drill_limit" },
  save_personal_template: { limitKey: "personalTemplates", upgradeKey: "template_limit" },
  reactivate_personal_template: { limitKey: "personalTemplates", upgradeKey: "template_limit" },
  open_full_drill_library: { limitKey: "fullDrillLibrary", upgradeKey: "full_drill_library" },
  open_practice_history: { limitKey: "visibleCompletedPractices", upgradeKey: "history_limit" },
  create_or_edit_goals: { limitKey: "goals", upgradeKey: "season_goals" },
  view_insights: { limitKey: "insights", upgradeKey: "practice_insights" },
};

// Recommended conceptual API from the brief:
//   can(user, action, resourceContext): EntitlementDecision
// `user` is expected to carry a resolved plan, e.g. {planType: "free"|"pro"|"pro_plus"}
// (from a user_entitlements row -- see the migration). `resourceContext` may
// include `currentUsage` (a number, for count-based limits) and
// `resourceScope` ("personal" | "organization").
//
// Deliberately not called from anywhere yet. When a future session wires up
// real gates, this is where that logic should live -- not reimplemented
// per-screen -- but it stays inert (always allowed:true) until
// FEATURE_FLAGS.BILLING_ENABLED actually flips on.
export function can(user, action, resourceContext = {}) {
  const resourceScope = resourceContext.resourceScope || "personal";

  if (resourceScope === "organization") {
    // Organization resources are gated by org membership/role, not by the
    // caller's personal plan -- never conflate the two (brief: "Organization
    // membership must not silently grant Pro benefits to unrelated personal
    // teams", which cuts both ways).
    return { allowed: true, plan: "organization", resourceScope };
  }

  const plan = user && PLAN_LIMITS[user.planType] ? user.planType : "free";

  if (!FEATURE_FLAGS.BILLING_ENABLED || FEATURE_FLAGS.EARLY_ACCESS_ACTIVE) {
    return { allowed: true, reason: "early_access", plan, resourceScope };
  }

  const rule = ACTION_LIMITS[action];
  if (!rule) return { allowed: true, plan, resourceScope };

  const limit = PLAN_LIMITS[plan][rule.limitKey];

  // Boolean gates (fullDrillLibrary/goals/insights) rather than count limits.
  if (typeof limit === "boolean") {
    return limit
      ? { allowed: true, plan, resourceScope }
      : { allowed: false, upgradeKey: rule.upgradeKey, plan, resourceScope, limit: 0 };
  }

  if (limit === null) return { allowed: true, plan, resourceScope }; // uncapped on this plan

  const currentUsage = resourceContext.currentUsage || 0;
  return currentUsage < limit
    ? { allowed: true, plan, resourceScope, currentUsage, limit }
    : { allowed: false, upgradeKey: rule.upgradeKey, plan, resourceScope, currentUsage, limit };
}
