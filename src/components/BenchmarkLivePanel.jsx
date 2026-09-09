import React, { useState, useEffect, useRef, useCallback } from "react";
import BenchmarkRecorder from "./BenchmarkRecorder.jsx";
import { mapBenchmarkVersion } from "../supabase.js";
import {
  resolveBenchmarkAssessment, getBenchmarkAssessment, saveBenchmarkAttempt,
  setBenchmarkParticipantStatus, finalizeBenchmarkAssessment, reopenBenchmarkAssessment,
  createBenchmarkRecordingGrant, revokeBenchmarkRecordingGrant, addBenchmarkParticipant,
} from "../supabase.js";
import { outboxScopeForUser, outboxClearScope } from "../benchmarkOutbox.js";

// Coach-side live recording for a benchmark activity or station. Capture runs
// on its own write path -- it does NOT use the practice controller's write
// queue and never requires Take Control (ROP-Benchmarks handoff 5.4). Any
// signed-in team coach can record; finalize / reopen / grants gate on the
// server (can_finalize / can_manage) and this only mirrors that in the UI.

export default function BenchmarkLivePanel({ activity, station, practice, team, liveSessionId, coachId, isDesktop, assessmentId: assessmentIdProp }) {
  // Standalone mode: the caller (Measure Again -> record now) has already
  // created the assessment and passes its id; there is no live activity or
  // station to resolve an occurrence for.
  const standalone = !!assessmentIdProp;
  const bId = standalone ? null : (station ? station.benchmarkId : activity.benchmarkId);
  const bvId = standalone ? null : (station ? station.benchmarkVersionId : activity.benchmarkVersionId);
  const occurrenceKey = standalone ? null : (station
    ? (station.benchmarkSharedOccurrence ? "sb:" + (station.stationBlockId || activity.id) + ":" + bvId : "st:" + station.id)
    : "pa:" + activity.id);

  const [assessmentId, setAssessmentId] = useState(assessmentIdProp || null);
  const [payload, setPayload] = useState(null);
  const [err, setErr] = useState("");        // fatal: could not start / load -> hides the panel
  const [actionErr, setActionErr] = useState(""); // finalize / grant error -> shown inline, panel stays
  const [busy, setBusy] = useState(true);
  const [confirmFinalize, setConfirmFinalize] = useState(null); // counts object
  const [grantToken, setGrantToken] = useState("");
  const [grantScope, setGrantScope] = useState(null); // 'players' | 'team'
  const pollRef = useRef(null);

  const refresh = useCallback(async (aid) => {
    const id = aid || assessmentId;
    if (!id) return;
    const { data, error } = await getBenchmarkAssessment(id);
    if (error || (data && data.error)) return;
    setPayload(data);
  }, [assessmentId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true); setErr("");
      if (standalone) { await refresh(assessmentIdProp); setBusy(false); return; }
      const { data, error } = await resolveBenchmarkAssessment({
        teamId: practice.teamId, benchmarkId: bId, versionId: bvId,
        occurrenceKey, practiceId: practice.id,
        practiceActivityId: station ? null : activity.id, stationId: station ? station.id : null,
        liveSessionId, timezone: team && team.timezone,
      });
      if (!alive) return;
      if (error || !data || !data.assessment_id) { setErr("Could not start recording for this benchmark."); setBusy(false); return; }
      setAssessmentId(data.assessment_id);
      await refresh(data.assessment_id);
      setBusy(false);
    })();
    return () => { alive = false; };
  }, [bId, bvId, occurrenceKey, assessmentIdProp]); // eslint-disable-line

  // Backfill the source-practice link if the live session row settled a beat
  // after this panel first resolved the assessment (handoff 4.1 / 5.2).
  useEffect(() => {
    if (standalone || !assessmentId || !liveSessionId) return;
    const a = payload && payload.assessment;
    if (a && !a.live_session_id) {
      resolveBenchmarkAssessment({
        teamId: practice.teamId, benchmarkId: bId, versionId: bvId, occurrenceKey,
        practiceId: practice.id, practiceActivityId: station ? null : activity.id,
        stationId: station ? station.id : null, liveSessionId, timezone: team && team.timezone,
      }).then(() => refresh());
    }
  }, [assessmentId, liveSessionId, payload && payload.assessment && payload.assessment.live_session_id]); // eslint-disable-line

  useEffect(() => {
    if (!assessmentId) return;
    pollRef.current = setInterval(() => refresh(), 5000);
    return () => clearInterval(pollRef.current);
  }, [assessmentId, refresh]);

  if (busy) return <Box><div style={{ color: "var(--td)", fontSize: 13 }}>Starting recording...</div></Box>;
  if (err) return <Box><div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div></Box>;
  if (!payload) return null;

  const a = payload.assessment || {};
  const protocol = mapBenchmarkVersion(payload.version || {});
  const subjectMode = payload.benchmark && payload.benchmark.subject_mode === "team" ? "team" : "individual";
  const state = a.state;
  const canFinalize = !!payload.can_finalize;
  const canManage = !!payload.can_manage;
  const recording = state === "recording";

  const saveAttempt = (participantId, slotIndex, values, opId, expectedRowVersion) =>
    saveBenchmarkAttempt({
      assessmentId, participantId, slotIndex,
      valueNumeric: values.valueNumeric ?? null, successes: values.successes ?? null,
      opportunities: values.opportunities ?? null, rubricLevelId: values.rubricLevelId ?? null,
      clientOperationId: opId, expectedRowVersion,
    });
  const setStatus = async (participantId, status) => { await setBenchmarkParticipantStatus(participantId, status); };

  const doFinalize = async (confirmIncomplete) => {
    setActionErr("");
    const { data, error } = await finalizeBenchmarkAssessment(assessmentId, confirmIncomplete);
    if (error) { setActionErr(error.message || "Finalize failed"); setConfirmFinalize(null); return; }
    if (data && data.needs_confirmation) { setConfirmFinalize(data.counts); return; }
    if (data && data.error) { setActionErr(data.message || data.error); setConfirmFinalize(null); return; }
    setConfirmFinalize(null);
    await outboxClearScope(outboxScopeForUser(coachId, assessmentId));
    await refresh();
  };

  const addHelper = async (scope) => {
    const playerIds = scope === "players"
      ? (payload.participants || []).filter(p => !p.is_team_subject && p.player_id).map(p => p.player_id)
      : [];
    setActionErr("");
    const { data, error } = await createBenchmarkRecordingGrant(assessmentId, { subjectScope: scope, playerIds });
    if (error || !data || !data.token) { setActionErr("Could not create a helper link."); return; }
    setGrantToken(data.token); setGrantScope(scope);
    await refresh();
  };
  const revokeGrant = async (id) => { await revokeBenchmarkRecordingGrant(id); await refresh(); };

  const recordLink = grantToken ? (typeof window !== "undefined" ? window.location.origin : "") + "/brec/" + grantToken : "";

  return (
    <Box>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 16, fontWeight: 900 }}>
          Record: {payload.benchmark ? payload.benchmark.title : "Benchmark"}
        </div>
        <span className="bdg bs">{a.under_correction ? "Under correction" : state}</span>
      </div>

      {(recording) && <BenchmarkRecorder
        protocol={protocol}
        participants={payload.participants || []}
        assessmentId={assessmentId}
        subjectMode={subjectMode}
        outboxScope={outboxScopeForUser(coachId, assessmentId)}
        saveAttempt={saveAttempt}
        setStatus={setStatus}
        onRefresh={refresh}
        readOnly={false}
        isDesktop={isDesktop}
      />}
      {!recording && <div style={{ fontSize: 13, color: "var(--td)" }}>
        This assessment is {state}. {canManage && state === "finalized" ? "Reopen it to correct a result." : "Results are locked."}
      </div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {recording && canFinalize && <button type="button" className="btn primary bsm" onClick={() => doFinalize(false)}>Finalize</button>}
        {state === "finalized" && canManage && <button type="button" className="btn ghost bsm" onClick={async () => { setActionErr(""); await reopenBenchmarkAssessment(assessmentId); await refresh(); }}>Reopen for correction</button>}
        {recording && canFinalize && <button type="button" className="btn ghost bsm" onClick={() => addHelper(subjectMode === "team" ? "team" : "players")}>Add a recording helper</button>}
      </div>
      {actionErr && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 6 }}>{actionErr}</div>}

      {grantToken && recording && <div style={{ marginTop: 10, background: "var(--s2)", borderRadius: 8, padding: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Recording link ({grantScope === "team" ? "team result" : "all listed players"})</div>
        <div style={{ fontSize: 12, wordBreak: "break-all", margin: "4px 0" }}>{recordLink}</div>
        <button type="button" className="btn ghost bxs" onClick={() => { try { navigator.clipboard.writeText(recordLink); } catch (e) {} }}>Copy recording link</button>
        <div style={{ fontSize: 11, color: "var(--td)", marginTop: 4 }}>Expires in 12 hours. Finalizing or archiving revokes it.</div>
      </div>}

      {(payload.active_grants || []).length > 0 && <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Active recording links</div>
        {payload.active_grants.map(g => <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "3px 0" }}>
          <span>{g.subject_scope === "team" ? "Team result" : (g.permitted_player_ids || []).length + " players"}{g.attribution_label ? " · " + g.attribution_label : ""}</span>
          <button type="button" className="btn ghost bxs" onClick={() => revokeGrant(g.id)}>Revoke</button>
        </div>)}
      </div>}

      {confirmFinalize && <div className="movly" style={{ zIndex: 340 }} onClick={e => { if (e.target === e.currentTarget) setConfirmFinalize(null); }}>
        <div className="modal" style={{ maxWidth: 420 }}>
          <div className="mtitle">Finalize with incomplete results?</div>
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            {confirmFinalize.complete} complete · {confirmFinalize.partial} partial · {confirmFinalize.missing} not measured · {confirmFinalize.skipped} skipped · {confirmFinalize.unable} unable, of {confirmFinalize.expected} expected.
            Incomplete participants stay out of the official summary.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn ghost bsm" onClick={() => setConfirmFinalize(null)}>Keep recording</button>
            <button type="button" className="btn primary bsm" onClick={() => doFinalize(true)}>Finalize anyway</button>
          </div>
        </div>
      </div>}
    </Box>
  );
}

function Box({ children }) {
  return <div style={{ border: "1.5px solid var(--green2)", background: "var(--gbg)", borderRadius: "var(--r)", padding: 12, marginBottom: 10 }}>{children}</div>;
}
