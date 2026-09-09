import React, { useState, useEffect, useRef, useCallback } from "react";
import BenchmarkRecorder from "./BenchmarkRecorder.jsx";
import { getBenchmarkRecordingViewByToken, saveBenchmarkAttemptByToken, mapBenchmarkVersion } from "../supabase.js";
import { outboxScopeForGrant } from "../benchmarkOutbox.js";

// Anonymous, scoped helper recording surface: /brec/:token (ROP-Benchmarks
// handoff 6.2). A distinct capability from /live/:token -- a general live token
// never gains write access here. The bearer token is validated inside every
// RPC; this component holds it only in memory and never puts it in a log,
// analytics call, or the page title.

export default function BenchmarkRecordView({ token }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    const { data, error: e } = await getBenchmarkRecordingViewByToken(token);
    if (e || !data) { setError("This recording link could not be opened."); setLoading(false); return; }
    if (data.error) {
      setError(data.error === "invalid_or_expired_token"
        ? "This recording link has expired or been turned off."
        : "This recording link is not available.");
      setView(null); setLoading(false); return;
    }
    setError("");
    setView(data);
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // No realtime channel for an anonymous recorder; a light poll keeps other
    // recorders' entries and a finalize/close visible.
    pollRef.current = setInterval(load, 5000);
    return () => clearInterval(pollRef.current);
  }, [load]);

  if (loading) return <Shell><div style={{ color: "#9fb3ab" }}>Loading...</div></Shell>;
  if (error) return <Shell><div style={{ fontWeight: 700 }}>{error}</div><div style={{ color: "#9fb3ab", marginTop: 6, fontSize: 13 }}>Ask the coach for a fresh link if you still need to record.</div></Shell>;
  if (!view) return <Shell><div>Nothing to record.</div></Shell>;

  const protocol = mapBenchmarkVersion(view.protocol);
  const subjectMode = (view.participants || []).some(p => p.is_team_subject) ? "team" : "individual";
  const closed = !!view.closed;

  const saveAttempt = async (participantId, slotIndex, values, opId /*, expectedRowVersion */) => {
    const { data, error: e } = await saveBenchmarkAttemptByToken(token, {
      participantId, slotIndex,
      valueNumeric: values.valueNumeric ?? null,
      successes: values.successes ?? null,
      opportunities: values.opportunities ?? null,
      rubricLevelId: values.rubricLevelId ?? null,
      clientOperationId: opId,
    });
    if (e) return { error: e };
    if (data && data.error) {
      // a closed / out-of-scope / read-only entry: surface, do not retry forever
      if (data.error === "assessment_closed") { load(); return { error: new Error("closed") }; }
      return { error: new Error(data.error) };
    }
    return { data };
  };

  return (
    <Shell wide>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 22, fontWeight: 900 }}>Record Results</div>
        {view.attribution_label && <div style={{ fontSize: 12, color: "#9fb3ab" }}>as {view.attribution_label}</div>}
      </div>
      <div style={{ background: "#fff", color: "var(--black)", borderRadius: 12, padding: 14 }}>
        <BenchmarkRecorder
          protocol={protocol}
          participants={view.participants || []}
          assessmentId={"grant"}
          subjectMode={subjectMode}
          outboxScope={outboxScopeForGrant("helper")}
          saveAttempt={saveAttempt}
          setStatus={null}
          onRefresh={load}
          readOnly={closed}
          mineOnlyEdit
          isDesktop={typeof window !== "undefined" && window.innerWidth >= 900}
        />
      </div>
      <div style={{ fontSize: 11, color: "#9fb3ab", marginTop: 10 }}>
        You can enter and edit only the results you record here. Existing entries by the coach or another recorder are read-only.
      </div>
    </Shell>
  );
}

function Shell({ children, wide }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0d1512", color: "#e8f0ec", padding: "24px 16px" }}>
      <div style={{ maxWidth: wide ? 760 : 420, margin: "0 auto" }}>
        <div style={{ fontSize: 12, letterSpacing: ".12em", color: "#6f8079", fontWeight: 800, marginBottom: 16 }}>RUN OF PRACTICE</div>
        {children}
      </div>
    </div>
  );
}
