import React, { useState } from "react";

// Shared by both equipment-mismatch moments (2026-08-01): copying a drill
// into your own library from Public Library/an org/a peer, and adding a
// drill straight into a practice in Builder. Same three choices either
// way, just different copy for what "add" means in each context -- kept as
// one component with a `context` prop rather than two near-duplicates.
export default function EquipmentMismatchDialog({ drillName, missing, context, onAddWithEquipment, onAddAnyway, onCancel }) {
  const [busy, setBusy] = useState(null); // "equip" | "anyway" | null

  const run = async (which, fn) => {
    setBusy(which);
    await fn();
    setBusy(null);
  };

  const missingList = missing.map(a => a.name).join(", ");
  const isLibrary = context === "library";

  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
    <div className="modal">
      <div className="mhandle" />
      <div className="mtitle">Missing Equipment</div>
      <div style={{ fontSize: 14, color: "var(--black2)", lineHeight: 1.5, marginBottom: 18 }}>
        {drillName} uses equipment you don't have yet: {missingList}. What would you like to do?
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="btn primary bmd" disabled={!!busy} onClick={() => run("equip", onAddWithEquipment)}>
          {busy === "equip" ? "Adding..." : (isLibrary ? "Add Equipment to Library" : "Add Equipment and Add Drill")}
        </button>
        <button className="btn outline bmd" disabled={!!busy} onClick={() => run("anyway", onAddAnyway)}>
          {busy === "anyway" ? "Adding..." : "Add Drill Anyway"}
        </button>
        <button className="btn ghost bmd" disabled={!!busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  </div>);
}
