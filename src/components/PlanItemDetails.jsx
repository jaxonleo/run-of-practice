import { useState } from "react";

// Practice history (direct feedback): reviewing a past practice should let a
// coach see what each drill/station actually was -- the same fields the live
// view showed (description, coaching focus, location/area, coach, equipment,
// player gear, grouping, players) -- but collapsed by default, so the page
// still reads as a compact recap until a coach asks for the detail. One
// toggle per drill or per station. Shared by both history screens
// (GoalsScreen's SessionHistoryDetail and CommandScreen's HistoryViewer) so
// the two can't drift apart again.
//
// `item` is either a plain activity (type "activity"/"checklist"/etc.) or a
// single station inside a station block; the field names line up across the
// two (sublocationId, coachId, equipment, playerGear, grouping, assignments).
export default function PlanItemDetails({ item, team, loc, data, isStation }) {
  const [open, setOpen] = useState(false);
  if (!item) return null;

  const coachName = id => { const c = team && (team.coaches || []).find(c => c.id === id); return c ? c.name : null; };
  const subName = (id, snap) => { const s = loc && (loc.sublocations || []).find(s => s.id === id); return s ? s.name : (snap || null); };
  const equipNames = ids => (Array.isArray(ids) ? ids : []).map(id => { const a = (data.assets || []).find(a => a.id === id); return a ? a.name : null; }).filter(Boolean).join(", ");
  const playerNames = ids => (ids || []).map(id => { const p = team && team.players.find(p => p.id === id); return p ? p.firstName : null; }).filter(Boolean).join(", ");

  const leader = coachName(item.coachId) || item.helperName || null;
  const area = subName(item.sublocationId, item.sublocationNameSnapshot);
  const equipment = equipNames(item.equipment);
  const grouping = item.grouping && item.grouping !== "whole" ? (item.grouping === "partners" ? "Partners" : (item.numGroups || 2) + " groups") : null;
  const players = playerNames(item.assignments);
  const items = item.type === "checklist" ? (item.items || []) : [];
  const drillName = isStation && item.activityName && item.activityName !== item.name ? item.activityName : null;

  const rows = [
    drillName && ["Drill", drillName],
    leader && [isStation ? "Coach" : "Led by", leader],
    area && [isStation ? "Area" : "Location", area],
    equipment && ["Equipment", equipment],
    item.playerGear && ["Player Gear", item.playerGear],
    grouping && ["Grouping", grouping],
    players && ["Players", players],
  ].filter(Boolean);
  const hasAnything = rows.length > 0 || item.description || item.coachingPoints || items.length > 0;
  if (!hasAnything) return null;

  return (<div style={{ marginTop: 6 }}>
    <button type="button" style={{ padding: "4px 0", border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600, color: "var(--field)" }} aria-expanded={open} onClick={() => setOpen(o => !o)}>
      {open ? "Hide details ▴" : "Show details ▾"}
    </button>
    {open && <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      {item.description && <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-soft)", whiteSpace: "pre-wrap" }}>{item.description}</div>}
      {item.coachingPoints && <div style={{ borderLeft: "3px solid var(--field)", paddingLeft: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--field)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 2 }}>Coaching Focus</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{item.coachingPoints}</div>
      </div>}
      {rows.map(([label, value]) => (<div key={label} style={{ fontSize: 13 }}><span style={{ color: "var(--text-dim)" }}>{label}: </span>{value}</div>))}
      {items.length > 0 && <div>
        {items.map(it => (<div key={it.id} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>{it.text}</div>))}
      </div>}
    </div>}
  </div>);
}
