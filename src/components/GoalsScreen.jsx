import React, { useState, useEffect, useCallback, useRef } from "react";
import { useBlocker } from "react-router-dom";
import { canManageTeamInMode, localDateStr, summarizeCategoryTrend, calculateGoalGapGuidance, TREND_FLAT_THRESHOLD_PCT, classifyDurationVariance } from "../constants.js";
import {
  fetchTeamGoals, setTeamGoals, updateGoalsWindowWeeks,
  fetchTeamGoalReport, fetchTeamGoalTrends, fetchTeamSessionHistory, fetchSessionActivityLog, fetchSessionExecutionScorecard, fetchNotesForPractice, archiveNote,
  setSessionExclusion, adjustSessionActivity, addSessionActivityRow, logGoalViewed,
  markPracticeNotesViewed, markNotesViewedForPractices,
} from "../supabase.js";
import PracticePlanPrint from "./PracticePlanPrint.jsx";

// Author-role labeling (Assistant Coach handoff §2.3): resolve a staff
// note's real name+role from the team roster already loaded here (never a
// raw stored name); anonymous notes show their freeform label instead.
function noteAuthorLabel(note, team) {
  if (note.authorKind === "anonymous") return (note.authorLabel || "A helper") + " · Helper";
  const c = team && (team.coaches || []).find(c => c.userId === note.createdBy);
  return (c ? c.name : "A coach") + (c ? " · " + c.role : "");
}

const fmtMin = n => (Math.round((n || 0) * 10) / 10);
const fmtSavedAt = iso => iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

// Bullet-chart-style row (handoff §5.2): a target tick overlaid on stacked
// planned/actual bars, with a delta chip only when the gap is real (>=3
// points) -- judgment lives at the window level, never flagging a single
// practice (there's no per-practice data here at all, only the window
// aggregate from get_team_goal_report).
function SkillBar({ label, pct, color }) {
  return (<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <span style={{ width: 50, fontSize: 10, color: "var(--td)", flexShrink: 0, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 700 }}>{label}</span>
    <div style={{ flex: 1, height: 8, background: "var(--s2)", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ height: "100%", width: Math.min(100, pct) + "%", background: color, borderRadius: 4 }} />
    </div>
    <span style={{ width: 38, textAlign: "right", fontSize: 11, fontFamily: "DM Mono,monospace", color: "var(--tm)" }}>{pct}%</span>
  </div>);
}

function SkillRow({ skill }) {
  const hasTarget = skill.target_pct !== null && skill.target_pct !== undefined;
  const delta = hasTarget ? Math.round((skill.actual_pct - skill.target_pct) * 10) / 10 : null;
  const showDelta = hasTarget && Math.abs(delta) >= 3;
  return (<div style={{ marginBottom: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5, gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skill.name}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {hasTarget && <span style={{ fontSize: 11, color: "var(--td)" }}>target {skill.target_pct}%</span>}
        {showDelta && <span className={"bdg " + (delta < 0 ? "bs" : "bp")}>{delta > 0 ? "+" : ""}{delta} pts vs target</span>}
      </div>
    </div>
    <div style={{ position: "relative", paddingLeft: 0 }}>
      {/* CSS calc() only allows a length-percentage multiplied by a unitless
          number, not by another percentage -- target_pct/100 (a number),
          not "target_pct%", is what makes this valid. */}
      {hasTarget && <div style={{ position: "absolute", left: "calc(56px + (100% - 94px) * " + (Math.min(100, skill.target_pct) / 100) + ")", top: -3, bottom: -3, width: 2, background: "var(--black)", zIndex: 2 }} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <SkillBar label="Planned" pct={skill.planned_pct} color="var(--gb)" />
        <SkillBar label="Actual" pct={skill.actual_pct} color="var(--green)" />
      </div>
    </div>
  </div>);
}

// Slider-per-category editor (Jax's call, 2026-07-19, take 2 -- goals moved
// up from individual skill tags to their global category: "Shooting," not
// "Catch-and-shoot" beneath it). One slider per skill_category for the
// team's sport, no tag-level breakdown; the total across all of them must
// land on exactly 100 (or exactly 0, meaning "not configured yet") before
// Save is enabled. Saving is one atomic RPC (set_team_goals) rather than N
// separate row writes.
function GoalsEditor({ teamId, team, data, goals, refreshGoals }) {
  const [windowWeeks, setWindowWeeks] = useState(team.goalsWindowWeeks || 4);
  useEffect(() => setWindowWeeks(team.goalsWindowWeeks || 4), [team.goalsWindowWeeks]);
  const [savingWindow, setSavingWindow] = useState(false);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // teams.goals_saved_at (set by set_team_goals itself, server-side) is the
  // source of truth on next load; updated optimistically right after a
  // successful save here so it doesn't wait on a full team refetch, same
  // pattern as windowWeeks above.
  const [savedAt, setSavedAt] = useState(team.goalsSavedAt || null);
  useEffect(() => setSavedAt(team.goalsSavedAt || null), [team.goalsSavedAt]);

  const categories = (data.skillCategories || []).filter(c => c.sport === team.sport && !c.archived_at).sort((a, b) => a.sort_order - b.sort_order);

  // Real-usage gap found live: a coach dragged sliders to a total that
  // wasn't 100%, tapped the (already-disabled, but visually identical to
  // enabled -- see .btn:disabled fix) Save button, nothing happened, then
  // navigated away and back and their edits were gone -- values only ever
  // lives in local state, so leaving without a successful save silently
  // discards it. baselineRef tracks the last-persisted snapshot so `dirty`
  // can tell "edited, not yet saved" apart from "just loaded."
  const baselineRef = useRef("{}");
  useEffect(() => {
    const initial = Object.fromEntries(goals.map(g => [g.categoryId, g.targetPct]));
    setValues(initial);
    baselineRef.current = JSON.stringify(initial);
  }, [goals]);
  const dirty = JSON.stringify(values) !== baselineRef.current;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = e => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname, [dirty]));
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("You have unsaved changes to your goals. Leave without saving?")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  const total = Object.values(values).reduce((s, v) => s + (v || 0), 0);
  const canSave = total === 100 || total === 0;

  const saveWindow = async () => {
    setSavingWindow(true);
    await updateGoalsWindowWeeks(teamId, windowWeeks);
    setSavingWindow(false);
  };
  const setValue = (categoryId, pct) => setValues(p => ({ ...p, [categoryId]: Math.max(0, Math.min(100, pct)) }));
  const save = async () => {
    if (!canSave) return;
    setSaving(true); setError("");
    const targets = Object.entries(values).filter(([, pct]) => pct > 0).map(([categoryId, targetPct]) => ({ categoryId, targetPct }));
    const { error } = await setTeamGoals(teamId, targets);
    setSaving(false);
    if (error) { setError("Something went wrong saving. Try again."); return; }
    baselineRef.current = JSON.stringify(values);
    setSavedAt(new Date().toISOString());
    await refreshGoals();
  };

  return (<div className="card mb10">
    <div className="clbl mb8">Goals</div>
    <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>Set targets for how your team spends practice time. The total must reach exactly 100% (or 0% to clear all goals) before saving.</div>

    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: "var(--r)", marginBottom: 14, background: total === 100 ? "var(--gbg)" : total > 100 ? "#fef2f2" : "var(--s1)", border: "1px solid " + (total === 100 ? "var(--gb)" : total > 100 ? "#fecaca" : "var(--b)") }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>{total}% allocated</span>
      <span style={{ fontSize: 12, color: total === 100 ? "var(--green2)" : total > 100 ? "var(--red)" : "var(--td)" }}>
        {total === 100 ? "Ready to save" : total > 100 ? (total - 100) + "% over, reduce before saving" : (100 - total) + "% remaining"}
      </span>
    </div>

    {categories.length === 0 && <div style={{ fontSize: 12, color: "var(--td)" }}>No skill categories set up for {team.sport} yet.</div>}
    {categories.map(cat => {
      const v = values[cat.id] || 0;
      return (<div key={cat.id} style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{cat.name}</span>
          {/* Typing a precise number was the actual ask -- dragging a
              slider to land on an exact value (especially when several
              categories need to add up to exactly 100) is fiddly. Kept the
              slider too since it's still the faster way to get in the
              right neighborhood. */}
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <input type="number" min="0" max="100" value={v} onChange={e => setValue(cat.id, e.target.value === "" ? 0 : Number(e.target.value))} style={{ width: 48, textAlign: "right", fontFamily: "DM Mono,monospace", fontSize: 13, color: "var(--tm)", border: "1px solid var(--b)", borderRadius: 4, padding: "2px 4px" }} />
            <span style={{ fontFamily: "DM Mono,monospace", fontSize: 13, color: "var(--tm)" }}>%</span>
          </div>
        </div>
        <input type="range" min="0" max="100" step="1" value={v} onChange={e => setValue(cat.id, Number(e.target.value))} style={{ width: "100%", accentColor: "var(--green)" }} />
      </div>);
    })}

    {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 10 }}>{error}</div>}
    <button className="btn primary bmd bfull" onClick={save} disabled={!canSave || saving}>{saving ? "Saving..." : "Save Goals"}</button>
    {savedAt && <div style={{ fontSize: 11, color: "var(--td)", textAlign: "center", marginTop: 6 }}>Last saved {fmtSavedAt(savedAt)}</div>}

    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--b)" }}>
      <label className="lbl">Measure over the last</label>
      <div className="row">
        <input className="inp" type="number" min="1" max="12" style={{ width: 64, padding: "6px 8px" }} value={windowWeeks} onChange={e => setWindowWeeks(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} onBlur={saveWindow} />
        <span style={{ fontSize: 13, color: "var(--td)" }}>week{windowWeeks === 1 ? "" : "s"}</span>
        {savingWindow && <span style={{ fontSize: 11, color: "var(--td)" }}>Saving...</span>}
      </div>
    </div>
  </div>);
}

// Target vs. planned vs. actual glance view (handoff §5.2). Percentages
// come straight from get_team_goal_report, already computed against the
// denominator (attributed minutes excluding breaks) so tagged% + untagged%
// reconciles to ~100 on both sides.
function GlanceView({ report }) {
  if (!report) return null;
  const skills = report.skills || [];
  const untagged = report.untagged || { planned_pct: 0, actual_pct: 0 };
  const denomActual = (report.denominators || {}).actual_minutes_total || 0;
  const completedCount = (report.practices || {}).completed_session_count || 0;
  const otherPerPractice = completedCount > 0 ? fmtMin(report.other_transition_minutes / completedCount) : 0;
  const untaggedHigh = untagged.planned_pct > 25 || untagged.actual_pct > 25;

  return (<div className="card mb10">
    <div className="clbl mb8">Target vs. Planned vs. Actual <span style={{ textTransform: "none", fontWeight: 400 }}>· last {report.window_weeks} week{report.window_weeks === 1 ? "" : "s"}</span></div>
    {skills.length === 0 && <div style={{ fontSize: 13, color: "var(--td)" }}>No goals set and nothing tagged yet this window.</div>}
    {skills.map(s => (<SkillRow key={s.skill_category_id} skill={s} />))}

    <div style={{ borderTop: "1px solid var(--b)", paddingTop: 10, marginTop: skills.length ? 4 : 0 }}>
      <SkillRow skill={{ name: "Untagged", target_pct: null, planned_pct: untagged.planned_pct, actual_pct: untagged.actual_pct }} />
      <div style={{ fontSize: 12, color: "var(--td)", marginTop: -6, marginBottom: 10 }}>
        Other / transitions: ~{otherPerPractice} min/practice between drills
      </div>
      {untaggedHigh && <div style={{ fontSize: 12, color: "var(--amber)", background: "var(--ambg)", border: "1px solid var(--ambb)", borderRadius: "var(--rs)", padding: "8px 10px" }}>
        A lot of practice time isn't tagged to a skill. Linking drills to the library when you build a practice will make this report more useful.
      </div>}
    </div>
    {denomActual === 0 && completedCount === 0 && <div style={{ fontSize: 12, color: "var(--td)", marginTop: 8 }}>No completed practices in this window yet.</div>}
  </div>);
}

const fmtClock = iso => iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;
// null while still running (no endedAt yet), otherwise whole minutes.
const logMinutes = l => l.endedAt ? Math.round((new Date(l.endedAt) - new Date(l.startedAt)) / 60000) : null;
// Jumping around the Overview list used to leave a real, permanent
// zero-duration row behind for every activity passed through on the way to
// the one actually wanted (fixed going forward in CommandScreen, but
// sessions logged before that fix still have these sitting in the data).
// They carry no real practice time, so drop them here rather than show
// "07:35 PM - 07:35 PM" rows that only look like a bug.
const meaningfulLogs = logs => logs.filter(l => l.endedAt === null || logMinutes(l) > 0);
// datetime-local wants "YYYY-MM-DDTHH:MM" in local time, no timezone suffix.
const toLocalInputValue = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
};

const fmtSec = s => s == null ? null : Math.round(s / 60 * 10) / 10;

function ScoreTile({ label, value }) {
  return (<div>
    <div style={{ fontSize: 10, color: "var(--td)", textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 700 }}>{label}</div>
    <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
  </div>);
}

const EXECUTION_GROUP_LABELS = {
  extended: "Extended", shortened: "Shortened", on_plan: "On Plan",
  skipped: "Skipped / Not Logged", manual: "Logged but Not Originally Captured",
};
function ExecutionGroup({ groupKey, items }) {
  if (!items.length) return null;
  return (<div style={{ marginBottom: 10 }}>
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--green2)", marginBottom: 4 }}>{EXECUTION_GROUP_LABELS[groupKey]} ({items.length})</div>
    {items.map(a => (<div key={a.unit_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
      <span>{a.name}{a.category_names.length > 0 && <span style={{ color: "var(--td)" }}> · {a.category_names.join(", ")}</span>}</span>
      <span style={{ color: "var(--tm)", fontFamily: "DM Mono,monospace", flexShrink: 0, marginLeft: 8 }}>
        {fmtSec(a.planned_seconds)}m planned{a.actual_seconds != null ? " · " + fmtSec(a.actual_seconds) + "m actual" : " · not logged"}
      </span>
    </div>))}
  </div>);
}

// Enhancement 5. Structured measures, deliberately no single overall score
// (spec: "the scorecard is a structured set of measures, not a judgment of
// coaching quality"). Classification reuses the exact same
// classifyDurationVariance/ON_PLAN_TOLERANCE_SECONDS Drill Insights also
// uses, so "extended"/"shortened" means the same thing in both places.
function PracticeExecutionScorecard({ scorecard }) {
  if (!scorecard) return (<div style={{ fontSize: 12, color: "var(--td)", padding: "8px 0" }}>Loading execution scorecard...</div>);

  const groups = { extended: [], shortened: [], on_plan: [], skipped: [], manual: [] };
  (scorecard.activities || []).forEach(a => {
    if (a.actual_seconds == null) { groups.skipped.push(a); return; }
    if (a.logged_but_not_captured) { groups.manual.push(a); return; }
    const c = classifyDurationVariance(a.planned_seconds, a.actual_seconds);
    groups[c].push(a);
  });
  const pctCaptured = scorecard.planned_activity_minutes > 0 ? Math.round(scorecard.logged_activity_minutes / scorecard.planned_activity_minutes * 100) : null;
  const noLogsAtAll = (scorecard.activities || []).every(a => a.actual_seconds == null);

  return (<div className="card mb10">
    <div className="clbl mb8">Practice Execution</div>
    {scorecard.excluded && <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 8 }}>This session is excluded from rolling Goals &amp; Insights, but the scorecard below still reflects what actually happened.</div>}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
      <ScoreTile label="Planned Duration" value={scorecard.planned_duration_minutes != null ? scorecard.planned_duration_minutes + "m" : "Not set"} />
      <ScoreTile label="Actual Duration" value={scorecard.actual_wall_minutes + "m"} />
      <ScoreTile label="Planned Activity Time" value={scorecard.planned_activity_minutes + "m"} />
      <ScoreTile label="Logged Activity Time" value={scorecard.logged_activity_minutes + "m"} />
      <ScoreTile label="Plan Completion" value={scorecard.plan_completion_count + " of " + scorecard.plan_total_count + " logged"} />
      <ScoreTile label="Attendance" value={scorecard.attendance_present_count + " of " + scorecard.roster_count} />
    </div>
    {pctCaptured != null && <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 12 }}>{pctCaptured}% of planned activity minutes captured · ~{scorecard.other_transition_minutes}m other/transition time</div>}

    {noLogsAtAll ? (
      <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 8 }}>No actual activity timing was captured for this practice.</div>
    ) : (<>
      <ExecutionGroup groupKey="extended" items={groups.extended} />
      <ExecutionGroup groupKey="shortened" items={groups.shortened} />
      <ExecutionGroup groupKey="on_plan" items={groups.on_plan} />
      <ExecutionGroup groupKey="skipped" items={groups.skipped} />
      <ExecutionGroup groupKey="manual" items={groups.manual} />
    </>)}

    {scorecard.category_comparison.length > 0 && <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--b)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--td)", marginBottom: 4 }}>Planned vs. Actual, This Practice</div>
      {scorecard.category_comparison.slice(0, 3).map(c => (<div key={c.skill_category_id} style={{ fontSize: 12, marginBottom: 2 }}>{c.name}: planned {c.planned_pct}%, actual {c.actual_pct}%</div>))}
    </div>}
  </div>);
}

function TimeRangeForm({ start, end, setStart, setEnd, onSave, onCancel, busy, saveLabel }) {
  return (<div style={{ background: "var(--s2)", borderRadius: "var(--rs)", padding: 10, marginTop: 6 }}>
    <div className="g2 mb6">
      <div className="fld" style={{ marginBottom: 0 }}><label className="lbl">Start</label><input className="inp" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></div>
      <div className="fld" style={{ marginBottom: 0 }}><label className="lbl">End</label><input className="inp" type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></div>
    </div>
    <div className="brow">
      <button className="btn ghost bxs" onClick={onCancel}>Cancel</button>
      <button className="btn primary bxs" onClick={onSave} disabled={busy || !start || !end}>{saveLabel || "Save"}</button>
    </div>
  </div>);
}

// History detail (handoff §5.3-5.4): planned vs. actual per activity (the
// first frontend read path for session_activity_log's real timing --
// HistoryViewer elsewhere in the app still shows only the plan, deliberately
// untouched here to avoid destabilizing its other three call sites, which
// have no session_id to key off of). Editing: exclude toggle, adjust an
// existing row's times, or log a row that was never captured live.
// Deferred, not built: the "warn if attributed time exceeds session wall
// time" client-side guardrail (§5.4) -- the DB-side sane-bounds check
// (adjust_session_activity's +/-1h/12h window, built in step 2) is the real
// safety net; this is UI polish on top of it, not core correctness.
function SessionHistoryDetail({ session, practice, team, data, canManage, onBack, onChanged, setSubViewBack }) {
  // Nav restructure round 3: GoalsScreen is always team-scoped, so this
  // always registers with Layout's colored bar instead of its own inline
  // Back button -- the !setSubViewBack fallback below is just defensive
  // consistency with PracticeDetail/HistoryViewer, not expected to trigger.
  //
  // Real infinite-loop bug found live (Execution Scorecard verification,
  // 2026-08-02), same class as PlayerProfile's useBlocker gotcha already
  // documented below: `onBack` is a fresh closure every time GoalsScreen
  // renders (`onBack={() => setOpenSessionId(null)}`), so depending on it
  // directly re-ran this effect on every render, which called
  // setSubViewBack({onBack}) -- a *new* object every time, which lives in
  // Layout's own state and re-renders Layout (and everything Layout wraps,
  // including this route) on every call, which recreates `onBack` again,
  // forever. The extra state-driven re-renders this session's new
  // scorecard fetch introduced were apparently just enough to tip an
  // already-fragile pattern into a full runaway (reproduced: render count
  // climbing unbounded within a second of opening a session). Fixed the
  // same way PlayerProfile's version was: register once via a ref that
  // always holds the latest onBack, instead of re-registering every time
  // the closure identity changes.
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; });
  useEffect(() => {
    if (!setSubViewBack) return;
    setSubViewBack({ onBack: () => onBackRef.current() });
    return () => setSubViewBack(null);
  }, [setSubViewBack]);
  const [logs, setLogs] = useState(null);
  const [notes, setNotes] = useState([]);
  const [editingLogId, setEditingLogId] = useState(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [addingFor, setAddingFor] = useState(null);
  const [addStart, setAddStart] = useState("");
  const [addEnd, setAddEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [scorecard, setScorecard] = useState(null);
  const loc = (practice && data) ? data.locations.find(l => l.id === practice.locationId) : null;

  const refresh = useCallback(() => { fetchSessionActivityLog(session.session_id).then(setLogs); }, [session.session_id]);
  useEffect(() => { refresh(); }, [refresh]);
  // Refreshed alongside the raw log (same triggers: initial mount, an
  // adjust/add/exclude edit) so it never displays stale values after a
  // manager edits history, per the spec's explicit requirement.
  const refreshScorecard = useCallback(() => { setScorecard(null); fetchSessionExecutionScorecard(session.session_id).then(setScorecard); }, [session.session_id]);
  useEffect(() => { refreshScorecard(); }, [refreshScorecard]);
  const refreshNotes = useCallback(() => { if (practice) fetchNotesForPractice(practice.id).then(setNotes); }, [practice && practice.id]);
  useEffect(() => { refreshNotes(); }, [refreshNotes]);
  const doArchiveNote = async id => { await archiveNote(id); refreshNotes(); };
  // Practice History's red dot (see HistoryList below) clears the moment
  // the head coach actually opens this session -- that's what "reviewed"
  // means here. Gated on canManage (not any viewer) since an assistant or
  // helper opening their own read-only view of a session shouldn't silently
  // clear the head coach's unread indicator. Guarded on the session's own
  // has_unviewed_notes so this fires at most once per open, not on every
  // notes refresh (e.g. after archiving one).
  useEffect(() => {
    if (!canManage || !practice || !session.has_unviewed_notes) return;
    markPracticeNotesViewed(practice.id).then(() => { if (onChanged) onChanged(); });
    // eslint-disable-next-line
  }, [canManage, practice && practice.id, session.has_unviewed_notes]);
  const taggedPlayerNames = ids => (ids || []).map(id => { const p = team && team.players.find(p => p.id === id); return p ? p.firstName + (p.lastName ? " " + p.lastName[0] + "." : "") : null; }).filter(Boolean);

  if (!practice) return (<div style={{ paddingBottom: 80 }}>{!setSubViewBack && <div className="row mb10"><button className="btn ghost bxs" onClick={onBack}>&#8249; History</button></div>}<div className="empty"><div className="emtx">Practice not found.</div></div></div>);
  if (logs === null) return (<div style={{ padding: "40px 0", textAlign: "center", color: "var(--td)" }}>Loading...</div>);

  const logsForActivity = actId => meaningfulLogs(logs.filter(l => l.practiceActivityId === actId));
  const logsForStation = stId => meaningfulLogs(logs.filter(l => l.stationId === stId));

  const startAdjust = log => { setEditingLogId(log.id); setEditStart(toLocalInputValue(log.startedAt)); setEditEnd(toLocalInputValue(log.endedAt)); };
  const saveAdjust = async () => {
    if (!editStart || !editEnd) return;
    setBusy(true);
    await adjustSessionActivity(editingLogId, new Date(editStart).toISOString(), new Date(editEnd).toISOString());
    setBusy(false); setEditingLogId(null);
    refresh(); refreshScorecard(); if (onChanged) onChanged();
  };
  const startAddRow = (practiceActivityId, stationId) => { setAddingFor({ practiceActivityId, stationId }); setAddStart(""); setAddEnd(""); };
  const saveAddRow = async () => {
    if (!addStart || !addEnd) return;
    setBusy(true);
    await addSessionActivityRow(session.session_id, { practiceActivityId: addingFor.practiceActivityId, stationId: addingFor.stationId, startedAt: new Date(addStart).toISOString(), endedAt: new Date(addEnd).toISOString() });
    setBusy(false); setAddingFor(null);
    refresh(); refreshScorecard(); if (onChanged) onChanged();
  };
  const toggleExclude = async () => {
    setBusy(true);
    await setSessionExclusion(session.session_id, !session.excluded);
    setBusy(false);
    refreshScorecard();
    if (onChanged) onChanged();
  };

  return (<div style={{ paddingBottom: 80 }}>
    {!setSubViewBack && <div className="row mb10"><button className="btn ghost bxs" onClick={onBack}>&#8249; History</button></div>}
    <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 22, fontWeight: 900, marginBottom: 4 }}>
      {session.ended_at ? new Date(session.ended_at).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "In progress"}
    </div>
    <button className="btn outline bsm bfull" style={{ marginBottom: 12 }} onClick={() => setShowPrint(true)}>Print / Export PDF</button>
    <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>
      {session.wall_minutes}min wall time · {session.attendance_count} attended
      {session.excluded && <span className="bdg bs" style={{ marginLeft: 6 }}>Excluded from goals</span>}
      {session.adjusted && <span className="bdg bp" style={{ marginLeft: 6 }}>Adjusted</span>}
    </div>

    <PracticeExecutionScorecard scorecard={scorecard} />

    {(session.top_skills || []).length > 0 && <div className="card mb10">
      <div className="clbl mb8">Skill Minutes</div>
      {session.top_skills.map(s => (<div key={s.skill_tag_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span>{s.name}</span><span style={{ fontFamily: "DM Mono,monospace", color: "var(--tm)" }}>{s.minutes}m</span>
      </div>))}
    </div>}

    <div className="clbl mb8">Planned vs. Actual</div>
    {(practice.activities || []).map(act => {
      if (act.type === "station_block") return (<div key={act.id} className="ablk mb8">
        <div style={{ padding: "10px 12px", background: "var(--s2)", fontFamily: "Barlow Condensed,sans-serif", fontWeight: 700, fontSize: 14 }}>Station Block · planned {act.stationDuration}m/station</div>
        {(act.stations || []).map(st => {
          const stLogs = logsForStation(st.id);
          const stTotalMin = stLogs.reduce((s, l) => s + (logMinutes(l) || 0), 0);
          return (<div key={st.id} style={{ padding: "10px 12px", borderTop: "1px solid var(--b)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{st.name}{st.activityName ? ": " + st.activityName : ""}</span>
              {stLogs.length > 1 && <span style={{ fontSize: 11, fontFamily: "DM Mono,monospace", color: "var(--tm)" }}>{stTotalMin}m total</span>}
            </div>
            {stLogs.length === 0 && <div style={{ fontSize: 12, color: "var(--td)" }}>No actual time logged.{canManage && <button className="btn ghost bxs" style={{ marginLeft: 8 }} onClick={() => startAddRow(null, st.id)}>Log actual time</button>}</div>}
            {stLogs.map(l => (<div key={l.id} style={{ fontSize: 12, color: "var(--tm)", display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              Actual: {fmtClock(l.startedAt)}{l.endedAt ? " - " + fmtClock(l.endedAt) : " (ongoing)"}
              {l.endedAt && <span style={{ fontFamily: "DM Mono,monospace" }}>&middot; {logMinutes(l)}m</span>}
              {l.adjustedAt && <span className="bdg bp">adjusted</span>}
              {canManage && <button className="btn ghost bxs" onClick={() => startAdjust(l)}>Edit</button>}
            </div>))}
            {addingFor && addingFor.stationId === st.id && <TimeRangeForm start={addStart} end={addEnd} setStart={setAddStart} setEnd={setAddEnd} onSave={saveAddRow} onCancel={() => setAddingFor(null)} busy={busy} saveLabel="Log time" />}
            {stLogs.some(l => l.id === editingLogId) && <TimeRangeForm start={editStart} end={editEnd} setStart={setEditStart} setEnd={setEditEnd} onSave={saveAdjust} onCancel={() => setEditingLogId(null)} busy={busy} />}
          </div>);
        })}
      </div>);

      const actLogs = logsForActivity(act.id);
      const actTotalMin = actLogs.reduce((s, l) => s + (logMinutes(l) || 0), 0);
      return (<div key={act.id} className="card mb8">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{act.name}</span>
          <span className="bdg bp">{act.duration}m planned</span>
        </div>
        {actLogs.length === 0 && <div style={{ fontSize: 12, color: "var(--td)" }}>No actual time logged{act.type === "break" ? " (break)" : ""}.
          {canManage && act.type !== "break" && <button className="btn ghost bxs" style={{ marginLeft: 8 }} onClick={() => startAddRow(act.id, null)}>Log actual time</button>}
        </div>}
        {actLogs.map(l => (<div key={l.id} style={{ fontSize: 12, color: "var(--tm)", display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
          Actual: {fmtClock(l.startedAt)}{l.endedAt ? " - " + fmtClock(l.endedAt) : " (ongoing)"}
          {l.endedAt && <span style={{ fontFamily: "DM Mono,monospace" }}>&middot; {logMinutes(l)}m</span>}
          {l.adjustedAt && <span className="bdg bp">adjusted</span>}
          {canManage && <button className="btn ghost bxs" onClick={() => startAdjust(l)}>Edit</button>}
        </div>))}
        {actLogs.length > 1 && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--black2)", marginTop: 4 }}>Total actual: {actTotalMin}m</div>}
        {addingFor && addingFor.practiceActivityId === act.id && <TimeRangeForm start={addStart} end={addEnd} setStart={setAddStart} setEnd={setAddEnd} onSave={saveAddRow} onCancel={() => setAddingFor(null)} busy={busy} saveLabel="Log time" />}
        {actLogs.some(l => l.id === editingLogId) && <TimeRangeForm start={editStart} end={editEnd} setStart={setEditStart} setEnd={setEditEnd} onSave={saveAdjust} onCancel={() => setEditingLogId(null)} busy={busy} />}
      </div>);
    })}

    {notes.length > 0 && <div className="card mb10">
      <div className="clbl mb8">Notes</div>
      {(() => {
        const byActivity = {};
        const general = [];
        notes.forEach(n => { if (n.practiceActivityId) (byActivity[n.practiceActivityId] ||= []).push(n); else general.push(n); });
        const activityLabel = id => { const a = practice.activities.find(a => a.id === id); return a ? (a.type === "station_block" ? "Station Block" : a.name) : "Drill"; };
        const renderNote = n => (<div key={n.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "var(--td)", marginBottom: 2 }}>{noteAuthorLabel(n, team)} · {new Date(n.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</div>
            <div style={{ fontSize: 13 }}>{n.text}</div>
            {n.playerIds && n.playerIds.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>{taggedPlayerNames(n.playerIds).map(name => (<span key={name} className="bdg bs" style={{ fontSize: 10 }}>{name}</span>))}</div>}
          </div>
          {canManage && <button className="btn ghost bxs" onClick={() => doArchiveNote(n.id)} title="Hide this note">&times;</button>}
        </div>);
        return (<div>
          {Object.keys(byActivity).map(actId => (<div key={actId} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--green2)", marginBottom: 4 }}>{activityLabel(actId)}</div>
            {byActivity[actId].map(renderNote)}
          </div>))}
          {general.length > 0 && <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--green2)", marginBottom: 4 }}>End of Practice</div>
            {general.map(renderNote)}
          </div>}
        </div>);
      })()}
    </div>}

    {canManage && <button className={"btn bmd bfull " + (session.excluded ? "primary" : "outline")} onClick={toggleExclude} disabled={busy}>
      {session.excluded ? "Restore to goals" : "Exclude from goals"}
    </button>}
    {showPrint && data && <PracticePlanPrint practice={practice} team={team} loc={loc} data={data} onClose={() => setShowPrint(false)} />}
  </div>);
}

// Reverse-chron completed-session list (handoff §5.3), "promoted, actuals-
// first" -- get_team_session_history already sorts by ended_at desc.
function HistoryList({ history, data, canManage, onOpen }) {
  if (!history.length) return (<div className="empty"><div className="emtx">No practice history yet.</div></div>);
  return (<div>
    {history.map(s => {
      const practice = data.practices.find(p => p.id === s.practice_id);
      return (<div key={s.session_id} className="card" style={{ marginBottom: 8, cursor: "pointer", opacity: s.excluded ? 0.6 : 1 }} onClick={() => onOpen(s)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {canManage && s.has_unviewed_notes && <span title="Has a note you haven't reviewed yet" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red)", flexShrink: 0 }} />}
              <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 15, fontWeight: 700 }}>
                {s.ended_at ? new Date(s.ended_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "In progress"}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--td)" }}>
              {s.wall_minutes}min · {s.attendance_count} attended
              {(() => { const names = (s.top_skills || []).slice(0, 3).map(sk => sk.name).join(", "); return names && " · " + names; })()}
              {s.excluded && <span className="bdg bs" style={{ marginLeft: 6 }}>Excluded</span>}
              {s.adjusted && <span className="bdg bp" style={{ marginLeft: 6 }}>Adjusted</span>}
            </div>
          </div>
          <span style={{ color: "var(--td)", fontSize: 18 }}>&#8250;</span>
        </div>
      </div>);
    })}
  </div>);
}

// Overview/Trends/History internal view selector (Goals & Insights
// enhancements spec, "Recommended internal navigation"). Same rounded-pill
// sub-toggle visual already used for Coach/Org mode (HomeScreen.jsx) and My
// Drills/Team Libraries (NewLibraryScreen.jsx) -- generalizes cleanly to a
// third option rather than inventing a new tab style.
function GoalsSubnav({ view, setView }) {
  return (<div style={{ display: "flex", gap: 0, background: "var(--s2)", borderRadius: "var(--r)", padding: 3, marginBottom: 14 }}>
    {[{ k: "overview", label: "Overview" }, { k: "trends", label: "Trends" }, { k: "history", label: "History" }].map(t => (
      <button key={t.k} onClick={() => setView(t.k)} style={{ flex: 1, padding: "7px 0", border: "none", cursor: "pointer", borderRadius: "calc(var(--r) - 2px)", background: view === t.k ? "#fff" : "transparent", fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: view === t.k ? "var(--black)" : "var(--td)" }}>{t.label}</button>
    ))}
  </div>);
}

// Compact inline-SVG weekly line chart -- Actual (solid, heavier) vs.
// Planned (dashed, lighter) vs. current Target (dotted flat reference),
// distinguishable by line style as well as color per the acceptance
// criteria ("not relying only on color"). Null weeks break the line rather
// than connecting across them (spec: "empty weeks do not produce misleading
// connected data"), by splitting into contiguous runs of usable points.
function WeeklyTrendChart({ weeks, targetPct }) {
  const W = 280, H = 64, PAD = 6;
  const n = weeks.length;
  const xStep = n > 1 ? (W - PAD * 2) / (n - 1) : 0;
  const x = i => PAD + i * xStep;
  const y = pct => H - PAD - (Math.max(0, Math.min(100, pct)) / 100) * (H - PAD * 2);

  const runsFor = key => {
    const runs = [];
    let cur = [];
    weeks.forEach((w, i) => {
      if (w[key] == null) { if (cur.length) runs.push(cur); cur = []; return; }
      cur.push([x(i), y(w[key])]);
    });
    if (cur.length) runs.push(cur);
    return runs;
  };
  const actualRuns = runsFor("actual_pct");
  const plannedRuns = runsFor("planned_pct");
  const toPoints = run => run.map(p => p.join(",")).join(" ");

  return (<svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: H, display: "block" }} role="img" aria-label={"Weekly actual and planned trend" + (targetPct != null ? ", target " + targetPct + "%" : "")}>
    {targetPct != null && <line x1={PAD} x2={W - PAD} y1={y(targetPct)} y2={y(targetPct)} stroke="var(--black)" strokeWidth="1.5" strokeDasharray="1,3" />}
    {plannedRuns.map((run, i) => (<polyline key={"p" + i} points={toPoints(run)} fill="none" stroke="var(--gb)" strokeWidth="2" strokeDasharray="4,3" />))}
    {actualRuns.map((run, i) => (<g key={"a" + i}>
      <polyline points={toPoints(run)} fill="none" stroke="var(--green)" strokeWidth="2.5" />
      {run.map((p, j) => (<circle key={j} cx={p[0]} cy={p[1]} r="2.5" fill="var(--green)" />))}
    </g>))}
  </svg>);
}

// Enhancement 1's per-category card: name, current target/rolling planned/
// rolling actual, pt variance, weekly chart, plain-language trend summary.
// Tapping expands a weekly table so the report reads correctly without
// relying only on chart geometry (acceptance criteria).
// Simple unweighted average of a week field across weeks that have it --
// deliberately not reusing get_team_goal_report's own "rolling" percentages
// here, even though both are labeled "current rolling": that report's
// planned bucket is forward-looking (what's currently scheduled), while
// this card's chart is the backward-looking, completed-session-cohort
// figure get_team_goal_trends returns -- mixing the two produced a real,
// confusing mismatch caught in live verification (a card reading "Planned
// 0%" directly beside a chart visibly showing ~55% planned). Averaging the
// same weekly values the chart already plots keeps the summary line and
// the chart telling the same story.
const avgWeekField = (weeks, key) => {
  const vals = weeks.filter(w => w[key] != null).map(w => w[key]);
  return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;
};
function GoalTrendCard({ cat }) {
  const [expanded, setExpanded] = useState(false);
  const weeks = cat.weeks || [];
  const currentActualPct = avgWeekField(weeks, "actual_pct");
  const currentPlannedPct = avgWeekField(weeks, "planned_pct");
  const variance = (currentActualPct != null && cat.target_pct != null) ? Math.round((currentActualPct - cat.target_pct) * 10) / 10 : null;
  const summary = summarizeCategoryTrend(weeks, cat.target_pct);

  return (<div className="card mb10">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", cursor: "pointer" }} onClick={() => setExpanded(e => !e)}>
      <span style={{ fontSize: 15, fontWeight: 700 }}>{cat.skill_category_name}</span>
      <span style={{ color: "var(--td)", fontSize: 16 }}>{expanded ? "▾" : "▸"}</span>
    </div>
    <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--td)", marginTop: 2, marginBottom: 8, flexWrap: "wrap" }}>
      <span>Target {cat.target_pct}%</span>
      <span>Planned {currentPlannedPct != null ? currentPlannedPct + "%" : "–"}</span>
      <span>Actual {currentActualPct != null ? currentActualPct + "%" : "–"}</span>
      {variance != null && <span style={{ fontWeight: 700, color: Math.abs(variance) < TREND_FLAT_THRESHOLD_PCT ? "var(--td)" : (variance < 0 ? "var(--red)" : "var(--green2)") }}>{variance > 0 ? "+" : ""}{variance} pts vs target</span>}
    </div>
    <WeeklyTrendChart weeks={weeks} targetPct={cat.target_pct} />
    <div style={{ fontSize: 12, color: "var(--td)", marginTop: 8 }}>{summary}</div>
    {expanded && <div style={{ marginTop: 10, borderTop: "1px solid var(--b)", paddingTop: 8 }}>
      {weeks.map(w => (<div key={w.week_start_local} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--s2)" }}>
        <span style={{ color: "var(--td)" }}>{new Date(w.week_start_local + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}–{new Date(w.week_end_local + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        <span>Planned {w.planned_pct != null ? w.planned_pct + "%" : "–"}</span>
        <span>Actual {w.actual_pct != null ? w.actual_pct + "%" : "–"}</span>
        <span style={{ color: "var(--td)" }}>Target {cat.target_pct}%</span>
      </div>))}
    </div>}
  </div>);
}

// Enhancement 1's Trends view. Fetches get_team_goal_trends once per team +
// window -- every number a card shows (including its rolling Planned/
// Actual summary) comes from that one payload, never mixed with
// get_team_goal_report's forward-looking Planned bucket (see
// GoalTrendCard's own comment for why that mix produced a real, confusing
// mismatch in live verification).
function TrendsView({ teamId, team, canManage }) {
  const [trends, setTrends] = useState(null);
  useEffect(() => { setTrends(null); fetchTeamGoalTrends(teamId).then(setTrends); }, [teamId]);

  if (trends === null) return (<div style={{ padding: "40px 0", textAlign: "center", color: "var(--td)" }}>Loading...</div>);
  const categories = trends.categories || [];
  if (categories.length === 0) return (<div className="empty">
    <div className="emtx">Set team goals to see development trends.</div>
    {canManage && <div style={{ fontSize: 12, color: "var(--td)", marginTop: 6 }}>Switch to Overview to set targets for this team's skill categories.</div>}
  </div>);
  if (!trends.has_any_completed_sessions) return (<div className="empty"><div className="emtx">Run a practice live to begin building actual-time trends.</div></div>);

  return (<div>
    <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 12 }}>Compared with the team's current goals.</div>
    {categories.map(cat => (<GoalTrendCard key={cat.skill_category_id} cat={cat} />))}
  </div>);
}

// Enhancement 2, Next Practice Guidance. Overview-only, sits under the
// existing Target vs. Planned vs. Actual report. Uses Actual history first
// when usable, falls back to Planned (labeled), and only shows minute
// recommendations once a real next-practice (or team-derived) duration is
// known -- never a silently-assumed 60 minutes, per the spec.
function NextPracticeGuidance({ team, teamId, data, report, canManage }) {
  const [showAll, setShowAll] = useState(false);
  if (!report || !(report.skills || []).length) return null;

  const todayStr = localDateStr();
  const teamPractices = (data.practices || []).filter(p => p.teamId === teamId && p.status !== "cancelled");
  const nextPractice = teamPractices.filter(p => p.date >= todayStr).sort((a, b) => a.date === b.date ? (a.startTime || "").localeCompare(b.startTime || "") : a.date.localeCompare(b.date))[0] || null;
  // Fallback: the team's own most recent scheduled duration, when no
  // upcoming practice exists yet -- never an arbitrary assumed default.
  const mostRecentDuration = (() => {
    const withDur = teamPractices.filter(p => p.scheduledDurationMinutes).sort((a, b) => b.date.localeCompare(a.date));
    return withDur.length ? withDur[0].scheduledDurationMinutes : null;
  })();
  const practiceDuration = (nextPractice && nextPractice.scheduledDurationMinutes) || mostRecentDuration || null;

  const hasUsableActual = (report.denominators || {}).actual_minutes_total > 0;
  const hasUsablePlanned = (report.denominators || {}).planned_minutes_total > 0;
  const source = hasUsableActual ? "actual" : (hasUsablePlanned ? "planned" : "goal_only");

  const categories = (report.skills || []).filter(s => s.target_pct != null).map(s => ({
    skillCategoryId: s.skill_category_id, name: s.name, targetPct: s.target_pct,
    currentPct: source === "planned" ? s.planned_pct : s.actual_pct,
    currentMinutes: source === "actual" ? s.actual_minutes : (source === "planned" ? s.planned_minutes : null),
    historicalTotalMinutes: source === "actual" ? report.denominators.actual_minutes_total : (source === "planned" ? report.denominators.planned_minutes_total : null),
  }));
  if (!categories.length) return null;

  const guidance = calculateGoalGapGuidance(categories, practiceDuration);
  const below = guidance.filter(g => !g.atOrAboveGoal).sort((a, b) => b.gapPts - a.gapPts);
  const shown = showAll ? below : below.slice(0, 3);
  const anyUnclosable = below.some(g => g.closable === false);

  return (<div className="card mb10">
    <div className="clbl mb8">Next Practice Guidance</div>
    {source === "planned" && <div style={{ fontSize: 12, color: "var(--amber)", marginBottom: 8 }}>Based on planned practice time until actual timing is available.</div>}
    {source === "goal_only" && <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 8 }}>No practice history yet -- showing your goal mix as a starting point.</div>}
    {!practiceDuration && <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 8 }}>Schedule a practice to see minute recommendations -- percentages only for now.</div>}

    {below.length === 0 && <div style={{ fontSize: 13, color: "var(--td)" }}>Every category is at or above its goal right now.</div>}
    {shown.map(g => (<div key={g.skillCategoryId} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--b)" }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{g.name} is {g.gapPts} point{g.gapPts === 1 ? "" : "s"} below goal.</div>
      <div style={{ fontSize: 12, color: "var(--td)", marginTop: 2 }}>
        {g.goalMixMinutes != null && <>A goal-balanced {practiceDuration}-minute practice would include {g.goalMixMinutes} minute{g.goalMixMinutes === 1 ? "" : "s"}. </>}
        {g.minutesNeeded != null && g.closable && <>Approximately {g.minutesNeeded} minute{g.minutesNeeded === 1 ? "" : "s"} would be needed to fully close the current rolling gap in one practice.</>}
        {g.minutesNeeded != null && g.closable === false && <>This gap cannot be fully closed in one practice.</>}
      </div>
    </div>))}
    {below.length > 3 && !showAll && <button className="btn ghost bxs" onClick={() => setShowAll(true)}>Show all categories</button>}
    {anyUnclosable && below.length > 1 && <div style={{ fontSize: 12, color: "var(--td)", marginTop: 4 }}>The current gaps cannot all be closed in one practice. Prioritize the areas that matter most for this team right now.</div>}
  </div>);
}

// Goals + Insights tab (handoff §5). Ties together the editor, glance view,
// and promoted History list/detail for one team.
export default function GoalsScreen({ data, teamId, coachId, setSubViewBack, mode }) {
  const team = data.teams.find(t => t.id === teamId);
  // canManageTeamInMode, not bare isHeadCoach -- a director overseeing an
  // org team should be able to set goals/exclude sessions/archive notes
  // without needing a personal team_staff row on that specific team.
  const canManage = team ? canManageTeamInMode(team, coachId, mode) : false;
  // Overview/Trends/History (spec's internal-navigation addition). Plain
  // component state, not persisted -- it naturally survives opening/closing
  // a SessionHistoryDetail within the same mount (view isn't reset by that),
  // which is all the spec asks for ("during the same mounted session").
  const [view, setView] = useState("overview");
  const [goals, setGoals] = useState(null);
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState(null);
  const [openSessionId, setOpenSessionId] = useState(null);
  // Re-derived from `history` every render (not stored as its own object)
  // so that toggling exclude/restore -- which refreshes `history` but was
  // otherwise leaving this stale -- actually shows up: previously the
  // Restore button called the right RPC and it succeeded server-side, but
  // the screen kept rendering the session object captured at the moment you
  // opened it, so the label never changed and it looked like nothing
  // happened.
  const openSession = openSessionId ? (history || []).find(h => h.session_id === openSessionId) || null : null;

  const refreshGoals = useCallback(() => fetchTeamGoals(teamId).then(setGoals), [teamId]);
  const refreshReport = useCallback(() => fetchTeamGoalReport(teamId).then(setReport), [teamId]);
  const refreshHistory = useCallback(() => fetchTeamSessionHistory(teamId).then(setHistory), [teamId]);
  useEffect(() => { refreshGoals(); refreshReport(); refreshHistory(); }, [refreshGoals, refreshReport, refreshHistory]);
  // Fire once per team mount, not on every refresh -- same "call once on
  // view load" convention as log_helper_join_event.
  useEffect(() => { logGoalViewed(teamId); }, [teamId]);

  const refreshAll = () => { refreshReport(); refreshHistory(); };
  const anyUnviewed = (history || []).some(s => s.has_unviewed_notes);
  const markAllViewed = async () => {
    await markNotesViewedForPractices((history || []).map(s => s.practice_id));
    refreshHistory();
  };

  if (!team) return null;
  if (goals === null || report === null || history === null) return (<div style={{ padding: "40px 0", textAlign: "center", color: "var(--td)" }}>Loading...</div>);

  if (openSession) {
    const practice = data.practices.find(p => p.id === openSession.practice_id);
    return <SessionHistoryDetail session={openSession} practice={practice} team={team} data={data} canManage={canManage}
      onBack={() => setOpenSessionId(null)}
      onChanged={() => { refreshAll(); }}
      setSubViewBack={setSubViewBack} />;
  }

  // No own page header/title here -- the active "Goals & Insights" top tab
  // (Layout.jsx's team-workspace tab row) already says where you are, same
  // as Schedule/Roster/Equipment/Build don't repeat their own name either.
  // Was embedded under PlanScreen.jsx's Build/Goals & Insights toggle before
  // the 2026-07-2x flattened top-tabs redesign gave this its own direct
  // route (/team/:teamId/goals).
  return (<div style={{ paddingBottom: "calc(var(--tab) + 20px)" }}>
    <GoalsSubnav view={view} setView={setView} />
    {view === "overview" && (<>
      {canManage && <GoalsEditor teamId={teamId} team={team} data={data} goals={goals} refreshGoals={() => { refreshGoals(); refreshReport(); }} />}
      <GlanceView report={report} />
      <NextPracticeGuidance team={team} teamId={teamId} data={data} report={report} canManage={canManage} />
    </>)}
    {view === "trends" && <TrendsView teamId={teamId} team={team} canManage={canManage} />}
    {view === "history" && (<>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div className="clbl" style={{ marginBottom: 0 }}>History</div>
        {canManage && anyUnviewed && <button className="btn ghost bxs" onClick={markAllViewed}>Mark all as viewed</button>}
      </div>
      <HistoryList history={history} data={data} canManage={canManage} onOpen={s => setOpenSessionId(s.session_id)} />
    </>)}
  </div>);
}
