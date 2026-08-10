import React, { useState } from "react";
import { setOwnLibraryShare, setManagerLibraryShare, setPracticeDelegate } from "../supabase.js";

// Reciprocal per-relationship permissions between a head coach and one
// rostered assistant/helper on a personal (non-org) team -- each side
// controls their own drill-library sharing, and the head coach separately
// controls delegating practice building (one assistant per team, enforced
// server-side by a unique index, not just this UI). Deliberately its own
// small component rather than folded into ModalLayer.jsx's already-large
// if/else chain -- same reasoning as AbsencePicker.jsx.
//
// Toggle switch styling copied verbatim from SettingsScreen.jsx's
// "Show on Home" control for visual consistency, not a new pattern.
function Toggle({ on, onClick, disabled }) {
  return (<button type="button" onClick={onClick} disabled={disabled} style={{ width: 44, height: 26, borderRadius: 13, border: "none", cursor: disabled ? "default" : "pointer", background: on ? "var(--green)" : "var(--s2)", position: "relative", flexShrink: 0, opacity: disabled ? 0.6 : 1 }}>
    <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
  </button>);
}

function Row({ label, blurb, on, onToggle, busy, readOnly, readOnlyNote }) {
  return (<div style={{ padding: "12px 0", borderBottom: "1px solid var(--b)" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 14, fontWeight: 700 }}>{label}</span>
      {readOnly
        ? <span style={{ fontSize: 12.5, color: "var(--td)", flexShrink: 0 }}>{readOnlyNote}</span>
        : <Toggle on={on} onClick={onToggle} disabled={busy} />}
    </div>
    <div style={{ fontSize: 12.5, color: "var(--td)", lineHeight: 1.5, marginTop: 4 }}>{blurb}</div>
  </div>);
}

export default function PermissionsModal({ team, coach, coachId, canManage, refreshTeams, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isOwnRow = coach.userId === coachId;
  const managerView = canManage && !isOwnRow;

  const run = async (fn) => {
    setBusy(true);
    setError("");
    const { error } = await fn();
    if (error) setError(error.message || "Something went wrong. Try again.");
    await refreshTeams();
    setBusy(false);
  };

  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal">
      <div className="mhandle" />
      <div className="mtitle">Permissions{managerView ? ": " + coach.name : ""}</div>
      <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 4 }}>{team.name}</div>

      {managerView && (<>
        <Row
          label="Share Drill Library"
          blurb={"Let " + coach.name + " see your non-private drills in Explore and use them when building practices, including for their own teams. This does not give them any of your equipment or templates."}
          on={coach.headCoachSharesLibrary}
          busy={busy}
          onToggle={() => run(() => setManagerLibraryShare(coach.id, !coach.headCoachSharesLibrary))}
        />
        <Row
          label="Share Practice Planning"
          blurb={"Let " + coach.name + " build and edit this team's scheduled practices, the same as you can. Only one coach per team can have this at a time."}
          on={coach.canBuildPractices}
          busy={busy}
          onToggle={() => run(() => setPracticeDelegate(coach.id, !coach.canBuildPractices))}
        />
        <Row
          label={coach.name + "'s Library"}
          blurb={coach.name + " controls this from their own Permissions screen."}
          readOnly
          readOnlyNote={coach.assistantSharesLibrary ? "Shared with you" : "Not shared"}
        />
      </>)}

      {!managerView && isOwnRow && (<>
        <Row
          label="Share Drill Library"
          blurb="Let your head coach on this team see your non-private drills in Explore and use them when building practices."
          on={coach.assistantSharesLibrary}
          busy={busy}
          onToggle={() => run(() => setOwnLibraryShare(coach.id, !coach.assistantSharesLibrary))}
        />
        <Row
          label="Head Coach's Library"
          blurb="Your head coach controls this from their own Permissions screen."
          readOnly
          readOnlyNote={coach.headCoachSharesLibrary ? "Shared with you" : "Your head coach controls this"}
        />
        <Row
          label="Practice Planning"
          blurb="Your head coach controls this."
          readOnly
          readOnlyNote={coach.canBuildPractices ? "You can build practices for this team" : "Your head coach controls this"}
        />
      </>)}

      {error && <div style={{ fontSize: 13, color: "var(--red)", marginTop: 10 }}>{error}</div>}
      <button className="btn ghost bmd bfull" style={{ marginTop: 16 }} onClick={onClose}>Close</button>
    </div>
  </div>);
}
