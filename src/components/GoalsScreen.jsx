import React, { useState, useEffect, useCallback } from "react";
import { isHeadCoach } from "../constants.js";
import {
  fetchTeamGoals, setTeamGoals, updateGoalsWindowWeeks,
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

// Slider-per-global-tag editor (Jax's call, 2026-07-19, replacing the old
// one-goal-at-a-time picker): every global skill tag for the sport gets a
// slider, grouped by category; the total across all of them must land on
// exactly 100 (or exactly 0, meaning "not configured yet") before Save is
// enabled. Saving is one atomic RPC (set_team_goals) rather than N separate
// row writes, so a coach adjusting several sliders can't leave team_goals in
// a partially-saved state if one write fails midway.
function GoalsEditor({ teamId, team, data, goals, refreshGoals }) {
  const [windowWeeks, setWindowWeeks] = useState(team.goalsWindowWeeks || 4);
  useEffect(() => setWindowWeeks(team.goalsWindowWeeks || 4), [team.goalsWindowWeeks]);
  const [savingWindow, setSavingWindow] = useState(false);
  const [values, setValues] = useState({});
  const [collapsed, setCollapsed] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const categories = (data.skillCategories || []).filter(c => c.sport === team.sport && !c.archived_at).sort((a, b) => a.sort_order - b.sort_order);
  const globalTagsByCategory = {};
  (data.skillTags || []).filter(t => t.scope === "global").forEach(t => { (globalTagsByCategory[t.categoryId] ||= []).push(t); });
  Object.values(globalTagsByCategory).forEach(arr => arr.sort((a, b) => a.name.localeCompare(b.name)));

  // Seed slider values from existing goals, resolved to their global
  // equivalent -- a goal set before this redesign may still point at a
  // coach-scope tag, and should still show up as a starting slider position
  // here rather than silently vanishing.
  useEffect(() => {
    const skillTagsById = Object.fromEntries((data.skillTags || []).map(t => [t.id, t]));
    const init = {};
    goals.forEach(g => {
      const t = skillTagsById[g.skillTagId];
      let globalId = g.skillTagId;
      if (t && t.scope !== "global") {
        const match = (data.skillTags || []).find(g2 => g2.scope === "global" && g2.categoryId === t.categoryId && g2.name === t.name);
        if (match) globalId = match.id;
      }
      init[globalId] = g.targetPct;
    });
    setValues(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals]);

  const total = Object.values(values).reduce((s, v) => s + (v || 0), 0);
  const canSave = total === 100 || total === 0;

  const saveWindow = async () => {
    setSavingWindow(true);
    await updateGoalsWindowWeeks(teamId, windowWeeks);
    setSavingWindow(false);
  };
  const setValue = (tagId, pct) => setValues(p => ({ ...p, [tagId]: pct }));
  const toggle = cid => setCollapsed(p => ({ ...p, [cid]: !p[cid] }));
  const save = async () => {
    if (!canSave) return;
    setSaving(true); setError("");
    const targets = Object.entries(values).filter(([, pct]) => pct > 0).map(([skillTagId, targetPct]) => ({ skillTagId, targetPct }));
    const { error } = await setTeamGoals(teamId, targets);
    setSaving(false);
    if (error) { setError("Something went wrong saving. Try again."); return; }
    await refreshGoals();
  };

  return (<div className="card mb10">
    <div className="clbl mb8">Goals</div>
    <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>Set targets for how your team spends practice time. The total across every skill must reach exactly 100% (or 0% to clear all goals) before saving.</div>

    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: "var(--r)", marginBottom: 14, background: total === 100 ? "var(--gbg)" : total > 100 ? "#fef2f2" : "var(--s1)", border: "1px solid " + (total === 100 ? "var(--gb)" : total > 100 ? "#fecaca" : "var(--b)") }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>{total}% allocated</span>
      <span style={{ fontSize: 12, color: total === 100 ? "var(--green2)" : total > 100 ? "var(--red)" : "var(--td)" }}>
        {total === 100 ? "Ready to save" : total > 100 ? (total - 100) + "% over, reduce before saving" : (100 - total) + "% remaining"}
      </span>
    </div>

    {categories.length === 0 && <div style={{ fontSize: 12, color: "var(--td)" }}>No skill categories set up for {team.sport} yet.</div>}
    {categories.map(cat => {
      const tags = globalTagsByCategory[cat.id] || [];
      if (!tags.length) return null;
      const catTotal = tags.reduce((s, t) => s + (values[t.id] || 0), 0);
      const isCollapsed = collapsed[cat.id];
      return (<div key={cat.id} style={{ marginBottom: 12 }}>
        <button onClick={() => toggle(cat.id)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", border: "none", background: "none", cursor: "pointer" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--td)", textTransform: "uppercase", letterSpacing: ".06em" }}>{cat.name}</span>
          <span style={{ fontSize: 11, color: "var(--td)" }}>{catTotal}% {isCollapsed ? "▶" : "▼"}</span>
        </button>
        {!isCollapsed && tags.map(t => {
          const v = values[t.id] || 0;
          return (<div key={t.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
              <span style={{ fontSize: 13 }}>{t.name}</span>
              <span style={{ fontFamily: "DM Mono,monospace", fontSize: 13, color: "var(--tm)" }}>{v}%</span>
            </div>
            <input type="range" min="0" max="100" step="1" value={v} onChange={e => setValue(t.id, Number(e.target.value))} style={{ width: "100%", accentColor: "var(--green)" }} />
          </div>);
        })}
      </div>);
    })}

    {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 10 }}>{error}</div>}
    <button className="btn primary bmd bfull" onClick={save} disabled={!canSave || saving}>{saving ? "Saving..." : "Save Goals"}</button>

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

  const logsForActivity = actId => meaningfulLogs(logs.filter(l => l.practiceActivityId === actId));
  const logsForStation = stId => meaningfulLogs(logs.filter(l => l.stationId === stId));

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

  if (!team) return null;
  if (goals === null || report === null || history === null) return (<div style={{ padding: "40px 0", textAlign: "center", color: "var(--td)" }}>Loading...</div>);

  if (openSession) {
    const practice = data.practices.find(p => p.id === openSession.practice_id);
    return <SessionHistoryDetail session={openSession} practice={practice} canManage={canManage}
      onBack={() => setOpenSessionId(null)}
      onChanged={() => { refreshAll(); }} />;
  }

  // No own page header/title here -- embedded under PlanScreen.jsx's "Plan"
  // header + Build/Goals & Insights toggle (nav restructure round 2,
  // 2026-07-15; this used to be its own top-level tab).
  return (<div>
    {canManage && <GoalsEditor teamId={teamId} team={team} data={data} goals={goals} refreshGoals={() => { refreshGoals(); refreshReport(); }} />}
    <GlanceView report={report} />
    <div className="clbl mb8" style={{ marginTop: 4 }}>History</div>
    <HistoryList history={history} data={data} canManage={canManage} onOpen={s => setOpenSessionId(s.session_id)} />
  </div>);
}
