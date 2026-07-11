import React, { useState, useMemo } from "react";
import { createPracticeSeries } from "../supabase.js";
import { isHeadCoach } from "../constants.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toStr = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

export default function SeriesWizard({ data, coachId, onClose, onDone }) {
  const today = new Date();
  // §3: only teams this user manages -- an assistant should never be able
  // to schedule for a team they don't head-coach, even via this wizard's
  // own team picker (the ScheduleScreen entry point only hides the button
  // when NO team is manageable; a mixed-role user still needs this filter).
  const myTeams = useMemo(() => data.teams.filter(t => isHeadCoach(t, coachId)), [data.teams, coachId]);
  const [step, setStep] = useState("team");
  const [teamId, setTeamId] = useState(myTeams[0] ? myTeams[0].id : "");
  const team = myTeams.find(t => t.id === teamId) || null;
  const [days, setDays] = useState(new Set());
  const [startTime, setStartTime] = useState("18:00");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [rangeStart, setRangeStart] = useState(toStr(today));
  const [rangeEnd, setRangeEnd] = useState(() => { const d = new Date(today); d.setDate(d.getDate() + 56); return toStr(d); });
  const [locationId, setLocationId] = useState("");
  const [deselected, setDeselected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggleDay = d => setDays(s => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });

  const enterRange = () => {
    if (team && team.startDate) setRangeStart(team.startDate);
    if (team && team.endDate) setRangeEnd(team.endDate);
    setStep("range");
  };

  const occurrences = useMemo(() => {
    if (!days.size || !rangeStart || !rangeEnd) return [];
    const out = [];
    const start = new Date(rangeStart + "T00:00:00"), end = new Date(rangeEnd + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (days.has(d.getDay())) out.push(toStr(d));
    }
    return out;
  }, [days, rangeStart, rangeEnd, step]);

  const selectedOccurrences = occurrences.filter(d => !deselected.has(d));
  const conflicts = useMemo(() => {
    const set = new Set();
    for (const ds of selectedOccurrences) {
      const clash = data.practices.some(p => p.teamId !== teamId && p.date === ds && p.startTime === startTime && p.status !== "cancelled");
      if (clash) set.add(ds);
    }
    return set;
  }, [selectedOccurrences.join(","), startTime, teamId]);

  const confirm = async () => {
    if (saving) return;
    setSaving(true); setError("");
    const { data: result, error: err } = await createPracticeSeries(teamId, {
      daysOfWeek: [...days], startTime, durationMinutes: durationMinutes || 60, locationId: locationId || null, sublocationId: null,
      rangeStart, rangeEnd, deselectedDates: [...deselected],
    });
    setSaving(false);
    if (err) { setError(err.message || "Something went wrong."); return; }
    onDone(result);
  };

  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal">
      {step === "team" && <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 12 }}>Set up a schedule</div>
        <div className="fld mb10"><label className="lbl">Team</label>
          <select className="sel" value={teamId} onChange={e => setTeamId(e.target.value)}>
            {myTeams.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
        </div>
        <div className="brow"><button className="btn ghost bsm" onClick={onClose}>Cancel</button><button className="btn primary bsm" style={{ flex: 1 }} onClick={() => setStep("pattern")} disabled={!teamId}>Next</button></div>
      </div>}

      {step === "pattern" && <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 12 }}>Days &amp; time</div>
        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {DOW.map((d, i) => (<button key={i} onClick={() => toggleDay(i)} style={{ flex: 1, padding: "8px 0", borderRadius: "var(--rs)", border: "1.5px solid " + (days.has(i) ? "var(--green)" : "var(--b)"), background: days.has(i) ? "var(--green)" : "#fff", color: days.has(i) ? "#fff" : "var(--black)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{d}</button>))}
        </div>
        <div className="fld mb10"><label className="lbl">Start Time</label><input className="inp" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
        <div className="fld mb10"><label className="lbl">Duration (minutes)</label><input className="inp" type="number" min="1" value={durationMinutes} onChange={e => { const v = e.target.value; setDurationMinutes(v === "" ? "" : +v); }} onBlur={() => { if (!durationMinutes || durationMinutes < 1) setDurationMinutes(60); }} /></div>
        <div className="brow"><button className="btn ghost bsm" onClick={() => setStep("team")}>Back</button><button className="btn primary bsm" style={{ flex: 1 }} onClick={enterRange} disabled={days.size === 0}>Next</button></div>
      </div>}

      {step === "range" && <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 12 }}>Date range</div>
        <div className="fld mb10"><label className="lbl">Start</label><input className="inp" type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} /></div>
        <div className="fld mb10"><label className="lbl">End</label><input className="inp" type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} /></div>
        <div className="brow"><button className="btn ghost bsm" onClick={() => setStep("pattern")}>Back</button><button className="btn primary bsm" style={{ flex: 1 }} onClick={() => setStep("location")} disabled={!rangeStart || !rangeEnd || rangeEnd < rangeStart}>Next</button></div>
      </div>}

      {step === "location" && <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 12 }}>Location <span style={{ color: "var(--td)", fontWeight: 400, fontSize: 13 }}>(optional)</span></div>
        <div className="fld mb10"><label className="lbl">Location</label>
          <select className="sel" value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">None</option>
            {data.locations.map(l => (<option key={l.id} value={l.id}>{l.name}</option>))}
          </select>
        </div>
        <div className="brow"><button className="btn ghost bsm" onClick={() => setStep("range")}>Back</button><button className="btn primary bsm" style={{ flex: 1 }} onClick={() => setStep("preview")}>Next</button></div>
      </div>}

      {step === "preview" && <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 4 }}>Review</div>
        <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>This will create {selectedOccurrences.length} practice{selectedOccurrences.length === 1 ? "" : "s"}.</div>
        {selectedOccurrences.length > 60 && <div style={{ fontSize: 12, color: "var(--amber)", marginBottom: 10 }}>That's a lot -- youth seasons typically run 20-60 practices. Double-check your date range.</div>}
        {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 10 }}>{error}</div>}
        <div style={{ maxHeight: 280, overflowY: "auto", marginBottom: 12 }}>
          {occurrences.map(ds => {
            const off = deselected.has(ds), conflict = conflicts.has(ds);
            return (<label key={ds} className="li" style={{ marginBottom: 4, opacity: off ? .5 : 1, cursor: "pointer" }}>
              <div className="lim"><div className="lin">{new Date(ds + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>{conflict && !off && <div className="limt" style={{ color: "var(--amber)" }}>Conflicts with another practice at this time</div>}</div>
              <input type="checkbox" checked={!off} onChange={() => setDeselected(s => { const n = new Set(s); if (n.has(ds)) n.delete(ds); else n.add(ds); return n; })} />
            </label>);
          })}
        </div>
        <div className="brow"><button className="btn ghost bsm" onClick={() => setStep("location")}>Back</button><button className="btn primary bsm" style={{ flex: 1 }} onClick={confirm} disabled={saving || selectedOccurrences.length === 0}>{saving ? "Creating..." : "Create Schedule"}</button></div>
      </div>}
    </div>
  </div>);
}
