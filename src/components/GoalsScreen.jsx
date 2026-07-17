import React, { useState, useEffect, useCallback } from "react";
import { isHeadCoach } from "../constants.js";
import {
  fetchTeamGoals, upsertTeamGoal, archiveTeamGoal, updateGoalsWindowWeeks,
  fetchTeamGoalReport, fetchTeamSessionHistory, fetchSessionActivityLog, fetchNotesForPractice,
  setSessionExclusion, adjustSessionActivity, addSessionActivityRow, logGoalViewed,
} from "../supabase.js";

const fmtMin = n => (Math.round((n || 0) * 10) / 10);

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

function GoalsEditor({ teamId, team, data, coachId, goals, refreshGoals }) {
  const [windowWeeks, setWindowWeeks] = useState(team.goalsWindowWeeks || 4);
  useEffect(() => setWindowWeeks(team.goalsWindowWeeks || 4), [team.goalsWindowWeeks]);
  const [addingGoal, setAddingGoal] = useState(false);
  const [pickingCategory, setPickingCategory] = useState(null);
  const [pickingTag, setPickingTag] = useState(null);
  const [newPct, setNewPct] = useState(20);
  const [savingWindow, setSavingWindow] = useState(false);
  const [error, setError] = useState("");

  const categories = (data.skillCategories || []).filter(c => c.sport === team.sport).sort((a, b) => a.sort_order - b.sort_order);
  const goaledTagIds = new Set(goals.map(g => g.skillTagId));
  const tagsForCategory = cid => (data.skillTags || []).filter(t => t.categoryId === cid && (t.scope === "global" || t.scope === "org" || t.ownerUserId === coachId) && !goaledTagIds.has(t.id));
  const tagName = id => { const t = (data.skillTags || []).find(t => t.id === id); return t ? t.name : "(tag)"; };
  const total = goals.reduce((s, g) => s + g.targetPct, 0);

  const saveWindow = async () => {
    setSavingWindow(true);
    await updateGoalsWindowWeeks(teamId, windowWeeks);
    setSavingWindow(false);
  };

  const startAdd = () => { setAddingGoal(true); setPickingCategory(null); setPickingTag(null); setNewPct(20); setError(""); };
  const cancelAdd = () => { setAddingGoal(false); setPickingCategory(null); setPickingTag(null); setError(""); };
  const addGoal = async () => {
    if (!pickingTag) return;
    if (total + newPct > 100) { setError("Active targets would total over 100% -- lower this one or remove another first."); return; }
    setError("");
    await upsertTeamGoal(teamId, pickingTag, newPct, coachId);
    cancelAdd();
    await refreshGoals();
  };
  const updateTarget = async (goal, pct) => {
    if (pct <= 0) return;
    if (total - goal.targetPct + pct > 100) { setError("That would push active targets over 100%."); return; }
    setError("");
    await upsertTeamGoal(teamId, goal.skillTagId, pct, coachId);
    await refreshGoals();
  };
  const removeGoal = async goal => { await archiveTeamGoal(goal.id); await refreshGoals(); };

  return (<div className="card mb10">
    <div className="clbl mb8">Goals</div>
    {goals.length === 0 && <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>Set targets for how your team spends practice time.</div>}
    {goals.map(g => (<div key={g.id} className="li" style={{ marginBottom: 6 }}>
      <div className="lim"><div className="lin">{tagName(g.skillTagId)}</div></div>
      <div className="row">
        <input className="inp" type="number" min="1" max="100" style={{ width: 64, padding: "6px 8px" }} value={g.targetPct}
          onChange={e => updateTarget(g, Number(e.target.value) || 0)} />
        <span style={{ fontSize: 12, color: "var(--td)" }}>%</span>
        <button className="btn danger bxs" onClick={() => removeGoal(g)}>x</button>
      </div>
    </div>))}
    {goals.length > 0 && <div style={{ fontSize: 12, color: total > 100 ? "var(--red)" : "var(--td)", marginBottom: 10 }}>
      {total}% of practice time targeted{total > 100 ? " -- over 100%, adjust before this reconciles" : ""}
    </div>}
    {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 10 }}>{error}</div>}

    {!addingGoal && <button className="btn outline bsm" onClick={startAdd}>+ Add Goal</button>}
    {!addingGoal && !categories.length && <div style={{ fontSize: 12, color: "var(--td)", marginTop: 8 }}>No skill categories set up for {team.sport} yet.</div>}

    {addingGoal && pickingCategory === null && (<div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 8 }}>Pick a category</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {categories.map(c => (<button key={c.id} className="btn ghost bsm" onClick={() => setPickingCategory(c.id)}>{c.name}</button>))}
      </div>
      <button className="btn ghost bsm" onClick={cancelAdd}>Cancel</button>
    </div>)}

    {addingGoal && pickingCategory !== null && (<div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 8 }}>Pick a skill tag</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {tagsForCategory(pickingCategory).map(t => (<button key={t.id} className={"btn bsm " + (pickingTag === t.id ? "primary" : "ghost")} onClick={() => setPickingTag(t.id)}>{t.name}</button>))}
        {!tagsForCategory(pickingCategory).length && <div style={{ fontSize: 12, color: "var(--td)" }}>No tags left in this category (or all already have a goal).</div>}
      </div>
      {pickingTag && <div className="row" style={{ marginBottom: 10 }}>
        <label className="lbl" style={{ marginBottom: 0 }}>Target</label>
        <input className="inp" type="number" min="1" max="100" style={{ width: 64, padding: "6px 8px" }} value={newPct} onChange={e => setNewPct(Number(e.target.value) || 0)} />
        <span style={{ fontSize: 12, color: "var(--td)" }}>%</span>
      </div>}
      <div className="brow">
        <button className="btn ghost bsm" onClick={() => setPickingCategory(null)}>Back</button>
        <button className="btn primary bsm" onClick={addGoal} disabled={!pickingTag}>Add</button>
      </div>
    </div>)}

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
    {skills.map(s => (<SkillRow key={s.skill_tag_id} skill={s} />))}

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
// datetime-local wants "YYYY-MM-DDTHH:MM" in local time, no timezone suffix.
const toLocalInputValue = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
};

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
function SessionHistoryDetail({ session, practice, canManage, onBack, onChanged }) {
  const [logs, setLogs] = useState(null);
  const [notes, setNotes] = useState([]);
  const [editingLogId, setEditingLogId] = useState(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [addingFor, setAddingFor] = useState(null);
  const [addStart, setAddStart] = useState("");
  const [addEnd, setAddEnd] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => { fetchSessionActivityLog(session.session_id).then(setLogs); }, [session.session_id]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (practice) fetchNotesForPractice(practice.id).then(setNotes); }, [practice && practice.id]);

  if (!practice) return (<div style={{ paddingBottom: 80 }}><div className="row mb10"><button className="btn ghost bxs" onClick={onBack}>&#8249; History</button></div><div className="empty"><div className="emtx">Practice not found.</div></div></div>);
  if (logs === null) return (<div style={{ padding: "40px 0", textAlign: "center", color: "var(--td)" }}>Loading...</div>);

  const logsForActivity = actId => logs.filter(l => l.practiceActivityId === actId);
  const logsForStation = stId => logs.filter(l => l.stationId === stId);

  const startAdjust = log => { setEditingLogId(log.id); setEditStart(toLocalInputValue(log.startedAt)); setEditEnd(toLocalInputValue(log.endedAt)); };
  const saveAdjust = async () => {
    if (!editStart || !editEnd) return;
    setBusy(true);
    await adjustSessionActivity(editingLogId, new Date(editStart).toISOString(), new Date(editEnd).toISOString());
    setBusy(false); setEditingLogId(null);
    refresh(); if (onChanged) onChanged();
  };
  const startAddRow = (practiceActivityId, stationId) => { setAddingFor({ practiceActivityId, stationId }); setAddStart(""); setAddEnd(""); };
  const saveAddRow = async () => {
    if (!addStart || !addEnd) return;
    setBusy(true);
    await addSessionActivityRow(session.session_id, { practiceActivityId: addingFor.practiceActivityId, stationId: addingFor.stationId, startedAt: new Date(addStart).toISOString(), endedAt: new Date(addEnd).toISOString() });
    setBusy(false); setAddingFor(null);
    refresh(); if (onChanged) onChanged();
  };
  const toggleExclude = async () => {
    setBusy(true);
    await setSessionExclusion(session.session_id, !session.excluded);
    setBusy(false);
    if (onChanged) onChanged();
  };

  return (<div style={{ paddingBottom: 80 }}>
    <div className="row mb10"><button className="btn ghost bxs" onClick={onBack}>&#8249; History</button></div>
    <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 22, fontWeight: 900, marginBottom: 4 }}>
      {session.ended_at ? new Date(session.ended_at).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "In progress"}
    </div>
    <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>
      {session.wall_minutes}min wall time · {session.attendance_count} attended
      {session.excluded && <span className="bdg bs" style={{ marginLeft: 6 }}>Excluded from goals</span>}
      {session.adjusted && <span className="bdg bp" style={{ marginLeft: 6 }}>Adjusted</span>}
    </div>

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
          return (<div key={st.id} style={{ padding: "10px 12px", borderTop: "1px solid var(--b)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{st.name}{st.activityName ? ": " + st.activityName : ""}</div>
            {stLogs.length === 0 && <div style={{ fontSize: 12, color: "var(--td)" }}>No actual time logged.{canManage && <button className="btn ghost bxs" style={{ marginLeft: 8 }} onClick={() => startAddRow(null, st.id)}>Log actual time</button>}</div>}
            {stLogs.map(l => (<div key={l.id} style={{ fontSize: 12, color: "var(--tm)", display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              Actual: {fmtClock(l.startedAt)}{l.endedAt ? " - " + fmtClock(l.endedAt) : " (ongoing)"}
              {l.adjustedAt && <span className="bdg bp">adjusted</span>}
              {canManage && <button className="btn ghost bxs" onClick={() => startAdjust(l)}>Edit</button>}
            </div>))}
            {addingFor && addingFor.stationId === st.id && <TimeRangeForm start={addStart} end={addEnd} setStart={setAddStart} setEnd={setAddEnd} onSave={saveAddRow} onCancel={() => setAddingFor(null)} busy={busy} saveLabel="Log time" />}
            {stLogs.some(l => l.id === editingLogId) && <TimeRangeForm start={editStart} end={editEnd} setStart={setEditStart} setEnd={setEditEnd} onSave={saveAdjust} onCancel={() => setEditingLogId(null)} busy={busy} />}
          </div>);
        })}
      </div>);

      const actLogs = logsForActivity(act.id);
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
          {l.adjustedAt && <span className="bdg bp">adjusted</span>}
          {canManage && <button className="btn ghost bxs" onClick={() => startAdjust(l)}>Edit</button>}
        </div>))}
        {addingFor && addingFor.practiceActivityId === act.id && <TimeRangeForm start={addStart} end={addEnd} setStart={setAddStart} setEnd={setAddEnd} onSave={saveAddRow} onCancel={() => setAddingFor(null)} busy={busy} saveLabel="Log time" />}
        {actLogs.some(l => l.id === editingLogId) && <TimeRangeForm start={editStart} end={editEnd} setStart={setEditStart} setEnd={setEditEnd} onSave={saveAdjust} onCancel={() => setEditingLogId(null)} busy={busy} />}
      </div>);
    })}

    {notes.length > 0 && <div className="card mb10">
      <div className="clbl mb8">Notes</div>
      {notes.map(n => (<div key={n.id} style={{ fontSize: 13, marginBottom: 6 }}>{n.text}</div>))}
    </div>}

    {canManage && <button className={"btn bmd bfull " + (session.excluded ? "primary" : "outline")} onClick={toggleExclude} disabled={busy}>
      {session.excluded ? "Restore to goals" : "Exclude from goals"}
    </button>}
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
            <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 15, fontWeight: 700 }}>
              {s.ended_at ? new Date(s.ended_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "In progress"}
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

// Goals + Insights tab (handoff §5). Ties together the editor, glance view,
// and promoted History list/detail for one team.
export default function GoalsScreen({ data, teamId, coachId }) {
  const team = data.teams.find(t => t.id === teamId);
  const canManage = team ? isHeadCoach(team, coachId) : false;
  const [goals, setGoals] = useState(null);
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState(null);
  const [openSession, setOpenSession] = useState(null);

  const refreshGoals = useCallback(() => fetchTeamGoals(teamId).then(setGoals), [teamId]);
  const refreshReport = useCallback(() => fetchTeamGoalReport(teamId).then(setReport), [teamId]);
  const refreshHistory = useCallback(() => fetchTeamSessionHistory(teamId).then(setHistory), [teamId]);
  useEffect(() => { refreshGoals(); refreshReport(); refreshHistory(); }, [refreshGoals, refreshReport, refreshHistory]);
  // Fire once per team mount, not on every refresh -- same "call once on
  // view load" convention as log_helper_join_event.
  useEffect(() => { logGoalViewed(teamId); }, [teamId]);

  const refreshAll = () => { refreshReport(); refreshHistory(); };

  if (!team) return null;
  if (goals === null || report === null || history === null) return (<div style={{ padding: "40px 0", textAlign: "center", color: "var(--td)" }}>Loading...</div>);

  if (openSession) {
    const practice = data.practices.find(p => p.id === openSession.practice_id);
    return <SessionHistoryDetail session={openSession} practice={practice} canManage={canManage}
      onBack={() => setOpenSession(null)}
      onChanged={() => { refreshAll(); }} />;
  }

  // No own page header/title here -- embedded under PlanScreen.jsx's "Plan"
  // header + Build/Goals & Insights toggle (nav restructure round 2,
  // 2026-07-15; this used to be its own top-level tab).
  return (<div>
    {canManage && <GoalsEditor teamId={teamId} team={team} data={data} coachId={coachId} goals={goals} refreshGoals={() => { refreshGoals(); refreshReport(); }} />}
    <GlanceView report={report} />
    <div className="clbl mb8" style={{ marginTop: 4 }}>History</div>
    <HistoryList history={history} data={data} canManage={canManage} onOpen={setOpenSession} />
  </div>);
}
