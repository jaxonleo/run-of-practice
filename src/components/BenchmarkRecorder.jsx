import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  officialResult, isOfficial, displayDecimals, roundTo,
  metresToFeetInches, parseDisplayValue, benchmarkStatusLabel,
} from "../benchmarks.js";
import {
  outboxAdd, outboxUpdate, outboxRemove, outboxList, outboxFlush, outboxResolveConflict,
} from "../benchmarkOutbox.js";

// ── BenchmarkRecorder ────────────────────────────────────────────────────────
//
// The shared live recording surface (ROP-Benchmarks handoff 5.2 / 5.3). Used
// by the signed-in coach inside the live run AND by an anonymous helper on the
// scoped /brec/:token route -- the only differences are the two save functions
// passed in and whether status controls render. Every attempt write goes
// through the durable outbox first, then the server, so a signal drop or a
// same-identity refresh never loses an entry. The server authorizes and
// computes; this component only displays a clearly-labelled provisional
// summary while recording.
//
// Props:
//   protocol      pinned version shape from benchmarks.js (metricType, direction,
//                 resultRule, scoredAttempts, opportunitiesPerSet, rubricLevels,
//                 scoreMin/Max/Increment, displayUnit)
//   participants  [{ participant_id, name, jersey, is_team_subject, status,
//                    attempts:[{slot_index,value_numeric,successes,opportunities,
//                    rubric_level_id,valid,row_version,mine}] }]
//   assessmentId, subjectMode ('individual'|'team'), outboxScope
//   saveAttempt(participantId, slotIndex, values, opId, expectedRowVersion)
//                 -> { data:{ok|idempotent|conflict, attempt, server, participant_status} } | { error }
//   setStatus(participantId, status) -> {} | null   (null hides status controls)
//   onRefresh()   re-fetch participants from the server
//   readOnly      assessment finalized / grant closed
//   mineOnlyEdit  helper mode: an attempt not authored under this grant is read-only
//   reserveParticipant(participantId, takeOver) -> { data:{reserved, held_by, expires_at} } | { error }
//   releaseParticipant(participantId) -> {}     (both undefined = reservations off, e.g. finalized)

export default function BenchmarkRecorder({
  protocol, participants, assessmentId, subjectMode, outboxScope,
  saveAttempt, setStatus, onRefresh, readOnly, mineOnlyEdit,
  reserveParticipant, releaseParticipant,
}) {
  const N = Math.max(1, protocol.scoredAttempts || 1);
  const isTeam = subjectMode === "team";
  const isRate = protocol.metricType === "success_rate";
  const isRubric = protocol.metricType === "score_rubric";
  const dp = displayDecimals(protocol);

  const [idx, setIdx] = useState(0); // current participant, mobile sheet
  const [drafts, setDrafts] = useState({}); // key `${pid}:${slot}` -> string(s)
  const [cellState, setCellState] = useState({}); // key -> 'saving'|'saved'|'retry'|'conflict'
  const [conflicts, setConflicts] = useState({}); // key -> server attempt
  const [pending, setPending] = useState([]); // outbox rows for this scope
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [reserveCheck, setReserveCheck] = useState(null); // latest reserve() result for the current selected player
  const [pickerOpen, setPickerOpen] = useState(false); // on-demand participant selector (design system v1 SS11)

  // Reservation heartbeat (design system v1 SS11: "Being recorded by {tester}").
  // Individual mode only, at any width -- the one-at-a-time card is now the
  // only individual layout (the old always-visible desktop grid is gone; see
  // the on-demand picker below). Team-subject mode has no such selection
  // moment. Re-reserves every 30s while this player stays open so the
  // server-side ~90s expiry never lapses under normal use; closing the sheet
  // (unmount / picking someone else) releases it immediately, and a dropped
  // tab still self-expires with no explicit cleanup needed.
  const rosterIds = participants.filter(p => !p.is_team_subject).map(p => p.participant_id).join(",");
  useEffect(() => {
    if (!reserveParticipant || isTeam || readOnly) return;
    const ids = rosterIds ? rosterIds.split(",") : [];
    const pid = ids[Math.min(idx, ids.length - 1)];
    if (!pid) return;
    let alive = true;
    const beat = async () => { const r = await reserveParticipant(pid); if (alive) setReserveCheck(r.data || null); };
    beat();
    const t = setInterval(beat, 30000);
    return () => { alive = false; clearInterval(t); if (releaseParticipant) releaseParticipant(pid); };
  }, [idx, rosterIds, isTeam, readOnly, reserveParticipant, releaseParticipant]);

  const refreshPending = useCallback(async () => { setPending(await outboxList(outboxScope)); }, [outboxScope]);
  useEffect(() => { refreshPending(); }, [refreshPending]);

  const flush = useCallback(async () => {
    await outboxFlush(outboxScope, async (row) => {
      const r = await saveAttempt(row.participantId, row.slotIndex, row.payload, row.opId, row.expectedRowVersion);
      if (r.error) return { error: r.error };
      const d = r.data || {};
      if (d.conflict) return { conflict: true, server: d.server };
      if (d.ok || d.idempotent) return { ok: true };
      return { error: new Error("unexpected") };
    });
    await refreshPending();
    if (onRefresh) onRefresh();
  }, [outboxScope, saveAttempt, refreshPending, onRefresh]);

  useEffect(() => {
    const on = () => { setOnline(true); flush(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [flush]);

  const cellKey = (pid, slot) => pid + ":" + slot;

  // Existing (server) attempt for a participant slot.
  const serverAttempt = (p, slot) => (p.attempts || []).find(a => a.slot_index === slot) || null;

  // Canonical numeric value from the display-unit input(s). Shared with the
  // target editor so entry is converted identically everywhere.
  function toCanonical(raw) {
    return parseDisplayValue(protocol, raw);
  }
  function fromCanonical(v) {
    if (!Number.isFinite(v)) return "";
    const u = protocol.displayUnit || "";
    if (protocol.metricType === "distance" && u === "feet/inches") { const { feet, inches } = metresToFeetInches(v); return feet + "' " + roundTo(inches, 1) + '"'; }
    if (protocol.metricType === "distance" && u === "centimeters") return String(roundTo(v * 100, dp));
    if (protocol.metricType === "speed") return String(roundTo(u === "km/h" ? v * 3.6 : v / 0.44704, dp));
    if (protocol.metricType === "time" && u === "minutes:seconds") { const m = Math.floor(v / 60); const s = v - m * 60; return m + ":" + String(roundTo(s, dp)).padStart(2, "0"); }
    return String(roundTo(v, dp));
  }

  // Provisional official result for a participant, computed locally, labelled.
  function provisional(p) {
    const attempts = (p.attempts || []).map(a => ({
      slot: a.slot_index, valid: a.valid !== false,
      value: a.value_numeric, successes: a.successes, opportunities: a.opportunities, levelId: a.rubric_level_id,
    }));
    // merge unsaved drafts so the coach sees the number they just typed
    for (let s = 0; s < N; s++) {
      const d = drafts[cellKey(p.participant_id, s)];
      if (d == null) continue;
      const existing = attempts.find(a => a.slot === s);
      if (isRate) {
        const [suc, opp] = String(d).split("/").map(x => x.trim());
        const entry = { slot: s, valid: true, successes: Number(suc), opportunities: Number(opp || protocol.opportunitiesPerSet) };
        if (existing) Object.assign(existing, entry); else attempts.push(entry);
      } else if (isRubric) {
        if (existing) existing.levelId = d; else attempts.push({ slot: s, valid: true, levelId: d });
      } else {
        const v = toCanonical(d);
        if (existing) existing.value = v; else attempts.push({ slot: s, valid: true, value: v });
      }
    }
    return officialResult(protocol, attempts);
  }
  function resultLabel(r) {
    if (!r) return "";
    if (r.status === "invalid") return "check entry";
    if (r.status === "none") return "not started";
    if (r.status === "partial") return r.filledSlots + " of " + r.requiredSlots;
    if (isRate) return r.successes + " / " + r.opportunities + " (" + roundTo(r.proportion * 100, 1) + "%)";
    if (isRubric) { const lvl = (protocol.rubricLevels || []).find(l => l.id === r.levelId); return lvl ? lvl.label : "level"; }
    return fromCanonical(r.value);
  }

  async function commitCell(p, slot) {
    if (readOnly) return;
    const key = cellKey(p.participant_id, slot);
    const draft = drafts[key];
    if (draft == null || draft === "") return;
    const sv = serverAttempt(p, slot);
    if (mineOnlyEdit && sv && sv.mine === false) { setCellState(s => ({ ...s, [key]: "readonly" })); return; }

    let payload;
    if (isRate) {
      const [suc, opp] = String(draft).split("/").map(x => x.trim());
      payload = { successes: Number(suc), opportunities: Number(opp || protocol.opportunitiesPerSet) };
    } else if (isRubric) {
      payload = { rubricLevelId: draft };
    } else {
      const v = toCanonical(draft);
      if (!Number.isFinite(v)) { setCellState(s => ({ ...s, [key]: "retry" })); return; }
      payload = { valueNumeric: v };
    }

    const opId = crypto.randomUUID();
    const expected = sv ? sv.row_version : null;
    await outboxAdd(outboxScope, { assessmentId, participantId: p.participant_id, slotIndex: slot, payload, opId, expectedRowVersion: expected });
    setCellState(s => ({ ...s, [key]: "saving" }));
    await refreshPending();

    const r = await saveAttempt(p.participant_id, slot, payload, opId, expected);
    if (r.error) {
      setCellState(s => ({ ...s, [key]: "retry" }));
      return;
    }
    const d = r.data || {};
    if (d.conflict) {
      setConflicts(c => ({ ...c, [key]: d.server }));
      setCellState(s => ({ ...s, [key]: "conflict" }));
      await outboxUpdate(opId, { status: "conflict", server: d.server });
      await refreshPending();
      return;
    }
    // ok or idempotent
    await outboxRemove(opId);
    setCellState(s => ({ ...s, [key]: "saved" }));
    setDrafts(dr => { const n = { ...dr }; delete n[key]; return n; });
    await refreshPending();
    if (onRefresh) onRefresh();
  }

  async function keepMine(p, slot) {
    const key = cellKey(p.participant_id, slot);
    setConflicts(c => { const n = { ...c }; delete n[key]; return n; });
    const row = (await outboxList(outboxScope)).find(x => x.participantId === p.participant_id && x.slotIndex === slot && x.status === "conflict");
    if (!row) return;
    const server = conflicts[key];
    const r = await saveAttempt(p.participant_id, slot, row.payload, crypto.randomUUID(), server ? server.row_version : null);
    await outboxResolveConflict(row.id);
    await refreshPending();
    if (!r.error && onRefresh) onRefresh();
    setCellState(s => ({ ...s, [key]: (r.data && r.data.ok) ? "saved" : "retry" }));
  }
  async function acceptServerValue(p, slot) {
    const key = cellKey(p.participant_id, slot);
    const row = (await outboxList(outboxScope)).find(x => x.participantId === p.participant_id && x.slotIndex === slot && x.status === "conflict");
    if (row) await outboxResolveConflict(row.id);
    setConflicts(c => { const n = { ...c }; delete n[key]; return n; });
    setCellState(s => { const n = { ...s }; delete n[key]; return n; });
    setDrafts(dr => { const n = { ...dr }; delete n[key]; return n; });
    await refreshPending();
    if (onRefresh) onRefresh();
  }

  const badge = st => {
    if (st === "saving") return <span style={S.badge("var(--text-dim)")}>Saving...</span>;
    if (st === "saved") return <span style={S.badge("var(--field)")}>Saved</span>;
    if (st === "retry") return <span style={S.badge("var(--caution)")}>Retry</span>;
    if (st === "conflict") return <span style={S.badge("var(--danger)")}>Conflict</span>;
    if (st === "readonly") return <span style={S.badge("var(--text-dim)")}>Read-only</span>;
    return null;
  };

  const attemptInput = (p, slot) => {
    const key = cellKey(p.participant_id, slot);
    const sv = serverAttempt(p, slot);
    const st = cellState[key];
    const conflict = conflicts[key];
    const disabled = readOnly || (mineOnlyEdit && sv && sv.mine === false);
    let display;
    if (drafts[key] != null) display = drafts[key];
    else if (isRate && sv) display = (sv.successes ?? "") + " / " + (sv.opportunities ?? protocol.opportunitiesPerSet);
    else if (isRubric && sv) display = sv.rubric_level_id || "";
    else if (sv && Number.isFinite(sv.value_numeric)) display = fromCanonical(sv.value_numeric);
    else display = "";

    return (
      <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 96 }}>
        <div style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 700 }}>Attempt {slot + 1}</div>
        {isRubric ? (
          <select className="inp" disabled={disabled} value={drafts[key] ?? (sv && sv.rubric_level_id) ?? ""}
            onChange={e => setDrafts(d => ({ ...d, [key]: e.target.value }))}
            onBlur={() => commitCell(p, slot)}>
            <option value="">--</option>
            {(protocol.rubricLevels || []).map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        ) : (
          <input className="inp" disabled={disabled}
            inputMode={isRate ? "text" : "decimal"}
            placeholder={isRate ? "s / " + protocol.opportunitiesPerSet : (protocol.displayUnit || "")}
            value={display}
            onChange={e => setDrafts(d => ({ ...d, [key]: e.target.value }))}
            onBlur={() => commitCell(p, slot)}
            onKeyDown={e => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
          />
        )}
        <div style={{ minHeight: 14 }}>{badge(st)}</div>
        {conflict && <div style={{ fontSize: 11, background: "var(--surface-soft)", borderRadius: 6, padding: 6 }}>
          Server has <b>{isRate ? (conflict.successes + "/" + conflict.opportunities) : isRubric ? conflict.rubric_level_id : fromCanonical(conflict.value_numeric)}</b>.
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button type="button" className="btn ghost bxs" onClick={() => acceptServerValue(p, slot)}>Use server</button>
            <button type="button" className="btn ghost bxs" onClick={() => keepMine(p, slot)}>Reapply mine</button>
          </div>
        </div>}
      </div>
    );
  }

  const statusPicker = (p) => setStatus ? (
    <select className="inp" style={{ maxWidth: 150 }} value={p.status || "not_measured"} disabled={readOnly}
      onChange={async e => { await setStatus(p.participant_id, e.target.value); if (onRefresh) onRefresh(); }}>
      {["not_measured", "partial", "complete", "unable", "skipped"].map(v => <option key={v} value={v}>{benchmarkStatusLabel(v)}</option>)}
    </select>
  ) : <span className="bdg bs">{benchmarkStatusLabel(p.status)}</span>;

  const retryCount = pending.filter(r => r.status === "retry").length;

  const header = (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{protocol.instructions}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        <span className="bdg bs">Provisional summary</span>
        {!online && <span style={S.badge("var(--caution)")}>Offline &mdash; queued locally</span>}
        {retryCount > 0 && <button type="button" className="btn ghost bxs" onClick={flush}>Retry {retryCount} unsent</button>}
        {readOnly && <span style={S.badge("var(--text-dim)")}>Recording closed</span>}
      </div>
    </div>
  );

  if (isTeam) {
    const team = participants.find(p => p.is_team_subject) || participants[0];
    if (!team) return <div style={{ fontSize: 13, color: "var(--text-dim)" }}>No team subject.</div>;
    const r = provisional(team);
    return (
      <div>
        {header}
        <div className="card">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Team result</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {Array.from({ length: N }).map((_, s) => attemptInput(team, s))}
          </div>
          <div style={{ marginTop: 8, fontSize: 13 }}>Result: <b>{resultLabel(r)}</b> <span style={{ color: "var(--text-dim)" }}>(provisional)</span></div>
          <div style={{ marginTop: 8 }}>{statusPicker(team)}</div>
        </div>
      </div>
    );
  }

  const roster = participants.filter(p => !p.is_team_subject);
  const p = roster[Math.min(idx, roster.length - 1)];
  if (!p) return <div style={{ fontSize: 13, color: "var(--text-dim)" }}>No participants.</div>;
  const r = provisional(p);
  const doneCount = roster.filter(x => x.status === "complete").length;
  // "Being recorded by" reads from this component's own last reserve() call
  // first (immediate, doesn't wait on the parent's poll), falling back to the
  // server-reported reserved_* fields on the participant itself.
  const heldByOther = (reserveCheck && reserveCheck.reserved === false)
    ? { label: reserveCheck.held_by, expiresAt: reserveCheck.expires_at }
    : (p.reserved_label && !p.reserved_by_me && p.reserved_expires_at && new Date(p.reserved_expires_at) > new Date())
      ? { label: p.reserved_label, expiresAt: p.reserved_expires_at }
      : null;
  const takeOver = async () => {
    if (!reserveParticipant) return;
    if (!window.confirm((heldByOther.label || "Someone") + " is currently recording this player. Take over anyway?")) return;
    const r2 = await reserveParticipant(p.participant_id, true);
    setReserveCheck(r2.data || null);
  };
  const participantHeldBy = (x) => (x.reserved_label && !x.reserved_by_me && x.reserved_expires_at && new Date(x.reserved_expires_at) > new Date())
    ? x.reserved_label : null;
  const rowStatusLabel = (x) => {
    const held = participantHeldBy(x);
    return held ? "Being recorded by " + held : benchmarkStatusLabel(x.status);
  };

  return (
    <div>
      {header}
      {/* On-demand participant selector (design system v1 SS11): the roster
          stays hidden behind this closed summary until the tester opens it,
          rather than permanently occupying the capture surface. */}
      <button type="button" className="card" style={{ width: "100%", textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }} onClick={() => setPickerOpen(true)}>
        <div>
          <div style={{ fontWeight: 800 }}>{p.name}{p.jersey ? " #" + p.jersey : ""}</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{doneCount} of {roster.length} complete</div>
        </div>
        <span style={{ color: "var(--text-dim)" }}>&#9662;</span>
      </button>
      {pickerOpen && <div className="movly" style={{ zIndex: 330 }} onClick={e => { if (e.target === e.currentTarget) setPickerOpen(false); }}>
        <div className="modal" style={{ maxWidth: 480 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div className="mtitle">Choose a Player</div>
            <button type="button" className="btn ghost bxs" onClick={() => setPickerOpen(false)}>Close</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6, maxHeight: "60vh", overflowY: "auto" }}>
            {roster.map((x, i) => (
              <button key={x.participant_id} type="button" className={"seg" + (i === idx ? " on" : "")} style={{ flex: "none", minHeight: 44, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", padding: "6px 10px", textAlign: "left" }}
                onClick={() => { setIdx(i); setPickerOpen(false); }}>
                <div style={{ fontWeight: 700 }}>{x.name}{x.jersey ? " #" + x.jersey : ""}</div>
                <div style={{ fontSize: 11, opacity: .85 }}>{rowStatusLabel(x)}</div>
              </button>
            ))}
          </div>
        </div>
      </div>}
      <div className="card">
        <div style={{ fontSize: 18, fontWeight: 900 }}>{p.name}{p.jersey ? "  #" + p.jersey : ""}</div>
        {heldByOther && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <span className="status caution">Being recorded by {heldByOther.label}</span>
          <button type="button" className="btn ghost bxs" onClick={takeOver}>Take Over</button>
        </div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
          {Array.from({ length: N }).map((_, s) => attemptInput(p, s))}
        </div>
        <div style={{ marginTop: 8, fontSize: 14 }}>Result: <b>{resultLabel(r)}</b> <span style={{ color: "var(--text-dim)" }}>(provisional)</span></div>
        <div style={{ marginTop: 8 }}>{statusPicker(p)}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, gap: 8 }}>
          <button type="button" className="btn ghost bsm" disabled={idx === 0} onClick={() => setIdx(i => Math.max(0, i - 1))}>Previous</button>
          <button type="button" className="btn primary bsm" disabled={idx >= roster.length - 1} onClick={() => setIdx(i => Math.min(roster.length - 1, i + 1))}>Next player</button>
        </div>
      </div>
    </div>
  );
}

const S = {
  badge: c => ({ fontSize: 10, fontWeight: 800, color: c, letterSpacing: ".03em" }),
};
