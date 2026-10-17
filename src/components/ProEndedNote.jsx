import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyBilling, fetchMyTeamPlanStatus } from "../supabase.js";

// "Your Pro ended" note (new-coach E2E follow-up, 2026-10-17). A coach whose
// Pro subscription has ended otherwise just sees the plain Free plan, with
// nothing saying what happened to their teams and history. Shown on Plan &
// billing for as long as they're on Free, and once on Home (dismissible,
// for 30 days after the end). Informational, not an upsell: it shows
// whether or not billing CTAs are on. The end date is the webhook's
// current_period_end, which holds when the subscription ended once it has.

const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
const HOME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const seenKey = "rop.proEndedSeen";

function proEnded(billing) {
  return !!(billing && billing.plan !== "pro" && billing.billing_status === "canceled" && billing.current_period_end
    && billing.cohort !== "founding_coach" && !billing.grant);
}

function pausedSentence(status) {
  const paused = status && status.limit != null ? Math.max(0, (status.owned_active || 0) - status.limit) : 0;
  if (!paused) return "";
  return paused === 1
    ? " One of your teams is paused until you upgrade or make it your active team."
    : ` ${paused} of your teams are paused until you upgrade or make one your active team.`;
}

function proEndedText(billing, status) {
  return `Your Pro subscription ended on ${fmtDate(billing.current_period_end)}. Nothing was deleted.${pausedSentence(status)} Practices beyond your 10 most recent, and drills or templates over Free's limits, are saved and come back with Pro.`;
}

// Plan & billing: the caller already has the billing summary.
export function ProEndedPlanNote({ billing }) {
  const [status, setStatus] = useState(null);
  const ended = proEnded(billing);
  useEffect(() => { if (ended) fetchMyTeamPlanStatus().then(setStatus); }, [ended]);
  if (!ended) return null;
  return <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>{proEndedText(billing, status)}</div>;
}

// Home: fetches its own billing summary; once dismissed for a given end
// date it stays dismissed.
export function ProEndedHomeCard() {
  const navigate = useNavigate();
  const [billing, setBilling] = useState(null);
  const [status, setStatus] = useState(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchMyBilling().then(b => {
      if (!alive || !proEnded(b)) return;
      if (Date.now() - new Date(b.current_period_end).getTime() > HOME_WINDOW_MS) return;
      let seen = null;
      try { seen = localStorage.getItem(seenKey); } catch { /* storage unavailable */ }
      if (seen === b.current_period_end) return;
      setBilling(b);
      fetchMyTeamPlanStatus().then(st => { if (alive) setStatus(st); });
    });
    return () => { alive = false; };
  }, []);
  if (!billing || hidden) return null;
  const dismiss = () => {
    try { localStorage.setItem(seenKey, billing.current_period_end); } catch { /* storage unavailable */ }
    setHidden(true);
  };
  return (<div style={{ margin: "0 16px 12px" }}><div className="card" style={{ padding: "14px 16px" }}>
    <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 10 }}>{proEndedText(billing, status)}</div>
    <div style={{ display: "flex", gap: 8 }}>
      <button className="btn outline bsm" onClick={() => navigate("/settings/plan")}>Plan &amp; billing</button>
      <button className="btn ghost bsm" onClick={dismiss}>Dismiss</button>
    </div>
  </div></div>);
}
