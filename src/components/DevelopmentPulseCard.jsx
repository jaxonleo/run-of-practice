import React, { useState, useEffect, useMemo } from "react";
import {
  resolveDevelopmentPulseState, DEVELOPMENT_PULSE_MIN_ACTION_MINUTES,
} from "../constants.js";
import { fetchTeamGoalReport } from "../supabase.js";

// Development Pulse Home widget. A short one-time entrance transition runs
// when the resolved state changes (never continuous, never on every Home
// remount) -- CSS only, respects prefers-reduced-motion via the media
// query below rather than JS feature-detection.
const PULSE_CSS = `
@keyframes devPulseIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
.dev-pulse-card { animation: devPulseIn .25s ease-out; }
@media (prefers-reduced-motion: reduce) { .dev-pulse-card { animation: none; } }
`;

function fmtPts(n) { return Math.round(Math.abs(n)); }

// Collapse caret -- points down when collapsed (tap to expand), up when
// expanded (tap to collapse), same convention as every disclosure control
// elsewhere in the app.
function Ic_Caret({ up }) {
  return (<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points={up ? "3 9 7 5 11 9" : "3 5 7 9 11 5"} />
  </svg>);
}

// Bullet-bar graphic: current fill (solid), projected extension (hatched
// pattern, not just lower opacity, so it reads apart from Actual without
// relying on color/contrast alone), goal tick (a distinct vertical mark,
// not a bar segment at all). Fixed 0-100 scale throughout -- never zoomed
// to the local gap, so cards stay comparable to each other.
function BulletBar({ label, currentPct, projectedPct, targetPct, color }) {
  const W = 280, H = 34, PAD = 2;
  const scaleX = pct => PAD + (Math.max(0, Math.min(100, pct || 0)) / 100) * (W - PAD * 2);
  const barY = 10, barH = 14;
  const cur = scaleX(currentPct);
  const hasProjection = projectedPct != null && Math.abs(projectedPct - (currentPct || 0)) >= 0.5;
  const proj = hasProjection ? scaleX(projectedPct) : null;
  const tick = scaleX(targetPct);
  const patternId = "devpulse-hatch";
  const summary = "Actual " + Math.round(currentPct || 0) + "%"
    + (hasProjection ? ", projected " + Math.round(projectedPct) + "%" : "")
    + ", goal " + Math.round(targetPct) + "%.";

  return (<div>
    <svg viewBox={"0 0 " + W + " " + (H + 14)} style={{ width: "100%", height: H + 14, display: "block" }} role="img" aria-label={label + ": " + summary}>
      <defs>
        <pattern id={patternId} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill={color} opacity="0.25" />
          <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2.5" opacity="0.55" />
        </pattern>
      </defs>
      <rect x={PAD} y={barY} width={W - PAD * 2} height={barH} rx={barH / 2} fill="var(--s2)" />
      <rect x={PAD} y={barY} width={Math.max(0, cur - PAD)} height={barH} rx={barH / 2} fill={color} />
      {hasProjection && <rect x={cur} y={barY} width={Math.max(0, proj - cur)} height={barH} fill={"url(#" + patternId + ")"} />}
      <line x1={tick} x2={tick} y1={barY - 4} y2={barY + barH + 4} stroke="var(--black)" strokeWidth="2.5" />
      <text x={PAD} y={H + 12} fontSize="10" fill="var(--td)" fontFamily="DM Mono,monospace">Actual {Math.round(currentPct || 0)}%</text>
      {hasProjection && <text x={W / 2} y={H + 12} fontSize="10" fill="var(--td)" fontFamily="DM Mono,monospace" textAnchor="middle">Projected {Math.round(projectedPct)}%</text>}
      <text x={W - PAD} y={H + 12} fontSize="10" fill="var(--black)" fontFamily="DM Mono,monospace" textAnchor="end">Goal {Math.round(targetPct)}%</text>
    </svg>
  </div>);
}

// Neutral placeholder (State 1: goals not configured) -- no category
// values implied at all, per the spec.
function PlaceholderStrip() {
  return (<svg viewBox="0 0 280 20" style={{ width: "100%", height: 20, display: "block" }} role="img" aria-label="No goals configured yet">
    {[0, 1, 2, 3].map(i => (<rect key={i} x={2 + i * 70} y={4} width={62} height={12} rx={6} fill="var(--s2)" />))}
  </svg>);
}

// Segmented goal-mix strip (State 2: insufficient history) -- shows the
// saved target mix only, never a fabricated Actual bar.
function GoalMixStrip({ categories }) {
  const total = categories.reduce((s, c) => s + (c.targetPct || 0), 0) || 100;
  let x = 0;
  const W = 280, H = 16;
  return (<svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: H, display: "block" }} role="img" aria-label={"Team goal mix: " + categories.map(c => c.name + " " + c.targetPct + "%").join(", ")}>
    {categories.map((c, i) => {
      const w = (c.targetPct / total) * W;
      const rect = <rect key={c.skillCategoryId || i} x={x} y={0} width={Math.max(0, w - 1)} height={H} rx={2} fill={i % 2 === 0 ? "var(--gb)" : "var(--s2)"} />;
      x += w;
      return rect;
    })}
  </svg>);
}

// Completeness bar (State 3: data quality) -- attributed vs. untagged,
// explicit text values, no color-only signal.
function CompletenessBar({ attributedPct, untaggedPct }) {
  const W = 280, H = 16;
  const untaggedW = (untaggedPct / 100) * W;
  return (<div>
    <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: H, display: "block" }} role="img" aria-label={Math.round(attributedPct) + "% tagged, " + Math.round(untaggedPct) + "% untagged"}>
      <rect x={0} y={0} width={W} height={H} rx={2} fill="var(--green)" />
      <rect x={W - untaggedW} y={0} width={untaggedW} height={H} rx={2} fill="var(--amber)" />
    </svg>
    <div style={{ fontSize: 11, color: "var(--td)", marginTop: 4 }}>{Math.round(attributedPct)}% tagged · {Math.round(untaggedPct)}% untagged</div>
  </div>);
}

// Presentation-neutral state -> copy/CTA. `canManage` swaps editing verbs
// for viewing ones per the CTA navigation matrix; role-aware, never shows
// an action a read-only coach can't complete.
function presentState(result, canManage) {
  const teamName = result.teamName;
  switch (result.state) {
    case "no_categories_for_sport":
      return { headline: "Goals & Insights isn't available for this sport yet", body: null, cta: null, graphic: "placeholder", lowEmphasis: true };
    case "goals_not_configured":
      return {
        headline: "Give every practice a purpose",
        body: "Set development targets and compare them with what you plan and run.",
        cta: { label: canManage ? "Set Team Goals" : "View Goals & Insights", kind: "goals_overview" },
        graphic: "placeholder",
      };
    case "insufficient_history": {
      const body = result.remaining === 1
        ? "Run 1 more practice live to unlock development trends and recommendations."
        : "Run " + result.remaining + " practices live to unlock development trends and recommendations.";
      const cta = result.hasPlannedFallback && result.nextPracticePlanned
        ? { label: "Review Practice Impact", kind: "builder_goal_guidance", practiceId: result.practiceId }
        : { label: canManage ? "Review Team Goals" : "View Goals & Insights", kind: "goals_overview" };
      return { headline: "Your development goals are ready", body, cta, graphic: "goal_mix", basisNote: result.hasPlannedFallback ? "Based on planned practice time until actual timing is available." : null };
    }
    case "data_quality":
      return {
        headline: "Some practice time is hiding your trends",
        body: Math.round(result.untaggedPct) + "% of recent activity time is untagged. Add skill tags to improve goal guidance.",
        cta: { label: canManage ? "Review Untagged Time" : "View Untagged Time", kind: "goals_untagged" },
        graphic: "completeness",
      };
    case "missing_from_next_plan": {
      // Spec: never suggest a minute count larger than the practice itself
      // can hold -- when the gap can't be closed in one practice,
      // `closable` is already false (calculateGoalGapGuidance caps it
      // against nextPracticeDurationMinutes), so fall back to the same
      // "more than one practice" copy meaningful_gap uses rather than
      // letting Math.round(result.suggestedMinutes) exceed the practice.
      if (result.closable === false) {
        return {
          headline: "Your largest gap is not in the plan yet",
          body: "This gap will take more than one practice to close.",
          cta: { label: "Review Goal Guidance", kind: "builder_goal_guidance", practiceId: result.practiceId, categoryId: result.categoryId },
          graphic: "bullet", noProjection: true,
        };
      }
      const minuteCta = result.suggestedMinutes != null && result.suggestedMinutes >= DEVELOPMENT_PULSE_MIN_ACTION_MINUTES;
      return {
        headline: "Your largest gap is not in the plan yet",
        body: result.categoryName + " is " + fmtPts(result.gapPct) + " points below goal, but the next practice currently includes no " + result.categoryName + " activities.",
        cta: minuteCta
          ? { label: "Plan " + Math.round(result.suggestedMinutes) + " minutes", kind: "builder_goal_guidance", practiceId: result.practiceId, categoryId: result.categoryId }
          : { label: "Adjust the Plan", kind: "builder_goal_guidance", practiceId: result.practiceId, categoryId: result.categoryId },
        graphic: "bullet", noProjection: true,
      };
    }
    case "plan_improves_gap":
      return {
        headline: "Your next practice moves the needle",
        body: "The current plan is projected to move " + result.categoryName + " from " + Math.round(result.currentPct) + "% to " + Math.round(result.projectedPct) + "% against a " + Math.round(result.targetPct) + "% goal.",
        cta: { label: "Review Practice Impact", kind: "builder_goal_guidance", practiceId: result.practiceId, categoryId: result.categoryId },
        graphic: "bullet",
      };
    case "meaningful_gap": {
      let body = "Recent actual time is " + Math.round(result.currentPct) + "% against a " + Math.round(result.targetPct) + "% goal.";
      const hasDuration = result.practiceDurationMinutes != null && result.goalMixMinutes != null;
      if (hasDuration) body += " A goal-balanced " + result.practiceDurationMinutes + "-minute practice would include about " + result.goalMixMinutes + " minutes.";
      let cta;
      const minuteCta = result.suggestedMinutes != null && result.suggestedMinutes >= DEVELOPMENT_PULSE_MIN_ACTION_MINUTES;
      if (result.closable === false) {
        body = "This gap will take more than one practice to close.";
        cta = { label: "Review Goal Guidance", kind: "builder_goal_guidance", practiceId: result.practiceId, categoryId: result.categoryId };
      } else if (result.practiceId && !result.practiceDurationMinutes) {
        cta = { label: canManage ? "Review Goal Guidance" : "View Goals & Insights", kind: "builder_goal_guidance", practiceId: result.practiceId, categoryId: result.categoryId };
      } else if (result.practiceId && minuteCta) {
        cta = { label: "Plan " + Math.round(result.suggestedMinutes) + " minutes", kind: "builder_goal_guidance", practiceId: result.practiceId, categoryId: result.categoryId };
      } else if (result.practiceId) {
        cta = { label: canManage ? "Review Goal Guidance" : "View Goals & Insights", kind: "builder_goal_guidance", practiceId: result.practiceId, categoryId: result.categoryId };
      } else {
        cta = { label: canManage ? "View Recommended Focus" : "View Goals & Insights", kind: "goals_overview" };
      }
      return { headline: result.categoryName + " needs more attention", body, cta, graphic: "bullet" };
    }
    case "aligned":
    default:
      return {
        headline: "Your practice balance is on track",
        body: "Every skill category is within a few points of " + teamName + "'s current goals.",
        cta: { label: "View Trends", kind: "goals_trends" },
        graphic: result.largestVarianceCategory ? "bullet_variance" : "placeholder",
        positive: true,
      };
  }
}

// Loads its own compact baseline (get_team_goal_report, already used
// elsewhere in Goals & Insights) for whichever team Home resolved as the
// focus team -- never a report per visible team, and cached for the
// mounted Home session per team id.
export default function DevelopmentPulseCard({ team, nextPractice, canManage, data, coachId, hasSportCategories, isLiveNow, onNavigate }) {
  const [report, setReport] = useState(null);
  useEffect(() => {
    setReport(null);
    if (team) fetchTeamGoalReport(team.id).then(setReport);
  }, [team && team.id]);

  const activityLibraryById = useMemo(() => Object.fromEntries((data.activityLibrary || []).map(a => [a.id, a])), [data.activityLibrary]);
  const skillTagsById = useMemo(() => Object.fromEntries((data.skillTags || []).map(t => [t.id, t])), [data.skillTags]);

  const result = useMemo(() => {
    if (!team || !report) return null;
    return resolveDevelopmentPulseState({
      team, report,
      // A live-in-progress session withholds the plan from projection --
      // the resolver falls back to the same "no plan impact" path an
      // unplanned practice already takes, and the card adds a note below.
      nextPractice: isLiveNow ? null : nextPractice,
      activityLibraryById, skillTagsById, hasSportCategories,
    });
  }, [team, report, nextPractice, isLiveNow, activityLibraryById, skillTagsById, hasSportCategories]);

  // Collapse/expand persists per-coach across sessions (direct feedback) --
  // this is one physical widget on Home, not a per-team preference, so a
  // coach who collapses it stays collapsed regardless of which team ends up
  // as the focus team on a later visit. Keyed by coachId, not team.id.
  const collapsedKey = coachId ? "devPulseCollapsed:" + coachId : null;
  const seenKey = coachId ? "devPulseSeenFingerprint:" + coachId : null;
  const [collapsed, setCollapsed] = useState(() => !!(collapsedKey && localStorage.getItem(collapsedKey) === "1"));
  const [lastSeenFingerprint, setLastSeenFingerprint] = useState(() => seenKey ? localStorage.getItem(seenKey) : null);
  // A cheap fingerprint of "what the coach would see if they expanded this
  // right now" -- team + resolved state + which category (when one is
  // named), deliberately not including percentages/minute counts so small
  // week-to-week wobble in the same underlying situation doesn't re-trigger
  // the dot. Null while the report is still loading.
  const fingerprint = (team && result) ? team.id + "|" + result.state + "|" + (result.categoryId || "") : null;
  const hasNewInsight = collapsed && fingerprint != null && fingerprint !== lastSeenFingerprint;
  // Whenever this is actually visible and showing a concrete state, that
  // counts as "seen" -- covers both the coach expanding it (their explicit
  // dismissal of the dot) and it simply being expanded already when a new
  // state resolves (no dot to dismiss in the first place).
  useEffect(() => {
    if (collapsed || !fingerprint || !seenKey) return;
    setLastSeenFingerprint(fingerprint);
    localStorage.setItem(seenKey, fingerprint);
  }, [collapsed, fingerprint, seenKey]);
  const toggleCollapsed = () => setCollapsed(c => {
    const next = !c;
    if (collapsedKey) localStorage.setItem(collapsedKey, next ? "1" : "0");
    return next;
  });

  if (!team) return null;

  const header = (<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--td)" }}>Development Pulse</span>
      {hasNewInsight && <span aria-label="New insight available" title="New insight available" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red)", display: "inline-block", flexShrink: 0 }} />}
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--black)" }}>{team.name}</span>
      <button type="button" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? "Expand Development Pulse" : "Collapse Development Pulse"} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--td)", padding: 4, display: "flex", alignItems: "center" }}>
        <Ic_Caret up={!collapsed} />
      </button>
    </div>
  </div>);

  if (!report || !result) return (<div className="card mb10" style={{ padding: "14px 16px" }}>
    {header}
    {!collapsed && <div style={{ height: 60 }} />}
  </div>);

  const presented = presentState(result, canManage);
  const teamColor = (team.colorPrimary) || "var(--green)";

  return (<div className="dev-pulse-card card mb10" style={{ padding: 0, overflow: "hidden", position: "relative" }} key={collapsed ? "collapsed" : result.state}>
    <style>{PULSE_CSS}</style>
    <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: teamColor }} />
    <div style={{ padding: "14px 16px 14px 20px" }}>
      <div style={{ marginBottom: collapsed ? 0 : 8 }}>{header}</div>

      {!collapsed && (<>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 18, fontWeight: 900, marginBottom: 4, color: presented.lowEmphasis ? "var(--td)" : "var(--black)" }}>{presented.headline}</div>
        {presented.body && <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 10, lineHeight: 1.4 }}>{presented.body}</div>}
        {presented.basisNote && <div style={{ fontSize: 11, color: "var(--amber)", marginBottom: 8 }}>{presented.basisNote}</div>}

        {presented.graphic === "placeholder" && <PlaceholderStrip />}
        {presented.graphic === "goal_mix" && <GoalMixStrip categories={(report.skills || []).filter(s => s.target_pct != null).map(s => ({ skillCategoryId: s.skill_category_id, name: s.name, targetPct: s.target_pct }))} />}
        {presented.graphic === "completeness" && <CompletenessBar attributedPct={100 - result.untaggedPct} untaggedPct={result.untaggedPct} />}
        {(presented.graphic === "bullet" || presented.graphic === "bullet_variance") && (() => {
          const cat = presented.graphic === "bullet_variance" ? result.largestVarianceCategory : result;
          const currentPct = presented.graphic === "bullet_variance" ? cat.currentPct : result.currentPct;
          const targetPct = presented.graphic === "bullet_variance" ? cat.targetPct : result.targetPct;
          return <BulletBar label={result.categoryName || (cat && cat.name)} currentPct={currentPct} targetPct={targetPct} projectedPct={presented.noProjection ? null : result.projectedPct} color={teamColor} />;
        })()}

        {isLiveNow && <div style={{ fontSize: 11, color: "var(--td)", marginTop: 8 }}>Insights will update after the practice is completed.</div>}

        {presented.cta && <button className="btn primary bsm bfull" style={{ marginTop: 12 }} onClick={() => onNavigate(presented.cta)}>{presented.cta.label}</button>}
      </>)}
    </div>
  </div>);
}
