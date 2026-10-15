import { useEffect } from "react";
import { UPSELL_CATALOG, catalogCopy, catalogCta } from "../upsellCatalog.js";
import { upsellCtasVisible, logUpsellEvent } from "../entitlements.js";

// Entitlement UX components. Phase 4 of the entitlement architecture
// (2026-09-18) added EntitlementLockedMessage as a small inline notice that
// drops into an existing error/status slot; the packaging handoff
// (2026-10-14, Phase C) moved it onto catalog IDs (upsellCatalog.js) with
// role variants, and added UsageMeter, ProBadge, and ProPreview. All of
// them use the soft --field-tint green, never --danger red: these are
// "here's how to get this" prompts, not errors.
//
// Never render any of these on CommandScreen (any stage), PreviewView,
// HelperView, BenchmarkRecordView, or any anonymous route.

const boxStyle = {
  display: "flex", flexDirection: "column", gap: 8,
  background: "var(--field-tint)", border: "1px solid var(--field-tint-border)",
  borderRadius: 8, padding: "10px 12px", fontSize: 13, lineHeight: 1.45,
};

function Actions({ catalogId, role, teamId, onSecondary, secondaryLabel }) {
  const entry = UPSELL_CATALOG[catalogId];
  const cta = upsellCtasVisible() ? catalogCta(catalogId, role) : null;
  const showCta = cta && !(role === "assistant" && entry && entry.assistantCta === false);
  const secondary = onSecondary ? (secondaryLabel || (entry && entry.secondary)) : null;
  if (!showCta && !secondary) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      {showCta && (
        <a href={cta.href} target={cta.href.startsWith("mailto:") ? undefined : "_blank"} rel="noopener noreferrer"
          onClick={() => logUpsellEvent("cta_click", catalogId, { teamId, featureKey: entry && entry.featureKey })}
          style={{ color: "var(--field)", fontWeight: 700 }}>
          {cta.label} &rarr;
        </a>
      )}
      {secondary && (
        <button type="button" className="btn ghost bxs" onClick={onSecondary}>{secondary}</button>
      )}
    </div>
  );
}

// A limit notice (or any catalog entry shown inline). Pass catalogId; the
// legacy `message` prop still works for any older call site.
// role: "head" for the team owner, "assistant" for anyone else (assistant
// copy, never pricing). Renders nothing when this role has no copy.
export function EntitlementLockedMessage({ catalogId, role = "head", tokens, teamId, onSecondary, secondaryLabel, message }) {
  const entry = catalogId ? UPSELL_CATALOG[catalogId] : null;
  // A limit always explains itself, even to a role the catalog has no copy
  // for (e.g. a non-owner head coach hitting the staff cap): fall back to
  // the owner's text. Actions still follow `role`, so no pricing shows.
  const text = catalogId
    ? (catalogCopy(catalogId, role, tokens) || (entry && entry.type === "limit" ? catalogCopy(catalogId, "head", tokens) : null))
    : message;
  useEffect(() => {
    if (catalogId && text) logUpsellEvent(entry && entry.type === "limit" ? "limit_hit" : "preview_view", catalogId, { teamId, featureKey: entry && entry.featureKey });
  }, [catalogId, text, teamId, entry]);
  if (!text) return null;
  return (
    <div style={boxStyle} role="status">
      <span style={{ color: "var(--text-muted)" }}>{text}</span>
      {catalogId && <Actions catalogId={catalogId} role={role} teamId={teamId} onSecondary={onSecondary} secondaryLabel={secondaryLabel} />}
    </div>
  );
}

// "[n] of [limit]" with a thin bar that turns amber at 75% of the limit.
// label overrides the text (e.g. a catalog meter's filled copy).
export function UsageMeter({ used, limit, label, style }) {
  if (limit == null || limit <= 0) return null;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const warn = used / limit >= 0.75;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120, ...style }}>
      <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 600 }}>{label || `${used} of ${limit}`}</span>
      <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }} aria-hidden="true">
        <div style={{ width: pct + "%", height: "100%", background: warn ? "var(--caution)" : "var(--field)" }} />
      </div>
    </div>
  );
}

// Small pill on a menu item or option that is part of Pro.
export function ProBadge({ style }) {
  return (
    <span style={{
      display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
      color: "var(--field)", background: "var(--field-tint)", border: "1px solid var(--field-tint-border)",
      borderRadius: 10, padding: "1px 7px", marginLeft: 6, verticalAlign: "middle", ...style,
    }}>Pro</span>
  );
}

// A preview slot: the coach's own labels (children) plus the catalog copy
// and CTA. Previews always use real data from the caller, never invented
// numbers. Renders nothing for a role with no copy.
export function ProPreview({ catalogId, role = "head", tokens, teamId, children }) {
  const entry = UPSELL_CATALOG[catalogId];
  const text = catalogCopy(catalogId, role, tokens);
  useEffect(() => {
    if (text) logUpsellEvent("preview_view", catalogId, { teamId, featureKey: entry && entry.featureKey });
  }, [catalogId, text, teamId, entry]);
  if (!text) return null;
  return (
    <div style={boxStyle}>
      {children}
      <span style={{ color: "var(--text-muted)" }}>{text}<ProBadge /></span>
      <Actions catalogId={catalogId} role={role} teamId={teamId} />
    </div>
  );
}

// A dismissible Home card for a value moment (V1-V6, O1). Promotional, so
// it only ever renders when the caller has already checked the display
// gates and throttling (see ValueMomentSlot.jsx). The CTA logs a click;
// Dismiss is the caller's (it snoozes or retires the moment).
export function ValueMomentCard({ catalogId, tokens, teamId, onDismiss }) {
  const text = catalogCopy(catalogId, "head", tokens);
  if (!text) return null;
  return (
    <div className="card" style={{ ...boxStyle, padding: "12px 14px", gap: 10 }}>
      <span style={{ color: "var(--ink-soft)", fontSize: 13.5, lineHeight: 1.5 }}>{text}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Actions catalogId={catalogId} role="head" teamId={teamId} />
        <button type="button" className="btn ghost bxs" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}
