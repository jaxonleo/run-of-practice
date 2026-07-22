import React, { useState, useEffect } from "react";
import { sumMins, isHeadCoach, canManageTeamInMode, planningState, localDateStr, stripIdsForCopy } from "../constants.js";
import { archivePractice, fetchPlannedAbsences, fetchPracticeRunStatus, markTeamStaffWelcomed, leaveTeam, hasCompletedSession, submitFeedback, savePracticeTree, acceptOrgInvite, declineOrgInvite, fetchOrgWeeklyPracticeRollup } from "../supabase.js";
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
function ChecklistModal({ data, hasCompleted, onClose, coachId, mode }) {
  // data.activityLibrary is never mode-scoped upstream (HomeRoute only
  // scopes teams/practices) -- it's always this coach's full personal drill
  // list, so in Org mode this step needs its own org-scoped count instead of
  // reusing that unfiltered one, or it reads "done" off personal drills that
  // have nothing to do with the org being viewed.
  const isOrgMode = mode && mode.type === "org";
  const libraryDone = isOrgMode
    ? (data.activityLibrary || []).some(a => a.organizationId === mode.orgId)
    : (data.activityLibrary || []).some(a => a.ownerUserId === coachId);
  const steps = [
    { label: "Create a team", done: data.teams.length > 0 },
    { label: "Add players", done: data.teams.some(t => t.players.length > 0) },
    { label: isOrgMode ? "Build out the club's library" : "Build out your library", done: libraryDone },
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

export default function HomeScreen({ data, update, goToBuilder, goToRun, goToSchedule, goToTeam, goToSettings, coachId, coachName, coachEmail, refreshPlanning, refreshTeams, refreshLibrary, mode, setMode }) {
  const isOrgMode = mode && mode.type === "org";
  const activeOrg = isOrgMode ? (data.myOrgs || []).find(o => o.id === mode.orgId) : null;
  const now = new Date();
  const todayStr = localDateStr(now);
  const tomorrowStr = localDateStr(new Date(Date.now() + 864e5));
  // "This Week" (handoff §4.3): was a 14-day window, now 7. The needs-a-plan
  // nudge below is separate and stays 14 -- its own copy always said "next
  // 14 days" even though the filter behind it was quietly reusing this same
  // 7-day cutoff (a real bug, not a design choice: a practice 8-13 days out
  // needing a plan was invisible to the nudge that claims to cover it).
  const in7Str = localDateStr(new Date(Date.now() + 7 * 864e5));
  const in14Str = localDateStr(new Date(Date.now() + 14 * 864e5));
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
  // Mirrors ChecklistModal's own mode-aware library check (data.activityLibrary
  // is never mode-scoped upstream) -- otherwise the "?" dot and the modal's
  // own step could disagree with each other.
  const libraryBuiltOut = (data.activityLibrary || []).some(a => (mode && mode.type === "org") ? a.organizationId === mode.orgId : a.ownerUserId === coachId);
  const checklistDone = data.teams.length > 0 && data.teams.some(t => t.players.length > 0) && libraryBuiltOut && data.practices.length > 0 && data.practices.some(p => (p.activities || []).length > 0) && hasCompleted;

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
  // filtered-out set can't be known until that fetch resolves). Widened to
  // 14 days so the needs-a-plan nudge (below) has real run-status data for
  // its full claimed window; "This Week" narrows this same set back to 7.
  const windowCandidates = active.filter(p => p.date >= todayStr && p.date <= in14Str).sort((a, b) => a.date === b.date ? (a.startTime || "").localeCompare(b.startTime || "") : a.date.localeCompare(b.date));
  // Completed practices leave the list entirely (handoff §4.3) -- Home used
  // to only badge them "· Completed" inline; Schedule already excludes them
  // from its "upcoming" bucket the same way.
  const agendaWindow = windowCandidates.filter(p => !ran(p) && p.date <= in7Str);

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
  const needsPlanning = windowCandidates.filter(p => !ran(p) && !isPlanned(p) && canManageTeamInMode(teamById(p.teamId), coachId, mode));
  const canManageAnyTeam = data.teams.some(t => canManageTeamInMode(t, coachId, mode));
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

  // Org Experience handoff Sec 5: unlike the team_staff welcome card above
  // (already-added, just an FYI), an org invite is a real consent gate --
  // nothing is granted until accept/decline runs. Surfaced here since Home
  // is where every signed-in coach lands regardless of org membership.
  const [respondingInviteId, setRespondingInviteId] = useState(null);
  const pendingOrgInvite = (data.pendingOrgInvites || [])[0] || null;
  const respondToInvite = async (accept) => {
    if (!pendingOrgInvite) return;
    setRespondingInviteId(pendingOrgInvite.id);
    if (accept) await acceptOrgInvite(pendingOrgInvite.id); else await declineOrgInvite(pendingOrgInvite.id);
    if (refreshLibrary) await refreshLibrary();
    if (accept && refreshTeams) await refreshTeams();
    setRespondingInviteId(null);
  };

  // Coach/Org mode toggle. Switching to Org with more than one org shows a
  // picker instead of jumping straight in -- with exactly one, no picker
  // needed. Switching back to Coach is always a single tap, no picker.
  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const myOrgs = data.myOrgs || [];
  const switchToOrgMode = () => {
    if (myOrgs.length === 0) return;
    if (myOrgs.length === 1) { setMode({ type: "org", orgId: myOrgs[0].id }); return; }
    setShowOrgPicker(true);
  };
  const pickOrg = orgId => { setMode({ type: "org", orgId }); setShowOrgPicker(false); };

  // Org mode extra: weekly rollup, absorbed from the standalone Org Home
  // page (folded into Home directly per direct feedback). Org Member
  // management (add/cancel invite) lives on the Teams tab's Organization
  // section instead -- Home isn't the right long-term place for it as
  // membership grows.
  const [rollup, setRollup] = useState([]);
  useEffect(() => { if (isOrgMode) fetchOrgWeeklyPracticeRollup(mode.orgId, 8).then(setRollup); }, [isOrgMode, mode && mode.orgId]);
  const maxRun = Math.max(1, ...rollup.map(w => w.live_practices || 0));

  if (historyPractice) return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}><HistoryViewer data={data} update={update} practice={historyPractice} onRunAgain={() => runAgainFrom(historyPractice)} onBack={() => setHistoryPractice(null)} coachId={coachId} refreshPlanning={refreshPlanning} /></div>);
  if (viewPractice) return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}><PracticeDetail practice={viewPractice} data={data} update={update} goToBuilder={goToBuilder} goToRun={goToRun} coachId={coachId} onBack={() => setViewPractice(null)} /></div>);

  return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}>
    <div style={{ padding: "20px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{greeting},</div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 26, fontWeight: 900, color: "var(--green)", lineHeight: 1 }}>{isOrgMode ? (activeOrg ? activeOrg.name : "Organization") : coachName}</div>
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
    {myOrgs.length > 0 && <div style={{ padding: "0 16px 12px" }}>
      <div style={{ display: "flex", gap: 0, background: "var(--s2)", borderRadius: "var(--r)", padding: 3 }}>
        <button onClick={() => setMode({ type: "coach" })} style={{ flex: 1, padding: "7px 0", border: "none", cursor: "pointer", borderRadius: "calc(var(--r) - 2px)", background: !isOrgMode ? "#fff" : "transparent", fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: !isOrgMode ? "var(--black)" : "var(--td)" }}>Coach</button>
        <button onClick={switchToOrgMode} style={{ flex: 1, padding: "7px 0", border: "none", cursor: "pointer", borderRadius: "calc(var(--r) - 2px)", background: isOrgMode ? "var(--green)" : "transparent", fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: isOrgMode ? "#fff" : "var(--td)" }}>Organization</button>
      </div>
      {showOrgPicker && <div className="card" style={{ marginTop: 6, padding: 8 }}>
        {myOrgs.map(org => (<button key={org.id} className="mm-item" style={{ width: "100%", textAlign: "left" }} onClick={() => pickOrg(org.id)}>{org.name}</button>))}
      </div>}
    </div>}
    {showChecklist && <ChecklistModal data={data} hasCompleted={hasCompleted} onClose={() => setShowChecklist(false)} coachId={coachId} mode={mode} />}
    {showFeedback && <FeedbackModal coachId={coachId} coachEmail={coachEmail} onClose={() => setShowFeedback(false)} />}
    {pendingWelcome && <div style={{ margin: "0 16px 12px" }}><div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 14, marginBottom: 6 }}>You've been added to <strong>{pendingWelcome.team.name}</strong> by {adderName}.</div>
      <button style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12, color: "var(--td)", textDecoration: "underline" }} disabled={leavingTeamId === pendingWelcome.team.id} onClick={() => handleLeave(pendingWelcome.team.id)}>Not your team? Leave</button>
    </div></div>}
    {pendingOrgInvite && <div style={{ margin: "0 16px 12px" }}><div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 14, marginBottom: 8 }}>You've been invited to help lead <strong>{pendingOrgInvite.organizationName}</strong> as a director{pendingOrgInvite.teamRole ? ", with a team role waiting for you once you accept" : ""}.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary bxs" disabled={respondingInviteId === pendingOrgInvite.id} onClick={() => respondToInvite(true)}>Accept</button>
        <button className="btn ghost bxs" disabled={respondingInviteId === pendingOrgInvite.id} onClick={() => respondToInvite(false)}>Decline</button>
      </div>
    </div></div>}

    {/* Org Members management (add a member, cancel a pending invite) moved
        to the Teams tab's Organization section -- per direct feedback, Home
        isn't the right long-term place for this as membership grows. Home
        keeps just the at-a-glance rollup. */}
    {isOrgMode && <div style={{ padding: "0 16px 16px" }}>
      <div className="clbl mb8">Weekly Live Practices</div>
      <div className="card" style={{ padding: 12 }}>
        {rollup.length === 0 && <div style={{ fontSize: 13, color: "var(--td)" }}>No live practices run yet.</div>}
        {rollup.length > 0 && <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60 }}>
          {rollup.map(w => (<div key={w.wk} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            <div style={{ width: "100%", background: "var(--green)", borderRadius: 3, height: Math.max(2, (w.live_practices / maxRun) * 52) }} />
            <div style={{ fontSize: 9, color: "var(--td)", marginTop: 2 }}>{w.live_practices}</div>
          </div>))}
        </div>}
      </div>
    </div>}

    <div style={{ padding: "0 16px" }}>
      {/* Your Teams quick-jump (2026-07-2x): a per-team row lived here once
          before, styled as pills, and got removed per direct feedback --
          pills read as an in-place filter control, not "leave this page."
          Brought back deliberately card-styled instead (matching the
          outgoing Last Practice cards' own look, which never had that
          confusion) so it reads as navigation, not filtering. */}
      {data.teams.length > 0 && <div style={{ marginBottom: 16 }}>
        <div className="clbl mb8">{isOrgMode ? "Org Teams" : "Your Teams"}</div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
          {data.teams.map(team => (<div key={team.id} className="card" style={{ flexShrink: 0, minWidth: 140, cursor: "pointer", borderLeft: "4px solid " + (team.colorPrimary || "transparent"), padding: "10px 12px" }} onClick={() => goToTeam(team.id)}>
            <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 15, fontWeight: 700, whiteSpace: "nowrap" }}>{team.name}</div>
            <div style={{ fontSize: 11, color: "var(--td)" }}>{team.sport}</div>
          </div>))}
        </div>
      </div>}

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
        const canManage = canManageTeamInMode(team, coachId, mode);
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

      {needsPlanning.length > 0 && <div className="li" style={{ marginBottom: 16, cursor: "pointer" }} onClick={goToSchedule}>
        <div className="lim"><div className="lin">{needsPlanning.length} practice{needsPlanning.length > 1 ? "s" : ""} in the next 14 days need{needsPlanning.length === 1 ? "s" : ""} a plan</div></div>
        <span style={{ color: "var(--green)", fontSize: 18 }}>&#8250;</span>
      </div>}

      <div className="sechdr" style={{ marginBottom: 8 }}><span className="sectitle">Upcoming Practices</span></div>
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
