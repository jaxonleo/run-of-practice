import React, { useState, useEffect } from "react";
import { sumMins, isHeadCoach, planningState, localDateStr, stripIdsForCopy } from "../constants.js";
import { archivePractice, fetchPlannedAbsences, fetchPracticeRunStatus, markTeamStaffWelcomed, leaveTeam, hasCompletedSession, submitFeedback, savePracticeTree } from "../supabase.js";
import PracticeDetail from "./PracticeDetail.jsx";
import AbsencePicker from "./AbsencePicker.jsx";
import { HistoryViewer } from "./CommandScreen.jsx";

// §1: "35/60 min" pill -- half-filled/amber for partial, warning-tinted for
// overplanned, filled+check when within tolerance. Returns null (renders
// nothing) for unplanned practices or practices with no scheduled duration
// -- the existing binary "Needs plan" language covers those cases already.
function PlanPill({ practice }) {
  const st = planningState(practice);
  if (!st) return null;
  const total = sumMins(practice.activities || []);
  const style = { partial: { color: "var(--amber)", icon: "◐" }, overplanned: { color: "var(--red)", icon: "⚠" }, complete: { color: "var(--green)", icon: "✓" } }[st];
  return <span style={{ color: style.color, fontWeight: 600 }}>{style.icon} {total}/{practice.scheduledDurationMinutes} min</span>;
}

// §6: getting-started checklist, completion fully derived from existing
// client state (no stored progress flags to drift) except the "run a
// practice" step, which needs one lightweight query since nothing else on
// Home already tracks completed-session history.
function ChecklistModal({ data, hasCompleted, onClose }) {
  const steps = [
    { label: "Create a team", done: data.teams.length > 0 },
    { label: "Add players", done: data.teams.some(t => t.players.length > 0) },
    { label: "Build out your library", done: (data.activityLibrary || []).length > 0 },
    { label: "Set your practice schedule", done: data.practices.length > 0 },
    { label: "Plan your first practice", done: data.practices.some(p => (p.activities || []).length > 0) },
    { label: "Run it live", done: hasCompleted },
  ];
  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal">
      <div className="mhandle" />
      <div className="mtitle">Getting Started</div>
      {steps.map((s, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < steps.length - 1 ? "1px solid var(--s2)" : "none" }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: s.done ? "var(--green)" : "var(--s2)", color: s.done ? "#fff" : "var(--td)" }}>{s.done ? "✓" : i + 1}</span>
        <span style={{ fontSize: 14, color: s.done ? "var(--td)" : "var(--black)", textDecoration: s.done ? "line-through" : "none" }}>{s.label}</span>
      </div>))}
      <button className="btn ghost bmd bfull" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
    </div>
  </div>);
}

// Landing-page addendum §4: fold feedback into the existing "?" menu rather
// than a second persistent icon -- one entry point, page_context hardcoded
// to "Home" since that's the only surface this opens from (same reasoning
// that already ruled out per-screen help buttons).
function FeedbackModal({ coachId, coachEmail, onClose }) {
  const [contact, setContact] = useState(coachEmail || "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const send = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    await submitFeedback(coachId, { contactEmail: contact.trim() || null, message: message.trim(), pageContext: "Home" });
    setSending(false);
    setDone(true);
  };
  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal">
      <div className="mhandle" />
      <div className="mtitle">Send Feedback</div>
      {done ? (<div>
        <div style={{ fontSize: 14, color: "var(--black2)", marginBottom: 16 }}>Thanks — got it.</div>
        <button className="btn ghost bmd bfull" onClick={onClose}>Close</button>
      </div>) : (<div>
        <div className="fld mb10">
          <label className="lbl">What's on your mind?</label>
          <textarea className="ta" rows={4} autoFocus placeholder="Ideas, bugs, questions..." value={message} onChange={e => setMessage(e.target.value)} />
        </div>
        <div className="fld mb10">
          <label className="lbl">Contact (optional, or a different way to reach you)</label>
          <input className="inp" type="email" value={contact} onChange={e => setContact(e.target.value)} />
        </div>
        <button className="btn primary bmd bfull" onClick={send} disabled={!message.trim() || sending}>{sending ? "Sending..." : "Send Feedback"}</button>
      </div>)}
    </div>
  </div>);
}

const timeLbl = p => { if (!p.startTime) return ""; const [h, m] = p.startTime.split(":").map(Number); return (h % 12 || 12) + ":" + (m < 10 ? "0" + m : m) + (h >= 12 ? " PM" : " AM"); };
const dayLbl = (dateStr, todayStr, tomorrowStr) => {
  if (dateStr === todayStr) return "Today";
  if (dateStr === tomorrowStr) return "Tomorrow";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

export default function HomeScreen({ data, update, goToBuilder, goToRun, goToSchedule, goToTeamGoals, goToSettings, coachId, coachName, coachEmail, refreshPlanning, refreshTeams }) {
  const now = new Date();
  const todayStr = localDateStr(now);
  const tomorrowStr = localDateStr(new Date(Date.now() + 864e5));
  // "My week" (handoff §4.3): was a 14-day window, now 7.
  const in7Str = localDateStr(new Date(Date.now() + 7 * 864e5));
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const [practiceMenuId, setPracticeMenuId] = useState(null);
  const [viewPractice, setViewPractice] = useState(null);
  const [historyPractice, setHistoryPractice] = useState(null);
  const [showAbsencePicker, setShowAbsencePicker] = useState(false);
  const [absenceCounts, setAbsenceCounts] = useState({});
  const [runStatus, setRunStatus] = useState({});
  const [showHelpMenu, setShowHelpMenu] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);
  const practiceIdsKey = JSON.stringify(data.practices.map(p => p.id));
  useEffect(() => { hasCompletedSession(data.practices.map(p => p.id)).then(setHasCompleted); }, [practiceIdsKey]);
  const checklistDone = data.teams.length > 0 && data.teams.some(t => t.players.length > 0) && (data.activityLibrary || []).length > 0 && data.practices.length > 0 && data.practices.some(p => (p.activities || []).length > 0) && hasCompleted;

  const teamById = id => data.teams.find(t => t.id === id);
  const locById = id => data.locations.find(l => l.id === id);
  const isPlanned = p => (p.activities || []).length > 0;
  const isCancelled = p => p.status === "cancelled";
  // Same date-agnostic run signal as ScheduleScreen -- a practice run
  // earlier today shouldn't still read as upcoming until midnight.
  const ran = p => runStatus[p.id] === "completed";

  const active = data.practices.filter(p => !isCancelled(p));
  // Raw date-window candidates, before the ran() filter -- runStatus/absence
  // counts are fetched for this set first (ran() reads runStatus, so the
  // filtered-out set can't be known until that fetch resolves).
  const windowCandidates = active.filter(p => p.date >= todayStr && p.date <= in7Str).sort((a, b) => a.date === b.date ? (a.startTime || "").localeCompare(b.startTime || "") : a.date.localeCompare(b.date));
  // Completed practices leave the list entirely (handoff §4.3) -- Home used
  // to only badge them "· Completed" inline; Schedule already excludes them
  // from its "upcoming" bucket the same way.
  const agendaWindow = windowCandidates.filter(p => !ran(p));

  const agendaIdsKey = JSON.stringify(windowCandidates.map(p => p.id));
  const refreshAbsenceCounts = () => {
    const ids = windowCandidates.map(p => p.id);
    if (!ids.length) { setAbsenceCounts({}); return; }
    fetchPlannedAbsences(ids).then(rows => {
      const counts = {};
      for (const r of rows) counts[r.practice_id] = (counts[r.practice_id] || 0) + 1;
      setAbsenceCounts(counts);
    });
  };
  useEffect(refreshAbsenceCounts, [agendaIdsKey]);
  useEffect(() => {
    const ids = windowCandidates.map(p => p.id);
    if (!ids.length) { setRunStatus({}); return; }
    fetchPracticeRunStatus(ids).then(setRunStatus);
  }, [agendaIdsKey]);

  // Last-practice recap, one per team (handoff §4.3) -- needs run status
  // across ALL practices, not just this week's window, since the most
  // recent completed practice for a team could be older than 7 days.
  const [allRunStatus, setAllRunStatus] = useState({});
  const allPracticeIdsKey = JSON.stringify(data.practices.map(p => p.id));
  useEffect(() => {
    const ids = data.practices.map(p => p.id);
    if (!ids.length) { setAllRunStatus({}); return; }
    fetchPracticeRunStatus(ids).then(setAllRunStatus);
  }, [allPracticeIdsKey]);
  const lastPracticePerTeam = data.teams.map(team => {
    const completed = data.practices
      .filter(p => p.teamId === team.id && allRunStatus[p.id] === "completed")
      .sort((a, b) => b.date === a.date ? (b.startTime || "").localeCompare(a.startTime || "") : b.date.localeCompare(a.date));
    return completed[0] ? { team, practice: completed[0] } : null;
  }).filter(Boolean);
  const [recapAbsenceCounts, setRecapAbsenceCounts] = useState({});
  const recapIdsKey = JSON.stringify(lastPracticePerTeam.map(r => r.practice.id));
  useEffect(() => {
    const ids = lastPracticePerTeam.map(r => r.practice.id);
    if (!ids.length) { setRecapAbsenceCounts({}); return; }
    fetchPlannedAbsences(ids).then(rows => {
      const counts = {};
      for (const r of rows) counts[r.practice_id] = (counts[r.practice_id] || 0) + 1;
      setRecapAbsenceCounts(counts);
    });
  }, [recapIdsKey]);
  const openPractice = p => {
    if (ran(p) && isPlanned(p)) setHistoryPractice(p);
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

  // Next-practice hero: soonest today (any time-of-day), else soonest
  // future -- skips a practice that's already completed today so the hero
  // moves on instead of still offering "Start Practice" on a finished run.
  // agendaWindow already excludes ran(p) practices (above), so no need to
  // recheck it here.
  const nextPractice = agendaWindow.find(p => p.date === todayStr) || agendaWindow.find(p => p.date > todayStr) || null;
  const isSoonOrLive = p => {
    if (!p || !p.startTime || p.date !== todayStr) return false;
    const [h, m] = p.startTime.split(":").map(Number);
    const pm = h * 60 + m, nm = now.getHours() * 60 + now.getMinutes();
    return pm - nm <= 120 && pm - nm >= -180;
  };
  // §3: the nudge strip is a to-do list for whoever can act on it -- filter
  // to practices on teams this user actually head-coaches, per-team (not a
  // global assistant/head-coach flag, since roles can differ by team).
  const needsPlanning = agendaWindow.filter(p => !isPlanned(p) && isHeadCoach(teamById(p.teamId), coachId));
  const canManageAnyTeam = data.teams.some(t => isHeadCoach(t, coachId));
  const delPractice = async id => { await archivePractice(id); await refreshPlanning(); if (viewPractice && viewPractice.id === id) setViewPractice(null); };

  // §2(f): one-time welcome card for a staff row someone else added (addedBy
  // set) that this user hasn't seen yet. Excludes self-created head_coach
  // rows (addedBy null there) -- you don't need to be welcomed to your own team.
  const pendingWelcome = data.teams.map(t => {
    const mine = (t.coaches || []).find(c => c.userId === coachId);
    return mine && mine.addedBy && !mine.welcomedAt ? { team: t, staff: mine } : null;
  }).filter(Boolean)[0] || null;
  const adderName = pendingWelcome ? ((pendingWelcome.team.coaches || []).find(c => c.userId === pendingWelcome.staff.addedBy)?.name || "a coach") : null;
  const pendingWelcomeStaffId = pendingWelcome ? pendingWelcome.staff.id : null;
  useEffect(() => { if (pendingWelcomeStaffId) markTeamStaffWelcomed(pendingWelcomeStaffId); }, [pendingWelcomeStaffId]);
  const [leavingTeamId, setLeavingTeamId] = useState(null);
  const handleLeave = async teamId => { setLeavingTeamId(teamId); await leaveTeam(teamId); if (refreshTeams) await refreshTeams(); setLeavingTeamId(null); };

  if (historyPractice) return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}><HistoryViewer data={data} update={update} practice={historyPractice} onRunAgain={() => runAgainFrom(historyPractice)} onBack={() => setHistoryPractice(null)} coachId={coachId} refreshPlanning={refreshPlanning} /></div>);
  if (viewPractice) return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}><PracticeDetail practice={viewPractice} data={data} update={update} goToBuilder={goToBuilder} goToRun={goToRun} coachId={coachId} onBack={() => setViewPractice(null)} /></div>);

  return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}>
    <div style={{ padding: "20px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{greeting},</div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 26, fontWeight: 900, color: "var(--green)", lineHeight: 1 }}>{coachName}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ position: "relative" }}>
          <button onClick={() => setShowHelpMenu(s => !s)} style={{ position: "relative", background: "var(--s2)", border: "1.5px solid var(--b)", borderRadius: "50%", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, fontFamily: "Barlow Condensed,sans-serif", fontSize: 18, fontWeight: 900, color: "var(--green)" }}>
            ?
            {!checklistDone && <span style={{ position: "absolute", top: 2, right: 2, width: 8, height: 8, borderRadius: "50%", background: "var(--green)" }} />}
          </button>
          {showHelpMenu && <div className="mini-menu" style={{ minWidth: 170 }}>
            <button className="mm-item" onClick={() => { setShowHelpMenu(false); setShowChecklist(true); }}>Getting Started</button>
            <button className="mm-item" onClick={() => { setShowHelpMenu(false); setShowFeedback(true); }}>Send Feedback</button>
          </div>}
        </div>
        <button onClick={goToSettings} aria-label="Settings" style={{ background: "var(--s2)", border: "1.5px solid var(--b)", borderRadius: "50%", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "var(--tm)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1.11-1.56 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.56-1.03H3a2 2 0 110-4h.09a1.7 1.7 0 001.56-1.11 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34h.08A1.7 1.7 0 0010.12 3.6V3a2 2 0 114 0v.09a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87v.08c.26.63.87 1.05 1.56 1.03H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.51 1.03z"/></svg>
        </button>
      </div>
    </div>
    {showChecklist && <ChecklistModal data={data} hasCompleted={hasCompleted} onClose={() => setShowChecklist(false)} />}
    {showFeedback && <FeedbackModal coachId={coachId} coachEmail={coachEmail} onClose={() => setShowFeedback(false)} />}
    {pendingWelcome && <div style={{ margin: "0 16px 12px" }}><div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 14, marginBottom: 6 }}>You've been added to <strong>{pendingWelcome.team.name}</strong> by {adderName}.</div>
      <button style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12, color: "var(--td)", textDecoration: "underline" }} disabled={leavingTeamId === pendingWelcome.team.id} onClick={() => handleLeave(pendingWelcome.team.id)}>Not your team? Leave</button>
    </div></div>}

    {/* A per-team quick-pick row used to live here (a pill/chip style row
        that navigated away on tap). Removed per direct feedback -- pills
        read as an in-place filter control, not "leave this page," and a
        dedicated Teams tab (Layout.jsx's GLOBAL_TABS) is now the one clear
        place to pick a team from anywhere, not just from Home. Home still
        surfaces team identity contextually via the hero/recap cards below. */}

    <div style={{ padding: "0 16px" }}>
      {!nextPractice && <div className="card" style={{ marginBottom: 16, textAlign: "center", padding: "28px 20px" }}>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{data.teams.length === 0 ? "Set up your practice schedule" : "Nothing on the schedule"}</div>
        <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 16 }}>{!canManageAnyTeam ? "Nothing planned yet." : data.teams.length === 0 ? "Add a team, then set up a recurring schedule to get started." : "Build a practice or set up a recurring schedule."}</div>
        {canManageAnyTeam && <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary bmd" style={{ flex: 1 }} onClick={() => goToBuilder(null)}>+ Build a Practice</button>
          <button className="btn outline bmd" style={{ flex: 1 }} onClick={goToSchedule}>Set Up Schedule</button>
        </div>}
      </div>}

      {nextPractice && (() => {
        const team = teamById(nextPractice.teamId), loc = locById(nextPractice.locationId);
        const planned = isPlanned(nextPractice), soon = isSoonOrLive(nextPractice);
        const canManage = isHeadCoach(team, coachId);
        const count = absenceCounts[nextPractice.id] || 0;
        const headcount = team ? Math.max(0, team.players.length - count) : null;
        return (<div className="card" style={{ marginBottom: 16, borderColor: soon ? "var(--green)" : "var(--b)", borderWidth: soon ? 2 : 1.5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            {team && team.colorPrimary && <span style={{ width: 10, height: 10, borderRadius: "50%", boxSizing: "border-box", background: planned ? team.colorPrimary : "transparent", border: "1.5px solid " + team.colorPrimary, flexShrink: 0 }} />}
            <span style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--td)" }}>{dayLbl(nextPractice.date, todayStr, tomorrowStr)}{nextPractice.startTime ? " · " + timeLbl(nextPractice) : ""}</span>
          </div>
          <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 26, fontWeight: 900, lineHeight: 1, marginBottom: 4 }}>{team ? team.name : "Practice"}</div>
          <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>
            {loc ? loc.name : "Location TBD"}
            {headcount !== null && <span> · {headcount} of {team.players.length} expected</span>}
            {planned && planningState(nextPractice) && <span> · <PlanPill practice={nextPractice} /></span>}
          </div>
          {!planned && canManage && <button className="btn primary bxl bfull" onClick={() => goToBuilder(nextPractice.id)}>Plan Practice</button>}
          {!planned && !canManage && <div className="btn outline bxl bfull" style={{ textAlign: "center", cursor: "default" }}>Not planned yet</div>}
          {planned && !soon && <button className="btn primary bxl bfull" onClick={() => setViewPractice(nextPractice)}>Review Plan</button>}
          {planned && soon && <button className="btn primary bxl bfull" onClick={() => goToRun(nextPractice.id)}>Start Practice &#8594;</button>}
        </div>);
      })()}

      {lastPracticePerTeam.length > 0 && <div style={{ marginBottom: 16 }}>
        <div className="clbl mb8">Last Practice</div>
        {lastPracticePerTeam.map(({ team, practice }) => {
          const mins = sumMins(practice.activities || []);
          const absent = recapAbsenceCounts[practice.id] || 0;
          const headcount = Math.max(0, team.players.length - absent);
          return (<div key={team.id} className="card" style={{ marginBottom: 8, cursor: "pointer" }} onClick={() => goToTeamGoals(team.id)}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              {team.colorPrimary && <span style={{ width: 8, height: 8, borderRadius: "50%", background: team.colorPrimary, flexShrink: 0 }} />}
              <span style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 14, fontWeight: 700 }}>{team.name}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--td)" }}>
              {new Date(practice.date + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {mins} min · {headcount} of {team.players.length} there
            </div>
            {/* Goals delta is stubbed here per the handoff (§4.3) -- the real
                target-vs-actual insight is built in the Goals tab (§5.2),
                which this links to. */}
            <div style={{ fontSize: 12, color: "var(--green)", marginTop: 4 }}>See goals insights &#8594;</div>
          </div>);
        })}
      </div>}

      {needsPlanning.length > 0 && <div className="li" style={{ marginBottom: 16, cursor: "pointer" }} onClick={goToSchedule}>
        <div className="lim"><div className="lin">{needsPlanning.length} practice{needsPlanning.length > 1 ? "s" : ""} in the next 14 days need{needsPlanning.length === 1 ? "s" : ""} a plan</div></div>
        <span style={{ color: "var(--green)", fontSize: 18 }}>&#8250;</span>
      </div>}

      <div className="sechdr" style={{ marginBottom: 8 }}><span className="sectitle">This Week</span></div>
      {agendaWindow.length === 0 && <div style={{ padding: "16px 0", textAlign: "center", color: "var(--td)", fontSize: 14 }}>Nothing scheduled.</div>}
      {agendaWindow.map(p => {
        // agendaWindow already excludes completed practices, so no "· Completed"
        // badge branch is needed here (unlike the old 14-day list).
        const team = teamById(p.teamId), loc = locById(p.locationId), planned = isPlanned(p), count = absenceCounts[p.id] || 0;
        return (<div key={p.id} className="li" style={{ marginBottom: 6, cursor: "pointer" }} onClick={() => openPractice(p)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            {team && team.colorPrimary && <span style={{ width: 8, height: 8, borderRadius: "50%", boxSizing: "border-box", background: planned ? team.colorPrimary : "transparent", border: "1.5px solid " + team.colorPrimary, flexShrink: 0 }} />}
            <div className="lim" style={{ minWidth: 0 }}>
              <div className="lin">{team ? team.name : "Practice"}</div>
              <div className="limt">{dayLbl(p.date, todayStr, tomorrowStr)}{p.startTime ? " · " + timeLbl(p) : ""}{loc ? " · " + loc.name : ""}{!planned && " · Needs plan"}{planned && planningState(p) && <React.Fragment> · <PlanPill practice={p} /></React.Fragment>}{count > 0 && " · " + count + " out"}</div>
            </div>
          </div>
          <div style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
            <button className="ell-btn" onClick={e => { e.stopPropagation(); setPracticeMenuId(practiceMenuId === p.id ? null : p.id); }}><span /><span /><span /></button>
            {practiceMenuId === p.id && <div className="mini-menu" style={{ right: 0, minWidth: 140 }}>
              <button className="mm-item" onClick={() => { setPracticeMenuId(null); goToBuilder(p.id); }}>Edit</button>
              <button className="mm-item mm-danger" onClick={() => { delPractice(p.id); setPracticeMenuId(null); }}>Delete</button>
            </div>}
          </div>
        </div>);
      })}

      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        {canManageAnyTeam && <button className="btn outline bmd" style={{ flex: 1 }} onClick={() => goToBuilder(null)}>+ Practice</button>}
        <button className="btn ghost bmd" style={{ flex: 1 }} onClick={() => setShowAbsencePicker(true)}>Player Out</button>
      </div>
    </div>

    {showAbsencePicker && <AbsencePicker data={data} coachId={coachId} mode="pickPlayerThenPractices" onClose={() => { setShowAbsencePicker(false); refreshAbsenceCounts(); }} />}
  </div>);
}
