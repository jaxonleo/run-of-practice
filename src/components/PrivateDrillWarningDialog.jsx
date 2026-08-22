import React, { useState } from "react";

// Delegated Planning spec, Section 3: shown once per add, before a private
// drill actually lands in a shared team practice -- the source stays
// private in the owner's library regardless (already true architecturally,
// see BUILD-STATUS's "copy, not reference" convention: practice_activities/
// stations are full copies, and their RLS is team/practice-scoped, not
// drill-ownership-scoped), this dialog is purely the disclosure. Same shape
// as EquipmentMismatchDialog -- add/cancel, plus a persisted "don't show
// again" checkbox this component owns entirely (the caller only needs to
// know whether to skip rendering it at all, via dismissed).
export default function PrivateDrillWarningDialog({ drillName, onAdd, onCancel, onDismissForever }) {
  const [busy, setBusy] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleAdd = async () => {
    setBusy(true);
    if (dontShowAgain && onDismissForever) await onDismissForever();
    await onAdd();
    setBusy(false);
  };

  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
    <div className="modal">
      <div className="mhandle" />
      <div className="mtitle">Private Drill</div>
      <div style={{ fontSize: 14, color: "var(--black2)", lineHeight: 1.5, marginBottom: 14 }}>
        {drillName ? `"${drillName}" is` : "This is"} a private drill. Adding it to this practice will make the practice copy visible to coaches and helpers who can access the practice. Coaches with build access may reuse this practice, and the head coach may save the practice as a template. Your original drill will remain private in your drill library.
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13, color: "var(--td)", cursor: "pointer" }}>
        <input type="checkbox" checked={dontShowAgain} onChange={e => setDontShowAgain(e.target.checked)} />
        Don't show this warning again
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="btn primary bmd" disabled={busy} onClick={handleAdd}>{busy ? "Adding..." : "Add to Practice"}</button>
        <button className="btn ghost bmd" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  </div>);
}
