import React, { useEffect, useState } from "react";
import { attendanceTimeline } from "../constants.js";
import { fetchRunAttendance } from "../supabase.js";

// Direct feedback (2026-09-23): a practice's history never showed who was
// actually there. This is a quick visual of one live run's attendance: one
// row per rostered player with a bar across the run (filled while they were
// present), so a late arrival or early exit reads at a glance, plus how
// many minutes they were there. Data is session_attendance's append-only
// rows (the Run Practice snapshot plus every mid-practice update), turned
// into intervals by attendanceTimeline in constants.js.
const clock = ms => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const mins = ms => Math.round(ms / 60000);

export default function AttendanceTimeline({ team, practiceId, sessionId }) {
  const [att, setAtt] = useState(undefined);
  useEffect(() => {
    let live = true;
    setAtt(undefined);
    fetchRunAttendance({ practiceId, sessionId }).then(a => { if (live) setAtt(a); });
    return () => { live = false; };
  }, [practiceId, sessionId]);
  if (att === undefined || att === null) return null;

  const players = (team && team.players) || [];
  const byId = attendanceTimeline(att.rows, att.runStartMs, att.runEndMs);
  const span = Math.max(1, att.runEndMs - att.runStartMs);
  const runMins = mins(att.runEndMs - att.runStartMs);
  // Roster order, but grouped: full practice, then partial, then absent.
  // A player added to the roster after this run has no rows and is left out
  // rather than shown as absent.
  const order = { full: 0, partial: 1, absent: 2 };
  const rowsFor = players.filter(p => byId[p.id]).map(p => ({ p, rec: byId[p.id] }))
    .sort((a, b) => order[a.rec.status] - order[b.rec.status]);
  const attended = rowsFor.filter(r => r.rec.status !== "absent").length;

  return (<div className="card mb10" data-testid="attendance-timeline">
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 15, fontWeight: 700 }}>Attendance</div>
      <div style={{ fontFamily: "DM Mono,monospace", fontSize: 13, fontWeight: 700, color: attended < rowsFor.length ? "var(--caution)" : "var(--field)" }}>{attended}/{rowsFor.length}</div>
    </div>
    <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
      {clock(att.runStartMs)} to {clock(att.runEndMs)} · {runMins}m{att.status === "abandoned" ? " · aborted run" : ""}
    </div>
    {!rowsFor.length && <div style={{ fontSize: 13, color: "var(--text-dim)" }}>No attendance was recorded for this run.</div>}
    {rowsFor.map(({ p, rec }) => {
      const absent = rec.status === "absent";
      const detail = [rec.arrivedAt ? "Arrived " + clock(rec.arrivedAt) : null, rec.leftAt ? "Left " + clock(rec.leftAt) : null]
        .concat(!rec.arrivedAt && !rec.leftAt && rec.intervals.length > 1 ? ["Stepped out"] : []).filter(Boolean).join(" · ");
      return (<div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
        <div style={{ width: 104, flexShrink: 0, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: absent ? "var(--text-dim)" : "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {p.jersey ? <span style={{ fontFamily: "DM Mono,monospace", fontSize: 11, color: "var(--text-dim)", marginRight: 4 }}>#{p.jersey}</span> : null}{p.firstName}{p.lastName ? " " + p.lastName.charAt(0) + "." : ""}
          </div>
          {detail && <div style={{ fontSize: 11, color: "var(--caution)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{detail}</div>}
        </div>
        <div role="img" aria-label={absent ? p.firstName + " absent" : p.firstName + " present " + mins(rec.presentMs) + " of " + runMins + " minutes"} style={{ flex: 1, minWidth: 40, height: 10, borderRadius: 5, background: "var(--surface-soft)", position: "relative", overflow: "hidden" }}>
          {rec.intervals.map(([s, e], i) => (<div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: ((s - att.runStartMs) / span * 100) + "%", width: Math.max(0.5, (e - s) / span * 100) + "%", background: rec.status === "full" ? "var(--field)" : "var(--caution)", borderRadius: 5 }} />))}
        </div>
        <div style={{ width: 52, flexShrink: 0, textAlign: "right", fontFamily: "DM Mono,monospace", fontSize: 12, fontWeight: 700, color: absent ? "var(--text-dim)" : rec.status === "full" ? "var(--field)" : "var(--caution)" }}>
          {absent ? "Absent" : mins(rec.presentMs) + "m"}
        </div>
      </div>);
    })}
  </div>);
}
