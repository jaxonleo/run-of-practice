import React, { useState, useEffect } from "react";
import { fetchPlannedAbsences, fetchPracticeRunStatus, savePracticeTree } from "../supabase.js";
import { isHeadCoach, sumMins, planningState, localDateStr, stripIdsForCopy } from "../constants.js";
import PracticeDetail from "./PracticeDetail.jsx";
import SeriesWizard from "./SeriesWizard.jsx";
import SchedulePracticeModal from "./SchedulePracticeModal.jsx";
import { HistoryViewer } from "./CommandScreen.jsx";

// §1: same "35/60 min" pill as HomeScreen -- duplicated per this codebase's
// existing convention (timeLbl/dayLbl are likewise redefined per file
// rather than shared) rather than factored into a new shared component.
function PlanPill({ practice }) {
  const st = planningState(practice);
  if (!st) return null;
  const total = sumMins(practice.activities || []);
  const style = { partial: { color: "var(--amber)", icon: "◐" }, overplanned: { color: "var(--red)", icon: "⚠" }, complete: { color: "var(--green)", icon: "✓" } }[st];
  return <span style={{ color: style.color, fontWeight: 600 }}>{style.icon} {total}/{practice.scheduledDurationMinutes} min</span>;
}

const timeLbl = p => { if (!p.startTime) return ""; const [h, m] = p.startTime.split(":").map(Number); return (h % 12 || 12) + ":" + (m < 10 ? "0" + m : m) + (h >= 12 ? " PM" : " AM"); };
const dayLbl = (dateStr, todayStr, tomorrowStr) => {
  if (dateStr === todayStr) return "Today";
  if (dateStr === tomorrowStr) return "Tomorrow";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
};

function DaySheet({ date, practices, data, todayStr, runStatus, onPick, onClose }) {
  const teamById = id => data.teams.find(t => t.id === id);
  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal">
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 12 }}>{new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
      {practices.length === 0 && <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>Nothing scheduled.</div>}
      {practices.map(p => {
        const team = teamById(p.teamId), planned = (p.activities || []).length > 0, cancelled = p.status === "cancelled";
        const completed = runStatus[p.id] === "completed", started = runStatus[p.id] === "started";
        const isPast = date < todayStr;
        return (<div key={p.id} className="li" style={{ marginBottom: 6, cursor: "pointer", opacity: cancelled ? .6 : 1 }} onClick={() => onPick(p)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {team && team.colorPrimary && <span style={{ width: 8, height: 8, borderRadius: "50%", boxSizing: "border-box", background: planned ? team.colorPrimary : "transparent", border: "1.5px solid " + team.colorPrimary, flexShrink: 0 }} />}
            <div className="lim"><div className="lin" style={{ textDecoration: cancelled ? "line-through" : "none" }}>{team ? team.name : "Practice"}</div><div className="limt">
              {timeLbl(p)}
              {cancelled && " · Cancelled"}
              {!cancelled && completed && " · Completed"}
              {!cancelled && !completed && started && isPast && " · Started, not finished"}
              {!cancelled && !completed && !started && !planned && (isPast ? " · Missed" : " · Needs plan")}
              {!cancelled && !completed && !started && planned && planningState(p) && <React.Fragment> · <PlanPill practice={p} /></React.Fragment>}
            </div></div>
          </div>
          <span style={{ color: "var(--td)", fontSize: 18 }}>&#8250;</span>
        </div>);
      })}
      <button className="btn ghost bmd bfull" style={{ marginTop: 8 }} onClick={onClose}>Close</button>
    </div>
  </div>);
}

// fixedTeamId (handoff §4.4): set when reached via /team/:teamId/schedule --
// data.practices is already scoped to that one team by the caller
// (fetchPracticesFull(teamId)), so the team-filter chip row is redundant
// (it would show exactly one, permanently-active chip) and is hidden.
export default function ScheduleScreen({ data, update, goToBuilder, goToRun, coachId, refreshPlanning, fixedTeamId }) {
  const now = new Date();
  const todayStr = localDateStr(now);
  const tomorrowStr = localDateStr(new Date(Date.now() + 864e5));

  const [mode, setMode] = useState("agenda");
  const [showPast, setShowPast] = useState(false);
  const [teamFilter, setTeamFilter] = useState(new Set());
  const [monthCursor, setMonthCursor] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [daySheetDate, setDaySheetDate] = useState(null);
  const [viewPractice, setViewPractice] = useState(null);
  const [historyPractice, setHistoryPractice] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [showSingle, setShowSingle] = useState(false);
  const [absenceCounts, setAbsenceCounts] = useState({});
  const [runStatus, setRunStatus] = useState({});

  const canScheduleAny = data.teams.some(t => isHeadCoach(t, coachId));
  const toggleTeam = id => setTeamFilter(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const passesFilter = p => teamFilter.size === 0 || teamFilter.has(p.teamId);
  const filtered = data.practices.filter(passesFilter);
  // A practice counts as "ran" the moment its live session completes, not
  // just once its calendar date has passed -- otherwise a practice run this
  // morning still reads as "upcoming" until midnight.
  const ran = p => runStatus[p.id] === "completed";

  useEffect(() => {
    const ids = filtered.map(p => p.id);
    if (!ids.length) { setAbsenceCounts({}); setRunStatus({}); return; }
    let cancelled = false;
    fetchPlannedAbsences(ids).then(rows => {
      if (cancelled) return;
      const counts = {};
      for (const r of rows) counts[r.practice_id] = (counts[r.practice_id] || 0) + 1;
      setAbsenceCounts(counts);
    });
    fetchPracticeRunStatus(ids).then(m => { if (!cancelled) setRunStatus(m); });
    return () => { cancelled = true; };
  }, [JSON.stringify(filtered.map(p => p.id))]);

  // Any past/planned practice (run or not) goes to HistoryViewer, which is
  // the only view that surfaces notes and "what took place" -- cancelled
  // practices stay on PracticeDetail (that's where Restore lives), and an
  // unplanned practice has nothing to review, so it stays on PracticeDetail
  // too (missed-plan messaging + a way to still plan/cancel it).
  const openPractice = p => {
    const isHistorical = p.date < todayStr || ran(p);
    if (isHistorical && p.status !== "cancelled" && (p.activities || []).length > 0) setHistoryPractice(p);
    else setViewPractice(p);
  };
  const runAgainFrom = async practice => {
    const runNow = new Date();
    const { data: saved } = await savePracticeTree(null, {
      teamId: practice.teamId, locationId: practice.locationId, sublocationId: practice.sublocationId,
      date: localDateStr(runNow), startTime: runNow.toTimeString().slice(0, 5),
      activities: stripIdsForCopy(practice.activities),
    });
    await refreshPlanning();
    setHistoryPractice(null);
    if (saved) goToRun(saved.id);
  };

  if (historyPractice) return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}><HistoryViewer data={data} update={update} practice={historyPractice} onRunAgain={() => runAgainFrom(historyPractice)} onBack={() => setHistoryPractice(null)} coachId={coachId} refreshPlanning={refreshPlanning} /></div>);
  if (viewPractice) return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}><PracticeDetail practice={viewPractice} data={data} update={update} goToBuilder={goToBuilder} goToRun={goToRun} coachId={coachId} refreshPlanning={refreshPlanning} onBack={() => setViewPractice(null)} /></div>);

  const teamById = id => data.teams.find(t => t.id === id);

  // Agenda -- "past" now also catches a same-day practice that already
  // finished (ran), and "upcoming" excludes it, so a completed morning
  // practice moves into history immediately instead of waiting for midnight.
  const upcoming = filtered.filter(p => p.date >= todayStr && !ran(p)).sort((a, b) => a.date === b.date ? (a.startTime || "").localeCompare(b.startTime || "") : a.date.localeCompare(b.date));
  const past = filtered.filter(p => p.date < todayStr || ran(p)).sort((a, b) => b.date.localeCompare(a.date) || (b.startTime || "").localeCompare(a.startTime || ""));
  const groupByDay = list => { const g = []; let cur = null; for (const p of list) { if (!cur || cur.date !== p.date) { cur = { date: p.date, items: [] }; g.push(cur); } cur.items.push(p); } return g; };
  // Past-list status word: cancelled beats everything, then a completed run,
  // then a session that was started but never finished (abandoned), then
  // plain missed (never even started).
  const pastStatusLbl = p => {
    if (p.status === "cancelled") return "Cancelled";
    if (ran(p)) return "Completed";
    if (runStatus[p.id] === "started") return "Started, not finished";
    return "Missed";
  };

  // Month grid
  const monthStart = monthCursor;
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const gridStart = new Date(monthStart); gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(monthEnd); gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
  const days = []; for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const practicesByDate = {}; for (const p of filtered) (practicesByDate[p.date] ||= []).push(p);
  const toDateStr = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

  return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}>
    <div style={{ padding: "20px 16px 12px" }}>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 28, fontWeight: 900, marginBottom: canScheduleAny ? 10 : 0 }}>Schedule</div>
      {canScheduleAny && <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary bsm" style={{ flex: 1 }} onClick={() => setShowSingle(true)}>+ Practice</button>
        <button className="btn outline bsm" style={{ flex: 1 }} onClick={() => setShowWizard(true)}>+ Series</button>
      </div>}
    </div>

    {!fixedTeamId && data.teams.length > 0 && <div style={{ padding: "0 16px 12px", display: "flex", gap: 6, flexWrap: "wrap" }}>
      {data.teams.map(t => (<button key={t.id} onClick={() => toggleTeam(t.id)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 20, border: "1.5px solid " + (teamFilter.size === 0 || teamFilter.has(t.id) ? (t.colorPrimary || "var(--green)") : "var(--b)"), background: teamFilter.has(t.id) ? (t.colorPrimary || "var(--green)") : "#fff", cursor: "pointer" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: t.colorPrimary || "var(--green)" }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: teamFilter.has(t.id) ? "#fff" : "var(--black)" }}>{t.name}</span>
      </button>))}
    </div>}

    <div style={{ display: "flex", gap: 0, background: "var(--s2)", borderRadius: "var(--r)", padding: 3, margin: "0 16px 12px" }}>
      {["agenda", "month"].map(m => (<button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: "8px 0", border: "none", cursor: "pointer", borderRadius: "calc(var(--r) - 2px)", background: mode === m ? "#fff" : "transparent", fontFamily: "Barlow Condensed,sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: mode === m ? "var(--black)" : "var(--td)" }}>{m}</button>))}
    </div>

    {mode === "agenda" && <div style={{ padding: "0 16px" }}>
      {groupByDay(upcoming).map(g => (<div key={g.date} style={{ marginBottom: 16 }}>
        <div className="clbl" style={{ marginBottom: 6 }}>{dayLbl(g.date, todayStr, tomorrowStr)}</div>
        {g.items.map(p => {
          const team = teamById(p.teamId), planned = (p.activities || []).length > 0, cancelled = p.status === "cancelled", count = absenceCounts[p.id] || 0;
          return (<div key={p.id} className="li" style={{ marginBottom: 6, cursor: "pointer", opacity: cancelled ? .6 : 1 }} onClick={() => openPractice(p)}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
              {team && team.colorPrimary && <span style={{ width: 8, height: 8, borderRadius: "50%", boxSizing: "border-box", background: planned ? team.colorPrimary : "transparent", border: "1.5px solid " + team.colorPrimary, flexShrink: 0 }} />}
              <div className="lim" style={{ minWidth: 0 }}>
                <div className="lin" style={{ textDecoration: cancelled ? "line-through" : "none" }}>{team ? team.name : "Practice"}</div>
                <div className="limt">{timeLbl(p)}{!planned && !cancelled && " · Needs plan"}{planned && !cancelled && planningState(p) && <React.Fragment> · <PlanPill practice={p} /></React.Fragment>}{cancelled && " · Cancelled"}{count > 0 && " · " + count + " out"}</div>
              </div>
            </div>
            <span style={{ color: "var(--td)", fontSize: 18 }}>&#8250;</span>
          </div>);
        })}
      </div>))}
      {upcoming.length === 0 && <div style={{ padding: "20px 0", textAlign: "center", color: "var(--td)", fontSize: 14 }}>{canScheduleAny ? "Nothing scheduled. Tap + Practice or + Series above to get started." : "Nothing scheduled yet."}</div>}
      {past.length > 0 && <div style={{ marginTop: 8 }}>
        <button className="btn ghost bsm bfull" onClick={() => setShowPast(s => !s)}>{showPast ? "Hide" : "Show"} Completed / History</button>
        {showPast && groupByDay(past).map(g => (<div key={g.date} style={{ marginTop: 12 }}>
          <div className="clbl" style={{ marginBottom: 6 }}>{dayLbl(g.date, todayStr, tomorrowStr)}</div>
          {g.items.map(p => { const team = teamById(p.teamId); return (<div key={p.id} className="li" style={{ marginBottom: 6, cursor: "pointer" }} onClick={() => openPractice(p)}>
            <div className="lim"><div className="lin">{team ? team.name : "Practice"}</div><div className="limt">{timeLbl(p)} · {pastStatusLbl(p)}</div></div>
            <span style={{ color: "var(--td)", fontSize: 18 }}>&#8250;</span>
          </div>); })}
        </div>))}
      </div>}
    </div>}

    {mode === "month" && <div style={{ padding: "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button className="btn ghost bxs" onClick={() => setMonthCursor(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))}>&#8249;</button>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 16, fontWeight: 700 }}>{monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</div>
        <button className="btn ghost bxs" onClick={() => setMonthCursor(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))}>&#8250;</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 4 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (<div key={i} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--td)" }}>{d}</div>))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
        {days.map((d, i) => {
          const ds = toDateStr(d);
          const dayPractices = practicesByDate[ds] || [];
          const inMonth = d.getMonth() === monthStart.getMonth();
          return (<div key={i} onClick={() => dayPractices.length && setDaySheetDate(ds)} style={{ aspectRatio: "1", border: "1px solid var(--b)", borderRadius: 6, padding: 3, cursor: dayPractices.length ? "pointer" : "default", opacity: inMonth ? 1 : .35, background: ds === todayStr ? "var(--gbg)" : "#fff" }}>
            <div style={{ fontSize: 10, color: "var(--td)", marginBottom: 2 }}>{d.getDate()}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
              {dayPractices.slice(0, 4).map(p => { const team = teamById(p.teamId); const planned = (p.activities || []).length > 0; const cancelled = p.status === "cancelled"; const color = (team && team.colorPrimary) || "var(--green)"; return (<span key={p.id} style={{ width: 6, height: 6, borderRadius: "50%", background: planned && !cancelled ? color : "transparent", border: "1.5px solid " + (cancelled ? "var(--td)" : color), opacity: cancelled ? .5 : 1 }} />); })}
            </div>
          </div>);
        })}
      </div>
      {daySheetDate && <DaySheet date={daySheetDate} practices={(practicesByDate[daySheetDate] || []).sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))} data={data} todayStr={todayStr} runStatus={runStatus} onPick={p => { setDaySheetDate(null); openPractice(p); }} onClose={() => setDaySheetDate(null)} />}
    </div>}

    {showWizard && <SeriesWizard data={data} coachId={coachId} onClose={() => setShowWizard(false)} onDone={async () => { setShowWizard(false); await refreshPlanning(); }} />}
    {showSingle && <SchedulePracticeModal data={data} coachId={coachId} onClose={() => setShowSingle(false)} onDone={async (result, planNow) => { setShowSingle(false); await refreshPlanning(); if (planNow && result) goToBuilder(result.id); }} />}
  </div>);
}
