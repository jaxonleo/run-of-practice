import React, { useMemo, useState } from "react";
import { savePracticeTree } from "../supabase.js";
import { isHeadCoach, localDateStr } from "../constants.js";

// Quick single-practice scheduler -- one screen, no day-of-week/date-range
// machinery, for the common case of "just this one practice" (SeriesWizard
// stays the path for recurring schedules). Same field set as the wizard's
// team/pattern/location steps, just collapsed since there's no range to
// preview.
export default function SchedulePracticeModal({ data, coachId, onClose, onDone }) {
  const myTeams = useMemo(() => data.teams.filter(t => isHeadCoach(t, coachId)), [data.teams, coachId]);
  const [teamId, setTeamId] = useState(myTeams[0] ? myTeams[0].id : "");
  const [date, setDate] = useState(localDateStr());
  const [startTime, setStartTime] = useState("18:00");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [locationId, setLocationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);

  const team = myTeams.find(t => t.id === teamId) || null;

  const confirm = async () => {
    if (saving || !teamId || !date) return;
    setSaving(true); setError("");
    const { data: result, error: err } = await savePracticeTree(null, {
      teamId, locationId: locationId || null, sublocationId: null,
      date, startTime, timezone: team && team.timezone,
      scheduledDurationMinutes: durationMinutes || null, activities: [],
    });
    setSaving(false);
    if (err) { setError(err.message || "Something went wrong."); return; }
    setCreated(result);
  };

  if (created) {
    return (<div className="movly" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 4 }}>Practice scheduled</div>
        <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 16 }}>{team ? team.name : "Practice"} · {new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
        <div className="brow">
          <button className="btn ghost bsm" style={{ flex: 1 }} onClick={() => onDone(created)}>Done</button>
          <button className="btn primary bsm" style={{ flex: 1 }} onClick={() => onDone(created, true)}>Plan Practice</button>
        </div>
      </div>
    </div>);
  }

  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal">
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 12 }}>Schedule a practice</div>
      <div className="fld mb10"><label className="lbl">Team</label>
        <select className="sel" value={teamId} onChange={e => setTeamId(e.target.value)}>
          {myTeams.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
        </select>
      </div>
      <div className="fld mb10"><label className="lbl">Date</label><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
      <div className="fld mb10"><label className="lbl">Start Time</label><input className="inp" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
      <div className="fld mb10"><label className="lbl">Duration (minutes)</label><input className="inp" type="number" min="1" value={durationMinutes} onChange={e => { const v = e.target.value; setDurationMinutes(v === "" ? "" : +v); }} onBlur={() => { if (!durationMinutes || durationMinutes < 1) setDurationMinutes(60); }} /></div>
      <div className="fld mb10"><label className="lbl">Location <span style={{ color: "var(--td)", fontWeight: 400 }}>(optional)</span></label>
        <select className="sel" value={locationId} onChange={e => setLocationId(e.target.value)}>
          <option value="">None</option>
          {data.locations.map(l => (<option key={l.id} value={l.id}>{l.name}</option>))}
        </select>
      </div>
      {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 10 }}>{error}</div>}
      <div className="brow"><button className="btn ghost bsm" onClick={onClose}>Cancel</button><button className="btn primary bsm" style={{ flex: 1 }} onClick={confirm} disabled={saving || !teamId || !date}>{saving ? "Scheduling..." : "Schedule Practice"}</button></div>
    </div>
  </div>);
}
