import React from "react";
import { buildEquipmentNeeded } from "../constants.js";

// Practice plan -> clean PDF export. Renders a print-optimized document (not
// a screenshot of the app UI) and hands off to the browser's native
// Print/Save-as-PDF -- no client-side PDF library, no server round trip.
// #rop-print-root + the @media print rules in App.jsx's CSS constant do the
// actual "print only this" isolation; .no-print marks the on-screen-only
// toolbar. Reuses the exact actMins()/equipment-resolution logic already
// shipped in PracticeDetail.jsx so the printed total always matches what
// the coach already sees on-screen -- not a second, possibly-diverging
// calculation of the same thing.
function fmtClock(d) {
  if (!d) return null;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function PracticePlanPrint({ practice, team, loc, data, onClose }) {
  const activities = practice.activities || [];
  const skillTagsById = Object.fromEntries((data.skillTags || []).map(t => [t.id, t]));
  const assetsById = Object.fromEntries((data.assets || []).map(a => [a.id, a]));
  const resolveEquip = ids => (Array.isArray(ids) ? ids : []).map(id => assetsById[id] && assetsById[id].name).filter(Boolean);
  const tagIdsForLibraryId = id => { const drill = id && (data.activityLibrary || []).find(a => a.id === id); return (drill && drill.skillTagIds) || []; };
  const tagNamesForLibraryId = id => tagIdsForLibraryId(id).map(tid => skillTagsById[tid] && skillTagsById[tid].name).filter(Boolean);
  const categoryIdsForLibraryId = id => { const cats = new Set(); tagIdsForLibraryId(id).forEach(tid => { const t = skillTagsById[tid]; if (t && t.categoryId) cats.add(t.categoryId); }); return [...cats]; };
  const playerFocusForLibraryId = id => {
    const catIds = categoryIdsForLibraryId(id);
    if (!catIds.length || !team) return [];
    return team.players.map(p => {
      const notes = (p.focusAreas || []).filter(fa => catIds.includes(fa.categoryId) && fa.note).map(fa => fa.note);
      return notes.length ? { name: p.firstName, note: notes.join(" · ") } : null;
    }).filter(Boolean);
  };
  const actMins = a => a.type === "station_block" ? a.stations.length * (a.stationDuration || 0) + Math.max(0, a.stations.length - 1) * (a.transitionDuration || 0) : (a.duration || 0);
  const totalMins = activities.reduce((s, a) => s + actMins(a), 0);
  const stationCount = activities.filter(a => a.type === "station_block").reduce((s, a) => s + (a.stations || []).length, 0);
  const coachNameFor = id => { const c = id && team && team.coaches.find(c => c.id === id); return c ? c.name : null; };
  const subNameFor = id => { const s = id && loc && loc.sublocations && loc.sublocations.find(s => s.id === id); return s ? s.name : null; };
  // Direct feedback: the Equipment Needed summary used to just dedupe names
  // across the whole practice -- paired here with each drill's own coach/
  // location (same buildEquipmentNeeded helper Practice Setup and the
  // pre-live Preview link use) so a printed sheet actually says who's
  // bringing what, where.
  const equipItemsForNeeded = activities.flatMap(a => a.type === "station_block"
    ? (a.stations || []).map(st => ({ equipment: resolveEquip(st.equipment), coachName: coachNameFor(st.coachId) || st.helperName || null, locationName: subNameFor(st.sublocationId) }))
    : [{ equipment: resolveEquip(a.equipment), coachName: coachNameFor(a.coachId) || a.helperName || null, locationName: subNameFor(a.sublocationId) }]
  );
  const allEquip = buildEquipmentNeeded(equipItemsForNeeded);

  // Clock times only mean anything with a real start time to anchor to --
  // otherwise every drill just shows its duration, same as the in-app view.
  let clock = null;
  if (practice.startTime && practice.date) {
    const [h, m] = practice.startTime.split(":").map(Number);
    clock = new Date(practice.date + "T00:00:00");
    clock.setHours(h, m, 0, 0);
  }
  const advance = mins => { if (clock) clock = new Date(clock.getTime() + mins * 60000); };
  const timeRangeFor = mins => {
    if (!clock) return null;
    const start = fmtClock(clock);
    const end = new Date(clock.getTime() + mins * 60000);
    advance(mins);
    return start + " – " + fmtClock(end);
  };

  const P = { black: "#1a1a1a", td: "#666", green: "#2d6a4f", green2: "#40916c", amber: "#92400e", b: "#ddd" };

  return (<div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 500, overflowY: "auto", padding: "20px 0" }}>
    <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", justifyContent: "center", gap: 10, padding: "10px 0", background: "rgba(0,0,0,.5)" }}>
      <button className="btn primary bmd" onClick={() => window.print()}>Print / Save as PDF</button>
      <button className="btn outline bmd" style={{ background: "#fff" }} onClick={onClose}>Close</button>
    </div>
    <div id="rop-print-root" style={{ maxWidth: 800, margin: "0 auto", background: "#fff", padding: "40px 48px", fontFamily: "Georgia,'Times New Roman',serif", color: P.black }}>
      {/* A small letterhead above the practice-specific header -- this used
          to just be "PRACTICE PLAN / Team Name", nothing tying it back to
          the app, so a printed sheet handed to a parent or another coach
          had no sense of where it came from. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        <img src="/icon-192.png" alt="" width={28} height={28} style={{ borderRadius: 6, display: "block" }} />
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 15, fontWeight: 900, color: P.black, letterSpacing: ".01em" }}>Run of Practice</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "3px solid " + P.black, paddingBottom: 14, marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: P.green, marginBottom: 4 }}>
            The Run of Practice{practice.date && (" for " + (team ? team.name : "this team") + " on " + new Date(practice.date + "T12:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }))}
          </div>
          <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 34, fontWeight: 900, lineHeight: 1 }}>{team ? team.name : "Practice"}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 13, color: P.td }}>
          {practice.date && <div style={{ fontWeight: 700, color: P.black }}>{new Date(practice.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>}
          {practice.startTime && <div>Starts {fmtClock(clock ? new Date(clock.getTime()) : null) || ""}</div>}
          {loc && <div>{loc.name}</div>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 0, marginBottom: 26, border: "1px solid " + P.b, borderRadius: 6, overflow: "hidden" }}>
        {[["Total Time", totalMins + " min"], ["Drills", activities.length], ["Stations", stationCount], ["Equipment", allEquip.length]].map(([label, val], i) => (
          <div key={label} style={{ flex: 1, textAlign: "center", padding: "10px 6px", borderLeft: i > 0 ? "1px solid " + P.b : "none" }}>
            <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 22, fontWeight: 900, color: P.green }}>{val}</div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: P.td }}>{label}</div>
          </div>
        ))}
      </div>

      {allEquip.length > 0 && <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: P.amber, marginBottom: 6 }}>Equipment Needed</div>
        {allEquip.map((e, i) => (<div key={i} style={{ fontSize: 13, color: P.black, marginBottom: 3 }}>
          <span style={{ fontWeight: 700 }}>{e.name}</span>
          {e.contexts.length > 0 && <span style={{ color: P.td }}> — {e.contexts.map(c => [c.coachName, c.locationName].filter(Boolean).join(" @ ")).join(", ")}</span>}
        </div>))}
      </div>}

      {activities.map((a, i) => {
        const mins = actMins(a);
        const range = timeRangeFor(mins);
        const equip = resolveEquip(a.equipment);
        const tags = a.type === "activity" ? tagNamesForLibraryId(a.libraryId) : [];
        const focus = a.type === "activity" ? playerFocusForLibraryId(a.libraryId) : [];
        return (<div key={a.id} style={{ display: "flex", gap: 16, marginBottom: 22, breakInside: "avoid", pageBreakInside: "avoid" }}>
          <div style={{ flexShrink: 0, width: 90, textAlign: "right" }}>
            <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 26, fontWeight: 900, color: P.black, lineHeight: 1 }}>{i + 1}</div>
            {range && <div style={{ fontSize: 11, color: P.td, marginTop: 4, lineHeight: 1.3 }}>{range}</div>}
            <div style={{ fontSize: 12, fontWeight: 700, color: P.green, marginTop: 2 }}>{mins} min</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, borderLeft: "3px solid " + P.green, paddingLeft: 16 }}>
            <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 4 }}>
              {a.type === "station_block" ? "Station Block" : a.name}
            </div>
            {a.type === "activity" && <>
              {(a.sublocationId || a.coachId) && <div style={{ fontSize: 12, color: P.td, marginBottom: 6 }}>
                {(() => { const s = loc && loc.sublocations.find(s => s.id === a.sublocationId); const c = team && team.coaches.find(c => c.id === a.coachId); return [s && s.name, c && ("Coach: " + c.name)].filter(Boolean).join("  ·  "); })()}
              </div>}
              {a.description && <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>{a.description}</div>}
              {a.coachingPoints && <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: P.green2, marginBottom: 2 }}>Coaching Focus</div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{a.coachingPoints}</div>
              </div>}
              {tags.length > 0 && <div style={{ fontSize: 12, color: P.td, marginBottom: 6 }}><em>Skills: {tags.join(", ")}</em></div>}
              {equip.length > 0 && <div style={{ fontSize: 12, color: P.amber, marginBottom: 6 }}>Equipment: {equip.join(", ")}</div>}
              {a.playerGear && <div style={{ fontSize: 12, color: P.amber, marginBottom: 6 }}>Player Gear: {a.playerGear}</div>}
              {a.grouping && a.grouping !== "whole" && <div style={{ fontSize: 12, color: P.td, marginBottom: 6 }}>{a.grouping === "partners" ? "Partners" : a.numGroups + " Groups"}</div>}
              {focus.length > 0 && <div style={{ marginTop: 6, borderTop: "1px dashed " + P.b, paddingTop: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: P.td, marginBottom: 3 }}>Player Focus</div>
                {focus.map(f => (<div key={f.name} style={{ fontSize: 12, marginBottom: 2 }}><strong>{f.name}:</strong> {f.note}</div>))}
              </div>}
            </>}
            {a.type === "checklist" && <div>
              {(a.items || []).map(it => (<div key={it.id} style={{ fontSize: 13, padding: "2px 0" }}>&#9633; {it.text}</div>))}
              {a.notes && <div style={{ fontSize: 12, color: P.td, marginTop: 4, fontStyle: "italic" }}>{a.notes}</div>}
            </div>}
            {a.type === "station_block" && <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {a.stations.map((st, si) => {
                const stEquip = resolveEquip(st.equipment);
                const stTags = tagNamesForLibraryId(st.libraryId);
                const stFocus = playerFocusForLibraryId(st.libraryId);
                const s = loc && loc.sublocations.find(s => s.id === st.sublocationId);
                const c = team && team.coaches.find(c => c.id === st.coachId);
                return (<div key={st.id} style={{ borderLeft: "2px solid " + P.b, paddingLeft: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Station {si + 1}{st.activityName ? "  ·  " + st.activityName : ""} <span style={{ fontWeight: 400, color: P.td, fontSize: 12 }}>({a.stationDuration || 0} min)</span></div>
                  {(s || c) && <div style={{ fontSize: 12, color: P.td }}>{[s && s.name, c && ("Coach: " + c.name)].filter(Boolean).join("  ·  ")}</div>}
                  {st.coachingPoints && <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 2 }}>{st.coachingPoints}</div>}
                  {stTags.length > 0 && <div style={{ fontSize: 11, color: P.td }}><em>Skills: {stTags.join(", ")}</em></div>}
                  {stEquip.length > 0 && <div style={{ fontSize: 11, color: P.amber }}>Equipment: {stEquip.join(", ")}</div>}
                  {st.playerGear && <div style={{ fontSize: 11, color: P.amber }}>Player Gear: {st.playerGear}</div>}
                  {stFocus.length > 0 && <div style={{ marginTop: 3 }}>
                    {stFocus.map(f => (<div key={f.name} style={{ fontSize: 11 }}><strong>{f.name}:</strong> {f.note}</div>))}
                  </div>}
                </div>);
              })}
            </div>}
          </div>
        </div>);
      })}

      <div style={{ marginTop: 30, paddingTop: 10, borderTop: "1px solid " + P.b, fontSize: 10, color: P.td, textAlign: "center" }}>
        Generated by Run of Practice · runofpractice.com · {new Date().toLocaleDateString()}
      </div>
    </div>
  </div>);
}
