import { useEffect, useState, useCallback } from "react";
import { adminGetBilling, adminBilling, adminGrantProTime, adminRevokeProGrant } from "../supabase.js";

// Admin make-goods for one coach (2026-10-15), shown on /admin/entitlements
// after looking a coach up: refund a payment, add account credit (comes off
// their next bills automatically), or give free Pro time (works with or
// without a subscription). Every action needs a reason, confirms the exact
// amount first, and is recorded in billing_adjustments; money actions run
// in the stripe-admin Edge Function and carry a one-time operation id, so a
// double click cannot refund or credit twice.

const money = (cents, currency = "usd") => (cents / 100).toLocaleString(undefined, { style: "currency", currency: currency.toUpperCase() });
const fmtDate = v => v ? new Date(typeof v === "number" ? v * 1000 : v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
const newOpId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

function Row({ children }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>{children}</div>;
}

export default function AdminBillingCard({ userId, label }) {
  const [info, setInfo] = useState(null);
  const [stripeInfo, setStripeInfo] = useState(null);
  const [form, setForm] = useState(null); // { kind, invoiceId?, amount, days, reason, opId, confirm }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(() => {
    adminGetBilling(userId).then(setInfo);
    adminBilling({ action: "list", user_id: userId }).then(setStripeInfo);
  }, [userId]);
  useEffect(() => { setForm(null); setMsg(""); refresh(); }, [refresh]);

  const open = (kind, extra = {}) => { setMsg(""); setForm({ kind, amount: "", days: kind === "pro_time" ? "30" : "", reason: "", opId: newOpId(), confirm: false, ...extra }); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v, confirm: false }));

  const summary = () => {
    if (!form) return "";
    if (form.kind === "pro_time") return `Give ${label} ${form.days} days of free Pro?`;
    const amt = form.amount ? money(Math.round(Number(form.amount) * 100)) : "the full remaining amount";
    if (form.kind === "refund") return `Refund ${amt} of this payment to ${label}'s card?`;
    return `Add ${amt} of account credit for ${label}?`;
  };

  const submit = async () => {
    if (!form.reason.trim()) { setMsg("A reason is required."); return; }
    if (!form.confirm) { setForm(f => ({ ...f, confirm: true })); return; }
    setBusy(true); setMsg("");
    let r;
    if (form.kind === "pro_time") {
      const res = await adminGrantProTime(userId, Number(form.days), form.reason.trim());
      r = res.error ? { error: res.error.message } : { ok: true };
    } else {
      r = await adminBilling({
        action: form.kind, user_id: userId, invoice_id: form.invoiceId,
        amount_cents: form.amount ? Math.round(Number(form.amount) * 100) : undefined,
        reason: form.reason.trim(), operation_id: form.opId,
      });
    }
    setBusy(false);
    if (r.error) { setMsg(r.error); setForm(f => ({ ...f, confirm: false })); return; }
    setMsg(form.kind === "refund" ? "Refund issued. Stripe emails the coach a receipt." : form.kind === "credit" ? "Credit added. It comes off their next bills automatically." : "Free Pro time added.");
    setForm(null);
    refresh();
  };

  const revoke = async (grantId) => {
    if (!window.confirm("End this free Pro time now?")) return;
    await adminRevokeProGrant(grantId);
    refresh();
  };

  if (!info) return null;
  const payments = (stripeInfo && stripeInfo.payments) || [];
  const activeGrants = (info.grants || []).filter(g => g.active);

  return (<div>
    <div style={{ fontSize: 13, marginBottom: 8 }}>
      <strong>{info.plan || "free"}</strong>
      {info.billing_status && info.billing_status !== "none" && <span style={{ color: "var(--text-dim)" }}> · {info.billing_status}{info.cancel_at_period_end ? " (cancels at period end)" : ""}</span>}
      {info.current_period_end && <span style={{ color: "var(--text-dim)" }}> · {info.billing_status === "canceled" ? "ended" : "period ends"} {fmtDate(info.current_period_end)}</span>}
      {stripeInfo && stripeInfo.balance_cents > 0 && <span style={{ color: "var(--field)" }}> · {money(stripeInfo.balance_cents)} credit</span>}
    </div>

    {activeGrants.map(g => (<Row key={g.id}>
      <span>Free Pro ({g.source}) until {fmtDate(g.ends_at)}<div style={{ color: "var(--text-dim)" }}>{g.reason}</div></span>
      <button className="btn ghost bxs" onClick={() => revoke(g.id)}>End now</button>
    </Row>))}

    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em", margin: "10px 0 4px" }}>Payments</div>
    {!stripeInfo && <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading...</div>}
    {stripeInfo && stripeInfo.error && <div style={{ fontSize: 12, color: "var(--danger)" }}>{stripeInfo.error}</div>}
    {stripeInfo && !stripeInfo.error && payments.length === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{stripeInfo.note || "No payments yet."}</div>}
    {payments.map(p => (<Row key={p.invoice_id}>
      <span>{fmtDate(p.created)} · {money(p.amount_paid, p.currency)}{p.amount_refunded ? <span style={{ color: "var(--text-dim)" }}> ({money(p.amount_refunded, p.currency)} refunded)</span> : null}</span>
      {p.amount_refunded < p.amount_paid && <button className="btn ghost bxs" onClick={() => open("refund", { invoiceId: p.invoice_id })}>Refund</button>}
    </Row>))}

    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
      <button className="btn outline bsm" onClick={() => open("pro_time")}>Give free Pro time</button>
      {stripeInfo && !stripeInfo.note && <button className="btn outline bsm" onClick={() => open("credit")}>Add account credit</button>}
    </div>

    {form && (<div style={{ marginTop: 10, padding: 10, border: "1px solid var(--border)", borderRadius: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      {form.kind === "pro_time"
        ? <label style={{ fontSize: 12 }}>Days <input className="inp" type="number" min="1" max="366" value={form.days} onChange={e => set("days", e.target.value)} style={{ width: 80, marginLeft: 6 }} /></label>
        : <label style={{ fontSize: 12 }}>Amount (USD) <input className="inp" type="number" min="0.01" step="0.01" placeholder={form.kind === "refund" ? "full" : "e.g. 12"} value={form.amount} onChange={e => set("amount", e.target.value)} style={{ width: 100, marginLeft: 6 }} /></label>}
      <input className="inp" placeholder="Reason (required, e.g. live timer froze during their practice)" value={form.reason} onChange={e => set("reason", e.target.value)} />
      {form.confirm && <div style={{ fontSize: 12.5, fontWeight: 700 }}>{summary()}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn ghost bsm" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
        <button className="btn primary bsm" onClick={submit} disabled={busy || (form.kind === "credit" && !form.amount)}>{busy ? "Working..." : form.confirm ? "Confirm" : "Continue"}</button>
      </div>
    </div>)}
    {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg.startsWith("A reason") || msg.toLowerCase().includes("fail") || msg.toLowerCase().includes("at most") ? "var(--danger)" : "var(--field)" }}>{msg}</div>}

    {(info.adjustments || []).length > 0 && <>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em", margin: "12px 0 4px" }}>History</div>
      {info.adjustments.map((a, i) => (<Row key={i}>
        <span>{fmtDate(a.created_at)} · {a.kind}{a.amount_cents ? " " + money(a.amount_cents, a.currency || "usd") : ""}</span>
        <span style={{ color: "var(--text-dim)", textAlign: "right" }}>{a.reason}</span>
      </Row>))}
    </>}
  </div>);
}
