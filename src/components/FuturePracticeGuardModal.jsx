import React, { useState, useRef } from "react";

// Shared 3-choice guard shown whenever a coach tries to start a practice
// more than 2 hours before its own scheduled time (direct feedback,
// prompted by a practice run a day early quietly consuming its real
// scheduled slot's completion state). "Run as New Practice" is exactly
// runAgainFrom/runNowFrom's existing copy-into-a-fresh-unscheduled-practice
// pattern (stripIdsForCopy + savePracticeTree(null, ...)), so the original
// scheduled slot is left completely untouched -- still scheduled, still
// planned, never marked completed. "Run This Practice Now" is the direct,
// pre-existing goToRun(practice.id) path -- the coach is on-site early or
// the real time just never got updated in the app. Kept as its own leaf
// component (not defined inside Home/PracticeDetail) so both can import it
// without a circular Home<->PracticeDetail dependency.
export default function FuturePracticeGuardModal({ practice, team, onCancel, onRunAsNew, onRunNow }) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = async fn => { if (busyRef.current) return; busyRef.current = true; setBusy(true); await fn(); };
  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
    <div className="modal">
      <div className="mhandle" />
      <div className="mtitle">This practice isn't scheduled for a while</div>
      <div style={{ fontSize: 14, color: "var(--td)", marginBottom: 16, lineHeight: 1.5 }}>
        {team ? team.name : "This practice"} isn't scheduled to start for over 2 hours. What would you like to do?
      </div>
      <button className="btn primary bmd bfull" style={{ marginBottom: 8 }} disabled={busy} onClick={() => run(onRunAsNew)}>Run This Plan as a New Practice</button>
      <div style={{ fontSize: 11, color: "var(--td)", marginBottom: 14, lineHeight: 1.4 }}>Creates a new practice from this plan, right now -- the original stays scheduled as planned.</div>
      <button className="btn outline bmd bfull" style={{ marginBottom: 8 }} disabled={busy} onClick={() => run(onRunNow)}>Run This Practice Now</button>
      <div style={{ fontSize: 11, color: "var(--td)", marginBottom: 14, lineHeight: 1.4 }}>Starts the actual scheduled practice early -- use this if you're just getting set up ahead of time.</div>
      <button className="btn ghost bmd bfull" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </div>);
}
