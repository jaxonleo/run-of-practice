// Entitlement architecture, Phase 4 (UX states): the "Locked" presentation
// (Run_of_Practice_Entitlement_Architecture_Handoff.md State 2 -- explain
// what the feature does, why it's valuable, and that it belongs to a
// higher plan, not just a dead end). Deliberately a small inline notice,
// not a modal or full-screen upsell -- it's meant to drop into an
// existing error/status slot a screen already has (ModalLayer.jsx's
// saveError, PermissionsModal.jsx's error) rather than trigger a redesign
// of the surrounding UI. Colors reuse the existing --field (brand green)
// tokens, not a new palette entry -- this is a positive "here's how to get
// this" prompt, not a warning/danger state, so it deliberately doesn't
// reuse --danger the way a real error does.
export function EntitlementLockedMessage({ message, ctaHref = "/pricing", ctaLabel = "See plans" }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 6,
      background: "var(--field-tint)", border: "1px solid var(--field-tint-border)",
      borderRadius: 8, padding: "10px 12px", fontSize: 13, lineHeight: 1.45,
    }}>
      <span style={{ color: "var(--text-muted)" }}>{message}</span>
      <a href={ctaHref} target="_blank" rel="noopener noreferrer" style={{ color: "var(--field)", fontWeight: 700, alignSelf: "flex-start" }}>
        {ctaLabel} &rarr;
      </a>
    </div>
  );
}
