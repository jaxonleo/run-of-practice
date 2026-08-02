import React, { useState, useEffect, useMemo } from "react";
import { isHeadCoach, categoryMinutesForPracticeActivities, calculateGoalGapGuidance, calculateProjectedGoalImpact } from "../constants.js";
import { fetchTeamGoalReport } from "../supabase.js";

// Enhancement 3, combined Builder Goal Guidance. Own sibling section between
// Practice Details and The Run of Practice (never inside Practice Details'
// own body, per the spec, so the coach can keep that collapsed while
// selectively opening this). Starts collapsed on every entry -- plain
// useState(true) is enough since BuilderScreen mounts fresh per entry path,
// no persistence needed or wanted.
//
// Network shape: one get_team_goal_report fetch per team selection (cached
// in state, not refetched per keystroke), then every recalculation as the
// draft changes runs locally via the same pure helpers Next Practice
// Guidance/Trends use -- no RPC call scales with how much the coach edits.
export default function BuilderGoalGuidance({ team, teamId, data, coachId, acts, schedDuration }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState(null);
  useEffect(() => {
    setReport(null);
    if (teamId) fetchTeamGoalReport(teamId).then(setReport);
  }, [teamId]);

  const activityLibraryById = useMemo(() => Object.fromEntries((data.activityLibrary || []).map(a => [a.id, a])), [data.activityLibrary]);
  const skillTagsById = useMemo(() => Object.fromEntries((data.skillTags || []).map(t => [t.id, t])), [data.skillTags]);
  const draft = useMemo(() => categoryMinutesForPracticeActivities(acts, activityLibraryById, skillTagsById), [acts, activityLibraryById, skillTagsById]);

  // Builder has no Coach/Org mode awareness anywhere today (a known,
  // pre-existing gap noted elsewhere in BUILD-STATUS) -- this falls back to
  // a personal head-coach check for the "manage goals" link only. The
  // guidance itself needs no permission check beyond what already gates
  // reaching Builder for this team: get_team_goal_report's own
  // can_access_team authorization (owner/org-member/team_staff) already
  // covers a director managing an org team with no personal team_staff row.
  const canManageLoosely = team && isHeadCoach(team, coachId);

  const duration = schedDuration || null;
  const hasGoals = report && (report.skills || []).some(s => s.target_pct != null);
  const hasUsableActual = report && (report.denominators || {}).actual_minutes_total > 0;
  const hasUsablePlanned = report && (report.denominators || {}).planned_minutes_total > 0;
  const source = hasUsableActual ? "actual" : (hasUsablePlanned ? "planned" : "goal_only");

  const baselineCategories = useMemo(() => {
    if (!report) return [];
    return (report.skills || []).filter(s => s.target_pct != null).map(s => ({
      skillCategoryId: s.skill_category_id, name: s.name, targetPct: s.target_pct,
      currentPct: source === "planned" ? s.planned_pct : s.actual_pct,
      currentMinutes: source === "actual" ? s.actual_minutes : (source === "planned" ? s.planned_minutes : 0),
      historicalTotalMinutes: source === "actual" ? report.denominators.actual_minutes_total : (source === "planned" ? report.denominators.planned_minutes_total : 0),
    }));
  }, [report, source]);

  const guidance = useMemo(() => calculateGoalGapGuidance(baselineCategories, duration), [baselineCategories, duration]);
  const below = guidance.filter(g => !g.atOrAboveGoal).sort((a, b) => b.gapPts - a.gapPts).slice(0, 3);

  const projectionBaseline = useMemo(() => ({
    historicalTotalMinutes: baselineCategories.length ? baselineCategories[0].historicalTotalMinutes : 0,
    categories: baselineCategories,
  }), [baselineCategories]);
  const impact = useMemo(() => calculateProjectedGoalImpact(projectionBaseline, draft), [projectionBaseline, draft]);

  const hasDraft = draft.totalMinutes > 0;
  const collapsedSummary = (() => {
    if (!team || !hasGoals) return "Set team goals to see guidance";
    if (!hasDraft) return below.length + " priorit" + (below.length === 1 ? "y" : "ies") + " · nothing planned yet";
    const closer = impact.filter(i => i.result === "Closer to goal").length;
    const farther = impact.filter(i => i.result === "Farther from goal").length;
    const phrase = closer > farther ? "plan projects closer to goal" : farther > closer ? "plan projects farther from goal" : "plan holds steady vs. goal";
    return below.length + " priorit" + (below.length === 1 ? "y" : "ies") + " · " + phrase;
  })();

  const zeroCategories = baselineCategories.filter(c => !(draft.byCategory[c.skillCategoryId] > 0));

  return (<div className="mb10" style={{ border: "1px solid var(--b)", borderRadius: "var(--r)", overflow: "hidden" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", cursor: "pointer", background: "var(--s1)" }} onClick={() => setOpen(o => !o)}>
      <span style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 13, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", flexShrink: 0 }}>Goal Guidance</span>
      <span style={{ fontSize: 12, color: "var(--td)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{collapsedSummary}</span>
      <span style={{ color: "var(--td)" }}>{open ? "▾" : "▸"}</span>
    </div>

    {open && <div style={{ padding: 14, borderTop: "1px solid var(--b)" }}>
      {!team && <div style={{ fontSize: 13, color: "var(--td)" }}>Select a team to see goal guidance.</div>}
      {team && report && !hasGoals && <div style={{ fontSize: 13, color: "var(--td)" }}>
        This team does not have practice-time goals yet.
        {canManageLoosely && <div style={{ marginTop: 6, fontSize: 12 }}>Set targets from this team's Goals &amp; Insights tab.</div>}
      </div>}
      {team && report === null && <div style={{ fontSize: 13, color: "var(--td)" }}>Loading...</div>}

      {team && hasGoals && (<>
        {source === "planned" && <div style={{ fontSize: 12, color: "var(--amber)", marginBottom: 10 }}>Based on planned practice time until actual timing is available.</div>}
        {source === "goal_only" && <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 10 }}>No practice history yet -- showing your goal mix as a starting point.</div>}
        {!duration && <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 10 }}>Set a practice duration to see minute recommendations -- percentages only for now.</div>}

        <div className="clbl mb8" style={{ fontSize: 11 }}>What to Consider Planning</div>
        {below.length === 0 && <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 12 }}>Every category is at or above its goal right now.</div>}
        {below.map(g => (<div key={g.skillCategoryId} style={{ marginBottom: 8, fontSize: 12 }}>
          <span style={{ fontWeight: 700 }}>{g.name}</span> <span style={{ color: "var(--td)" }}>{g.gapPts} pt{g.gapPts === 1 ? "" : "s"} below goal</span>
          {g.goalMixMinutes != null && <span style={{ color: "var(--td)" }}> · goal mix {g.goalMixMinutes}m</span>}
          {g.minutesNeeded != null && g.closable && <span style={{ color: "var(--td)" }}> · ~{g.minutesNeeded}m to fully close the gap</span>}
          {g.minutesNeeded != null && g.closable === false && <span style={{ color: "var(--amber)" }}> · can't be fully closed in one practice</span>}
        </div>))}

        <div className="clbl mb8" style={{ fontSize: 11, marginTop: 12 }}>What You've Planned So Far</div>
        <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 6 }}>
          {Math.round(draft.totalMinutes)} minute{Math.round(draft.totalMinutes) === 1 ? "" : "s"} planned{duration ? " of " + duration + " scheduled" : ""}
          {draft.untaggedMinutes > 0 && <> · {Math.round(draft.untaggedMinutes)}m untagged</>}
        </div>
        {zeroCategories.length > 0 && <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 10 }}>No time planned yet for: {zeroCategories.map(c => c.name).join(", ")}.</div>}

        <div className="clbl mb8" style={{ fontSize: 11, marginTop: 12 }}>Projected Rolling Impact</div>
        {impact.map(i => (<div key={i.skillCategoryId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span>{i.name}</span>
          <span style={{ color: "var(--td)" }}>{i.currentPct}% &#8594; {i.projectedPct}% <span style={{ color: i.result === "Closer to goal" ? "var(--green2)" : i.result === "Farther from goal" ? "var(--red)" : "var(--td)" }}>({i.result})</span></span>
        </div>))}
        <div style={{ fontSize: 11, color: "var(--td)", marginTop: 8 }}>Projection assumes the practice runs as currently planned.</div>
      </>)}
    </div>}
  </div>);
}
