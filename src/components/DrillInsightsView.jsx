import React, { useState, useEffect } from "react";
import { drillUsageHeatTier, classifyDurationVariance } from "../constants.js";
import { fetchDrillInsights } from "../supabase.js";

// Enhancement 6. Deliberately not hover-only (spec: "the main experience is
// mobile") and deliberately not animated -- a static color swap on load,
// never a continuous rotation/pulse, so the heat scale can't be misread as
// a live status indicator. Red means frequently used, not a problem; the
// accessible name always carries the real count so the color is never the
// only signal.
export function DrillInsightHeatIcon({ summary, onClick }) {
  const tier = summary && drillUsageHeatTier(summary.completed_uses_trailing_12_months);
  if (!tier) return null;
  const n = summary.completed_uses_trailing_12_months;
  return (<button type="button" onClick={e => { e.stopPropagation(); onClick(); }}
    aria-label={"View drill insights. Used in " + n + " completed practice" + (n === 1 ? "" : "s") + " during the last 12 months."}
    title={tier.label + " · " + n + " use" + (n === 1 ? "" : "s") + " in the last 12 months"}
    style={{ width: 26, height: 26, borderRadius: "50%", border: "none", background: tier.color, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}>
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
      <line x1="3" y1="11" x2="3" y2="7" /><line x1="7" y1="11" x2="7" y2="4" /><line x1="11" y1="11" x2="11" y2="6" />
    </svg>
  </button>);
}

function VarianceRow({ label, value }) {
  if (value == null) return null;
  return (<span style={{ fontSize: 12, color: "var(--td)" }}>{label} {value}%</span>);
}

// Drilled-in subview (not a modal) per the spec's preference when the
// content needs scrolling and history rows -- consistent with how
// PublicLibraryScreen/SessionHistoryDetail are already full navigational
// subviews elsewhere in this app rather than dismissible sheets.
export default function DrillInsightsView({ libraryActivityId, drillName, onClose }) {
  const [insights, setInsights] = useState(null);
  useEffect(() => { setInsights(null); fetchDrillInsights(libraryActivityId).then(setInsights); }, [libraryActivityId]);

  const durationInsight = (() => {
    if (!insights || insights.avg_planned_minutes == null || insights.avg_actual_minutes == null) return "Not enough actual timing data to compare planned and actual duration.";
    const classification = classifyDurationVariance(insights.avg_planned_minutes * 60, insights.avg_actual_minutes * 60);
    if (classification === "on_plan") return "This drill typically finishes within one minute of plan.";
    return "You usually plan " + insights.avg_planned_minutes + " minutes, but this drill averages " + insights.avg_actual_minutes + " minutes.";
  })();

  return (<div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 500, overflowY: "auto" }}>
    <div style={{ position: "sticky", top: 0, background: "#fff", borderBottom: "1px solid var(--b)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, zIndex: 1 }}>
      <button className="btn ghost bxs" onClick={onClose}>&#8249; Back</button>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 18, fontWeight: 900, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{drillName} Insights</div>
    </div>
    <div style={{ padding: 16, paddingBottom: 60 }}>
      {insights === null && <div style={{ padding: "40px 0", textAlign: "center", color: "var(--td)" }}>Loading...</div>}
      {insights && insights.uses_all_time === 0 && <div className="empty"><div className="emtx">Insights will appear after this drill is used in a completed live practice.</div></div>}
      {insights && insights.uses_all_time > 0 && (<>
        <div className="card mb10">
          <div className="clbl mb8">Usage</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <ScoreTileLocal label="Last 4 Weeks" value={insights.uses_last_4_weeks} />
            <ScoreTileLocal label="Last 12 Weeks" value={insights.uses_last_12_weeks} />
            <ScoreTileLocal label="Last 12 Months" value={insights.uses_trailing_12_months} />
            <ScoreTileLocal label="All Time" value={insights.uses_all_time} />
          </div>
          {insights.last_used_at && <div style={{ fontSize: 12, color: "var(--td)" }}>Last used {new Date(insights.last_used_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>}
        </div>

        <div className="card mb10">
          <div className="clbl mb8">Duration</div>
          <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 8 }}>
            {insights.avg_planned_minutes != null && <>Averages {insights.avg_planned_minutes}m planned</>}
            {insights.avg_actual_minutes != null && <> · {insights.avg_actual_minutes}m actual</>}
          </div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>{durationInsight}</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <VarianceRow label="On plan:" value={insights.pct_on_plan} />
            <VarianceRow label="Extended:" value={insights.pct_extended} />
            <VarianceRow label="Shortened:" value={insights.pct_shortened} />
          </div>
          {insights.skipped_count != null && <div style={{ fontSize: 12, color: "var(--td)", marginTop: 6 }}>Planned but not logged/skipped {insights.skipped_count} time{insights.skipped_count === 1 ? "" : "s"}.</div>}
        </div>

        {insights.teams.length > 0 && <div className="card mb10">
          <div className="clbl mb8">Teams</div>
          <div style={{ fontSize: 12 }}>{insights.teams.map(t => t.team_name).join(", ")}</div>
        </div>}

        <div className="card mb10">
          <div className="clbl mb8">Usage History</div>
          {insights.usage_history.map(h => (<div key={h.session_id + h.practice_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--s2)" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{new Date(h.ended_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
              <div style={{ color: "var(--td)" }}>{h.team_name}</div>
            </div>
            <div style={{ textAlign: "right", fontFamily: "DM Mono,monospace", color: "var(--tm)" }}>
              {h.planned_minutes}m planned<br />
              {h.actual_minutes != null ? h.actual_minutes + "m actual" : "not logged"}
            </div>
          </div>))}
        </div>

        {insights.recent_notes.length > 0 && <div className="card mb10">
          <div className="clbl mb8">Recent Notes</div>
          {insights.recent_notes.map(n => (<div key={n.note_id} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "var(--td)" }}>{n.author_kind === "anonymous" ? (n.author_label || "A helper") + " · Helper" : (n.author_name || "A coach")} · {new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
            <div style={{ fontSize: 13 }}>{n.text}</div>
          </div>))}
        </div>}
      </>)}
    </div>
  </div>);
}
function ScoreTileLocal({ label, value }) {
  return (<div>
    <div style={{ fontSize: 10, color: "var(--td)", textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 700 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
  </div>);
}
