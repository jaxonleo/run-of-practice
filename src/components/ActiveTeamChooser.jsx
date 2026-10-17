import { useState } from "react";
import { catalogCopy } from "../upsellCatalog.js";
import { setActivePersonalTeam } from "../supabase.js";
import { logUpsellEvent, upsellCtasVisible } from "../entitlements.js";
import { defaultActiveTeamId } from "../teamPlan.js";

// Packaging Phase E (catalog T4): the blocking active-team chooser shown
// before Home after a downgrade leaves a coach on Free with more than one
// active personal team and no chosen team. Same full-screen pattern as the
// deactivated-account ReactivatePrompt. Nothing is deleted: the other
// teams stay fully viewable, just paused for planning, scheduling, and
// starting new live runs. Default selection: the team with the next
// scheduled practice, then the oldest. The first pick can be corrected once
// without waiting (set_active_personal_team), and once billing is on the
// chooser also offers Pro, which keeps every team active.
export default function ActiveTeamChooser({ teams, practices, onChosen, onExit, onUpgrade }) {
  const [selected, setSelected] = useState(() => defaultActiveTeamId(teams, practices));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choose = async () => {
    if (!selected) return;
    setBusy(true); setError("");
    const { error: err } = await setActivePersonalTeam(selected);
    setBusy(false);
    if (err) { setError("Couldn't save your choice. Try again."); return; }
    logUpsellEvent("limit_hit", "T4", { teamId: selected, featureKey: "teams.personal_count" });
    onChosen();
  };
  return (<div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--ink)", padding: "24px 16px" }}>
    <div style={{ width: 80, height: 80, borderRadius: 18, overflow: "hidden", marginBottom: 18, boxShadow: "0 8px 32px rgba(0,0,0,.4)" }}>
      <img src="/apple-touch-icon.png" style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="Run of Practice" />
    </div>
    <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 24, fontWeight: 900, color: "#fff", textAlign: "center", marginBottom: 8 }}>Pick your active team</div>
    <div style={{ fontSize: 14, color: "var(--text-dim)", textAlign: "center", lineHeight: 1.5, marginBottom: 20, maxWidth: 360 }}>{catalogCopy("T4", "head")}</div>
    <div role="radiogroup" aria-label="Active team" style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
      {teams.map(t => (<button key={t.id} type="button" role="radio" aria-checked={selected === t.id} onClick={() => setSelected(t.id)}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 10, cursor: "pointer", textAlign: "left",
          background: selected === t.id ? "var(--field)" : "rgba(255,255,255,.06)", border: "1px solid " + (selected === t.id ? "var(--field)" : "rgba(255,255,255,.18)"), color: "#fff" }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: t.colorPrimary || "var(--text-dim)", flexShrink: 0 }} />
        <span style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{t.name}</span>
        <span style={{ fontSize: 12, opacity: .8 }}>{t.sport}</span>
      </button>))}
    </div>
    {error && <div style={{ fontSize: 13, color: "var(--danger)", marginBottom: 10 }}>{error}</div>}
    <button className="btn primary bmd bfull" style={{ maxWidth: 360, marginBottom: 10 }} onClick={choose} disabled={busy || !selected}>{busy ? "Saving..." : "Choose Team"}</button>
    {onUpgrade && upsellCtasVisible() && <button className="btn outline bmd bfull" style={{ maxWidth: 360, marginBottom: 10, color: "#fff", background: "transparent", borderColor: "rgba(255,255,255,.5)" }}
      onClick={() => { logUpsellEvent("cta_click", "T4", { featureKey: "teams.personal_count" }); onUpgrade(); }} disabled={busy}>Keep every team with Pro</button>}
    <button className="btn ghost bmd bfull" style={{ maxWidth: 360, color: "#fff", background: "transparent", borderColor: "rgba(255,255,255,.25)" }} onClick={onExit} disabled={busy}>Sign Out</button>
  </div>);
}
