// Upsell and locked-state copy catalog (Free / Pro / Organization packaging
// handoff, 2026-10-14). Every limit notice, meter, preview, and value
// moment reads its copy from here by catalog ID, so a copy change never
// touches screen code. Copy is the handoff's final draft, verbatim except
// for bracketed tokens, which fillTokens() replaces.
//
// head: what the team owner sees. assistant: what a non-owner coach on the
// same team sees (never pricing; null means assistants see nothing).
// cta: the pricing call to action (hidden while billing is off, see
// upsellCtasVisible). secondary: a functional, non-promotional action label
// a call site may wire up (it shows whenever the call site passes a handler).
// featureKey ties a catalog entry to the server's ENTITLEMENT_* error codes.

export const UPSELL_CATALOG = {
  T1: { type: "limit", featureKey: "teams.personal_count",
    head: "Coaching more than one team? Free covers one team. Pro gives each of your teams its own schedule, roster, and goals.",
    assistant: null, cta: "See Pro", secondary: "Not now" },
  T2: { type: "limit", featureKey: "teams.assistants",
    head: "Your staff is growing. Free teams include 2 coaches. Pro makes room for your whole staff. Parent helpers never need an account, so a helper link is always free.",
    assistant: null, cta: "See Pro", secondary: "Share a helper link" },
  T2a: { type: "limit", featureKey: "teams.assistants",
    head: null,
    assistant: "[Team] is full right now. Ask [head coach first name] to make room or upgrade, and your invite will still be here.",
    cta: null },
  T3: { type: "limit", featureKey: "teams.personal_count",
    head: "This team is paused. Free covers one active team. Upgrade to bring [Team] back, or switch your active team in 30 days.",
    assistant: "[Team] is paused on its current plan. You can still view everything here.",
    cta: "See Pro", secondary: "Switch active team" },
  T4: { type: "limit", featureKey: "teams.personal_count",
    head: "Your account is on Free, which covers one active team. Pick the team you're coaching now. Everything on your other teams is saved.",
    assistant: null, cta: null, secondary: "Choose team" },
  T5: { type: "limit", featureKey: "delegation.practice_planning",
    head: "Let [coach first name] plan practices and stations with you. Shared planning is part of Pro.",
    assistant: null, cta: "See Pro" },
  L1: { type: "meter", featureKey: "library.personal_drills",
    head: "[n] of 20 saved drills", assistant: "[n] of 20 saved drills", cta: null },
  L2: { type: "limit", featureKey: "library.personal_drills",
    head: "Your library is full. You can still add any Public Library drill to a practice without saving it. Pro keeps every drill you write.",
    assistant: "Your library is full. You can still add any Public Library drill to a practice without saving it. Pro keeps every drill you write.",
    cta: "See Pro", assistantCta: false },
  L3: { type: "limit", featureKey: "library.personal_templates",
    head: "Templates turn your best practice into a one-tap start. Free keeps 2. Pro keeps them all, or you can replace one of yours.",
    assistant: null, cta: "See Pro", secondary: "Replace a template" },
  L4: { type: "preview", featureKey: "library.drill_insights",
    head: "See how [drill name] actually runs: how often you use it, and whether it runs long or short against your plan.",
    assistant: null, cta: "See Pro" },
  L5: { type: "preview", featureKey: "library.suggested_sort",
    head: "Suggested sorts your drills by the goals your team is furthest behind on.",
    assistant: null, cta: "See Pro" },
  H1: { type: "meter", featureKey: "history.practice_history",
    head: "Showing your 10 most recent practices. [hidden_count] older practices are saved.",
    assistant: "Showing your 10 most recent practices. [hidden_count] older practices are saved.",
    cta: "Unlock full history", assistantCta: false },
  H2: { type: "limit", featureKey: "history.practice_history",
    head: "This practice is saved. Free shows your 10 most recent; Pro brings back every practice you've run.",
    assistant: "This practice is saved but outside the team's visible history.",
    cta: "See Pro" },
  H3: { type: "meter", featureKey: "history.practice_history",
    head: "[hidden_count] more notes about [player first name] are saved from earlier practices. Pro brings back their full history.",
    assistant: "[hidden_count] more notes about [player first name] are saved from earlier practices.",
    cta: "Unlock full history" },
  G1: { type: "preview", featureKey: "goals.window_config",
    head: "Measure over 8 or 12 weeks with Pro so one rained-out week doesn't skew the picture.",
    assistant: null, cta: "See Pro" },
  G2: { type: "preview", featureKey: "goals.next_practice_guidance",
    head: "[n] more categories are below target. Pro shows all of them, with drills from your library for each.",
    assistant: null, cta: "See Pro" },
  G3: { type: "preview", featureKey: "goals.builder_projection",
    head: "See how this plan moves each goal before you run it.",
    assistant: null, cta: "See Pro" },
  G4: { type: "preview", featureKey: "goals.trends",
    head: "Is [top category] time actually going up? Trends shows actual vs. goal week by week for [category 1], [category 2], and [n] more.",
    assistant: null, cta: "See Pro" },
  G5: { type: "preview", featureKey: "goals.execution_scorecard",
    head: "How closely did you run the plan? See which drills ran long, ran short, or got skipped.",
    assistant: null, cta: "See Pro" },
  B1: { type: "preview", featureKey: "benchmarks.access",
    head: "Measure it, don't guess. Set a repeatable test like a 60-ft sprint or free-throw percentage, record it at practice, and watch each player improve.",
    assistant: "Benchmarks are available when this team's head coach upgrades.",
    cta: "See Pro" },
  B2: { type: "preview", featureKey: "benchmarks.access",
    head: "Add a measured test to this practice and track every player's results over the season.",
    assistant: "Add a measured test to this practice and track every player's results over the season.",
    cta: "See Pro", assistantCta: false },
  P1: { type: "moment", featureKey: "players.development_path",
    head: "Replacing [old focus]? Pro saves it to [player first name]'s path as achieved, so you can see how far they've come.",
    assistant: null, cta: "See Pro", secondary: "Replace" },
  O1: { type: "moment", featureKey: null,
    head: "Running a club? Organization pricing is per team and gets cheaper as you grow.",
    assistant: null, cta: "Request a consultation", ctaHref: "mailto:contact@runofpractice.com" },
  O2: { type: "meter", featureKey: "org.teams",
    head: "[n] of [limit] contracted teams. You can add a few more this season; we'll true up at renewal.",
    assistant: null, cta: "Contact us", ctaHref: "mailto:contact@runofpractice.com" },
  V1: { type: "moment", featureKey: "goals.builder_projection",
    head: "Your first real read on practice time vs. your goals is in. Pro shows how each new plan moves those numbers before you run it.",
    assistant: null, cta: "See Pro" },
  V2: { type: "moment", featureKey: "history.practice_history",
    head: "That's 11 practices run with Run of Practice. Free shows your 10 most recent. Every older one is saved, and Pro brings them all back.",
    assistant: null, cta: "See Pro" },
  V3: { type: "moment", featureKey: "goals.next_practice_guidance",
    head: "You keep coming back to your top priority. Pro shows every category below target, with drills from your library for each.",
    assistant: null, cta: "See Pro" },
  V4: { type: "moment", featureKey: "goals.builder_projection",
    head: "[category] has been left out of your last two plans. Pro's Builder guidance shows the gap closing as you add drills.",
    assistant: null, cta: "See Pro" },
  V5: { type: "moment", featureKey: "goals.execution_scorecard",
    head: "Five practices run. See which drills actually ran long or short, and how closely each practice followed the plan.",
    assistant: null, cta: "See Pro" },
  V6: { type: "moment", featureKey: "goals.trends",
    head: "You've seen Trends on [other team]. Bring it to [own team] with Pro.",
    assistant: null, cta: "See Pro" },
};

export const PRICING_HREF = "/pricing";

// Replace [Token] placeholders. Unknown tokens are left as-is so a missing
// value is visible in QA rather than silently blank.
export function fillTokens(text, tokens = {}) {
  if (!text) return text;
  return text.replace(/\[([^\]]+)\]/g, (m, key) => (tokens[key] != null ? String(tokens[key]) : m));
}

// role: "head" (the team owner) or "assistant" (anyone else). Returns null
// when this role sees nothing for this entry.
export function catalogCopy(catalogId, role = "head", tokens = {}) {
  const entry = UPSELL_CATALOG[catalogId];
  if (!entry) return null;
  const text = role === "assistant" ? entry.assistant : entry.head;
  return text ? fillTokens(text, tokens) : null;
}

// Assistants never see pricing; some entries also hide the CTA for them.
export function catalogCta(catalogId, role = "head") {
  const entry = UPSELL_CATALOG[catalogId];
  if (!entry || !entry.cta) return null;
  if (role === "assistant") return null;
  return { label: entry.cta, href: entry.ctaHref || PRICING_HREF };
}

// Server refusals carry a stable code as the exception message:
// ENTITLEMENT_LIMIT:<feature_key> or ENTITLEMENT_LOCKED:<feature_key>, with
// {"limit", "current_count"} JSON in details. Never parse free text.
export function parseEntitlementError(error) {
  const msg = error && (error.message || (typeof error === "string" ? error : ""));
  const m = /^ENTITLEMENT_(LIMIT|LOCKED):([a-z0-9_.]+)$/.exec(msg || "");
  if (!m) return null;
  let detail;
  try { detail = error.details ? JSON.parse(error.details) : {}; } catch { detail = {}; }
  return {
    kind: m[1] === "LIMIT" ? "limit" : "locked",
    featureKey: m[2],
    limit: detail.limit ?? null,
    currentCount: detail.current_count ?? null,
  };
}

// Which catalog entry a refusal maps to, per call-site context. A context
// can override the default (e.g. an invite acceptance is T2a, not T2).
const DEFAULT_ID_BY_FEATURE = {
  "teams.personal_count": "T1",
  "teams.assistants": "T2",
  "delegation.practice_planning": "T5",
  "library.personal_drills": "L2",
  "library.personal_templates": "L3",
  "history.practice_history": "H2",
  "library.drill_insights": "L4",
  "goals.trends": "G4",
  "goals.execution_scorecard": "G5",
  "benchmarks.access": "B1",
  "org.teams": "O2",
};
export function catalogIdForError(error, overrides = {}) {
  const parsed = parseEntitlementError(error);
  if (!parsed) return null;
  return overrides[parsed.featureKey] || DEFAULT_ID_BY_FEATURE[parsed.featureKey] || null;
}
