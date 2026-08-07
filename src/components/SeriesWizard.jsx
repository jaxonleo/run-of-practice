import React, { useState, useMemo, useRef } from "react";
import { createPracticeSeries } from "../supabase.js";
import { canManageTeamInMode } from "../constants.js";
import { AddLocationDialog } from "./NewLibraryScreen.jsx";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toStr = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

export default function SeriesWizard({ data, coachId, mode, presetTeamId, refreshPlanning, onClose, onDone }) {
  const today = new Date();
  // §3: only teams this user manages -- an assistant should never be able
  // to schedule for a team they don't manage, even via this wizard's own
  // team picker (the ScheduleScreen entry point only hides the button when
  // NO team is manageable; a mixed-role user still needs this filter).
  // canManageTeamInMode, not bare isHeadCoach -- a director overseeing an
  // org team can schedule for it without a personal team_staff row there.
  const myTeams = useMemo(() => data.teams.filter(t => canManageTeamInMode(t, coachId, mode)), [data.teams, coachId, mode]);
  // Consolidated from 5 sequential screens (team / pattern / range /
  // location / preview) down to 2 -- everything that's just picking fields
  // (team, days & time, date range, location) now lives on one "details"
  // screen, with only the review/preview step kept separate since that one
  // actually needs its own scrollable list and per-date deselect UI.
  const [step, setStep] = useState("details");
  // Opened from inside a specific team's Schedule tab defaults to that team
  // (only if the coach actually head-coaches it -- myTeams already enforces
  // that) rather than whichever head-coached team sorts first.
  const [teamId, setTeamId] = useState(() => (presetTeamId && myTeams.some(t => t.id === presetTeamId)) ? presetTeamId : (myTeams[0] ? myTeams[0].id : ""));
  const team = myTeams.find(t => t.id === teamId) || null;
  const [days, setDays] = useState(new Set());
  const [startTime, setStartTime] = useState("18:00");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [rangeStart, setRangeStart] = useState(toStr(today));
  const [rangeEnd, setRangeEnd] = useState(() => { const d = new Date(today); d.setDate(d.getDate() + 56); return toStr(d); });
  // Prefilling the range from the newly-picked team's own season dates used
  // to happen on a dedicated "entering the range step" transition -- now
  // that team-pick and range are the same screen, do it the moment the
  // team selection changes instead (skip it for the initial default team,
  // since rangeStart/rangeEnd's own useState initializers already cover that).
  const firstTeamId = useMemo(() => (presetTeamId && myTeams.some(t => t.id === presetTeamId)) ? presetTeamId : (myTeams[0] ? myTeams[0].id : ""), []);
  const changeTeam = tid => {
    setTeamId(tid);
    const t = myTeams.find(x => x.id === tid);
    if (tid !== firstTeamId) {
      if (t && t.startDate) setRangeStart(t.startDate);
      if (t && t.endDate) setRangeEnd(t.endDate);
    }
  };
  const [locationId, setLocationId] = useState("");
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [deselected, setDeselected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  // A single unlucky series can insert well over 100 practice rows in one
  // RPC call, slow enough on a bad connection that an impatient coach taps
  // Create Schedule again before the disabled attribute has actually
  // painted -- state alone isn't a safe guard against that (see the same
  // fix and reasoning in ModalLayer.jsx's save()), so this uses a ref too.
  const savingRef = useRef(false);
  const [error, setError] = useState("");

  const toggleDay = d => setDays(s => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  const detailsValid = teamId && days.size > 0 && rangeStart && rangeEnd && rangeEnd >= rangeStart;

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
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError("");
    const { data: result, error: err } = await createPracticeSeries(teamId, {
      daysOfWeek: [...days], startTime, durationMinutes: durationMinutes || 60, locationId: locationId || null, sublocationId: null,
      rangeStart, rangeEnd, deselectedDates: [...deselected],
    });
    savingRef.current = false;
    setSaving(false);
    if (err) { setError(err.message || "Something went wrong."); return; }
    onDone(result);
  };

  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal">
      {step === "details" && <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 12 }}>Set up a schedule</div>
        <div className="fld mb10"><label className="lbl">Team</label>
          <select className="sel" value={teamId} onChange={e => changeTeam(e.target.value)}>
            {myTeams.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
        </div>
        <div className="fld mb6"><label className="lbl">Days &amp; Time</label>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {DOW.map((d, i) => (<button key={i} type="button" onClick={() => toggleDay(i)} style={{ flex: 1, padding: "8px 0", borderRadius: "var(--rs)", border: "1.5px solid " + (days.has(i) ? "var(--green)" : "var(--b)"), background: days.has(i) ? "var(--green)" : "#fff", color: days.has(i) ? "#fff" : "var(--black)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{d}</button>))}
          </div>
        </div>
        <div className="g2 mb10">
          <div className="fld" style={{ marginBottom: 0 }}><label className="lbl">Start Time</label><input className="inp" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
          <div className="fld" style={{ marginBottom: 0 }}><label className="lbl">Duration (min)</label><input className="inp" type="number" min="1" value={durationMinutes} onChange={e => { const v = e.target.value; setDurationMinutes(v === "" ? "" : +v); }} onBlur={() => { if (!durationMinutes || durationMinutes < 1) setDurationMinutes(60); }} /></div>
        </div>
        <div className="g2 mb10">
          <div className="fld" style={{ marginBottom: 0 }}><label className="lbl">Start Date</label><input className="inp" type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} /></div>
          <div className="fld" style={{ marginBottom: 0 }}><label className="lbl">End Date</label><input className="inp" type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} /></div>
        </div>
        <div className="fld mb10"><label className="lbl">Location <span style={{ color: "var(--td)", fontWeight: 400 }}>(optional)</span></label>
          {data.locations.length > 0 ? (<select className="sel" value={locationId} onChange={e => { const v = e.target.value; if (v === "__add_new__") { setShowAddLocation(true); return; } setLocationId(v); }}>
            <option value="">None</option>
            {data.locations.map(l => (<option key={l.id} value={l.id}>{l.name}</option>))}
            <option value="__add_new__">+ Add New Location...</option>
          </select>) : (
            <button type="button" className="btn outline bsm bfull" onClick={() => setShowAddLocation(true)}>+ Add a Location</button>
          )}
        </div>
        {rangeEnd < rangeStart && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 10 }}>End date can't be before the start date.</div>}
        <div className="brow"><button className="btn ghost bsm" onClick={onClose}>Cancel</button><button className="btn primary bsm" style={{ flex: 1 }} onClick={() => setStep("preview")} disabled={!detailsValid}>Next</button></div>
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
        {saving && <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 10 }}>Creating {selectedOccurrences.length} practice{selectedOccurrences.length === 1 ? "" : "s"}, this can take a few seconds for a full season. Please wait, don't tap again.</div>}
        <div className="brow"><button className="btn ghost bsm" onClick={() => setStep("details")} disabled={saving}>Back</button><button className="btn primary bsm" style={{ flex: 1 }} onClick={confirm} disabled={saving || selectedOccurrences.length === 0}>{saving ? "Creating..." : "Create Schedule"}</button></div>
      </div>}
    </div>
    {showAddLocation && <AddLocationDialog coachId={coachId} orgId={team && team.organizationId} onClose={() => setShowAddLocation(false)} onCreated={async (loc) => { if (refreshPlanning) await refreshPlanning(); setLocationId(loc.id); }} />}
  </div>);
}
