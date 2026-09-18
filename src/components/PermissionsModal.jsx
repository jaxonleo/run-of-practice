import React, { useState } from "react";
import { setOwnLibraryShare, setManagerLibraryShare, setPracticeDelegate } from "../supabase.js";
import { EntitlementLockedMessage } from "./EntitlementNotice.jsx";

// Reciprocal permissions between a head coach and one rostered assistant/
// helper on a personal (non-org) team -- each side controls their own
// drill-library sharing, and the head coach separately controls
// delegating practice building (any number of assistants per team as of
// the Multi-Coach Builder work, 2026-08-16 -- was capped at one, enforced
// server-side by a unique index; that cap is gone, not just relaxed in
// this UI). Deliberately its own
// small component rather than folded into ModalLayer.jsx's already-large
// if/else chain -- same reasoning as AbsencePicker.jsx.
//
// Library sharing is a per-(head coach, assistant) relationship, not
// per-team, even though it's stored on team_staff (one row per team):
// is_library_peer already unions across every personal team this exact
// pair shares, and set_manager_library_share/set_own_library_share
// (20260810000000) keep every one of that pair's rows in sync so the
// toggle shown here always reflects the real, already-unioned access
// regardless of which team's Permissions page it's viewed from. Practice-
// building delegation is genuinely per-team on purpose (a coach may want
// a different delegate on each team), so that one stays untouched.
//
// Toggle switch styling copied verbatim from SettingsScreen.jsx's
// "Show on Home" control for visual consistency, not a new pattern.
function Toggle({ on, onClick, disabled }) {
  return (<button type="button" onClick={onClick} disabled={disabled} style={{ width: 44, height: 26, borderRadius: 13, border: "none", cursor: disabled ? "default" : "pointer", background: on ? "var(--field)" : "var(--surface-soft)", position: "relative", flexShrink: 0, opacity: disabled ? 0.6 : 1 }}>
    <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
  </button>);
}

function Row({ label, blurb, on, onToggle, busy, readOnly, readOnlyNote }) {
  return (<div style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 14, fontWeight: 700 }}>{label}</span>
      {readOnly
        ? <span style={{ fontSize: 12.5, color: "var(--text-dim)", flexShrink: 0 }}>{readOnlyNote}</span>
        : <Toggle on={on} onClick={onToggle} disabled={busy} />}
    </div>
    <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5, marginTop: 4 }}>{blurb}</div>
  </div>);
}

export default function PermissionsModal({ team, coach, coachId, canManage, refreshTeams, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isOwnRow = coach.userId === coachId;
  const managerView = canManage && !isOwnRow;

  // entitlementCta: true only for the practice-delegation toggle -- the
  // only one of the three toggles here with a real plan-driven failure mode
  // (set_practice_delegate, since the Phase 3 entitlement gate). Library
  // sharing has no plan gate, so its errors stay plain text.
  const run = async (fn, { entitlementCta } = {}) => {
    setBusy(true);
    setError("");
    const { error } = await fn();
    if (error) setError(entitlementCta ? <EntitlementLockedMessage message={error.message}/> : (error.message || "Something went wrong. Try again."));
    await refreshTeams();
    setBusy(false);
  };

  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal">
      <div className="mhandle" />
      <div className="mtitle">Permissions{managerView ? ": " + coach.name : ""}</div>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 4 }}>{team.name}</div>

      {managerView && (<>
        <Row
          label="Share Drill Library"
          blurb={"Let " + coach.name + " see your non-private drills in Explore and use them when building practices, including for their own teams. This does not give them any of your equipment or templates. Applies everywhere you and " + coach.name + " share a team, not just this one."}
          on={coach.headCoachSharesLibrary}
          busy={busy}
          onToggle={() => run(() => setManagerLibraryShare(coach.id, !coach.headCoachSharesLibrary))}
        />
        <Row
          label="Share Practice Planning"
          blurb={"Let " + coach.name + " build and edit this team's scheduled practices, the same as you can, and be assignable to individual stations in Builder."}
          on={coach.canBuildPractices}
          busy={busy}
          onToggle={() => run(() => setPracticeDelegate(coach.id, !coach.canBuildPractices), { entitlementCta: true })}
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
          blurb="Let your head coach on this team see your non-private drills in Explore and use them when building practices. Applies everywhere you and this head coach share a team, not just this one."
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

      {error && (typeof error === "string"
        ? <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 10 }}>{error}</div>
        : <div style={{ marginTop: 10 }}>{error}</div>)}
      <button className="btn ghost bmd bfull" style={{ marginTop: 16 }} onClick={onClose}>Close</button>
    </div>
  </div>);
}
