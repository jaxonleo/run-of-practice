import React from "react";

// Dedicated "Teams" tab (added 2026-07-15 per direct feedback): a plain
// navigable list, not the pill/chip styling Home used to use for the same
// job -- pills read as an in-place filter control, not "tap to leave this
// page," which is exactly what tapping one of these rows does. Reachable
// from anywhere (Library included), not just from Home.
export default function TeamsListScreen({ data, goToTeam }) {
  const teams = data.teams || [];
  return (<div style={{ paddingBottom: 80 }}>
    <div style={{ padding: "20px 16px 12px" }}>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 28, fontWeight: 900 }}>Teams</div>
    </div>
    <div style={{ padding: "0 16px" }}>
      {teams.length === 0 && <div className="empty"><div className="emtx">No teams yet.</div></div>}
      {teams.map(t => (<div key={t.id} className="li tap" style={{ marginBottom: 8, borderLeft: "4px solid " + (t.colorPrimary || "transparent") }} onClick={() => goToTeam(t.id)}>
        <div className="lim">
          <div className="lin">{t.name}</div>
          <div className="limt">{t.sport} · {t.players.length} player{t.players.length === 1 ? "" : "s"}</div>
        </div>
        <span style={{ color: "var(--green)", fontSize: 22 }}>&#8250;</span>
      </div>))}
    </div>
  </div>);
}
