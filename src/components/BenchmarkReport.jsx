import React, { useState, useEffect, useCallback } from "react";
import BenchmarkLivePanel from "./BenchmarkLivePanel.jsx";
import {
  fetchTeamBenchmarkReport, fetchPlayerBenchmarkReport, mapBenchmarkVersion,
  setTeamBenchmarkTarget, setTeamBenchmarkBaseline, setBenchmarkAssessmentExclusion,
  resolveBenchmarkAssessment,
} from "../supabase.js";
import {
  officialResult, isOfficial, teamPerformanceIndividual, matchedImprovement, collectiveImprovement,
  personalBest, classifyAgainstPersonalBest, targetAttainment, meetsTarget,
  comparableAssessments, isEligibleAssessment, previousEligibleAssessment,
  displayDecimals, roundTo, changeVerb,
} from "../benchmarks.js";

// Reporting surfaces for Goals & Insights and PlayerProfile. All official
// numbers are computed here from the golden-fixture-tested benchmarks.js, never
// re-derived. The RPCs (get_team_benchmark_report / get_player_benchmark_report)
// are the authoritative access gate and return canonical attempt values only.

// ── mappers ─────────────────────────────────────────────────────────────────
function mapAttempts(attempts) {
  return (attempts || []).map(a => ({
    slot: a.slot_index, valid: a.valid !== false,
    value: a.value_numeric, successes: a.successes, opportunities: a.opportunities, levelId: a.rubric_level_id,
  }));
}
function protocolOf(versionRow) {
  return mapBenchmarkVersion(versionRow || {});
}
// { measured, expected, teamPerf, resultByPlayer, teamResult, participantIds }
function computeAssessment(protocol, assessment) {
  const parts = assessment.participants || [];
  if (protocol.subjectMode === "team" || parts.some(p => p.is_team_subject)) {
    const t = parts.find(p => p.is_team_subject);
    const res = t ? officialResult(protocol, mapAttempts(t.attempts)) : { status: "none" };
    return {
      collective: true,
      teamResult: res,
      participantIds: (t && t.participating_player_ids) || null,
      playerCount: (t && t.player_count) || null,
      status: t && t.status,
    };
  }
  const rows = parts.filter(p => !p.is_team_subject).map(p => ({
    playerId: p.player_id, name: p.name, jersey: p.jersey, status: p.status,
    result: officialResult(protocol, mapAttempts(p.attempts)),
  }));
  const perf = teamPerformanceIndividual(protocol, rows, rows.length);
  const resultByPlayer = {};
  for (const r of rows) if (r.status === "complete" && isOfficial(r.result)) resultByPlayer[r.playerId] = r.result;
  return { collective: false, rows, teamPerf: perf, resultByPlayer };
}
function protocolForVersion(detail, versionId) {
  const v = (detail.versions || []).find(x => x.id === versionId) || (detail.versions || [])[0];
  return protocolOf(v);
}
const eligible = a => a.state === "finalized" && !a.under_correction;

function fmtResult(protocol, r) {
  if (!isOfficial(r)) return "—";
  if (r.metricType === "success_rate") return r.successes + "/" + r.opportunities + " (" + roundTo(r.proportion * 100, 1) + "%)";
  if (r.metricType === "score_rubric") { const l = (protocol.rubricLevels || []).find(x => x.id === r.levelId); return l ? l.label : "level " + r.levelOrder; }
  return roundTo(r.value, displayDecimals(protocol)) + (protocol.displayUnit ? " " + protocol.displayUnit : "");
}
function fmtChange(m) {
  if (!m || m.status !== "ok") return "";
  if (m.kind === "rubric") return m.improved + " up · " + m.unchanged + " same · " + m.lower + " down";
  const s = roundTo(m.signedImprovement, 2);
  const rel = m.relativeImprovementPercent != null ? " (" + roundTo(Math.abs(m.relativeImprovementPercent), 1) + "%)" : "";
  return (s > 0 ? "+" : "") + s + " " + (m.verb || "") + rel;
}

// ── Goals & Insights: overview + detail ─────────────────────────────────────
export function TeamBenchmarksView({ teamId, team, coachId, canManage, isBB }) {
  const [openId, setOpenId] = useState(null);
  if (openId) return <TeamBenchmarkDetail teamId={teamId} team={team} coachId={coachId} benchmarkId={openId} canManage={canManage} onBack={() => setOpenId(null)} isBB={isBB} />;
  return <TeamBenchmarksOverview teamId={teamId} canManage={canManage} onOpen={setOpenId} />;
}

function TeamBenchmarksOverview({ teamId, onOpen }) {
  const [report, setReport] = useState(null);
  useEffect(() => { setReport(null); fetchTeamBenchmarkReport(teamId).then(r => setReport(r.data || { error: true })); }, [teamId]);
  if (!report) return <div style={{ fontSize: 13, color: "var(--td)" }}>Loading...</div>;
  if (report.error) return <div style={{ fontSize: 13, color: "var(--td)" }}>Benchmark history is not available for this team.</div>;
  const list = report.benchmarks || [];
  if (!list.length) return <div className="card"><div style={{ fontSize: 13, color: "var(--td)" }}>No benchmarks adopted for this team yet. Add one from Library &rarr; Benchmarks or in the Builder.</div></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {list.map(row => {
        const protocol = protocolOf(row.version);
        const latest = row.latest;
        let summary = "No finalized measurements yet";
        if (latest) {
          const c = computeAssessment(protocol, latest);
          if (c.collective) summary = "Team: " + fmtResult(protocol, c.teamResult);
          else if (c.teamPerf && !c.teamPerf.noResults) {
            summary = c.teamPerf.metricType === "success_rate" || protocol.metricType === "success_rate"
              ? "Avg " + roundTo(c.teamPerf.meanProportion * 100, 1) + "% · " + c.teamPerf.measuredCount + " measured"
              : protocol.metricType === "score_rubric"
                ? c.teamPerf.measuredCount + " measured"
                : "Avg " + roundTo(c.teamPerf.mean, displayDecimals(protocol)) + (protocol.displayUnit ? " " + protocol.displayUnit : "") + " · " + c.teamPerf.measuredCount + " measured";
          } else summary = "No completed results";
        }
        return (
          <div key={row.team_benchmark_id} className="card" style={{ cursor: "pointer" }} onClick={() => onOpen(row.benchmark.id)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontWeight: 800 }}>{row.benchmark.title}</div>
              <div style={{ fontSize: 11, color: "var(--td)" }}>{row.finalized_count} finalized{row.recording_count ? " · " + row.recording_count + " recording" : ""}</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--td)", marginTop: 2 }}>{row.benchmark.subject_mode === "team" ? "Whole team" : "Individual"} · {protocol.metricType}</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>{summary}{latest ? "  ·  " + latest.measured_local_date : ""}</div>
          </div>
        );
      })}
    </div>
  );
}

const HISTORY_PAGE = 25;

function TeamBenchmarkDetail({ teamId, team, coachId, benchmarkId, canManage, onBack, isDesktop }) {
  const [detail, setDetail] = useState(null);
  const [compareId, setCompareId] = useState(null); // "" | "season" | <assessmentId>
  const [extra, setExtra] = useState([]);           // older assessments loaded via "Load more"
  const [noMore, setNoMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [measureAgain, setMeasureAgain] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setDetail(null); setExtra([]); setNoMore(false);
    fetchTeamBenchmarkReport(teamId, benchmarkId, { limit: HISTORY_PAGE }).then(r => setDetail(r.data || { error: true }));
  }, [teamId, benchmarkId]);
  useEffect(load, [load]);

  if (!detail) return <div style={{ fontSize: 13, color: "var(--td)" }}>Loading...</div>;
  if (detail.error) return <div><button className="btn ghost bxs" onClick={onBack}>&larr; Back</button><div style={{ fontSize: 13, color: "var(--td)", marginTop: 8 }}>Not available.</div></div>;

  const all = [...(detail.assessments || []), ...extra];
  const hasMore = (detail.assessments || []).length >= HISTORY_PAGE && !noMore;
  async function loadMore() {
    setLoadingMore(true);
    const oldest = all[all.length - 1];
    const r = await fetchTeamBenchmarkReport(teamId, benchmarkId, { limit: HISTORY_PAGE, before: oldest && oldest.measured_at });
    setLoadingMore(false);
    const page = (r.data && r.data.assessments) || [];
    setExtra(x => [...x, ...page]);
    if (page.length < HISTORY_PAGE) setNoMore(true);
  }

  const elig = all.filter(eligible);
  const latest = elig[0];
  const version = detail.team_benchmark ? detail.team_benchmark.adopted_version_id : (latest && latest.protocol_version_id);
  const protocol = protocolForVersion(detail, version);
  const subjectMode = detail.benchmark.subject_mode;
  const baselineId = detail.team_benchmark && detail.team_benchmark.baseline_assessment_id;

  // comparison target: an explicit assessment, the season baseline, or (default)
  // the immediately preceding eligible assessment of the same version.
  let compare = null;
  if (compareId === "season") {
    compare = baselineId ? elig.find(a => a.id === baselineId) : null;
    if (!compare) {
      const s = detail.season || {};
      const sameVer = elig.filter(a => a.protocol_version_id === version && !a.excluded_from_comparisons);
      const inSeason = (s.start && s.end) ? sameVer.filter(a => a.measured_local_date >= s.start && a.measured_local_date <= s.end) : sameVer;
      compare = (inSeason.length ? inSeason : sameVer).slice().sort((x, y) => (x.measured_at < y.measured_at ? -1 : 1))[0] || null;
    }
  } else if (compareId) {
    compare = all.find(a => a.id === compareId) || null;
  } else if (latest) {
    compare = elig.find(a => a.id !== latest.id && a.protocol_version_id === latest.protocol_version_id && !a.excluded_from_comparisons && !latest.excluded_from_comparisons) || null;
  }

  // official summary of the latest
  const cur = latest ? computeAssessment(protocol, latest) : null;
  let improvement = null;
  if (latest && compare && latest.protocol_version_id === compare.protocol_version_id && !latest.excluded_from_comparisons && !compare.excluded_from_comparisons) {
    const prevC = computeAssessment(protocol, compare);
    if (subjectMode === "team") {
      improvement = collectiveImprovement(protocol, prevC.teamResult, cur.teamResult, prevC.participantIds, cur.participantIds,
        { previous: compare.measured_local_date, current: latest.measured_local_date });
    } else {
      improvement = matchedImprovement(protocol, prevC.resultByPlayer, cur.resultByPlayer,
        { previous: compare.measured_local_date, current: latest.measured_local_date });
    }
  }

  // current target (latest revision for this version)
  const target = (detail.targets || []).find(t => t.protocol_version_id === version) || (detail.targets || [])[0];
  const targetObj = target && (
    protocol.metricType === "success_rate" ? { proportion: target.threshold_proportion } :
    protocol.metricType === "score_rubric" ? { levelOrder: target.threshold_level_order } :
    { value: target.threshold_value }
  );
  let attain = null;
  if (targetObj && cur && !cur.collective && cur.rows) {
    attain = targetAttainment(protocol, targetObj, cur.rows.map(r => ({ status: r.status, result: r.result })), cur.rows.length);
  }

  // assessment-average series for the chart/table
  const series = elig.slice().reverse().map(a => {
    const c = computeAssessment(protocol, a);
    let value = null, n = 0;
    if (c.collective) { value = isOfficial(c.teamResult) ? (c.teamResult.proportion ?? c.teamResult.levelOrder ?? c.teamResult.value) : null; n = c.participantIds ? c.participantIds.length : 0; }
    else if (c.teamPerf && !c.teamPerf.noResults) { value = c.teamPerf.meanProportion ?? c.teamPerf.mean ?? null; n = c.teamPerf.measuredCount; }
    return { date: a.measured_local_date, value, n, excluded: a.excluded_from_comparisons };
  }).filter(p => p.value != null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <button className="btn ghost bxs" onClick={onBack}>&larr; All benchmarks</button>
        {!detail.benchmark.archived && <button type="button" className="btn ghost bsm" onClick={() => setMeasureAgain(true)}>Measure again</button>}
      </div>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, margin: "8px 0 2px" }}>{detail.benchmark.title}</div>
      <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 10 }}>{subjectMode === "team" ? "Whole-team" : "Individual"} · {protocol.metricType} · {(detail.versions || []).length} version{(detail.versions || []).length === 1 ? "" : "s"}</div>

      {measureAgain && <MeasureAgainModal
        teamId={teamId} team={team} coachId={coachId}
        benchmarkId={benchmarkId}
        versionId={(detail.team_benchmark && detail.team_benchmark.adopted_version_id) || version}
        title={detail.benchmark.title}
        onClose={() => setMeasureAgain(false)}
        onDone={() => { setMeasureAgain(false); load(); }}
      />}

      {!latest && <div className="card"><div style={{ fontSize: 13, color: "var(--td)" }}>No finalized assessments yet.</div></div>}

      {latest && <div className="card" style={{ marginBottom: 10 }}>
        <div className="clbl mb8">Latest · {latest.measured_local_date}{latest.label ? " · " + latest.label : ""}</div>
        {cur && cur.collective && <div style={{ fontSize: 15, fontWeight: 800 }}>{fmtResult(protocol, cur.teamResult)}{cur.playerCount ? "  ·  " + cur.playerCount + " players" : ""}</div>}
        {cur && !cur.collective && cur.teamPerf && !cur.teamPerf.noResults && <>
          <div style={{ fontSize: 15, fontWeight: 800 }}>
            {protocol.metricType === "success_rate" ? "Avg " + roundTo(cur.teamPerf.meanProportion * 100, 1) + "%" :
             protocol.metricType === "score_rubric" ? cur.teamPerf.measuredCount + " measured" :
             "Avg " + roundTo(cur.teamPerf.mean, displayDecimals(protocol)) + (protocol.displayUnit ? " " + protocol.displayUnit : "")}
          </div>
          <div style={{ fontSize: 12, color: "var(--td)" }}>{cur.teamPerf.measuredCount} measured · {cur.teamPerf.notMeasuredCount} not measured · {cur.teamPerf.partialCount} partial · {cur.teamPerf.skippedCount} skipped · {cur.teamPerf.unableCount} unable</div>
        </>}
        {cur && !cur.collective && cur.teamPerf && cur.teamPerf.noResults && <div style={{ fontSize: 13, color: "var(--td)" }}>No completed results.</div>}
      </div>}

      {latest && elig.length > 1 && <div className="card" style={{ marginBottom: 10 }}>
        <div className="clbl mb8">Comparison</div>
        <select className="inp" value={compareId || (compare ? compare.id : "")} onChange={e => setCompareId(e.target.value || null)} style={{ marginBottom: 8 }}>
          <option value="">Previous eligible</option>
          <option value="season">Season baseline{baselineId ? " (chosen)" : ""}</option>
          {elig.filter(a => a.id !== latest.id).map(a => <option key={a.id} value={a.id}>{a.measured_local_date}{a.label ? " · " + a.label : ""}</option>)}
        </select>
        {compareId === "season" && !compare && <div style={{ fontSize: 12, color: "var(--amber)", marginBottom: 6 }}>Baseline unavailable (archived or excluded). Choose another below or set a new one.</div>}
        {!improvement && <div style={{ fontSize: 13, color: "var(--td)" }}>No comparable assessment (version mismatch or excluded).</div>}
        {improvement && improvement.status === "no_overlap" && <div style={{ fontSize: 13 }}>No comparable players between these dates.</div>}
        {improvement && improvement.status === "ok" && improvement.kind !== undefined && <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{fmtChange(improvement)}</div>
          <div style={{ fontSize: 12, color: "var(--td)" }}>
            {improvement.kind === "rubric" ? "" : "matched " + improvement.matchedCount + " player" + (improvement.matchedCount === 1 ? "" : "s") + " · "}
            {compare.measured_local_date} &rarr; {latest.measured_local_date}
          </div>
          {improvement.note === "few_comparable_players" && <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 4 }}>Only {improvement.matchedCount} comparable player{improvement.matchedCount === 1 ? "" : "s"} — not a team-wide claim.</div>}
          {improvement.improved != null && improvement.kind !== "rubric" && <div style={{ fontSize: 12, color: "var(--td)", marginTop: 4 }}>{improvement.improved} improved · {improvement.unchanged} unchanged · {improvement.worse} lower</div>}
        </div>}
        {improvement && improvement.status === "ok" && improvement.label === "team_challenge" && <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Team challenge result: {fmtChange({ ...improvement, kind: "ratio" })}</div>
          {improvement.compositionWarning && <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 4 }}>Different participants ({improvement.previousCount ?? "?"} &rarr; {improvement.currentCount ?? "?"}) — not same-player development.</div>}
        </div>}
      </div>}

      {target && <div className="card" style={{ marginBottom: 10 }}>
        <div className="clbl mb8">Target</div>
        <div style={{ fontSize: 13 }}>
          {protocol.metricType === "success_rate" ? "≥ " + roundTo(target.threshold_proportion * 100, 0) + "%" :
           protocol.metricType === "score_rubric" ? "at or above level " + target.threshold_level_order :
           (protocol.direction === "lower" ? "≤ " : "≥ ") + target.threshold_value + (protocol.displayUnit ? " " + protocol.displayUnit : "")}
          {target.attainment_percent != null ? " · objective " + target.attainment_percent + "% of measured" : ""}
        </div>
        {attain && <div style={{ fontSize: 13, marginTop: 4 }}>{attain.meetingCount} of {attain.measuredCount} measured meet target ({attain.attainmentPercent}%)</div>}
      </div>}

      {series.length > 1 && <div className="card" style={{ marginBottom: 10 }}>
        <div className="clbl mb8">Assessment averages</div>
        <Sparkline points={series} lower={protocol.direction === "lower"} />
        <table style={{ width: "100%", fontSize: 12, marginTop: 8, borderCollapse: "collapse" }}>
          <thead><tr><th style={{ textAlign: "left", borderBottom: "1px solid var(--b)" }}>Date</th><th style={{ textAlign: "right", borderBottom: "1px solid var(--b)" }}>Average</th><th style={{ textAlign: "right", borderBottom: "1px solid var(--b)" }}>N</th></tr></thead>
          <tbody>{series.map((p, i) => <tr key={i}><td>{p.date}{p.excluded ? " (excluded)" : ""}</td><td style={{ textAlign: "right" }}>{roundTo(p.value, protocol.metricType === "success_rate" ? 3 : displayDecimals(protocol))}</td><td style={{ textAlign: "right" }}>{p.n}</td></tr>)}</tbody>
        </table>
      </div>}

      {cur && !cur.collective && cur.rows && <div className="card" style={{ marginBottom: 10 }}>
        <div className="clbl mb8">Players · latest</div>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <tbody>{cur.rows.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(r => <tr key={r.playerId || r.name}>
            <td style={{ borderBottom: "1px solid var(--b)" }}>{r.name}{r.jersey ? " #" + r.jersey : ""}</td>
            <td style={{ borderBottom: "1px solid var(--b)", textAlign: "right" }}>{r.status === "complete" ? fmtResult(protocol, r.result) : (r.status || "not measured").replace("_", " ")}</td>
            <td style={{ borderBottom: "1px solid var(--b)", textAlign: "right", width: 60 }}>{targetObj && r.status === "complete" ? (meetsTarget(protocol, targetObj, r.result) ? "✓" : "—") : ""}</td>
          </tr>)}</tbody>
        </table>
      </div>}

      <div className="card">
        <div className="clbl mb8">Assessment history</div>
        {all.map(a => <div key={a.id} style={{ fontSize: 13, padding: "5px 0", borderTop: "1px solid var(--b)", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span>{a.measured_local_date}{a.label ? " · " + a.label : ""} <span className="bdg bs">{a.under_correction ? "under correction" : a.state}</span>{a.excluded_from_comparisons ? <span className="bdg bs" style={{ marginLeft: 4 }}>excluded</span> : null}{baselineId === a.id ? <span className="bdg bs" style={{ marginLeft: 4 }}>baseline</span> : null}</span>
          {canManage && a.state === "finalized" && <span style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn ghost bxs" disabled={busy} onClick={async () => {
              setBusy(true); await setTeamBenchmarkBaseline(detail.team_benchmark.id, baselineId === a.id ? null : a.id); setBusy(false); load();
            }}>{baselineId === a.id ? "Clear baseline" : "Set baseline"}</button>
            <button type="button" className="btn ghost bxs" disabled={busy} onClick={async () => {
              setBusy(true); await setBenchmarkAssessmentExclusion(a.id, !a.excluded_from_comparisons, a.excluded_from_comparisons ? null : "Different test conditions"); setBusy(false); load();
            }}>{a.excluded_from_comparisons ? "Include" : "Exclude"}</button>
          </span>}
        </div>)}
        {hasMore && <button type="button" className="btn ghost bsm bfull" style={{ marginTop: 10 }} disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Loading..." : "Load more"}</button>}
      </div>

      {canManage && detail.team_benchmark && <TargetEditor detail={detail} version={version} protocol={protocol} onSaved={load} />}
    </div>
  );
}

// Measure Again -> "record results now without a scheduled practice" (handoff
// 4.3, option 3). Creates a team-scoped standalone assessment for a chosen
// measured date/time (no future dates for actual results) and hosts the
// recorder + finalize in place. Server rejects if the caller is neither a
// manager nor a build delegate.
export function MeasureAgainModal({ teamId, team, coachId, benchmarkId, versionId, title, onClose, onDone }) {
  const today = new Date();
  const pad = n => String(n).padStart(2, "0");
  const [date, setDate] = useState(today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate()));
  const [time, setTime] = useState(pad(today.getHours()) + ":" + pad(today.getMinutes()));
  const [assessmentId, setAssessmentId] = useState(null);
  const [err, setErr] = useState("");
  const [starting, setStarting] = useState(false);
  const maxDate = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());

  async function start() {
    setErr(""); setStarting(true);
    const measuredAt = new Date(date + "T" + (time || "00:00")).toISOString();
    if (new Date(measuredAt) > new Date()) { setErr("A recorded measurement cannot be in the future."); setStarting(false); return; }
    const r = await resolveBenchmarkAssessment({
      teamId, benchmarkId, versionId,
      occurrenceKey: "manual:" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random()),
      standalone: true, label: "Measure Again",
      measuredAt, measuredLocalDate: date, timezone: team && team.timezone,
    });
    setStarting(false);
    if (r.error || !r.data || !r.data.assessment_id) { setErr((r.error && r.error.message) || "Could not start. You may not have permission."); return; }
    setAssessmentId(r.data.assessment_id);
  }

  return (
    <div className="movly" style={{ zIndex: 330 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 620, maxHeight: "88vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="mtitle" style={{ marginBottom: 0 }}>Measure Again — {title}</div>
          <button type="button" className="btn ghost bxs" onClick={assessmentId ? onDone : onClose}>{assessmentId ? "Done" : "Cancel"}</button>
        </div>
        {!assessmentId && <>
          <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 10 }}>Records a standalone measurement for {team ? team.name : "this team"}. It adds no practice minutes and creates no practice.</div>
          <div style={{ display: "flex", gap: 10 }}>
            <div className="fld" style={{ flex: 1 }}><label className="lbl">Measured date</label><input className="inp" type="date" max={maxDate} value={date} onChange={e => setDate(e.target.value)} /></div>
            <div className="fld" style={{ flex: 1 }}><label className="lbl">Time</label><input className="inp" type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
          </div>
          {err && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{err}</div>}
          <button type="button" className="btn primary bmd bfull" disabled={starting} onClick={start}>{starting ? "Starting..." : "Start recording"}</button>
        </>}
        {assessmentId && <div style={{ overflowY: "auto", flex: 1 }}>
          <BenchmarkLivePanel assessmentId={assessmentId} team={team} coachId={coachId} isDesktop={typeof window !== "undefined" && window.innerWidth >= 1024} />
          <button type="button" className="btn primary bmd bfull" style={{ marginTop: 10 }} onClick={onDone}>Done</button>
        </div>}
      </div>
    </div>
  );
}

function TargetEditor({ detail, version, protocol, onSaved }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [pct, setPct] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" className="btn ghost bsm" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>Set / update target</button>;
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="clbl mb8">Set target ({protocol.metricType})</div>
      <div className="fld"><label className="lbl">{protocol.metricType === "success_rate" ? "Threshold %" : protocol.metricType === "score_rubric" ? "Level order" : "Threshold" + (protocol.displayUnit ? " (" + protocol.displayUnit + ")" : "")}</label>
        <input className="inp" type="number" step="any" value={val} onChange={e => setVal(e.target.value)} /></div>
      {protocol.subjectMode !== "team" && <div className="fld"><label className="lbl">Objective: % of measured players meeting it</label><input className="inp" type="number" value={pct} onChange={e => setPct(e.target.value)} /></div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn ghost bsm" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="btn primary bsm" disabled={busy || val === ""} onClick={async () => {
          setBusy(true);
          const num = Number(val);
          await setTeamBenchmarkTarget(detail.team_benchmark.id, version, {
            thresholdValue: (protocol.metricType === "success_rate" || protocol.metricType === "score_rubric") ? null : num,
            thresholdProportion: protocol.metricType === "success_rate" ? num / 100 : null,
            thresholdLevelOrder: protocol.metricType === "score_rubric" ? num : null,
            attainmentPercent: pct === "" ? null : Number(pct),
          });
          setBusy(false); setOpen(false); onSaved();
        }}>Save target</button>
      </div>
    </div>
  );
}

function Sparkline({ points, lower }) {
  const vals = points.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const W = 280, H = 60, pad = 4;
  const x = i => pad + (points.length === 1 ? 0 : i * (W - 2 * pad) / (points.length - 1));
  const y = v => max === min ? H / 2 : pad + (1 - (v - min) / (max - min)) * (H - 2 * pad);
  const d = points.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.value).toFixed(1)).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Assessment averages over time">
      <path d={d} fill="none" stroke="var(--green)" strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="2.5" fill={p.excluded ? "var(--td)" : "var(--green)"} />)}
    </svg>
  );
}

// ── PlayerProfile: one player's benchmark history ───────────────────────────
export function PlayerBenchmarks({ teamId, playerId }) {
  const [report, setReport] = useState(null);
  useEffect(() => { setReport(null); fetchPlayerBenchmarkReport(teamId, playerId).then(r => setReport(r.data || { error: true })); }, [teamId, playerId]);
  if (!report) return <div style={{ fontSize: 13, color: "var(--td)" }}>Loading...</div>;
  if (report.error) return null; // not authorized to see development history -> render nothing
  const list = (report.benchmarks || []).filter(b => (b.observations || []).length);
  if (!list.length) return <div style={{ fontSize: 13, color: "var(--td)" }}>No benchmark results for this player yet.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {list.map((b, bi) => {
        const obsByVersion = {};
        for (const o of b.observations) (obsByVersion[o.protocol_version_id] ||= []).push(o);
        return Object.entries(obsByVersion).map(([vid, obs]) => {
          const protocol = protocolOf((b.versions || []).find(v => v.id === vid) || b.versions[0]);
          const officials = obs
            .filter(o => o.state === "finalized" && !o.under_correction && !o.excluded_from_comparisons && o.status === "complete")
            .map(o => ({ date: o.measured_local_date, result: officialResult(protocol, mapAttempts(o.attempts)) }))
            .filter(o => isOfficial(o.result));
          const latest = officials[officials.length - 1];
          const prev = officials[officials.length - 2];
          const first = officials[0];
          const pb = personalBest(protocol, officials.map(o => o.result));
          const pbClass = latest ? classifyAgainstPersonalBest(protocol, officials.slice(0, -1).map(o => o.result), latest.result) : { status: "none" };
          const change = (a, c) => (isOfficial(a) && isOfficial(c)) ? matchedImprovement(protocol, { x: a }, { x: c }) : null;
          const vsPrev = prev && latest ? change(prev.result, latest.result) : null;
          const vsFirst = first && latest && first !== latest ? change(first.result, latest.result) : null;
          return (
            <div key={b.benchmark.id + vid} className="card">
              <div style={{ fontWeight: 800 }}>{b.benchmark.title}</div>
              {!latest && <div style={{ fontSize: 13, color: "var(--td)", marginTop: 4 }}>Pending — no complete finalized result yet.</div>}
              {latest && <>
                <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>{fmtResult(protocol, latest.result)} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--td)" }}>· {latest.date}</span></div>
                <div style={{ fontSize: 12, color: "var(--td)", marginTop: 2 }}>
                  {officials.length === 1 ? "First measurement" : (vsPrev ? "vs previous: " + fmtChange(vsPrev) : "")}
                  {vsFirst ? "  ·  since first: " + fmtChange(vsFirst) : ""}
                </div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {pbClass.status === "new" && <span className="bdg bs">New personal best</span>}
                  {pbClass.status === "matched" && <span className="bdg bs">Matched personal best</span>}
                  {pbClass.status === "first" && <span className="bdg bs">First measurement</span>}
                  {pb && pbClass.status === "below" && <span style={{ color: "var(--td)" }}>PB {fmtResult(protocol, pb)}</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--td)", marginTop: 6 }}>{officials.length} finalized observation{officials.length === 1 ? "" : "s"}</div>
              </>}
            </div>
          );
        });
      })}
    </div>
  );
}
