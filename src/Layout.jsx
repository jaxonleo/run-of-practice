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

// Flattened team-workspace nav (2026-07-2x): replaces the old nested
// Schedule/Plan/Team bottom-tab set (Plan hiding a Build/Goals toggle, Team
// hiding a Roster/Equipment toggle) with 5 direct routes in one horizontal,
// side-scrolling top row, so nothing is two taps deep anymore. The bottom
// bar itself no longer switches contents inside a team -- it's always
// GLOBAL_TABS, addressing the "no common bottom menu" complaint directly.
const teamWorkspaceTabs = teamId => [
  { id: "schedule", label: "Schedule", path: `/team/${teamId}/schedule` },
  { id: "roster", label: "Roster", path: `/team/${teamId}/roster` },
  { id: "equipment", label: "Equipment", path: `/team/${teamId}/equipment` },
  { id: "goals", label: "Goals & Insights", path: `/team/${teamId}/goals` },
  { id: "build", label: "Build", path: `/team/${teamId}/build` },
];

export default function Layout({ data, liveId, goToRun }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { teamId } = useParams();
  const inTeam = !!teamId;
  const hideTabBar = location.pathname.startsWith("/run/");

  const team = inTeam ? (data.teams || []).find(t => t.id === teamId) : null;
  const workspaceTabs = inTeam ? teamWorkspaceTabs(teamId) : [];

  const livePractice = liveId ? (data.practices || []).find(p => p.id === liveId) : null;
  const liveTeam = livePractice ? (data.teams || []).find(t => t.id === livePractice.teamId) : null;

  return (<div style={{ display: "contents" }}>
    <div className="app">
      {inTeam && team && <div style={{ height: 4, background: team.colorPrimary || "var(--green)", flexShrink: 0 }} />}
      {/* Back-button audit (2026-07-15): was "My Week" -> Home. Changed to
          Teams since that's the canonical "leave a team" destination
          elsewhere too (ManageScreen's own back control used to duplicate
          this exact link -- removed there, this is now the only one). */}
      {inTeam && team && <div style={{ padding: "10px 14px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <button className="btn ghost bxs" onClick={() => navigate("/teams")}>&#8249; Teams</button>
        <span style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 15, fontWeight: 700 }}>{team.name}</span>
      </div>}
      {inTeam && team && <div style={{ display: "flex", gap: 18, overflowX: "auto", padding: "10px 14px 0", flexShrink: 0 }}>
        {workspaceTabs.map(({ id, label, path }) => {
          const active = location.pathname.startsWith(path);
          return (<button key={id} onClick={() => navigate(path)} style={{ flexShrink: 0, whiteSpace: "nowrap", padding: "0 0 8px", border: "none", background: "none", cursor: "pointer", fontFamily: "Barlow Condensed,sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: ".02em", color: active ? "var(--green)" : "var(--td)", borderBottom: "2px solid " + (active ? "var(--green)" : "transparent") }}>
            {label}
          </button>);
        })}
      </div>}
      <div className="screen">
        <Outlet/>
      </div>
      {!hideTabBar && <nav className="tabbar">
        {GLOBAL_TABS.map(({ id, label, path, I }) => {
          const active = path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);
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
