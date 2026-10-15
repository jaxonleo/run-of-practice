import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { adminListPartners, adminDecidePartner } from "../supabase.js";

// Partner program admin (/admin/partners, 2026-10-15). Approving gives a
// partner one free quarter of Pro (3 months); nothing renews on its own.
// When a partner's quarter is within 14 days of ending, they move to the
// top under "Renewal due" (and Home shows the admin a prompt) so each
// quarter is a deliberate decision: renew for another quarter, or end it
// (the current quarter still runs out; nothing is taken away early).
// Someone approved before they have an account gets their first quarter
// automatically when they sign up with the same email.

const fmtDate = v => v ? new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

function Section({ title, children }) {
  return (<div style={{ marginBottom: 18 }}>
    <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--ink-soft)", marginBottom: 8 }}>{title}</div>
    {children}
  </div>);
}

function PartnerCard({ p, onAct }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    await onAct(p.id, action, note.trim() || null);
    setBusy(false);
    setNote("");
  };
  const actions = p.status === "pending"
    ? [["approve", "Approve (first free quarter)", "primary"], ["decline", "Decline", "ghost"]]
    : p.status === "approved"
      ? [["renew", "Approve next quarter", "primary"], ["end", "End partnership", "ghost"]]
      : [];
  return (<div className="card" style={{ padding: 14, marginBottom: 10, borderColor: p.renewal_due ? "var(--caution)" : undefined }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
          <a href={"mailto:" + p.email} style={{ color: "var(--field)" }}>{p.email}</a>
          {p.sport ? " · " + p.sport : ""}{p.team_level ? " · " + p.team_level : ""}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", textAlign: "right" }}>
        Applied {fmtDate(p.created_at)}
        {!p.has_account && <div style={{ color: "var(--caution)" }}>No account yet</div>}
      </div>
    </div>
    {p.message && <div style={{ fontSize: 13, marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{p.message}</div>}
    {p.status === "approved" && <div style={{ fontSize: 12.5, marginTop: 8, color: p.renewal_due ? "var(--caution)" : "var(--text-muted)" }}>
      {p.latest_end
        ? `Quarter ${p.quarters} ${new Date(p.latest_end) < new Date() ? "ended" : "ends"} ${fmtDate(p.latest_end)}`
        : "Approved; first quarter starts when they sign up"}
    </div>}
    {p.admin_note && <div style={{ fontSize: 12, marginTop: 4, color: "var(--text-dim)" }}>Note: {p.admin_note}</div>}
    {actions.length > 0 && <>
      <input className="inp" style={{ marginTop: 10 }} placeholder="Note (optional, e.g. what feedback earned this quarter)" value={note} onChange={e => setNote(e.target.value)} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {actions.map(([action, label, style]) => (
          <button key={action} className={"btn bsm " + style} disabled={busy}
            onClick={() => act(action, action === "end" ? `End ${p.name}'s partnership? Their current quarter still runs out.` : action === "decline" ? `Decline ${p.name}'s application?` : null)}>
            {label}
          </button>
        ))}
      </div>
    </>}
  </div>);
}

export default function AdminPartnersScreen() {
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => adminListPartners().then(setList), []);
  useEffect(() => { refresh(); }, [refresh]);

  const onAct = async (id, action, note) => {
    setError("");
    const { error: err } = await adminDecidePartner(id, action, note);
    if (err) setError(err.message || "That didn't work. Try again.");
    await refresh();
  };

  const due = (list || []).filter(p => p.renewal_due);
  const pending = (list || []).filter(p => p.status === "pending");
  const active = (list || []).filter(p => p.status === "approved" && !p.renewal_due);
  const past = (list || []).filter(p => p.status === "declined" || p.status === "ended");

  return (<div style={{ height: "100dvh", overflowY: "auto", maxWidth: 640, margin: "0 auto", padding: "16px 14px 40px", boxSizing: "border-box" }}>
    <button className="btn ghost bxs" onClick={() => navigate(-1)}>Back</button>
    <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontWeight: 900, fontSize: 22, margin: "10px 0 4px" }}>Partner Program</div>
    <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 16 }}>Approving gives one free quarter of Pro. Each further quarter is your call: partners due for renewal show at the top two weeks before their quarter ends.</div>
    {error && <div style={{ fontSize: 13, color: "var(--danger)", marginBottom: 10 }}>{error}</div>}
    {!list && <div style={{ color: "var(--text-dim)" }}>Loading...</div>}
    {list && list.length === 0 && <div style={{ color: "var(--text-dim)", fontSize: 13 }}>No applications yet. The public page is at /partners.</div>}
    {due.length > 0 && <Section title={`Renewal due (${due.length})`}>{due.map(p => <PartnerCard key={p.id} p={p} onAct={onAct} />)}</Section>}
    {pending.length > 0 && <Section title={`New applications (${pending.length})`}>{pending.map(p => <PartnerCard key={p.id} p={p} onAct={onAct} />)}</Section>}
    {active.length > 0 && <Section title={`Active partners (${active.length})`}>{active.map(p => <PartnerCard key={p.id} p={p} onAct={onAct} />)}</Section>}
    {past.length > 0 && <Section title="Past">{past.map(p => <PartnerCard key={p.id} p={p} onAct={onAct} />)}</Section>}
  </div>);
}
