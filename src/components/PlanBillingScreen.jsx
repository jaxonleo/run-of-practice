import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchMyBilling, startProCheckout, openBillingPortal } from "../supabase.js";
import { clearEntitlementsCache, upsellCtasVisible } from "../entitlements.js";

// Settings > Plan & billing (self-serve billing, 2026-10-15). Shows the
// coach's plan and what they can do about it:
//   Founding Coach -> nothing to buy, everything included.
//   Partner quarter / courtesy Pro -> Pro until a date, nothing to buy.
//   Pro subscription -> Manage subscription (Stripe's portal: switch
//     monthly/annual, card, invoices, cancel at period end).
//   Free -> Go Pro (Stripe Checkout, monthly or annual), plus the partner
//     program.
// Buying is only offered once billing is on (or in an admin's preview
// browser); the plan itself is always shown. Stripe returns here with
// ?checkout=success|cancel; on success this polls until the webhook has
// moved the coach to Pro, then refreshes their cached plan everywhere.

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "";

function Card({ children, style }) {
  return <div className="card" style={{ padding: "16px", marginBottom: 14, ...style }}>{children}</div>;
}

export default function PlanBillingScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const checkout = params.get("checkout");
  const [billing, setBilling] = useState(null);
  const [busy, setBusy] = useState(null); // "monthly" | "annual" | "portal"
  const [error, setError] = useState("");
  const [waitingForPro, setWaitingForPro] = useState(checkout === "success");

  const load = useCallback(() => fetchMyBilling().then(b => { setBilling(b || { error: true }); return b; }), []);
  useEffect(() => { load(); }, [load]);

  // After Checkout, Stripe's webhook flips the plan within seconds. Poll
  // briefly so the coach sees Pro without having to reload.
  useEffect(() => {
    if (!waitingForPro) return;
    let tries = 0;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const b = await load();
      tries += 1;
      if (b && b.plan === "pro") { clearEntitlementsCache(); setWaitingForPro(false); return; }
      if (tries < 15) setTimeout(tick, 2000); else setWaitingForPro(false);
    };
    tick();
    return () => { cancelled = true; };
  }, [waitingForPro, load]);

  const go = async (kind) => {
    setBusy(kind); setError("");
    const r = kind === "portal" ? await openBillingPortal() : await startProCheckout(kind);
    if (r.url) { window.location.assign(r.url); return; }
    setError(r.error || "Something went wrong. Try again.");
    setBusy(null);
  };

  const dismissCheckoutNote = () => { params.delete("checkout"); setParams(params, { replace: true }); };
  const canBuy = upsellCtasVisible();

  if (!billing) return <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-dim)" }}>Loading...</div>;

  const founding = billing.cohort === "founding_coach";
  const grant = billing.grant;
  const subscribed = billing.plan === "pro" && ["active", "trialing", "past_due"].includes(billing.billing_status);
  const annual = billing.price_lookup_key === "rop_pro_annual";

  return (<div className="bb-centered-page" style={{ padding: "16px 16px 80px", boxSizing: "border-box" }}>
    <button className="btn ghost bxs" style={{ marginBottom: 12 }} onClick={() => navigate("/settings")}>&#8249; Settings</button>
    <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 26, fontWeight: 900, marginBottom: 14 }}>Plan &amp; billing</div>

    {checkout === "success" && <Card style={{ background: "var(--field-tint)", border: "1px solid var(--field-tint-border)" }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{waitingForPro ? "Finishing your upgrade..." : billing.plan === "pro" ? "Welcome to Pro." : "Payment received."}</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{waitingForPro ? "This takes a few seconds." : billing.plan === "pro" ? "Everything in Pro is unlocked on your teams." : "Your plan will update shortly. Refresh in a minute if it hasn't."}</div>
      {!waitingForPro && <button className="btn ghost bxs" style={{ marginTop: 8 }} onClick={dismissCheckoutNote}>Dismiss</button>}
    </Card>}
    {checkout === "cancel" && <Card>
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Checkout was cancelled. Nothing was charged.</div>
      <button className="btn ghost bxs" style={{ marginTop: 8 }} onClick={dismissCheckoutNote}>Dismiss</button>
    </Card>}

    <div className="clbl mb8">Your plan</div>
    <Card>
      {founding ? (<>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900 }}>Founding Coach</div>
        <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>You were here from the start, so you have everything in Pro at no cost. Thank you.</div>
      </>) : subscribed ? (<>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900 }}>Pro</div>
        <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 4 }}>{annual ? "$99 per year" : "$12 per month"}</div>
        {billing.billing_status === "past_due" && <div style={{ fontSize: 13, color: "var(--caution)", marginTop: 8 }}>Your last payment didn't go through. Update your card in Manage subscription to keep Pro.</div>}
        {billing.cancel_at_period_end
          ? <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>Pro ends on {fmtDate(billing.current_period_end)}. After that you'll be on Free, and nothing is deleted.</div>
          : billing.current_period_end && <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 8 }}>Renews on {fmtDate(billing.current_period_end)}.</div>}
        <button className="btn outline bmd bfull" style={{ marginTop: 12 }} disabled={busy === "portal"} onClick={() => go("portal")}>{busy === "portal" ? "Opening..." : "Manage subscription"}</button>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6 }}>Switch between monthly and annual, update your card, see receipts, or cancel.</div>
      </>) : grant ? (<>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900 }}>Pro</div>
        <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>
          {grant.source === "partner" ? "Free as a Run of Practice partner" : "Complimentary"} through {fmtDate(grant.ends_at)}.
        </div>
      </>) : (<>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900 }}>Free</div>
        <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>One active team, you plus two assistant coaches, 20 saved drills, two templates, and your 10 most recent practices. Live practices are always unlimited.</div>
      </>)}
    </Card>

    {!founding && !subscribed && !grant && <>
      <div className="clbl mb8">Go Pro</div>
      <Card>
        <div style={{ fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.55, marginBottom: 12 }}>
          Up to three teams, your whole staff, unlimited drills and templates, shared planning, every Goals &amp; Insights tool, Benchmarks, and your complete practice history.
        </div>
        {canBuy ? (<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="btn primary bmd bfull" disabled={!!busy} onClick={() => go("annual")}>{busy === "annual" ? "Opening checkout..." : "$99 per year (save $45)"}</button>
          <button className="btn outline bmd bfull" disabled={!!busy} onClick={() => go("monthly")}>{busy === "monthly" ? "Opening checkout..." : "$12 per month"}</button>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Secure checkout by Stripe. Cancel anytime; Pro stays on until the end of what you paid for.</div>
        </div>) : (
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Pro upgrades open soon.</div>
        )}
      </Card>
    </>}

    {!founding && !subscribed && <>
      <div className="clbl mb8">Partner program</div>
      <Card>
        <div style={{ fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.55, marginBottom: 10 }}>
          {billing.partner_status === "pending" ? "Thanks for applying. We'll be in touch soon."
            : billing.partner_status === "approved" ? "You're a Run of Practice partner. Thank you for the feedback."
            : "Help shape Run of Practice. Partners get Pro free for each quarter they share regular, useful feedback."}
        </div>
        {!billing.partner_status && <button className="btn outline bmd bfull" onClick={() => navigate("/partners")}>Learn about partnering</button>}
      </Card>
    </>}

    {error && <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 4 }}>{error}</div>}
  </div>);
}
