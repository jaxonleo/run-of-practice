import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { sumMins, isHeadCoach, myTeamRole, canManageTeamInMode, planningState, localDateStr, stripIdsForCopy, articleFor, resolveDevelopmentPulseFocusTeamId, isMoreThanTwoHoursAway, getGettingStartedHidden, setGettingStartedHidden, menuNeedsToOpenUpward, useBigBrowser } from "../constants.js";
import { TwoPane } from "./BBShells.jsx";
import { archivePractice, fetchPlannedAbsences, fetchPracticeRunStatus, markTeamStaffWelcomed, hasCompletedSession, submitFeedback, savePracticeTree, acceptOrgInvite, declineOrgInvite, acknowledgeTeamDeparture, acknowledgeTeamJoinNotice, acknowledgeStationAssignmentNotice, fetchOrgWeeklyPracticeRollup, findActiveLiveSession, fetchActiveLiveSessions, fetchTeamsRecentCompletedSession, fetchTeamsWithUnviewedNotes, ORG_ROLE_LABELS, acceptTeamInvite, declineTeamInvite } from "../supabase.js";
import PracticeDetail from "./PracticeDetail.jsx";
import AbsencePicker from "./AbsencePicker.jsx";
import { HistoryViewer } from "./CommandScreen.jsx";
import { DaySheet } from "./ScheduleScreen.jsx";
import DevelopmentPulseCard from "./DevelopmentPulseCard.jsx";
import FuturePracticeGuardModal from "./FuturePracticeGuardModal.jsx";

// §1: "35/60 min" pill. Shows for any practice with a scheduled duration,
// planned or not -- an unplanned practice reads "0/60 min" so the gap is
// obvious. Red below 90% planned, green at or above it.
function PlanPill({ practice }) {
  const st = planningState(practice);
  if (!st) return null;
  const total = sumMins(practice.activities || []);
  const onTrack = st === "onTrack";
  const exceeds = st === "exceeds";
  // whiteSpace:nowrap -- otherwise a tight card can wrap mid-phrase (e.g.
  // "0/60" on one line, "min" starting the next), which reads as broken.
  return <span style={{ color: onTrack ? "var(--green)" : exceeds ? "var(--amber)" : "var(--red)", fontWeight: 600, whiteSpace: "nowrap" }}>{onTrack ? "✓ " : ""}{total}/{practice.scheduledDurationMinutes} min</span>;
}

// §6: getting-started checklist, completion fully derived from existing
// client state (no stored progress flags to drift) except the "run a
// practice" step, which needs one lightweight query since nothing else on
// Home already tracks completed-session history.
//
// Was a "?" popup with a green-dot nudge and static, non-clickable rows --
// direct feedback was that a brand-new coach's first Home screen wasn't
// intuitive about how to actually proceed. Now a persistent card right on
// Home (gone once every step is done) whose rows are real navigation, not
// just a progress readout, and the green dot is dropped since the card
// itself is now the visible nudge.
function GettingStartedCard({ data, hasCompleted, coachId, mode, goToBuilder, goToSchedule, navigate, onHide }) {
  const isOrgMode = mode && mode.type === "org";
  const libraryDone = isOrgMode
    ? (data.activityLibrary || []).some(a => a.organizationId === mode.orgId)
    : (data.activityLibrary || []).some(a => a.ownerUserId === coachId);
  const firstTeam = data.teams[0] || null;
  const unplannedPractice = data.practices.find(p => (p.activities || []).length === 0) || null;
  // Direct feedback: an assistant who can't actually build practices
  // (not a head coach anywhere, not delegated on any team) still saw
  // "Plan your first practice" as a live, tappable step straight into
  // Builder -- the same entry point Feature Inventory's own "Builder...
  // entry points are hidden for teams they don't head-coach" rule already
  // hides everywhere else, just missed here. canManageAnyTeam already
  // covers Org mode via canManageTeamInMode's org branch; Coach mode adds
  // delegated practice-building on top, since that's a real, legitimate
  // way to plan a practice too, not just being the head coach.
  const canPlanAny = isOrgMode
    ? data.teams.some(t => t.organizationId === mode.orgId)
    : data.teams.some(t => isHeadCoach(t, coachId) || (t.coaches || []).some(c => c.userId === coachId && c.canBuildPractices));
  const steps = [
    { label: "Create a team", done: data.teams.length > 0, onClick: () => navigate("/teams") },
    { label: "Add players", done: data.teams.some(t => t.players.length > 0), onClick: () => navigate(firstTeam ? "/team/" + firstTeam.id + "/roster" : "/teams") },
    { label: isOrgMode ? "Build out the club's library" : "Build out your library", done: libraryDone, onClick: () => navigate("/library") },
    { label: "Set your practice schedule", done: data.practices.length > 0, onClick: goToSchedule },
    // No onClick when this coach can't actually plan anywhere -- same
    // "informational, not a dead-end action" treatment "Run it live"
    // below already gets, rather than sending them into a build tool
    // they don't have write access to.
    { label: "Plan your first practice", done: data.practices.some(p => (p.activities || []).length > 0), onClick: canPlanAny ? () => goToBuilder(unplannedPractice ? unplannedPractice.id : null) : null },
    // Not clickable -- there's no single screen to jump to for this one,
    // it's the outcome of the hero card's own Start Practice button once a
    // practice is actually planned and today, not a page of its own.
    { label: "Run it live", done: hasCompleted },
  ];
  return (<div style={{ margin: "0 16px 16px" }}>
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div className="clbl" style={{ marginBottom: 0 }}>Getting Started</div>
        <button className="btn ghost bxs" style={{ padding: "2px 8px" }} onClick={onHide}>Hide</button>
      </div>
      {steps.map((s, i) => {
        const Row = s.onClick ? "button" : "div";
        return (<Row key={i} onClick={s.onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "none", borderLeft: "none", borderRight: "none", borderBottom: i < steps.length - 1 ? "1px solid var(--s2)" : "none", width: "100%", background: "none", textAlign: "left", cursor: s.onClick ? "pointer" : "default", font: "inherit" }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: s.done ? "var(--green)" : "var(--s2)", color: s.done ? "#fff" : "var(--td)" }}>{s.done ? "✓" : i + 1}</span>
          <span style={{ flex: 1, fontSize: 14, color: s.done ? "var(--td)" : "var(--black)", textDecoration: s.done ? "line-through" : "none" }}>{s.label}</span>
          {s.onClick && !s.done && <span style={{ color: "var(--td)", fontSize: 18 }}>&#8250;</span>}
        </Row>);
      })}
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
        <div style={{ fontSize: 14, color: "var(--black2)", marginBottom: 16 }}>Thanks, got it.</div>
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

export default function HomeScreen({ data, allTeams, liveId, goToBuilder, goToRun, goToSchedule, goToTeam, goToSettings, coachId, coachName, coachEmail, refreshPlanning, refreshTeams, refreshLibrary, mode, setMode }) {
  const navigate = useNavigate();
  // BB layout pass: two-column dashboard at BB (left: hero + Upcoming
  // Practices; right: Getting Started + notification cards + Development
  // Pulse) -- see the named *Content consts and final return below.
  const isBB = useBigBrowser();
  const isOrgMode = mode && mode.type === "org";
  const activeOrg = isOrgMode ? (data.myOrgs || []).find(o => o.id === mode.orgId) : null;
  const now = new Date();
  const todayStr = localDateStr(now);
  const tomorrowStr = localDateStr(new Date(Date.now() + 864e5));
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Direct feedback: the only existing "is a practice live" signals are
  // either scoped to one specific practice a screen already has in hand
  // (a hero/detail card's own isSessionLive check) or purely local state
  // (the bottom live-resume bar's liveId, only ever set on a device that
  // itself navigated into /run/:id -- never on a device that hasn't). An
  // assistant whose head coach just went live, or a coach checking a
  // second team, had zero indication anything was happening until they
  // guessed to go look. Polled (no realtime channel for this yet) rather
  // than fetched once, so a session that starts while this coach is
  // already sitting on Home still surfaces without a reload -- matches the
  // same "don't require a hard refresh" reasoning as App.jsx's own
  // visibility/poll refresh. RLS (practice_live_sessions_select_access)
  // already scopes results to whichever practices this coach can access
  // at all, so no team filter is needed here.
  const [liveSessions, setLiveSessions] = useState([]);
  // Direct feedback after a real incident: a plain setInterval(poll,20000)
  // keeps firing on a fixed cadence no matter what -- backgrounded tab,
  // already-slow backend, previous call still pending, none of it matters,
  // it just adds another request every 20s regardless. That's exactly the
  // shape that turned a slow moment into hours of exhausted PostgREST
  // threads (see BUILD-STATUS Gotchas): every open tab kept polling this
  // plus abandon_stale_live_sessions on top of an already-struggling
  // backend, compounding rather than backing off. Fixed three ways: never
  // start a new poll while the last one is still in flight, skip polling
  // entirely while the tab is hidden (an immediate poll on regaining focus
  // covers "missed one while backgrounded" instead), and widen the delay
  // before the next attempt whenever one takes unusually long -- a real
  // signal the backend is struggling, without needing fetchActiveLive
  // Sessions itself to report failure (it deliberately swallows its own
  // errors and always resolves, per its own doc comment).
  useEffect(() => {
    let cancelled = false, inFlight = false, timer = null;
    const BASE_DELAY = 20000, SLOW_THRESHOLD_MS = 5000, MAX_DELAY = 5 * 60000;
    const schedule = delay => { timer = setTimeout(runPoll, delay); };
    const runPoll = () => {
      if (cancelled || inFlight) return;
      if (document.visibilityState !== "visible") { schedule(BASE_DELAY); return; }
      inFlight = true;
      const startedAt = Date.now();
      fetchActiveLiveSessions().then(rows => {
        inFlight = false;
        if (cancelled) return;
        setLiveSessions(rows);
        const tookMs = Date.now() - startedAt;
        schedule(tookMs > SLOW_THRESHOLD_MS ? Math.min(BASE_DELAY * 4, MAX_DELAY) : BASE_DELAY);
      });
    };
    const onVisible = () => { if (document.visibilityState === "visible") { clearTimeout(timer); runPoll(); } };
    document.addEventListener("visibilitychange", onVisible);
    runPoll();
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  // allTeams, not the show_on_home-scoped data.teams this screen otherwise
  // uses everywhere else -- a coach still needs to know a practice is
  // actually running on a team they've hidden from their own Home agenda,
  // in order to go join it. Excludes whichever session (if any) this
  // device already has open via liveId -- that one's already covered by
  // the bottom live-resume bar, so showing it here too would just be
  // visual noise for the one case that's already handled.
  const joinableLiveSessions = liveSessions.filter(s => s.practiceId !== liveId).map(s => ({ ...s, team: (allTeams || data.teams).find(t => t.id === s.teamId) })).filter(s => s.team);

  const [practiceMenuId, setPracticeMenuId] = useState(null);
  const [practiceMenuUp, setPracticeMenuUp] = useState(false);
  const [viewPractice, setViewPractice] = useState(null);
  const [historyPractice, setHistoryPractice] = useState(null);
  const [showAbsencePicker, setShowAbsencePicker] = useState(false);
  const [absenceCounts, setAbsenceCounts] = useState({});
  const [runStatus, setRunStatus] = useState({});
  // Direct feedback: the hero/Upcoming-Practices list visibly "glitched" --
  // a practice would render for a second, then disappear (or the hero would
  // jump to a different practice a beat later). Root cause: runStatus starts
  // empty ({}), so ran(p) reads false for *everything* until
  // fetchPracticeRunStatus's own async round trip resolves -- meaning the
  // very first render of every fresh Home mount computed nextPractice/
  // agendaWindow as if nothing were ever completed, then recomputed them a
  // moment later once the real statuses came in, visibly swapping out
  // whichever already-completed practice had briefly been treated as still
  // upcoming. Same shape as the hasCompleted/checklistDone fix above --
  // wait for the one query that decides this to actually resolve before
  // trusting its default, rather than rendering a guess that then corrects
  // itself on screen. Set once and never reset on a later refetch (matching
  // hasCompleted's convention) so an ordinary background refresh later in
  // the session doesn't re-hide already-correct content.
  const [runStatusLoaded, setRunStatusLoaded] = useState(false);
  const [showHelpMenu, setShowHelpMenu] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  // Direct feedback: a coach who'd already finished the checklist still
  // saw it flash in on every Home load, then vanish a moment later. Root
  // cause: hasCompleted defaulted to false (an explicit "not done yet")
  // until hasCompletedSession's own async query resolved, so
  // checklistDone was briefly false -- and the card rendered -- on every
  // fresh mount regardless of the real answer. null now means "still
  // finding out," distinct from a real false, so the card waits for that
  // one query to settle before it's allowed to render at all.
  const [hasCompleted, setHasCompleted] = useState(null);
  // Synchronous localStorage read (not an effect) so a coach who already
  // hid this card never sees it flash on screen for a frame before
  // disappearing -- same "don't render a guess that corrects itself"
  // reasoning as hasCompleted/runStatusLoaded above.
  const [gettingStartedHidden, setGettingStartedHiddenState] = useState(() => getGettingStartedHidden(coachId));
  const practiceIdsKey = JSON.stringify(data.practices.map(p => p.id));
  useEffect(() => { hasCompletedSession(data.practices.map(p => p.id)).then(setHasCompleted); }, [practiceIdsKey]);
  // Mirrors ChecklistModal's own mode-aware library check (data.activityLibrary
  // is never mode-scoped upstream) -- otherwise the "?" dot and the modal's
  // own step could disagree with each other.
  const libraryBuiltOut = (data.activityLibrary || []).some(a => (mode && mode.type === "org") ? a.organizationId === mode.orgId : a.ownerUserId === coachId);
  const checklistDone = hasCompleted === null || (data.teams.length > 0 && data.teams.some(t => t.players.length > 0) && libraryBuiltOut && data.practices.length > 0 && data.practices.some(p => (p.activities || []).length > 0) && hasCompleted);

  const teamById = id => data.teams.find(t => t.id === id);
  const locById = id => data.locations.find(l => l.id === id);
  const isPlanned = p => (p.activities || []).length > 0;
  const isCancelled = p => p.status === "cancelled";
  // Same date-agnostic run signal as ScheduleScreen -- a practice run
  // earlier today shouldn't still read as upcoming until midnight.
  const ran = p => runStatus[p.id] === "completed";

  const active = data.practices.filter(p => !isCancelled(p));
  // Direct feedback: "Upcoming Practices" should always show the coach's
  // next 4 practices -- planned or not, no matter how far out they are --
  // rather than being capped to a rolling day window that could show
  // nothing at all during an off-season gap. Candidates are still capped at
  // a generous count (not literally every future practice) purely so the
  // batch run-status/absence-count fetch below stays bounded -- a genuinely
  // future-dated practice can't yet be "ran" anyway, so this only matters
  // for today's own practice(s), which always sort first regardless.
  const upcomingCandidates = active.filter(p => p.date >= todayStr).sort((a, b) => a.date === b.date ? (a.startTime || "").localeCompare(b.startTime || "") : a.date.localeCompare(b.date)).slice(0, 20);
  // Completed practices leave the list entirely (handoff §4.3) -- Home used
  // to only badge them "· Completed" inline; Schedule already excludes them
  // from its "upcoming" bucket the same way.
  const agendaWindow = upcomingCandidates.filter(p => !ran(p)).slice(0, 4);

  const agendaIdsKey = JSON.stringify(upcomingCandidates.map(p => p.id));
  const refreshAbsenceCounts = () => {
    const ids = upcomingCandidates.map(p => p.id);
    if (!ids.length) { setAbsenceCounts({}); return; }
    fetchPlannedAbsences(ids).then(rows => {
      const counts = {};
      for (const r of rows) counts[r.practice_id] = (counts[r.practice_id] || 0) + 1;
      setAbsenceCounts(counts);
    });
  };
  useEffect(refreshAbsenceCounts, [agendaIdsKey]);
  useEffect(() => {
    const ids = upcomingCandidates.map(p => p.id);
    if (!ids.length) { setRunStatus({}); setRunStatusLoaded(true); return; }
    fetchPracticeRunStatus(ids).then(rs => { setRunStatus(rs); setRunStatusLoaded(true); });
  }, [agendaIdsKey]);

  // This Week at a Glance: Sun-Sat calendar week containing today, matching
  // Month view's own week-start convention (gridStart.setDate(-getDay()))
  // so the two stay mentally consistent. Reuses data.practices directly,
  // not upcomingCandidates -- a day earlier this week that's already
  // happened still belongs in "this week," the same way Month view's own
  // dots keep showing past days, not just upcomingCandidates' today-forward
  // window (which also caps at 20 and would silently truncate a busy week).
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const weekDates = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return localDateStr(d); });
  const weekPracticesByDate = {};
  for (const d of weekDates) weekPracticesByDate[d] = [];
  for (const p of data.practices) if (weekPracticesByDate[p.date]) weekPracticesByDate[p.date].push(p);
  const weekPracticeIdsKey = JSON.stringify(weekDates.flatMap(d => weekPracticesByDate[d].map(p => p.id)));
  // Separate from the hero/Upcoming-Practices runStatus above -- that one
  // is scoped to upcomingCandidates (today-forward only), but the glance
  // strip's own DaySheet needs Completed/Started status for past days in
  // the week too, which upcomingCandidates never covers.
  const [weekRunStatus, setWeekRunStatus] = useState({});
  useEffect(() => {
    const ids = weekDates.flatMap(d => weekPracticesByDate[d].map(p => p.id));
    if (!ids.length) { setWeekRunStatus({}); return; }
    let cancelled = false;
    fetchPracticeRunStatus(ids).then(rs => { if (!cancelled) setWeekRunStatus(rs); });
    return () => { cancelled = true; };
  }, [weekPracticeIdsKey]);
  const [glanceDate, setGlanceDate] = useState(null);

  const openPractice = p => {
    if (ran(p) && isPlanned(p)) setHistoryPractice(p);
    else setViewPractice(p);
  };
  // Separate from openPractice above: that one only ever sees agendaWindow
  // rows (today-forward, via upcomingCandidates), so checking the
  // upcoming-only `runStatus` for "was this completed" was always enough.
  // The glance strip's DaySheet can pick a past day within the current
  // week, which `runStatus` never covers -- mirrors ScheduleScreen's own
  // openPractice, which already has to handle exactly this (any day,
  // past or future), by also treating a past date as historical even when
  // no explicit "completed" status ever got recorded for it.
  const openWeekPractice = p => {
    const historical = p.date < todayStr || weekRunStatus[p.id] === "completed";
    if (historical && p.status !== "cancelled" && isPlanned(p)) setHistoryPractice(p);
    else setViewPractice(p);
  };
  const runAgainFrom = async practice => {
    const runNow = new Date();
    const { data: saved } = await savePracticeTree(null, {
      teamId: practice.teamId, locationId: practice.locationId, sublocationId: practice.sublocationId,
      date: localDateStr(runNow), startTime: runNow.toTimeString().slice(0, 5),
      prePracticeNotes: practice.prePracticeNotes,
      activities: stripIdsForCopy(practice.activities), coachId,
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
  // Direct feedback: the hero said "Nothing on the schedule" while
  // Schedule still showed something -- `active` (feeding agendaWindow)
  // deliberately excludes cancelled practices, so a coach whose only
  // upcoming slot was cancelled saw a flatly empty hero even though
  // Schedule still lists it. Fall back to the soonest upcoming cancelled
  // practice so the hero always reflects anything Schedule would.
  const nextCancelledPractice = !nextPractice ? (data.practices.filter(p => isCancelled(p) && p.date >= todayStr).sort((a, b) => a.date === b.date ? (a.startTime || "").localeCompare(b.startTime || "") : a.date.localeCompare(b.date))[0] || null) : null;
  // Direct feedback: "Practice Setup" used to route a coach through the
  // anonymous /preview/:token flow (the same page an anonymous parent/
  // helper gets), which had no real attendance/station-assignment
  // controls and could bounce a coach into the read-only helper view the
  // moment anyone went live. Practice Setup is now the real live
  // session's own first stage (see CommandScreen's "attend" stage) --
  // the hero's setup/start button just goes straight to
  // /run/:practiceId, landing on Setup if nothing's confirmed yet or
  // straight into the live view if it already is. isSessionLive tracks
  // whether ANY coach has already started this practice, so the label
  // can say "Join Practice" instead of implying this coach is the one
  // kicking it off.
  const [isSessionLive, setIsSessionLive] = useState(false);
  useEffect(() => {
    if (!nextPractice) { setIsSessionLive(false); return; }
    let cancelled = false;
    findActiveLiveSession(nextPractice.id).then(s => { if (!cancelled) setIsSessionLive(!!s); });
    return () => { cancelled = true; };
  }, [nextPractice && nextPractice.id]);
  // Team-timezone-correct, not the old same-day-only heuristic (which broke
  // across a midnight boundary -- e.g. an 11pm-tonight practice couldn't
  // read as "soon" for a practice at 12:30am tomorrow). "Soon" here means
  // the same thing the guard popup's 2-hour threshold means: not more than
  // 2 hours out (already started/overdue counts as soon too).
  const isSoonOrLive = (p, team) => !!p && !isMoreThanTwoHoursAway(p, team);
  const [showFutureGuard, setShowFutureGuard] = useState(false);
  const runAsNewFromGuard = async practice => {
    const runNow = new Date();
    const { data: saved } = await savePracticeTree(null, {
      teamId: practice.teamId, locationId: practice.locationId, sublocationId: practice.sublocationId,
      date: localDateStr(runNow), startTime: runNow.toTimeString().slice(0, 5),
      prePracticeNotes: practice.prePracticeNotes,
      activities: stripIdsForCopy(practice.activities), coachId,
    });
    await refreshPlanning();
    setShowFutureGuard(false);
    if (saved) goToRun(saved.id);
  };
  const canManageAnyTeam = data.teams.some(t => canManageTeamInMode(t, coachId, mode));

  // Development Pulse focus-team resolution (Coach mode only -- data.teams
  // here is already homeTeamsForMode-scoped by HomeRoute, so no re-filter
  // needed for "visible Coach Mode team" / show_on_home). Priority 1
  // (nextPractice's own team) needs no fetch at all; priority 2 (most
  // recently active team) needs one batch call across every visible team,
  // fetched lazily only when there's no nextPractice to short-circuit it --
  // never a query per team.
  const [recentSessionByTeamId, setRecentSessionByTeamId] = useState(null);
  const homeTeamIdsKey = data.teams.map(t => t.id).join(",");
  useEffect(() => {
    if (isOrgMode || nextPractice || !homeTeamIdsKey) { setRecentSessionByTeamId(null); return; }
    fetchTeamsRecentCompletedSession(homeTeamIdsKey.split(",")).then(rows => {
      setRecentSessionByTeamId(Object.fromEntries(rows.map(r => [r.teamId, r.lastCompletedAt])));
    });
  }, [isOrgMode, !!nextPractice, homeTeamIdsKey]);
  // Direct feedback: a coach had no reason to ever open Goals & Insights'
  // History tab to discover an unreviewed practice note -- Home should
  // call their attention to it. canManage-gated since reviewing (clearing
  // the flag) is itself gated the same way in SessionHistoryDetail; an
  // assistant with no manage rights on any team never sees this.
  const [unviewedNoteTeamIds, setUnviewedNoteTeamIds] = useState([]);
  useEffect(() => {
    if (!homeTeamIdsKey) { setUnviewedNoteTeamIds([]); return; }
    let cancelled = false;
    fetchTeamsWithUnviewedNotes(homeTeamIdsKey.split(",")).then(ids => { if (!cancelled) setUnviewedNoteTeamIds(ids); });
    return () => { cancelled = true; };
  }, [homeTeamIdsKey]);
  const unviewedNoteTeam = (() => {
    const id = unviewedNoteTeamIds.find(tid => canManageTeamInMode(teamById(tid), coachId, mode));
    return id ? teamById(id) : null;
  })();
  // Direct feedback: an assistant coach (or helper) who'd just accepted an
  // invite saw Development Pulse for that team even though they don't head
  // -coach it -- the card is a head-coach planning tool (goal-setting/
  // Builder guidance), not something a non-managing coach should be shown
  // at all, regardless of what its CTA copy says. Scope both the focus-team
  // pool and nextPractice's own short-circuit to teams this coach actually
  // head-coaches, so a non-head-coached team is never even considered, not
  // just relabeled once picked.
  const headCoachTeams = isOrgMode ? [] : data.teams.filter(t => isHeadCoach(t, coachId));
  const dpNextPractice = nextPractice && isHeadCoach(teamById(nextPractice.teamId), coachId) ? nextPractice : null;
  // Direct feedback (same "glitchy" report as the runStatus fix above):
  // with no nextPractice and more than one home team, resolveDevelopment-
  // PulseFocusTeamId's own documented fallback (guess homeTeams[0], correct
  // once recentSessionByTeamId's fetch resolves) meant Development Pulse
  // could render one team's card for a moment, then visibly swap to a
  // different team's once the real "most recently active" answer came
  // back. Only wait on that fetch when it's actually going to run (no
  // nextPractice to short-circuit it, and more than one team for the
  // answer to possibly differ) -- a single-team coach or one with a
  // nextPractice already gets the right team on the very first render.
  const focusTeamNeedsAsyncData = !isOrgMode && !dpNextPractice && headCoachTeams.length > 1;
  const focusTeamDataReady = !focusTeamNeedsAsyncData || recentSessionByTeamId !== null;
  const focusTeamId = isOrgMode ? null : resolveDevelopmentPulseFocusTeamId({ nextPractice: dpNextPractice, homeTeams: headCoachTeams, recentSessionByTeamId });
  const focusTeam = focusTeamDataReady && focusTeamId ? teamById(focusTeamId) : null;
  const focusTeamCanManage = focusTeam ? canManageTeamInMode(focusTeam, coachId, mode) : false;
  const focusTeamHasCategories = focusTeam ? (data.skillCategories || []).some(c => c.sport === focusTeam.sport && !c.archived_at) : false;
  // A live-in-progress (or abandoned-but-not-completed) session for the
  // next practice withholds it from projection -- fetchPracticeRunStatus's
  // 'started' bucket already covers both, matching the spec's "do not
  // project the actively running practice from its stale planned state."
  const focusTeamIsLiveNow = !!(nextPractice && focusTeamId === nextPractice.teamId && runStatus[nextPractice.id] === "started");
  const developmentPulseNavigate = cta => {
    if (!cta) return;
    if (cta.kind === "goals_overview") navigate("/team/" + focusTeamId + "/goals");
    else if (cta.kind === "goals_untagged") navigate("/team/" + focusTeamId + "/goals", { state: { openGoalsView: "overview", emphasizeUntagged: true } });
    else if (cta.kind === "goals_trends") navigate("/team/" + focusTeamId + "/goals", { state: { openGoalsView: "trends" } });
    // goToBuilder (not a raw navigate()) -- it primes editPracticeId in
    // context synchronously before the route change, which BuilderScreen's
    // useState initializers need on their very first render; a bare
    // navigate("/builder/"+id) leaves them seeing a stale null
    // editPracticeId until BuilderRoute's own effect catches up a tick
    // later, by which point those useState calls already locked in a blank
    // "new practice" default and never re-derive from the real one.
    else if (cta.kind === "builder_goal_guidance" && cta.practiceId) goToBuilder(cta.practiceId, null, null, { openGoalGuidance: true, highlightedSkillCategoryId: cta.categoryId || null, source: "development_pulse" });
  };
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
  // Real bug found live: this used to only call markTeamStaffWelcomed and
  // never refresh local `data.teams` with the result, so `welcomedAt` here
  // stayed stale-null for the rest of the session. "Accept" only ever
  // dismissed the card via component-local state (dismissedWelcomeIds), so
  // simply navigating to another tab and back to Home (no full page
  // reload) remounted this component with a fresh, empty dismissal set --
  // the card reappeared even though the coach had already accepted it.
  // Following the mark with refreshTeams() catches the real data up
  // immediately, so pendingWelcome correctly computes to null on its own
  // as soon as the refresh lands, independent of any local-only state.
  useEffect(() => { if (pendingWelcomeStaffId) markTeamStaffWelcomed(pendingWelcomeStaffId).then(() => refreshTeams && refreshTeams()); }, [pendingWelcomeStaffId]);
  // "Accept" is a purely local dismissal for the moment before the refresh
  // above lands -- welcomedAt is already set server-side and reflected
  // locally within a beat, so there's no separate server-side "accepted"
  // state to flip here. Real leaving/hiding now lives in Settings > My Team
  // Assignments (see the "Manage Team Assignments" link below), not as a
  // raw "Leave" link right here.
  const [dismissedWelcomeIds, setDismissedWelcomeIds] = useState(new Set());
  const showWelcome = pendingWelcome && !dismissedWelcomeIds.has(pendingWelcome.team.id);

  // The reverse of the welcome card above (direct feedback: leaving a team
  // used to be silent to the head coach). One notice at a time, oldest
  // first, same "pick the first, refetch clears it once acted on" shape as
  // the org-invite card below -- acknowledging is a real server-side write
  // (acknowledge_team_departure), not a local-only dismissal, so it won't
  // resurface the way the welcome card's used to.
  const [ackingDepartureId, setAckingDepartureId] = useState(null);
  const pendingDeparture = (data.pendingTeamDepartures || [])[0] || null;
  const acknowledgeDeparture = async () => {
    if (!pendingDeparture) return;
    setAckingDepartureId(pendingDeparture.id);
    await acknowledgeTeamDeparture(pendingDeparture.id);
    if (refreshLibrary) await refreshLibrary();
    setAckingDepartureId(null);
  };

  // The reverse of the departure card above (direct feedback): the head
  // coach used to find out an invite was accepted only by noticing the
  // roster grew, with no nudge to actually go set up sharing/delegation for
  // the new coach. "Set Up Permissions" deep-links into the roster's
  // Coaches tab and auto-opens PermissionsModal for that specific person
  // (RostersTab reads location.state.openPermissionsForUserId), same
  // location.state deep-link convention Settings' Terms/Privacy back
  // button already established.
  const [ackingJoinId, setAckingJoinId] = useState(null);
  const pendingJoinNotice = (data.pendingTeamJoinNotices || [])[0] || null;
  const acknowledgeJoinNotice = async () => {
    if (!pendingJoinNotice) return;
    setAckingJoinId(pendingJoinNotice.id);
    await acknowledgeTeamJoinNotice(pendingJoinNotice.id);
    if (refreshLibrary) await refreshLibrary();
    // Real bug: the inviting coach's own `teams` state is loaded once at
    // login and never refetched in response to someone else's write (no
    // realtime subscription on team_staff/team_invites) -- if this card
    // renders while that session is already open, the roster's Coaches
    // tab kept showing the new coach as "pending" even after they'd
    // actually accepted, until the inviter reloaded the whole app.
    if (refreshTeams) await refreshTeams();
    setAckingJoinId(null);
  };
  const [openingPermissionsFor, setOpeningPermissionsFor] = useState(null);
  const goToCoachPermissions = async () => {
    if (!pendingJoinNotice) return;
    setOpeningPermissionsFor(pendingJoinNotice.id);
    // Real bug: only the Dismiss button (acknowledgeJoinNotice above) ever
    // called acknowledgeTeamJoinNotice -- Set Up Permissions, the button
    // coaches actually tap to act on this card, navigated away without
    // ever acknowledging it, so the same "X accepted your invite" prompt
    // was still there (unread) the next time Home rendered. Acknowledge
    // here too, same as Dismiss, so acting on the card closes it out just
    // as surely as dismissing it does.
    await acknowledgeTeamJoinNotice(pendingJoinNotice.id);
    if (refreshLibrary) await refreshLibrary();
    // Await the refresh before navigating so RostersTab's deep-link effect
    // (which reads team.coaches synchronously off already-loaded state)
    // finds the newly-accepted coach instead of racing a stale roster.
    if (refreshTeams) await refreshTeams();
    setOpeningPermissionsFor(null);
    navigate("/team/" + pendingJoinNotice.teamId + "/roster", { state: { openPermissionsForUserId: pendingJoinNotice.joinedUserId } });
  };

  // Multi-Coach Builder handoff section 8: the assigned coach's own real
  // in-app notice, the moment a head coach assigns them a station -- can't
  // assume they're looking at the app right now, so this is a persistent
  // Home card (acknowledged via a real server write, not a local dismiss)
  // rather than a passive badge. Same shape as the join-notice card above,
  // one level down: "go build it" instead of "go set up permissions."
  const [ackingStationNoticeId, setAckingStationNoticeId] = useState(null);
  const pendingStationNotice = (data.pendingStationAssignmentNotices || [])[0] || null;
  const dismissStationNotice = async () => {
    if (!pendingStationNotice) return;
    setAckingStationNoticeId(pendingStationNotice.id);
    await acknowledgeStationAssignmentNotice(pendingStationNotice.id);
    if (refreshLibrary) await refreshLibrary();
    setAckingStationNoticeId(null);
  };
  const goToMyStation = async () => {
    if (!pendingStationNotice) return;
    setAckingStationNoticeId(pendingStationNotice.id);
    await acknowledgeStationAssignmentNotice(pendingStationNotice.id);
    if (refreshLibrary) await refreshLibrary();
    setAckingStationNoticeId(null);
    goToBuilder(pendingStationNotice.practiceId);
  };

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

  // Real consent gate (2026-08-01), unlike the team_staff welcome card
  // above -- team_invites requires an explicit accept/decline before
  // anything is granted, same pattern as the org-invite card just above.
  const [respondingTeamInviteId,setRespondingTeamInviteId]=useState(null);
  const pendingTeamInvite=(data.pendingTeamInvites||[])[0]||null;
  const respondToTeamInvite=async(accept)=>{
    if(!pendingTeamInvite)return;
    setRespondingTeamInviteId(pendingTeamInvite.id);
    if(accept)await acceptTeamInvite(pendingTeamInvite.id); else await declineTeamInvite(pendingTeamInvite.id);
    if(refreshLibrary)await refreshLibrary();
    if(accept&&refreshTeams)await refreshTeams();
    setRespondingTeamInviteId(null);
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

  if (historyPractice) return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}><HistoryViewer data={data} practice={historyPractice} onRunAgain={() => runAgainFrom(historyPractice)} onBack={() => setHistoryPractice(null)} coachId={coachId} refreshPlanning={refreshPlanning} /></div>);
  if (viewPractice) return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}><PracticeDetail practice={viewPractice} data={data} goToBuilder={goToBuilder} goToRun={goToRun} coachId={coachId} refreshPlanning={refreshPlanning} onBack={() => setViewPractice(null)} mode={mode} /></div>);

  const joinBarContent = (<>
    {joinableLiveSessions.map(s => (<button key={s.sessionId} onClick={() => goToRun(s.practiceId)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 16px", background: "var(--green)", color: "#fff", border: "none", borderBottom: "1px solid rgba(255,255,255,.15)", cursor: "pointer", fontFamily: "Barlow Condensed,sans-serif" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", flexShrink: 0 }} />
      {/* setupConfirmedAt distinguishes a real running practice from one
          still sitting in Practice Setup (shared pre-live stage) -- both
          are joinable, but worded differently so a coach with more than
          one open at once (e.g. two teams, or an un-aborted prior setup)
          can tell which is which before tapping Join. */}
      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".02em" }}>{s.setupConfirmedAt ? "Live practice" : "Practice setup"} for {s.team.name}</span>
      <span style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", textDecoration: "underline", marginLeft: 4 }}>Join</span>
    </button>))}
  </>);
  const headerContent = (<div style={{ padding: "20px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{greeting},</div>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 26, fontWeight: 900, color: (isOrgMode && activeOrg && activeOrg.color) || "var(--green)", lineHeight: 1, display: "flex", alignItems: "center", gap: 8 }}>
        {isOrgMode && activeOrg && activeOrg.color && <span style={{ width: 14, height: 14, borderRadius: "50%", background: activeOrg.color, flexShrink: 0 }} />}
        {isOrgMode ? (activeOrg ? activeOrg.name : "Organization") : coachName}
      </div>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative" }}>
        <button onClick={() => setShowHelpMenu(s => !s)} style={{ position: "relative", background: "var(--s2)", border: "1.5px solid var(--b)", borderRadius: "50%", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, fontFamily: "Barlow Condensed,sans-serif", fontSize: 18, fontWeight: 900, color: "var(--green)" }}>
          ?
        </button>
        {/* Getting Started moved out of this menu entirely -- it's now a
            persistent card on Home itself (see GettingStartedCard below),
            so the green dot nudging you toward this menu for it is gone
            too. FAQs replaces it here (task: only Send Feedback / FAQs). */}
        {showHelpMenu && <div className="mini-menu" style={{ minWidth: 170 }}>
          <button className="mm-item" onClick={() => { setShowHelpMenu(false); navigate("/faq"); }}>FAQs</button>
          <button className="mm-item" onClick={() => { setShowHelpMenu(false); setShowFeedback(true); }}>Send Feedback</button>
        </div>}
      </div>
      <button onClick={goToSettings} aria-label="Settings" style={{ background: "var(--s2)", border: "1.5px solid var(--b)", borderRadius: "50%", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "var(--tm)" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1.11-1.56 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.56-1.03H3a2 2 0 110-4h.09a1.7 1.7 0 001.56-1.11 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34h.08A1.7 1.7 0 0010.12 3.6V3a2 2 0 114 0v.09a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87v.08c.26.63.87 1.05 1.56 1.03H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.51 1.03z"/></svg>
      </button>
    </div>
  </div>);
  const modeToggleContent = (myOrgs.length > 0 && <div style={{ padding: "0 16px 12px" }}>
    <div style={{ display: "flex", gap: 0, background: "var(--s2)", borderRadius: "var(--r)", padding: 3 }}>
      <button onClick={() => setMode({ type: "coach" })} style={{ flex: 1, padding: "7px 0", border: "none", cursor: "pointer", borderRadius: "calc(var(--r) - 2px)", background: !isOrgMode ? "#fff" : "transparent", fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: !isOrgMode ? "var(--black)" : "var(--td)" }}>Coach Mode</button>
      <button onClick={switchToOrgMode} style={{ flex: 1, padding: "7px 0", border: "none", cursor: "pointer", borderRadius: "calc(var(--r) - 2px)", background: isOrgMode ? "var(--green)" : "transparent", fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: isOrgMode ? "#fff" : "var(--td)" }}>Organization Mode</button>
    </div>
    {showOrgPicker && <div className="card" style={{ marginTop: 6, padding: 8 }}>
      {myOrgs.map(org => (<button key={org.id} className="mm-item" style={{ width: "100%", textAlign: "left" }} onClick={() => pickOrg(org.id)}>{org.name}</button>))}
    </div>}
  </div>);
  const gettingStartedContent = (!checklistDone && !gettingStartedHidden && <GettingStartedCard data={data} hasCompleted={hasCompleted} coachId={coachId} mode={mode} goToBuilder={goToBuilder} goToSchedule={goToSchedule} navigate={navigate} onHide={() => { setGettingStartedHidden(coachId, true); setGettingStartedHiddenState(true); }} />);
  const noticesContent = (<>
    {showWelcome && <div style={{ margin: "0 16px 12px" }}><div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 14, marginBottom: 10 }}>You've been added to <strong>{pendingWelcome.team.name}</strong> by {adderName}.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary bxs" style={{ flex: 1 }} onClick={() => setDismissedWelcomeIds(s => new Set(s).add(pendingWelcome.team.id))}>Accept</button>
        <button className="btn ghost bxs" style={{ flex: 1 }} onClick={() => navigate("/settings", { state: { openSection: "assignments" } })}>Manage Team Assignments</button>
      </div>
    </div></div>}
    {pendingOrgInvite && <div style={{ margin: "0 16px 12px" }}><div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 14, marginBottom: 8 }}>You've been invited to help lead <strong>{pendingOrgInvite.organizationName}</strong> as {articleFor(ORG_ROLE_LABELS[pendingOrgInvite.role] || "Director")} {ORG_ROLE_LABELS[pendingOrgInvite.role] || "Director"}{pendingOrgInvite.teamRole ? ", with a team role waiting for you once you accept" : ""}.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary bxs" disabled={respondingInviteId === pendingOrgInvite.id} onClick={() => respondToInvite(true)}>Accept</button>
        <button className="btn ghost bxs" disabled={respondingInviteId === pendingOrgInvite.id} onClick={() => respondToInvite(false)}>Decline</button>
      </div>
    </div></div>}
    {pendingTeamInvite && <div style={{ margin: "0 16px 12px" }}><div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 14, marginBottom: 8 }}>You've been invited to join <strong>{pendingTeamInvite.teamName}</strong> as {articleFor(pendingTeamInvite.role)} {pendingTeamInvite.role}.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary bxs" disabled={respondingTeamInviteId === pendingTeamInvite.id} onClick={() => respondToTeamInvite(true)}>Accept</button>
        <button className="btn ghost bxs" disabled={respondingTeamInviteId === pendingTeamInvite.id} onClick={() => respondToTeamInvite(false)}>Decline</button>
      </div>
    </div></div>}
    {pendingDeparture && <div style={{ margin: "0 16px 12px" }}><div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 14, marginBottom: 10 }}><strong>{pendingDeparture.departedName}</strong> ({pendingDeparture.role}) left <strong>{pendingDeparture.teamName}</strong>.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary bxs" style={{ flex: 1 }} disabled={ackingDepartureId === pendingDeparture.id} onClick={acknowledgeDeparture}>Acknowledge</button>
        <button className="btn ghost bxs" style={{ flex: 1 }} onClick={() => { acknowledgeDeparture(); navigate("/team/" + pendingDeparture.teamId + "/roster"); }}>View Coaches</button>
      </div>
    </div></div>}
    {pendingJoinNotice && <div style={{ margin: "0 16px 12px" }}><div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 14, marginBottom: 10 }}><strong>{pendingJoinNotice.joinedName}</strong> accepted your invite to <strong>{pendingJoinNotice.teamName}</strong> as {articleFor(pendingJoinNotice.role)} {pendingJoinNotice.role}. Set up what you share and delegate with them.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary bxs" style={{ flex: 1 }} disabled={openingPermissionsFor === pendingJoinNotice.id} onClick={goToCoachPermissions}>{openingPermissionsFor === pendingJoinNotice.id ? "Opening..." : "Set Up Permissions"}</button>
        <button className="btn ghost bxs" style={{ flex: 1 }} disabled={ackingJoinId === pendingJoinNotice.id} onClick={acknowledgeJoinNotice}>Dismiss</button>
      </div>
    </div></div>}
    {pendingStationNotice && <div style={{ margin: "0 16px 12px" }}><div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 14, marginBottom: 10 }}>You've been asked to plan <strong>{pendingStationNotice.stationName || "a station"}</strong> for <strong>{pendingStationNotice.practiceName || "a practice"}</strong> ({pendingStationNotice.teamName}).</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary bxs" style={{ flex: 1 }} disabled={ackingStationNoticeId === pendingStationNotice.id} onClick={goToMyStation}>Build My Station</button>
        <button className="btn ghost bxs" style={{ flex: 1 }} disabled={ackingStationNoticeId === pendingStationNotice.id} onClick={dismissStationNotice}>Dismiss</button>
      </div>
    </div></div>}
    {unviewedNoteTeam && <div style={{ margin: "0 16px 12px" }}><div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 14, marginBottom: 10 }}>A practice note from <strong>{unviewedNoteTeam.name}</strong>'s history hasn't been reviewed yet.</div>
      <button className="btn primary bxs bfull" onClick={() => navigate("/team/" + unviewedNoteTeam.id + "/goals", { state: { openGoalsView: "history" } })}>Review Practice History</button>
    </div></div>}
  </>);

  // Org Members management (add a member, cancel a pending invite) moved
  // to the Teams tab's Organization section -- per direct feedback, Home
  // isn't the right long-term place for this as membership grows. Home
  // keeps just the at-a-glance rollup.
  const orgRollupContent = (isOrgMode && <div style={{ padding: "0 16px 16px" }}>
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
  </div>);

  // Your Teams quick-jump (2026-07-2x): a per-team row lived here once
  // before, styled as pills, and got removed per direct feedback --
  // pills read as an in-place filter control, not "leave this page."
  // Brought back deliberately card-styled instead (matching the
  // outgoing Last Practice cards' own look, which never had that
  // confusion) so it reads as navigation, not filtering.
  const yourTeamsContent = (data.teams.length > 0 && <div style={{ marginBottom: 16 }}>
    <div className="clbl mb8">{isOrgMode ? "Org Teams" : "Your Teams"}</div>
    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
      {data.teams.map(team => (<div key={team.id} className="card" style={{ flexShrink: 0, minWidth: 140, cursor: "pointer", borderLeft: "4px solid " + (team.colorPrimary || "transparent"), padding: "10px 12px" }} onClick={() => goToTeam(team.id)}>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 15, fontWeight: 700, whiteSpace: "nowrap" }}>{team.name}</div>
        <div style={{ fontSize: 11, color: "var(--td)" }}>{team.sport}</div>
        {/* Org name shown here (Coach mode only) so a coach juggling
            personal teams and org teams together can tell which is
            which at a glance -- Org mode already says the org's name
            in the greeting header above, so repeating it per-card there
            would just be noise. */}
        {!isOrgMode && team.organizationName && <div style={{ fontSize: 10, color: "var(--td)", marginTop: 2 }}>{team.organizationName}</div>}
        {!isOrgMode && <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--td)", marginTop: 2 }}>{myTeamRole(team, coachId)}</div>}
      </div>))}
    </div>
  </div>);

  // BB composition: this strip renders full-width, above Up Next AND
  // Development Pulse (see the isBB branch below), never inside Up Next's
  // own column -- putting it there first pushed Up Next's card lower than
  // Development Pulse's, reintroducing exactly the misalignment the .clbl
  // pull-out above (DevelopmentPulseCard.jsx) fixes. At mobile there's
  // nothing beside Up Next to misalign against, so it sits directly above
  // the Up Next card there instead, no different treatment needed.
  //
  // Dots reuse Month view's own per-practice rule (ScheduleScreen.jsx) --
  // one dot per practice, colored by that team's own colorPrimary, filled
  // if planned, hollow ring if not, muted if cancelled -- capped at 2
  // (Month view caps at 4, but its grid cells are far wider than this
  // single 7-across row's cells) with a "+N" past that. Tapping a day
  // opens the exact same DaySheet Month view's own dots open, not a
  // second, parallel day-list -- Up Next's own card never changes, since
  // its buttons are wired to the one real, time-gated next practice.
  const weekGlanceContent = (data.teams.length > 0 && <div style={{ marginBottom: 16 }}>
    <div className="clbl mb8">This Week</div>
    <div style={{ display: "flex", gap: 4 }}>
      {weekDates.map(d => {
        const dayPractices = (weekPracticesByDate[d] || []).slice().sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
        const isToday = d === todayStr;
        const dow = new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" }).slice(0, 3).toUpperCase();
        const dnum = Number(d.slice(8, 10));
        const visible = dayPractices.slice(0, 2);
        const overflow = dayPractices.length - visible.length;
        return (<button key={d} onClick={() => setGlanceDate(d)} style={{ flex: 1, minWidth: 0, textAlign: "center", background: isToday ? "var(--s2)" : "none", border: "1px solid " + (isToday ? "var(--b)" : "transparent"), borderRadius: 7, padding: "5px 2px 4px", cursor: "pointer", font: "inherit" }}>
          <span style={{ display: "block", fontSize: 9, fontWeight: 700, color: "var(--td)", letterSpacing: ".04em", marginBottom: 3 }}>{dow}</span>
          <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--black)", marginBottom: 3 }}>{dnum}</span>
          <span style={{ display: "flex", gap: 2, alignItems: "center", justifyContent: "center", height: 6 }}>
            {visible.length === 0 && <span style={{ display: "block", width: 6, height: 6, borderRadius: "50%", background: "transparent", border: "1.3px solid transparent" }} />}
            {visible.map(p => {
              const team = teamById(p.teamId), planned = isPlanned(p), cancelled = isCancelled(p), color = (team && team.colorPrimary) || "var(--green)";
              return (<span key={p.id} style={{ display: "block", width: 6, height: 6, borderRadius: "50%", background: planned && !cancelled ? color : "transparent", border: "1.3px solid " + (cancelled ? "var(--td)" : color), opacity: cancelled ? .5 : 1, flexShrink: 0 }} />);
            })}
            {overflow > 0 && <span style={{ fontSize: 8, fontWeight: 700, color: "var(--td)", lineHeight: 1 }}>+{overflow}</span>}
          </span>
        </button>);
      })}
    </div>
  </div>);

  const heroContent = (!runStatusLoaded && upcomingCandidates.length > 0) ? (
    <div className="card" style={{ marginBottom: 16, textAlign: "center", padding: "28px 20px", color: "var(--td)", fontSize: 14 }}>Loading...</div>
  ) : (<>
    {!nextPractice && nextCancelledPractice && (() => {
      const team = teamById(nextCancelledPractice.teamId);
      return (<div className="card" style={{ marginBottom: 16, borderColor: "var(--b)" }}>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--td)", marginBottom: 6 }}>{dayLbl(nextCancelledPractice.date, todayStr, tomorrowStr)}{nextCancelledPractice.startTime ? " · " + timeLbl(nextCancelledPractice) : ""} · Cancelled</div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 26, fontWeight: 900, lineHeight: 1, marginBottom: 4, color: "var(--td)", textDecoration: "line-through" }}>{team ? team.name : "Practice"}</div>
        <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>This practice was cancelled -- nothing else is coming up yet.</div>
        <button className="btn outline blg bfull" onClick={() => setViewPractice(nextCancelledPractice)}>View Practice</button>
      </div>);
    })()}
    {!nextPractice && !nextCancelledPractice && <div className="card" style={{ marginBottom: 16, textAlign: "center", padding: "28px 20px" }}>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{data.teams.length === 0 ? "Set up your practice schedule" : "Nothing on the schedule"}</div>
      <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 16 }}>{!canManageAnyTeam ? "Nothing planned yet." : data.teams.length === 0 ? "Add a team, then set up a recurring schedule to get started." : "Build a practice or set up a recurring schedule."}</div>
      {canManageAnyTeam && <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary bmd" style={{ flex: 1 }} onClick={() => goToBuilder(null)}>+ Build a Practice</button>
        <button className="btn outline bmd" style={{ flex: 1 }} onClick={goToSchedule}>Set Up Schedule</button>
      </div>}
    </div>}

    {nextPractice && (() => {
      const team = teamById(nextPractice.teamId), loc = locById(nextPractice.locationId);
      const planned = isPlanned(nextPractice), soon = isSoonOrLive(nextPractice, team);
      const canManage = canManageTeamInMode(team, coachId, mode);
      const count = absenceCounts[nextPractice.id] || 0;
      const headcount = team ? Math.max(0, team.players.length - count) : null;
      // "Up Next" names what this card actually is -- the single soonest
      // practice -- distinct from the "Upcoming Practices" list further
      // down, which covers the whole week.
      return (<><div className="clbl mb8">Up Next</div>
      <div className="card" style={{ marginBottom: 16, borderColor: soon ? "var(--green)" : "var(--b)", borderWidth: soon ? 2 : 1.5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          {team && team.colorPrimary && <span style={{ width: 10, height: 10, borderRadius: "50%", boxSizing: "border-box", background: planned ? team.colorPrimary : "transparent", border: "1.5px solid " + team.colorPrimary, flexShrink: 0 }} />}
          <span style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--td)" }}>{dayLbl(nextPractice.date, todayStr, tomorrowStr)}{nextPractice.startTime ? " · " + timeLbl(nextPractice) : ""}</span>
        </div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 26, fontWeight: 900, lineHeight: 1, marginBottom: 4 }}>{team ? team.name : "Practice"}</div>
        <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>
          {loc ? loc.name : "Location TBD"}
          {headcount !== null && <span> · {headcount} of {team.players.length} expected</span>}
          {planningState(nextPractice) && <span> · <PlanPill practice={nextPractice} /></span>}
        </div>
        {/* .blg, not .bxl -- matches the planned-state buttons below
            (already sized down from bxl for the same overflow reason
            documented there); bxl here just made this one button read
            taller than every other button on the screen for no reason. */}
        {!planned && canManage && <button className="btn primary blg bfull" onClick={() => goToBuilder(nextPractice.id)}>Plan Practice</button>}
        {!planned && !canManage && <div className="btn outline blg bfull" style={{ textAlign: "center", cursor: "default" }}>Not planned yet</div>}
        {/* "Practice Setup" as a distinct button/label is gone (direct
            feedback: it showed for a practice over a week away, where
            jumping straight into pre-live setup makes no sense) --
            always either "Join Practice" (a session already exists,
            regardless of scheduled time) or "Start Practice →". Tapping
            Start more than 2 hours before the real scheduled time no
            longer silently jumps into that practice's own live session
            (the exact bug that left a still-upcoming practice reading as
            already completed) -- it opens the 3-choice guard below
            instead. Sized down from bxl to blg and forced minWidth:0 on
            both -- two bxl buttons (nowrap text, big padding) never
            actually fit side by side on a phone-width screen: flex items
            default to min-width:auto, so flex-shrink couldn't shrink
            either below its own text width and the row overflowed the
            viewport. */}
        {planned && <div style={{ display: "flex", gap: 8 }}>
          <button className="btn outline blg" style={{ flex: 1, minWidth: 0 }} onClick={() => setViewPractice(nextPractice)}>Review Plan</button>
          <button className="btn primary blg" style={{ flex: 1, minWidth: 0 }} onClick={() => isSessionLive ? goToRun(nextPractice.id) : (soon ? goToRun(nextPractice.id) : setShowFutureGuard(true))}>{isSessionLive ? "Join Practice" : "Start Practice →"}</button>
        </div>}
        {showFutureGuard && <FuturePracticeGuardModal practice={nextPractice} team={team} onCancel={() => setShowFutureGuard(false)} onRunAsNew={() => runAsNewFromGuard(nextPractice)} onRunNow={() => { setShowFutureGuard(false); goToRun(nextPractice.id); }} />}
      </div></>);
    })()}
  </>);

  // Development Pulse: Coach mode only, directly beneath the hero and
  // above everything else, per the spec. Not rendered in Org mode --
  // a director-facing cross-team version is explicitly a future,
  // separate widget, never this card reused with a random team.
  const devPulseContent = (<>
    {!isOrgMode && focusTeam && <DevelopmentPulseCard team={focusTeam} nextPractice={nextPractice} canManage={focusTeamCanManage} data={data} coachId={coachId} hasSportCategories={focusTeamHasCategories} isLiveNow={focusTeamIsLiveNow} onNavigate={developmentPulseNavigate} />}
    {/* Direct feedback: an assistant/helper with no head-coached team
        anywhere used to just see nothing here (headCoachTeams.length===0
        means focusTeam is always null for them) -- no explanation why the
        widget they see other coaches use is simply missing. Prompts them
        toward the one thing that would actually unlock it, same "Create a
        team" entry point Getting Started's own first step uses. */}
    {!isOrgMode && !focusTeam && headCoachTeams.length === 0 && <div className="card" style={{ marginBottom: 16, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--td)", marginBottom: 6 }}>Development Pulse</div>
      <div style={{ fontSize: 14, color: "var(--black2)", marginBottom: 12, lineHeight: 1.5 }}>Development Pulse tracks how a team's practices compare to its goals over time -- it's for teams you head-coach. Create a team to start seeing it.</div>
      <button className="btn outline bmd bfull" onClick={() => navigate("/teams")}>Create a Team</button>
    </div>}
  </>);

  // Direct feedback: the "N practices in the next 14 days need a plan"
  // nudge is gone -- Upcoming Practices already shows the coach's next
  // 4 practices (planned or not, "Needs plan" called out inline per
  // row below) and My Schedule covers the rest; a second surface
  // saying the same thing was redundant.
  const upcomingContent = (<>
    <div className="sechdr" style={{ marginBottom: 8 }}><span className="sectitle">Upcoming Practices</span><button className="btn ghost bxs" onClick={goToSchedule}>My Schedule</button></div>
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
            {/* count>0 branch wraps "N out" in its own nowrap span -- found
                live wrapping mid-phrase ("1" ending one line, "out"
                starting the next), same fix as PlanPill's "0/60 min". */}
            <div className="limt">{dayLbl(p.date, todayStr, tomorrowStr)}{p.startTime ? " · " + timeLbl(p) : ""}{loc ? " · " + loc.name : ""}{!planned && " · Needs plan"}{planningState(p) && <React.Fragment> · <PlanPill practice={p} /></React.Fragment>}{count > 0 && <React.Fragment> · <span style={{ whiteSpace: "nowrap" }}>{count} out</span></React.Fragment>}</div>
          </div>
        </div>
        <div style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
          <button className="ell-btn" onClick={e => {
            e.stopPropagation();
            if (practiceMenuId === p.id) { setPracticeMenuId(null); return; }
            setPracticeMenuUp(menuNeedsToOpenUpward(e.currentTarget.getBoundingClientRect(), 120));
            setPracticeMenuId(p.id);
          }}><span /><span /><span /></button>
          {practiceMenuId === p.id && <div className="mini-menu" style={practiceMenuUp ? { right: 0, minWidth: 140, top: "auto", bottom: "calc(100% - 4px)" } : { right: 0, minWidth: 140 }}>
            <button className="mm-item" onClick={() => { setPracticeMenuId(null); goToBuilder(p.id); }}>Edit</button>
            <button className="mm-item mm-danger" onClick={() => { delPractice(p.id); setPracticeMenuId(null); }}>Delete</button>
          </div>}
        </div>
      </div>);
    })}
  </>);

  const bottomRowContent = (<div style={{ marginTop: 20, display: "flex", gap: 8 }}>
    {canManageAnyTeam && <button className="btn outline bmd" style={{ flex: 1 }} onClick={() => goToBuilder(null)}>+ Practice</button>}
    <button className="btn ghost bmd" style={{ flex: 1 }} onClick={() => setShowAbsencePicker(true)}>Player Out</button>
  </div>);

  // BB layout pass: two-column dashboard at BB (left: hero + Upcoming
  // Practices; right: Getting Started + notification cards + Development
  // Pulse), per the handoff's own spec -- join bar/header/mode toggle stay
  // full width above both, same as they already were at mobile. Every
  // piece above is unchanged JSX/state/handlers; only the wrapper differs.
  return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}>
    {joinBarContent}
    {headerContent}
    {modeToggleContent}
    {showFeedback && <FeedbackModal coachId={coachId} coachEmail={coachEmail} onClose={() => setShowFeedback(false)} />}
    {isBB ? (<>
      <div style={{ padding: "0 16px" }}>{yourTeamsContent}</div>
      <div style={{ padding: "0 16px" }}>{weekGlanceContent}</div>
      <TwoPane
        left={<div style={{ padding: "0 16px" }}>{heroContent}{upcomingContent}{bottomRowContent}</div>}
        right={<div style={{ padding: "0 16px" }}>{gettingStartedContent}{noticesContent}{orgRollupContent}{devPulseContent}</div>}
      />
    </>) : (<>
      {gettingStartedContent}
      {noticesContent}
      {orgRollupContent}
      <div style={{ padding: "0 16px" }}>
        {yourTeamsContent}
        {weekGlanceContent}
        {heroContent}
        {devPulseContent}
        {upcomingContent}
        {bottomRowContent}
      </div>
    </>)}
    {showAbsencePicker && <AbsencePicker data={data} coachId={coachId} mode="pickPlayerThenPractices" onClose={() => { setShowAbsencePicker(false); refreshAbsenceCounts(); }} />}
    {glanceDate && <DaySheet date={glanceDate} practices={(weekPracticesByDate[glanceDate] || []).slice().sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))} data={data} todayStr={todayStr} runStatus={weekRunStatus} onPick={p => { setGlanceDate(null); openWeekPractice(p); }} onClose={() => setGlanceDate(null)} />}
  </div>);
}
