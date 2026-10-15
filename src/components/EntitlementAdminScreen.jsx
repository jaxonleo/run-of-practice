import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  adminFindUserByEmail, adminListOrganizations, adminGetEntitlements,
  adminSetPlan, adminAssignCohort, adminGrantOverride, adminRevokeOverride,
  fetchEntitlementBundles, fetchFeatureRegistry,
  fetchEntitlementSettings, adminSetFoundingCutoff,
} from "../supabase.js";
import { upsellPreviewEnabled, setUpsellPreviewEnabled } from "../entitlements.js";
import AdminBillingCard from "./AdminBillingCard.jsx";

// Entitlement architecture, Phase 5 (handoff §6 -- "a practical way for
// development and QA to simulate different entitlement states"). Sits
// entirely on top of the admin RPCs built in Phases 2/5
// (admin_get_entitlements/admin_set_plan/admin_assign_cohort/
// admin_grant_override/admin_revoke_override, admin_find_user_by_email,
// admin_list_organizations) -- this screen is a thin UI, no resolution
// logic of its own. Self-contained styling (own Card/SectionTitle),
// matching FounderMetricsScreen.jsx's own convention for an admin-only
// screen rather than importing shared chrome.

function Card({ children, style }) {
  return <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 14, ...style }}>{children}</div>;
}
function SectionTitle({ children }) {
  return <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--ink-soft)", marginBottom: 8 }}>{children}</div>;
}
// datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's own zone.
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const STATE_COLORS = { full: "var(--field)", preview: "var(--field-accent)", locked: "var(--text-dim)", hidden: "var(--danger)" };
function StatePill({ state }) {
  return <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#fff", background: STATE_COLORS[state] || "var(--text-dim)", borderRadius: 4, padding: "2px 6px" }}>{state}</span>;
}

export default function EntitlementAdminScreen() {
  const navigate = useNavigate();
  const [subjectType, setSubjectType] = useState("user");
  const [email, setEmail] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [subject, setSubject] = useState(null); // {id, label} for either a user or an org
  const [orgs, setOrgs] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [features, setFeatures] = useState([]);
  const [entitlements, setEntitlements] = useState(null);
  const [busy, setBusy] = useState(false);
  const [overrideFeature, setOverrideFeature] = useState("");
  const [overrideState, setOverrideState] = useState("full");
  const [overrideLimit, setOverrideLimit] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [settings, setSettings] = useState(null);
  const [cutoffInput, setCutoffInput] = useState("");
  const [cutoffError, setCutoffError] = useState("");
  const [previewOn, setPreviewOn] = useState(upsellPreviewEnabled());

  const loadSettings = useCallback(() => fetchEntitlementSettings().then(st => {
    setSettings(st);
    setCutoffInput(st && st.founding_cohort_cutoff ? toLocalInput(st.founding_cohort_cutoff) : "");
  }), []);
  useEffect(() => { fetchEntitlementBundles().then(setBundles); fetchFeatureRegistry().then(setFeatures); loadSettings(); }, [loadSettings]);
  const saveCutoff = async (value) => {
    setCutoffError("");
    const { error } = await adminSetFoundingCutoff(value ? new Date(value).toISOString() : null);
    if (error) setCutoffError(error.message || "Could not save the cutoff.");
    loadSettings();
  };
  useEffect(() => { if (subjectType === "organization") adminListOrganizations().then(setOrgs); }, [subjectType]);

  const refresh = useCallback((s) => {
    const target = s || subject;
    if (!target) return;
    const userId = subjectType === "user" ? target.id : null;
    const orgId = subjectType === "organization" ? target.id : null;
    adminGetEntitlements(subjectType, userId, orgId).then(setEntitlements);
  }, [subject, subjectType]);

  const lookupUser = async () => {
    setLookupError(""); setEntitlements(null);
    const found = await adminFindUserByEmail(email.trim());
    if (!found) { setLookupError("No account found for that email."); setSubject(null); return; }
    const label = (found.first_name || found.last_name) ? `${found.first_name || ""} ${found.last_name || ""}`.trim() : found.email;
    const s = { id: found.id, label: `${label} (${found.email})` };
    setSubject(s);
    refresh(s);
  };
  const pickOrg = (orgId) => {
    setEntitlements(null);
    if (!orgId) { setSubject(null); return; }
    const org = orgs.find(o => o.id === orgId);
    const s = { id: orgId, label: org ? org.name : orgId };
    setSubject(s);
    refresh(s);
  };

  const withBusy = async (fn) => { setBusy(true); await fn(); refresh(); setBusy(false); };

  const userId = subjectType === "user" ? (subject && subject.id) : null;
  const organizationId = subjectType === "organization" ? (subject && subject.id) : null;

  return (
    <div style={{ height: "100dvh", overflowY: "auto", maxWidth: 560, margin: "0 auto", padding: "16px 14px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <button className="btn ghost bxs" style={{ alignSelf: "flex-start" }} onClick={() => navigate(-1)}>Back</button>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontWeight: 900, fontSize: 22, color: "var(--ink)" }}>Entitlement Simulator</div>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: -10 }}>
        Look up a real account (a QA account is easiest -- see Working Conventions) and change its plan, cohort, or grant/revoke a specific feature, to see exactly what that account experiences in the app.
      </div>

      <Card>
        <SectionTitle>Founding Coach cutoff</SectionTitle>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 8 }}>
          New signups join the Founding Coach cohort (full access) until this moment. After it, new coaches start on Free. Billing must not be enabled while this is unset.
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          {settings && settings.founding_cohort_cutoff
            ? `Cutoff: ${new Date(settings.founding_cohort_cutoff).toLocaleString()}`
            : "No cutoff set. Every new signup is a Founding Coach."}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <input className="inp" style={{ flex: 1, minWidth: 180 }} type="datetime-local" value={cutoffInput} onChange={e => setCutoffInput(e.target.value)} />
          <button className="btn primary bsm" disabled={!cutoffInput} onClick={() => saveCutoff(cutoffInput)}>Set cutoff</button>
          {settings && settings.founding_cohort_cutoff && <button className="btn ghost bsm" onClick={() => saveCutoff(null)}>Clear</button>}
        </div>
        {cutoffError && <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 8 }}>{cutoffError}</div>}
      </Card>

      <Card>
        <SectionTitle>Upsell preview (this browser)</SectionTitle>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 8 }}>
          While billing is off, pricing buttons and value moments are hidden for everyone. Turn this on to see them in this browser only, for QA. Limit notices and previews always show either way.
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
          <input type="checkbox" checked={previewOn} onChange={e => { setUpsellPreviewEnabled(e.target.checked); setPreviewOn(e.target.checked); }} />
          Show upsell buttons and value moments here
        </label>
      </Card>

      <Card>
        <SectionTitle>Subject</SectionTitle>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {["user", "organization"].map(t => (
            <button key={t} className={"btn bsm " + (subjectType === t ? "primary" : "ghost")}
              onClick={() => { setSubjectType(t); setSubject(null); setEntitlements(null); setLookupError(""); }}>
              {t === "user" ? "User" : "Organization"}
            </button>
          ))}
        </div>
        {subjectType === "user" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input className="inp" style={{ flex: 1 }} type="email" placeholder="coach@example.com" value={email}
              onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && lookupUser()} />
            <button className="btn primary bsm" onClick={lookupUser} disabled={!email.trim()}>Look up</button>
          </div>
        ) : (
          <select className="sel" style={{ width: "100%" }} value={(subject && subject.id) || ""} onChange={e => pickOrg(e.target.value)}>
            <option value="">Select an organization...</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {lookupError && <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 8 }}>{lookupError}</div>}
        {subject && <div style={{ fontSize: 13, marginTop: 8, fontWeight: 700 }}>{subject.label}</div>}
      </Card>

      {subject && entitlements && (<>
        <Card>
          <SectionTitle>Plan &amp; cohort</SectionTitle>
          <div className="fld mb8">
            <label className="lbl">Active plan bundle</label>
            <select className="sel" value={entitlements.plan_bundle_key || ""} disabled={busy}
              onChange={e => withBusy(() => adminSetPlan(subjectType, userId, organizationId, e.target.value))}>
              {bundles.filter(b => b.is_plan && (!b.retired_at || b.bundle_key === entitlements.plan_bundle_key)).map(b => <option key={b.bundle_key} value={b.bundle_key}>{b.display_name} ({b.bundle_key})</option>)}
            </select>
          </div>
          <div className="fld">
            <label className="lbl">Cohort / grandfathered bundle</label>
            <select className="sel" value={entitlements.cohort_bundle_key || ""} disabled={busy}
              onChange={e => withBusy(() => adminAssignCohort(subjectType, userId, organizationId, e.target.value || null, "set via entitlement simulator"))}>
              <option value="">None (use plan only)</option>
              {bundles.filter(b => !b.retired_at || b.bundle_key === entitlements.cohort_bundle_key).map(b => <option key={b.bundle_key} value={b.bundle_key}>{b.display_name} ({b.bundle_key})</option>)}
            </select>
          </div>
        </Card>

        {subjectType === "user" && <Card>
          <SectionTitle>Billing</SectionTitle>
          <AdminBillingCard userId={subject.id} label={subject.label.split(" (")[0]} />
        </Card>}

        <Card>
          <SectionTitle>Individual overrides</SectionTitle>
          {entitlements.overrides.length === 0 && <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 10 }}>No overrides set.</div>}
          {entitlements.overrides.map(o => (
            <div key={o.feature_key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>{o.feature_key}</span> &rarr; <StatePill state={o.state} />
                {o.limit_value != null && <span style={{ color: "var(--text-dim)" }}> (limit {o.limit_value})</span>}
                {o.reason && <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{o.reason}</div>}
              </div>
              <button className="btn ghost bxs" disabled={busy} onClick={() => withBusy(() => adminRevokeOverride(subjectType, userId, organizationId, o.feature_key))}>Revoke</button>
            </div>
          ))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            <select className="sel" style={{ flex: 1, minWidth: 140 }} value={overrideFeature} onChange={e => setOverrideFeature(e.target.value)}>
              <option value="">Feature...</option>
              {features.map(f => <option key={f.feature_key} value={f.feature_key}>{f.feature_key}</option>)}
            </select>
            <select className="sel" value={overrideState} onChange={e => setOverrideState(e.target.value)}>
              {["full", "preview", "locked", "hidden"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input className="inp" style={{ width: 90 }} type="number" placeholder="limit" value={overrideLimit} onChange={e => setOverrideLimit(e.target.value)} />
            <input className="inp" style={{ flex: 1, minWidth: 140 }} placeholder="reason (e.g. beta tester)" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} />
            <button className="btn primary bsm" disabled={busy || !overrideFeature} onClick={() => withBusy(async () => {
              await adminGrantOverride(subjectType, userId, organizationId, overrideFeature, overrideState, overrideLimit === "" ? null : Number(overrideLimit), overrideReason || null);
              setOverrideFeature(""); setOverrideLimit(""); setOverrideReason("");
            })}>Grant</button>
          </div>
        </Card>

        <Card>
          <SectionTitle>Resolved (what this account actually sees)</SectionTitle>
          {Object.entries(entitlements.resolved).map(([key, r]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 13 }}>{key}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {r.limit_value != null && <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>limit {r.limit_value}</span>}
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>via {r.source}</span>
                <StatePill state={r.state} />
              </div>
            </div>
          ))}
        </Card>
      </>)}
    </div>
  );
}
