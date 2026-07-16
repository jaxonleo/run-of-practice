import React from "react";
import { Outlet, useNavigate, useParams, useLocation } from "react-router-dom";
import { Ic } from "./icons.jsx";

// App shell shared by every authenticated route (ROP-Goals-TeamNav-Handoff.md
// §4.1-4.2). Context-sensitive tab bar: outside a team it's Home/Library;
// inside /team/:teamId/* it's the four workspace tabs plus a back-to-home
// affordance. Lifted the live-resume bar here (was App.jsx-only before) so
// it renders across every route, not just the four that used to check
// view!=="command" directly.
// Teams added as its own global tab per direct user feedback (2026-07-15):
// the only way in used to be a pill-styled row on Home, which read as a
// filter control (tap to toggle something in place) rather than a nav
// action (tap to leave the page) -- and Library had no path in at all
// without detouring through Home first.
const GLOBAL_TABS = [
  { id: "home", label: "Home", path: "/", I: Ic.Home },
  { id: "teams", label: "Teams", path: "/teams", I: Ic.Teams },
  { id: "library", label: "Library", path: "/library", I: Ic.Lib },
];

export default function Layout({ data, liveId, goToRun }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { teamId } = useParams();
  const inTeam = !!teamId;
  const hideTabBar = location.pathname.startsWith("/run/");

  const team = inTeam ? (data.teams || []).find(t => t.id === teamId) : null;
  const teamTabs = inTeam ? [
    { id: "schedule", label: "Schedule", path: `/team/${teamId}/schedule`, I: Ic.Cal },
    { id: "plan", label: "Plan", path: `/team/${teamId}/plan`, I: Ic.Plan },
    { id: "goals", label: "Goals", path: `/team/${teamId}/goals`, I: Ic.Goals },
    { id: "team", label: "Team", path: `/team/${teamId}/team`, I: Ic.Admin },
  ] : [];

  const livePractice = liveId ? (data.practices || []).find(p => p.id === liveId) : null;
  const liveTeam = livePractice ? (data.teams || []).find(t => t.id === livePractice.teamId) : null;

  return (<div style={{ display: "contents" }}>
    <div className="app">
      {inTeam && team && <div style={{ height: 4, background: team.colorPrimary || "var(--green)", flexShrink: 0 }} />}
      {inTeam && team && <div style={{ padding: "10px 14px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <button className="btn ghost bxs" onClick={() => navigate("/")}>&#8249; My Week</button>
        <span style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 15, fontWeight: 700 }}>{team.name}</span>
      </div>}
      <div className="screen">
        <Outlet/>
      </div>
      {!hideTabBar && <nav className="tabbar">
        {(inTeam ? teamTabs : GLOBAL_TABS).map(({ id, label, path, I }) => {
          const active = inTeam ? location.pathname.startsWith(path) : (path === "/" ? location.pathname === "/" : location.pathname.startsWith(path));
          return (<button key={id} className={"ti " + (active ? "on" : "")} onClick={() => navigate(path)}>
            <I/>{label}
          </button>);
        })}
      </nav>}
      {liveId && !hideTabBar && <button className="live-resume" onClick={() => goToRun(liveId)}>
        <span className="live"/>Resume Live Practice{liveTeam ? " · " + liveTeam.name : ""}
      </button>}
    </div>
  </div>);
}
