import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AutoTextarea, equipmentPickerAssets, EquipmentPickerPill } from "./ActivityConfigs.jsx";
import { updateStationContent, subscribeToStationPresence, resolveDrillEquipmentForCoach, findMissingEquipment } from "../supabase.js";
import { timeAgo } from "../constants.js";

// Multi-Coach Builder handoff, section 5: when a coach who isn't the head
// coach (and isn't a full skeleton-editing delegate -- see BuilderRoute in
// App.jsx, which is what decides to render this screen instead of the
// normal BuilderScreen) opens Builder for a practice where they're
// assigned to one or more stations, they land here instead -- read/write
// only their own station(s), via the atomic update_station_content RPC
// (never a full savePracticeTree pass), plus a read-only summary card for
// every other station in the same block. No skeleton controls (add/remove
// blocks, timing, station count) render here at all, not just disabled --
// same "hidden entirely, not grayed out" convention this app already uses
// for entry points a coach doesn't have access to.
//
// Deliberately a fresh, self-contained component rather than threading a
// "single station mode" flag through ActivityConfigs.jsx's StationConfig --
// that component's block-level state (rotate/duration steppers, add/remove
// station, player-assignment grouping) is tightly interleaved with its
// per-station fields in one continuous render, and none of that skeleton/
// player-assignment surface belongs in this restricted view anyway. This
// reuses the same exported building blocks (AutoTextarea,
// equipmentPickerAssets, EquipmentPickerPill) and visual language for
// consistency, not a from-scratch redesign.

function coachNameFor(team, teamStaffId) {
  if (!team || !teamStaffId) return null;
  const c = (team.coaches || []).find(c => c.id === teamStaffId);
  return c ? c.name : null;
}

// Read-only -- drill name, duration (uniform across a block, so read off
// the containing activity rather than the station itself), equipment,
// last-edited-by. Genuinely lighter than the editable form below, not a
// grayed-out copy of it -- no form fields at all, matching the same
// "compact card, no edit affordances" convention the live view's own
// other-station summary cards already use.
function StationSummaryCard({ station, blockDurationMinutes, team, assetsById }) {
  const equipNames = (station.equipment || []).map(id => assetsById[id] && assetsById[id].name).filter(Boolean);
  // coachId (who leads this station live), not delegatedTo (who's asked
  // to plan it) -- these are two distinct fields now, direct feedback.
  // This card is deliberately read-only either way, so only the live-
  // leader info is worth surfacing here.
  const leaderName = coachNameFor(team, station.coachId) || station.helperName || null;
  return (<div className="card" style={{ padding: "12px 14px", opacity: .85 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{station.name || "Untitled station"}</div>
      <div style={{ fontSize: 12, color: "var(--td)", flexShrink: 0 }}>{blockDurationMinutes}m</div>
    </div>
    {leaderName && <div style={{ fontSize: 12, color: "var(--td)", marginTop: 2 }}>Leads: {leaderName}</div>}
    {equipNames.length > 0 && <div style={{ fontSize: 12, color: "var(--td)", marginTop: 4 }}>Equipment: {equipNames.join(", ")}</div>}
    {station.stationUpdatedAt && <div style={{ fontSize: 11, color: "var(--td)", marginTop: 4 }}>Last edited {timeAgo(station.stationUpdatedAt)}{coachNameFor(team, station.stationUpdatedBy) ? " by " + coachNameFor(team, station.stationUpdatedBy) : ""}</div>}
  </div>);
}

// The editable form for exactly one station. `station`/`activity` are
// re-derived fresh from `data` on every poll by the parent and may become
// null (station archived out from under the caller) or non-null-but-
// reassigned (delegatedTo no longer matches) -- see the handoff's own
// section 7 edge cases. Local draft state is seeded once from the first snapshot this
// component ever receives and never clobbered by a later poll, matching
// this app's existing "nothing round-trips until Save" Builder convention
// (constants.js/App.jsx BuilderScreen) -- a background poll refreshing
// sibling summary cards must never silently overwrite a coach's own
// in-progress typing.
function MyStationEditor({ practiceId, activity, station, initialSnapshot, team, coachId, coachLabel, assets, libraryDrills, teamSport, refreshLibrary }) {
  const [draft, setDraft] = useState(() => ({
    name: initialSnapshot.name || "", description: initialSnapshot.description || "",
    coachingPoints: initialSnapshot.coachingPoints || "", libraryId: initialSnapshot.libraryId || null,
    sublocationId: initialSnapshot.sublocationId || "", grouping: initialSnapshot.grouping || "whole",
    numGroups: initialSnapshot.numGroups || 2, equipment: initialSnapshot.equipment || [],
  }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [copied, setCopied] = useState(false);

  const upd = patch => { setDraft(d => ({ ...d, ...patch })); setDirty(true); };

  // Genuinely gone (archived/restructured) vs. reassigned to someone else
  // vs. still mine -- three distinct states, per the handoff's own section
  // 7. Both "not mine anymore" states preserve the draft above (still
  // rendered, read-only) rather than discarding it.
  const stillExists = !!station;
  const stillMine = stillExists && station.delegatedTo === team.coaches.find(c => c.userId === coachId)?.id;

  const [presentCoachNames, setPresentCoachNames] = useState([]);
  useEffect(() => {
    if (!stillMine || !station) return;
    return subscribeToStationPresence(station.id, { kind: "coach", label: coachLabel }, setPresentCoachNames);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stillMine, station && station.id]);

  const sport = teamSport || "General";
  const teamEquipPool = (assets || []).filter(a => (!a.type || a.type === "team") && (a.sport === sport || a.sport === "General"));
  const assetsById = Object.fromEntries((assets || []).map(a => [a.id, a]));
  const teamEquipAssets = equipmentPickerAssets(teamEquipPool, draft.equipment, assets, a => (!a.type || a.type === "team"));

  const filteredLibrary = (libraryDrills || []).filter(a => ((a.sport || "General") === sport || (a.sport || "General") === "General") && (!librarySearch || a.name.toLowerCase().includes(librarySearch.toLowerCase())));

  const chooseFromLibrary = async lib => {
    const ownAssetPool = (assets || []).filter(a => a.ownerUserId === coachId);
    const missing = findMissingEquipment(lib.equipment, assetsById, ownAssetPool);
    const resolvedEquip = missing.length ? await resolveDrillEquipmentForCoach(coachId, lib.equipment, assetsById, ownAssetPool, true) : (lib.equipment || []);
    if (missing.length && refreshLibrary) await refreshLibrary();
    upd({ name: lib.name, description: lib.description || "", coachingPoints: lib.coachingPoints || draft.coachingPoints, equipment: resolvedEquip, libraryId: lib.id, grouping: lib.grouping || "whole", numGroups: lib.numGroups || 2 });
    setShowLibraryPicker(false);
    setLibrarySearch("");
  };

  const save = async () => {
    if (saving || !stillMine) return;
    setSaving(true);
    setSaveError("");
    const { error, notFound, notAuthorized } = await updateStationContent(practiceId, activity.id, station.id, draft);
    setSaving(false);
    if (error) {
      setSaveError(notFound ? "This station was removed from the plan before your save went through." : notAuthorized ? "You're no longer delegated to plan this station." : "Couldn't save. Try again.");
      return;
    }
    setDirty(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  const copyDraft = async () => {
    const text = (draft.name ? draft.name + "\n" : "") + (draft.description ? draft.description + "\n" : "") + (draft.coachingPoints || "");
    try { await navigator.clipboard.writeText(text.trim()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) { /* clipboard unavailable -- text stays visible/selectable below regardless */ }
  };

  if (!stillMine) {
    return (<div className="card" style={{ padding: "14px 16px", border: "1.5px solid var(--amber)" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--amber)", marginBottom: 6 }}>
        {stillExists ? "You're no longer delegated to plan this station" : "This station was removed from the plan"}
      </div>
      <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 10 }}>
        {stillExists ? "The head coach delegated it to someone else. Your in-progress notes are still here below -- nothing was written to the station." : "The head coach deleted or restructured this part of the plan. Your in-progress notes are still here below -- they were never saved anywhere."}
      </div>
      <div style={{ fontSize: 13, background: "var(--s2)", borderRadius: "var(--r)", padding: 10, whiteSpace: "pre-wrap" }}>{draft.name}{draft.name && "\n"}{draft.description}{draft.description && "\n"}{draft.coachingPoints}</div>
      <button type="button" className="btn ghost bxs" style={{ marginTop: 10 }} onClick={copyDraft}>{copied ? "Copied" : "Copy My Notes"}</button>
    </div>);
  }

  return (<div className="card" style={{ padding: "14px 16px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{station.name || "Your station"}</div>
      {presentCoachNames.length > 0 && <div style={{ fontSize: 11, color: "var(--green)", flexShrink: 0 }}>● editing now</div>}
    </div>
    {station.stationUpdatedAt && <div style={{ fontSize: 11, color: "var(--td)", marginBottom: 10 }}>Last saved {timeAgo(station.stationUpdatedAt)}{coachNameFor(team, station.stationUpdatedBy) ? " by " + coachNameFor(team, station.stationUpdatedBy) : ""}</div>}

    <div className="fld"><label className="lbl">Drill</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="inp" style={{ flex: 1 }} placeholder="Drill name" value={draft.name} onChange={e => upd({ name: e.target.value })} />
        <button type="button" className="btn ghost bxs" onClick={() => setShowLibraryPicker(s => !s)}>{showLibraryPicker ? "Close" : "Choose from Library"}</button>
      </div>
      {showLibraryPicker && <div style={{ marginTop: 8, border: "1.5px solid var(--b)", borderRadius: "var(--r)", padding: 8, maxHeight: 240, overflowY: "auto" }}>
        <input className="inp" placeholder="Search drills..." value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} style={{ marginBottom: 8 }} />
        {filteredLibrary.length === 0 && <div style={{ fontSize: 12, color: "var(--td)" }}>No drills found</div>}
        {filteredLibrary.map(lib => (<button key={lib.id} type="button" onClick={() => chooseFromLibrary(lib)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 6px", border: "none", borderBottom: "1px solid var(--b)", background: "none", cursor: "pointer", fontSize: 13 }}>{lib.name}</button>))}
      </div>}
    </div>
    <div className="fld"><label className="lbl">Description</label><AutoTextarea minHeight={40} value={draft.description} onChange={e => upd({ description: e.target.value })} /></div>
    <div className="fld"><label className="lbl">Coaching Points</label><AutoTextarea minHeight={40} value={draft.coachingPoints} onChange={e => upd({ coachingPoints: e.target.value })} /></div>
    {team && team.loc && team.loc.sublocations && team.loc.sublocations.length > 0 && <div className="fld"><label className="lbl">Area</label>
      <select className="sel" value={draft.sublocationId || ""} onChange={e => upd({ sublocationId: e.target.value })}>
        <option value="">Any</option>{team.loc.sublocations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>}
    <div className="fld"><label className="lbl">Grouping</label>
      <div style={{ display: "flex", gap: 6 }}>
        {[{ v: "whole", l: "Whole Station" }, { v: "partners", l: "Partners" }, { v: "groups", l: "Groups" }].map(({ v, l }) => (
          <button key={v} type="button" onClick={() => upd({ grouping: v })} style={{ flex: 1, padding: "8px 4px", borderRadius: "var(--r)", border: "1.5px solid var(--b)", background: draft.grouping === v ? "var(--green)" : "var(--s1)", color: draft.grouping === v ? "#fff" : "var(--black)", fontSize: 13, cursor: "pointer", fontWeight: 700 }}>{l}</button>
        ))}
      </div>
      {draft.grouping === "groups" && <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {[2, 3, 4, 5, 6].map(n => (<button key={n} type="button" onClick={() => upd({ numGroups: n })} style={{ flex: 1, padding: "8px 0", borderRadius: "var(--r)", border: "1.5px solid var(--b)", background: (draft.numGroups || 2) === n ? "var(--green)" : "var(--s1)", color: (draft.numGroups || 2) === n ? "#fff" : "var(--black)", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{n}</button>))}
      </div>}
    </div>
    <div className="fld"><label className="lbl">Equipment</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {teamEquipAssets.map(a => (<EquipmentPickerPill key={a.id} asset={a} selected={draft.equipment.includes(a.id)} onToggle={() => { const has = draft.equipment.includes(a.id); upd({ equipment: has ? draft.equipment.filter(x => x !== a.id) : [...draft.equipment, a.id] }); }} refreshLibrary={refreshLibrary} />))}
        {teamEquipAssets.length === 0 && <span style={{ fontSize: 12, color: "var(--td)" }}>No team equipment in library</span>}
      </div>
    </div>

    {saveError && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 8 }}>{saveError}</div>}
    <button type="button" className="btn primary bmd bfull" disabled={!dirty || saving} onClick={save}>{saving ? "Saving..." : savedFlash ? "Saved" : dirty ? "Save Station" : "Saved"}</button>
  </div>);
}

// Head coach's own Builder view (App.jsx BuilderScreen): a small read-only
// "Coach X is editing" indicator per station that has a coach assigned,
// reusing the same per-station presence channel MyStationEditor tracks
// into above -- passing `me: null` here so this side only listens, never
// tracks (the head coach browsing their own skeleton editor isn't "editing
// this station" in the sense this indicator means).
export function StationPresenceIndicator({ stationId }) {
  const [names, setNames] = useState([]);
  useEffect(() => {
    if (!stationId) return;
    return subscribeToStationPresence(stationId, null, setNames);
  }, [stationId]);
  if (!names.length) return null;
  return <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 600 }}>● {names.join(", ")} editing now</span>;
}

export default function MyStationBuilderScreen({ practice, team, data, coachId, coachLabel, refreshPlanning, refreshLibrary, goHome }) {
  const navigate = useNavigate();
  const myTeamStaffId = useMemo(() => { const c = (team.coaches || []).find(c => c.userId === coachId); return c ? c.id : null; }, [team, coachId]);

  // Every station id this coach has ever had open this session, union-only
  // (never shrinks) -- see MyStationEditor's own comment on why: a station
  // that gets reassigned/deleted out from under the coach mid-edit should
  // keep rendering its own editor (now showing the removed/reassigned
  // banner with the preserved draft) rather than silently vanishing from
  // the screen the next poll happens to land on.
  const [openStationIds, setOpenStationIds] = useState(() => new Set());
  const firstSnapshotsRef = useRef({});

  const blockActs = (practice.activities || []).filter(a => a.type === "station_block");
  const currentMineIds = [];
  for (const act of blockActs) for (const st of act.stations || []) if (st.delegatedTo === myTeamStaffId) currentMineIds.push(st.id);

  useEffect(() => {
    setOpenStationIds(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const id of currentMineIds) if (!next.has(id)) { next.add(id); changed = true; }
      return changed ? next : prev;
    });
    for (const act of blockActs) for (const st of act.stations || []) if (currentMineIds.includes(st.id) && !firstSnapshotsRef.current[st.id]) firstSnapshotsRef.current[st.id] = st;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMineIds.join(",")]);

  // ~25s poll for other stations' summary cards and this coach's own
  // "still assigned?" check -- matches the handoff's own instruction to
  // mirror Home's existing staleness-backstop poll interval, not realtime.
  useEffect(() => {
    const t = setInterval(() => { if (refreshPlanning) refreshPlanning(); }, 25000);
    return () => clearInterval(t);
  }, [refreshPlanning]);

  const assetsById = Object.fromEntries((data.assets || []).map(a => [a.id, a]));
  const teamSport = team.sport || "General";
  const teamWithLoc = { ...team, loc: (data.locations || []).find(l => l.id === practice.locationId) };

  if (openStationIds.size === 0) {
    return (<div style={{ padding: "0 16px calc(var(--tab) + 20px)" }}>
      <div className="card" style={{ padding: "14px 16px", marginTop: 16 }}>You don't have a station assigned in this plan yet.</div>
      <button type="button" className="btn ghost bmd" style={{ marginTop: 12 }} onClick={goHome}>Back to Home</button>
    </div>);
  }

  return (<div style={{ padding: "0 16px calc(var(--tab) + 20px)" }}>
    <div style={{ padding: "16px 0 8px" }}>
      <div style={{ fontSize: 12, color: "var(--td)", textTransform: "uppercase", letterSpacing: ".05em" }}>{team.name}</div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{practice.name || "Practice"}{practice.date ? " · " + practice.date : ""}</div>
    </div>
    {[...openStationIds].map(stationId => {
      // Re-derive fresh from the current `data`/`practice` every render --
      // may resolve to null (activity/station gone) or a station whose
      // delegatedTo no longer matches, both handled inside MyStationEditor.
      let activity = null, station = null;
      for (const act of blockActs) { const st = (act.stations || []).find(s => s.id === stationId); if (st) { activity = act; station = st; break; } }
      const initialSnapshot = firstSnapshotsRef.current[stationId] || station || {};
      return (<div key={stationId} style={{ marginBottom: 20 }}>
        {activity && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--td)", marginBottom: 8 }}>{activity.name || "Station Block"}</div>}
        <MyStationEditor
          practiceId={practice.id} activity={activity} station={station} initialSnapshot={initialSnapshot}
          team={teamWithLoc} coachId={coachId} coachLabel={coachLabel} assets={data.assets}
          libraryDrills={data.activityLibrary} teamSport={teamSport} refreshLibrary={refreshLibrary}
        />
        {activity && <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {(activity.stations || []).filter(s => s.id !== stationId).map(s => (
            <StationSummaryCard key={s.id} station={s} blockDurationMinutes={activity.stationDuration} team={teamWithLoc} assetsById={assetsById} />
          ))}
        </div>}
      </div>);
    })}
    <button type="button" className="btn ghost bmd" onClick={goHome}>Back to Home</button>
  </div>);
}
