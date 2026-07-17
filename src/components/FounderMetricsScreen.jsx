import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer, ComposedChart, LineChart, BarChart, Bar, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { fetchFounderMetricsSummary, fetchFounderMetricsDetail } from "../supabase.js";

const RANGES = [4, 12, 26];
const REDUCE_MOTION = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ANIM = REDUCE_MOTION ? false : true;

function useFounderMetrics(weeks) {
  const [summary, setSummary] = useState(null);
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setDetail(null);
    fetchFounderMetricsSummary(weeks).then(d => { if (!cancelled) setSummary(d); });
    fetchFounderMetricsDetail(weeks).then(d => { if (!cancelled) setDetail(d); });
    return () => { cancelled = true; };
  }, [weeks]);
  return { summary, detail };
}

const fmtWeek = wk => new Date(wk).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const pct = n => n === null || n === undefined ? "—" : Math.round(n * 100) + "%";

// Empty-state deltas (handoff §5 visual spec): plain-language caption, no
// fabricated percentages when the previous week's count is tiny/zero.
function heroDelta(current, previous) {
  if (previous === 0 && current > 0) return { text: "first one 🎉", dir: "up" };
  if (previous === 0 && current === 0) return { text: "No activity yet", dir: null };
  const diff = current - previous;
  if (diff === 0) return { text: "Same as last week", dir: null };
  return { text: Math.abs(diff) + (diff > 0 ? " more" : " fewer") + " than last week", dir: diff > 0 ? "up" : "down" };
}

function Subtitle({ children }) {
  return <div style={{ fontSize: 11, color: "var(--td)", marginTop: 2, marginBottom: 10, lineHeight: 1.4 }}>{children}</div>;
}
function SectionTitle({ children }) {
  return <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontWeight: 700, fontSize: 15, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--black2)" }}>{children}</div>;
}
function Card({ children, style }) {
  return <div style={{ background: "var(--s1)", border: "1px solid var(--b)", borderRadius: "var(--r)", padding: 14, ...style }}>{children}</div>;
}

function HeroCard({ label, value, delta, isNorthStar }) {
  const dirColor = delta && delta.dir === "up" ? "var(--green)" : delta && delta.dir === "down" ? "var(--red)" : "var(--td)";
  const arrow = delta && delta.dir === "up" ? "▲" : delta && delta.dir === "down" ? "▼" : "";
  return (
    <Card style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--tm)" }}>{label}</div>
      <div style={{ fontFamily: "DM Mono,monospace", fontSize: 26, fontWeight: 500, color: isNorthStar ? "var(--amber)" : "var(--black)", marginTop: 4 }}>{value}</div>
      {delta && <div style={{ fontSize: 11, color: dirColor, marginTop: 3 }}>{arrow} {delta.text}</div>}
    </Card>
  );
}

function ChartCard({ title, subtitle, children, height = 180 }) {
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <Subtitle>{subtitle}</Subtitle>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </Card>
  );
}

function RetentionGrid({ retention, cohortSizes }) {
  if (!retention || !retention.length) return <div style={{ fontSize: 12, color: "var(--td)" }}>Not enough cohort data yet.</div>;
  const sizeByWk = {};
  (cohortSizes || []).forEach(c => { sizeByWk[c.cohort_wk] = c.signups; });
  const cellByKey = {};
  retention.forEach(r => { cellByKey[r.cohort_wk + "|" + r.wk_offset] = r.active_users; });
  const cohortWks = Array.from(new Set(retention.map(r => r.cohort_wk))).sort();
  const nowWk = new Date();
  nowWk.setUTCHours(0, 0, 0, 0);
  const day = nowWk.getUTCDay();
  nowWk.setUTCDate(nowWk.getUTCDate() - ((day + 6) % 7));
  const offsets = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "4px 6px", color: "var(--tm)", fontWeight: 700 }}>Cohort</th>
            {offsets.map(o => <th key={o} style={{ padding: "4px 6px", color: "var(--tm)", fontWeight: 700 }}>W{o}</th>)}
          </tr>
        </thead>
        <tbody>
          {cohortWks.map(wk => {
            const size = sizeByWk[wk] || 0;
            const weeksElapsed = Math.floor((nowWk - new Date(wk)) / 604800000);
            return (
              <tr key={wk}>
                <td style={{ padding: "4px 6px", whiteSpace: "nowrap", fontWeight: 600 }}>{fmtWeek(wk)}</td>
                {offsets.map(o => {
                  if (o > weeksElapsed) return <td key={o} style={{ padding: "4px 6px", textAlign: "center", color: "var(--td)" }}>–</td>;
                  const active = cellByKey[wk + "|" + o] || 0;
                  const rate = size > 0 ? active / size : 0;
                  return (
                    <td key={o} style={{ padding: "4px 6px", textAlign: "center", background: "rgba(45,106,79," + (0.08 + rate * 0.55) + ")" }}>
                      {Math.round(rate * 100)}%
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function FounderMetricsScreen() {
  const [weeks, setWeeks] = useState(12);
  const { summary, detail } = useFounderMetrics(weeks);

  const weekly = summary && summary.weekly || null;
  const lastWk = weekly && weekly.length ? weekly[weekly.length - 1] : null;
  const prevWk = weekly && weekly.length > 1 ? weekly[weekly.length - 2] : null;

  const funnel = detail && detail.activation_funnel || [];
  const latestFunnel = funnel.slice(-4);
  const funnelRows = ["signups", "made_team", "made_plan", "ran_live"].map((key, i) => {
    const row = { step: ["Signups", "Made a team", "Built a plan", "Ran live"][i] };
    latestFunnel.forEach((c, idx) => { row["c" + idx] = c[key]; });
    return row;
  });

  return (
    <div style={{ height: "100dvh", overflowY: "auto", maxWidth: 480, margin: "0 auto", padding: "16px 14px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontWeight: 900, fontSize: 22, color: "var(--black)" }}>Founder Metrics</div>
        <div style={{ display: "flex", gap: 4 }}>
          {RANGES.map(r => (
            <button key={r} onClick={() => setWeeks(r)}
              style={{
                border: "1px solid var(--b)", borderRadius: "var(--rs)", padding: "5px 9px", fontSize: 11, fontWeight: 700,
                background: weeks === r ? "var(--green)" : "var(--s1)", color: weeks === r ? "#fff" : "var(--tm)", cursor: "pointer",
              }}>{r}w</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--td)", marginTop: -8 }}>
        Self-instrumented from in-app events. Directional, not exact — treat trends over absolute counts as the managed quantity.
      </div>

      {!summary && <div style={{ padding: "40px 0", textAlign: "center", color: "var(--td)" }}>Loading...</div>}

      {summary && (<>
        <div style={{ display: "flex", gap: 10 }}>
          <HeroCard label="Live practices this week" value={lastWk ? lastWk.live_practices : 0}
            delta={lastWk && prevWk ? heroDelta(lastWk.live_practices, prevWk.live_practices) : null} isNorthStar />
          <HeroCard label="Repeat coach rate" value={pct(summary.repeat_coach && summary.repeat_coach.repeat_rate)} />
          <HeroCard label="Helpers / practice (4w)" value={summary.helpers_per_practice_trailing4 != null ? summary.helpers_per_practice_trailing4 : "—"} />
        </div>

        <ChartCard title="Live practices run" subtitle="The north star. If this isn't climbing, nothing else here matters yet." height={190}>
          <ComposedChart data={weekly}>
            <CartesianGrid stroke="var(--b)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="wk" tickFormatter={fmtWeek} tick={{ fontSize: 10, fill: "var(--tm)" }} axisLine={{ stroke: "var(--b)" }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--tm)" }} axisLine={false} tickLine={false} width={26} allowDecimals={false} />
            <Tooltip labelFormatter={fmtWeek} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            <Area type="monotone" dataKey="live_practices" stroke="var(--amber)" fill="var(--ambg)" fillOpacity={0.7} isAnimationActive={ANIM} />
            <Line type="monotone" dataKey="weekly_active_coaches" stroke="var(--tm)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" isAnimationActive={ANIM} />
          </ComposedChart>
        </ChartCard>

        <ChartCard title="Plan → run conversion (4w)" subtitle="Falling toward 0 means ROP is a planning tool, not an execution tool." height={90}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, height: "100%" }}>
            <div style={{ fontFamily: "DM Mono,monospace", fontSize: 28, color: "var(--green)" }}>
              {summary.plan_to_run_trailing4 ? pct(summary.plan_to_run_trailing4.rate) : "—"}
            </div>
            <div style={{ fontSize: 11, color: "var(--td)" }}>
              {summary.plan_to_run_trailing4 ? summary.plan_to_run_trailing4.ran_count + " of " + summary.plan_to_run_trailing4.planned_count + " planned practices ran live" : "No planned practices yet"}
            </div>
          </div>
        </ChartCard>
      </>)}

      {!detail && summary && <div style={{ padding: "20px 0", textAlign: "center", color: "var(--td)", fontSize: 12 }}>Loading funnel &amp; retention…</div>}

      {detail && (<>
        <ChartCard title="Activation funnel" subtitle="Signup → team → plan → live run, 14-day window per step, latest cohorts." height={200}>
          <BarChart data={funnelRows} layout="vertical" margin={{ left: 0 }}>
            <CartesianGrid stroke="var(--b)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: "var(--tm)" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="step" tick={{ fontSize: 11, fill: "var(--black2)" }} axisLine={false} tickLine={false} width={90} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            {latestFunnel.map((c, idx) => (
              <Bar key={idx} dataKey={"c" + idx} name={fmtWeek(c.cohort_wk)} fill={idx === latestFunnel.length - 1 ? "var(--green)" : "var(--gb)"} isAnimationActive={ANIM} />
            ))}
          </BarChart>
        </ChartCard>

        <Card>
          <SectionTitle>Retention cohorts</SectionTitle>
          <Subtitle>% of each signup week still active (planned or ran live) N weeks later.</Subtitle>
          <RetentionGrid retention={detail.retention} cohortSizes={detail.cohort_sizes} />
        </Card>

        <ChartCard title="Library reuse rate" subtitle="Rising means the compounding-value story — reusing past drills, not rebuilding from scratch — is real." height={160}>
          <LineChart data={detail.library_reuse}>
            <CartesianGrid stroke="var(--b)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="wk" tickFormatter={fmtWeek} tick={{ fontSize: 10, fill: "var(--tm)" }} axisLine={{ stroke: "var(--b)" }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--tm)" }} axisLine={false} tickLine={false} width={32} tickFormatter={v => Math.round(v * 100) + "%"} />
            <Tooltip labelFormatter={fmtWeek} formatter={v => pct(v)} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            <Line type="monotone" dataKey="reuse_rate" stroke="var(--green)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={ANIM} />
          </LineChart>
        </ChartCard>

        <Card>
          <SectionTitle>Goals adoption</SectionTitle>
          <Subtitle>% of active teams (practice built in the last 4 weeks) with a goal set.</Subtitle>
          <div style={{ fontFamily: "DM Mono,monospace", fontSize: 24, color: "var(--green)" }}>
            {detail.goals_adoption ? pct(detail.goals_adoption.adoption_rate) : "—"}
          </div>
          <div style={{ fontSize: 11, color: "var(--td)" }}>
            {detail.goals_adoption ? "of " + detail.goals_adoption.active_team_count + " active teams" : ""}
          </div>
        </Card>

        <ChartCard title="Weekly signups" subtitle="Growth, below the fold on purpose — validation metrics matter more right now." height={150}>
          <BarChart data={weekly || []}>
            <CartesianGrid stroke="var(--b)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="wk" tickFormatter={fmtWeek} tick={{ fontSize: 10, fill: "var(--tm)" }} axisLine={{ stroke: "var(--b)" }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--tm)" }} axisLine={false} tickLine={false} width={26} allowDecimals={false} />
            <Tooltip labelFormatter={fmtWeek} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
            <Bar dataKey="signups" fill="var(--green2)" radius={[3, 3, 0, 0]} isAnimationActive={ANIM} />
          </BarChart>
        </ChartCard>
      </>)}
    </div>
  );
}
