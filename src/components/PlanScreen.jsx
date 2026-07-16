import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import GoalsScreen from "./GoalsScreen.jsx";

// Plan tab (nav restructure round 2, 2026-07-15). Folds two things into one
// tab: "Build" (team-scoped drill/template access -- this tab's original,
// never-built scope: templates/drills filtered to the team's sport, the
// team's default template promoted) and "Goals & Insights" (the target vs.
// planned vs. actual report + History, previously its own top-level tab).
// Both are fundamentally "how this team spends its practice time," which is
// why they were merged rather than kept as separate tabs.
function BuildTab({ data, team, goToBuilder }) {
  const teamSport = team.sport || "General";
  const templates = (data.templates || []).filter(t => (t.sport || "General") === teamSport);
  const defaultTpl = templates.find(t => t.defaultTeamId === team.id);
  const otherTpls = templates.filter(t => t.id !== (defaultTpl && defaultTpl.id));
  const drills = (data.activityLibrary || []).filter(a => (a.sport || "General") === teamSport || (a.sport || "General") === "General");

  return (<div>
    <button className="btn primary bmd bfull" style={{ marginBottom: 14 }} onClick={() => goToBuilder(null, null, team.id)}>+ Build a Practice</button>

    {defaultTpl && <div className="card mb10" style={{ borderColor: "var(--gb)", background: "var(--gbg)" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--green)", marginBottom: 4 }}>Default Template</div>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 18, fontWeight: 900, marginBottom: 8 }}>{defaultTpl.name}</div>
      <button className="btn primary bsm bfull" onClick={() => goToBuilder(null, defaultTpl.id, team.id)}>Start from Template</button>
    </div>}

    {otherTpls.length > 0 && <div className="mb10">
      <div className="clbl mb8">{teamSport} Templates</div>
      {otherTpls.map(t => (<div key={t.id} className="li tap" style={{ marginBottom: 6 }} onClick={() => goToBuilder(null, t.id, team.id)}>
        <div className="lim"><div className="lin">{t.name}</div><div className="limt">{(t.activities || []).length} activities · {t.durMin || 0}min</div></div>
        <span style={{ color: "var(--green)", fontSize: 18 }}>&#8250;</span>
      </div>))}
    </div>}
    {templates.length === 0 && <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 12 }}>No {teamSport} templates yet -- save one from Builder, or browse Library.</div>}

    <div className="clbl mb8">{teamSport} Drills</div>
    {drills.length === 0 && <div style={{ fontSize: 13, color: "var(--td)" }}>No drills for {teamSport} yet -- add some from Library.</div>}
    {drills.slice(0, 12).map(d => (<div key={d.id} className="li" style={{ marginBottom: 6 }}>
      <div className="lim"><div className="lin">{d.name}</div><div className="limt">{d.duration}min{d.description ? " · " + d.description : ""}</div></div>
      <span className="bdg bp">{d.duration}m</span>
    </div>))}
    {drills.length > 12 && <div style={{ fontSize: 12, color: "var(--td)", textAlign: "center", marginTop: 4 }}>+{drills.length - 12} more in Library</div>}
  </div>);
}

export default function PlanScreen({ data, teamId, coachId, goToBuilder }) {
  const team = data.teams.find(t => t.id === teamId);
  // ?tab=goals lets Home's "Last Practice" recap card (goToTeamGoals) land
  // directly on the Goals & Insights sub-tab instead of the Build default.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") === "goals" ? "goals" : "build");
  if (!team) return null;
  return (<div style={{ paddingBottom: 80 }}>
    <div style={{ padding: "20px 16px 12px" }}>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 28, fontWeight: 900 }}>Plan</div>
    </div>
    <div style={{ padding: "0 16px 12px" }}>
      <div style={{ display: "flex", gap: 0, background: "var(--s2)", borderRadius: "var(--r)", padding: 3 }}>
        {[{ k: "build", label: "Build" }, { k: "goals", label: "Goals & Insights" }].map(t => (<button key={t.k} onClick={() => setTab(t.k)} style={{ flex: 1, padding: "7px 0", border: "none", cursor: "pointer", borderRadius: "calc(var(--r) - 2px)", background: tab === t.k ? "#fff" : "transparent", fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: tab === t.k ? "var(--black)" : "var(--td)" }}>{t.label}</button>))}
      </div>
    </div>
    <div style={{ padding: "0 16px" }}>
      {tab === "build" && <BuildTab data={data} team={team} goToBuilder={goToBuilder} />}
      {tab === "goals" && <GoalsScreen data={data} teamId={teamId} coachId={coachId} />}
    </div>
  </div>);
}
