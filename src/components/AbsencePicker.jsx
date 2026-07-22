import React, { useState, useEffect } from "react";
import { fetchPlannedAbsences, createPlannedAbsence, deletePlannedAbsence, setPlannedAbsences } from "../supabase.js";
import { localDateStr, myTeamRole } from "../constants.js";

// Real gap found live: a multi-team coach/director hit one long flat player
// list across every team with no way to narrow it down. Added a team-first
// step ahead of "player" (skipped entirely for a single-team coach, or when
// presetPlayer already supplies both) -- teams sorted head-coach-first,
// then assistant-coach, then whatever's left (a director's oversight-only
// teams) in alphabetical order.
const roleRank = (t, coachId) => {
  const role = myTeamRole(t, coachId);
  if (role === "Head Coach") return 0;
  if (role === "Assistant Coach") return 1;
  return 2;
};

// Two entry shapes (§7): a fixed practice picking which roster players are
// out ("Who's out?" from PracticeDetail), or a player picking which of
// their upcoming practices they're out for ("Mark out for..."/Home quick
// action) -- presetPlayer skips straight to the practice-picking step.
export default function AbsencePicker({ data, coachId, mode, practice, team, presetPlayer, onClose }) {
  const todayStr = localDateStr();
  const in14Str = localDateStr(new Date(Date.now() + 14 * 864e5));
  const sortedTeams = [...(data.teams || [])].sort((a, b) => {
    const ra = roleRank(a, coachId), rb = roleRank(b, coachId);
    return ra !== rb ? ra - rb : (a.name || "").localeCompare(b.name || "");
  });
  const needsTeamStep = !presetPlayer && mode === "pickPlayerThenPractices" && sortedTeams.length > 1;
  const [step, setStep] = useState(presetPlayer ? "practices" : (needsTeamStep ? "team" : "player"));
  const [teamFilter, setTeamFilter] = useState(null);
  const [player, setPlayer] = useState(presetPlayer || null);
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const allPlayers = (data.teams || [])
    .filter(t => !teamFilter || t.id === teamFilter)
    .flatMap(t => t.players.map(p => ({ ...p, teamId: t.id, teamName: t.name })));
  const candidatePractices = player
    ? (data.practices || []).filter(p => p.teamId === player.teamId && p.date >= todayStr && p.date <= in14Str && p.status !== "cancelled").sort((a, b) => a.date.localeCompare(b.date))
    : [];

  useEffect(() => {
    if (mode === "pickPlayersForPractice" && practice) {
      fetchPlannedAbsences([practice.id]).then(rows => { setSelected(new Set(rows.map(r => r.player_id))); setLoaded(true); });
    } else if (mode === "pickPlayerThenPractices" && player && step === "practices") {
      const ids = candidatePractices.map(p => p.id);
      fetchPlannedAbsences(ids).then(rows => {
        setSelected(new Set(rows.filter(r => r.player_id === player.id).map(r => r.practice_id)));
        setLoaded(true);
      });
    }
  }, [mode, practice && practice.id, player && player.id, step]);

  const toggle = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    if (mode === "pickPlayersForPractice") {
      const roster = team ? team.players : [];
      for (const p of roster) {
        if (selected.has(p.id)) await createPlannedAbsence(practice.id, p.id, coachId, null);
        else await deletePlannedAbsence(practice.id, p.id);
      }
    } else if (player) {
      await setPlannedAbsences(player.id, coachId, [...selected], candidatePractices.map(p => p.id), null);
    }
    setSaving(false);
    onClose();
  };

  const timeLbl = p => { if (!p.startTime) return ""; const [h, m] = p.startTime.split(":").map(Number); return (h % 12 || 12) + ":" + (m < 10 ? "0" + m : m) + (h >= 12 ? " PM" : " AM"); };
  const dayLbl = ds => new Date(ds + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (<div className="movly" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal">
      {mode === "pickPlayerThenPractices" && step === "team" && <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 12 }}>Who's out?</div>
        <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>Which team?</div>
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {sortedTeams.map(t => (<div key={t.id} className="li" style={{ marginBottom: 6, cursor: "pointer" }} onClick={() => { setTeamFilter(t.id); setStep("player"); }}>
            <div className="lim"><div className="lin">{t.name}</div><div className="limt">{myTeamRole(t, coachId) || "Director"}</div></div>
            <span style={{ color: "var(--td)", fontSize: 18 }}>&#8250;</span>
          </div>))}
        </div>
        <button className="btn ghost bmd bfull" style={{ marginTop: 12 }} onClick={onClose}>Cancel</button>
      </div>}

      {mode === "pickPlayerThenPractices" && step === "player" && <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 12 }}>Who's out?</div>
        {allPlayers.length === 0 && <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>No players yet.</div>}
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {allPlayers.map(p => (<div key={p.id} className="li" style={{ marginBottom: 6, cursor: "pointer" }} onClick={() => { setPlayer(p); setStep("practices"); setLoaded(false); }}>
            <div className="lim"><div className="lin">{p.firstName} {p.lastName}</div><div className="limt">{p.teamName}</div></div>
            <span style={{ color: "var(--td)", fontSize: 18 }}>&#8250;</span>
          </div>))}
        </div>
        <div className="brow" style={{ marginTop: 12 }}>
          {needsTeamStep && <button className="btn ghost bsm" onClick={() => { setTeamFilter(null); setStep("team"); }}>Back</button>}
          <button className="btn ghost bmd" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        </div>
      </div>}

      {mode === "pickPlayerThenPractices" && step === "practices" && <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 4 }}>Mark out for...</div>
        {player && <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>{player.firstName} {player.lastName}</div>}
        {candidatePractices.length === 0 && <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>No upcoming practices in the next 14 days.</div>}
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {candidatePractices.map(p => (<label key={p.id} className="li" style={{ marginBottom: 6, cursor: "pointer" }}>
            <div className="lim"><div className="lin">{dayLbl(p.date)}</div><div className="limt">{timeLbl(p)}</div></div>
            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
          </label>))}
        </div>
        <div className="brow" style={{ marginTop: 12 }}>
          {!presetPlayer && <button className="btn ghost bsm" onClick={() => setStep("player")}>Back</button>}
          <button className="btn primary bsm" style={{ flex: 1 }} onClick={save} disabled={saving || !loaded}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>}

      {mode === "pickPlayersForPractice" && <div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, marginBottom: 12 }}>Who's out?</div>
        {(!team || team.players.length === 0) && <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>No players on this team.</div>}
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {team && team.players.map(p => (<label key={p.id} className="li" style={{ marginBottom: 6, cursor: "pointer" }}>
            <div className="lim"><div className="lin">{p.firstName} {p.lastName}</div></div>
            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
          </label>))}
        </div>
        <div className="brow" style={{ marginTop: 12 }}>
          <button className="btn ghost bsm" onClick={onClose}>Cancel</button>
          <button className="btn primary bsm" style={{ flex: 1 }} onClick={save} disabled={saving || !loaded}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>}
    </div>
  </div>);
}
