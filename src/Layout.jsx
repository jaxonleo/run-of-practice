import React, { useState } from "react";
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
// Equipment is Coach-mode only (Phase 2 org rework): in Org mode a club's
// equipment is managed centrally from Club Library's own Equipment tab, not
// per-team -- a per-team tab here would just be a second, narrower place to
// edit the same org-owned rows. Builder's picker already surfaces the right
// equipment for a given team/location regardless of mode (see
// ownedOrOrgAtLoc in ActivityConfigs.jsx), so nothing is lost by dropping it.
const teamWorkspaceTabs = (teamId, isOrgMode) => [
  { id: "schedule", label: "Schedule", path: `/team/${teamId}/schedule` },
  { id: "roster", label: "Roster", path: `/team/${teamId}/roster` },
  ...(isOrgMode ? [] : [{ id: "equipment", label: "Equipment", path: `/team/${teamId}/equipment` }]),
  { id: "goals", label: "Goals & Insights", path: `/team/${teamId}/goals` },
];

export default function Layout({ data, liveId, goToRun, mode, openModal, subViewBack }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { teamId } = useParams();
  const inTeam = !!teamId;
  const hideTabBar = location.pathname.startsWith("/run/");
  const isOrgMode = mode && mode.type === "org";
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);

  const team = inTeam ? (data.teams || []).find(t => t.id === teamId) : null;
  const workspaceTabs = inTeam ? teamWorkspaceTabs(teamId, isOrgMode) : [];
  // Org color (Jax's ask: "so when they're logged in to their org it looks
  // like their org") -- falls back to the plain .tabbar.org green when the
  // org hasn't picked one. Inline style wins over the CSS class's
  // background for this one property; the class still supplies the
  // active/inactive tab-icon and text-color rules.
  const activeOrg = isOrgMode ? (data.myOrgs || []).find(o => o.id === mode.orgId) : null;
  const orgBarStyle = activeOrg && activeOrg.color ? { background: activeOrg.color, borderTopColor: activeOrg.color } : undefined;

  const livePractice = liveId ? (data.practices || []).find(p => p.id === liveId) : null;
  const liveTeam = livePractice ? (data.teams || []).find(t => t.id === livePractice.teamId) : null;

  return (<div style={{ display: "contents" }}>
    <div className="app">
      {/* Nav restructure round 2: the old "‹ Teams" link back to the team
          list, sitting above every team-scoped screen, duplicated each
          screen's own Back button (PracticeDetail, PlayerProfile, ...) --
          two ways to leave a page that both went to nearly the same place.
          Replaced with a colored identity strip (team name, no back link of
          its own -- the bottom Teams tab already covers "leave the team")
          that also centralizes Edit Team access via its ellipsis, out of
          the per-tab menus that used to duplicate it.
          Round 3: a sub-view drilled into from one of the workspace tabs
          (Practice Detail, History, Session History, Player Profile) used
          to render its own Back button inline, below this bar and the
          workspace tabs row -- easy to miss, and buried under chrome that
          doesn't change when you drill in. Whichever sub-view is active
          registers itself via subViewBack (AppCtx), and its Back button
          renders here instead, on the opposite side from the ellipsis. */}
      {inTeam && team && <div style={{ position: "relative", background: team.colorPrimary || "var(--green)", padding: "14px 46px", textAlign: "center", flexShrink: 0 }} onClick={() => teamMenuOpen && setTeamMenuOpen(false)}>
        {/* subViewBack (a drilled-in sub-view like Practice Detail) takes
            priority when present -- it un-drills one level. Otherwise this
            is the team workspace's own top-level Schedule/Roster/Equipment/
            Goals view, which had no way back to the Teams list at all
            before (deliberately, per the nav-restructure comment above) --
            direct feedback said that wasn't enough on its own. */}
        <button aria-label="Back" onClick={e => { e.stopPropagation(); subViewBack ? subViewBack.onBack() : navigate("/teams"); }} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,.18)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", fontSize: 20, lineHeight: 1 }}>&#8249;</button>
        <span style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, color: "#fff", letterSpacing: ".01em" }}>{team.name}</span>
        <button className="ell-btn" aria-label="Team options" onClick={e => { e.stopPropagation(); setTeamMenuOpen(o => !o); }} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}>
          <span style={{ background: "#fff" }}/><span style={{ background: "#fff" }}/><span style={{ background: "#fff" }}/>
        </button>
        {teamMenuOpen && <div className="mini-menu" onClick={e => e.stopPropagation()} style={{ right: 8, top: 44 }}>
          <button className="mm-item" onClick={() => { setTeamMenuOpen(false); openModal("editTeam", { team }); }}>Edit Team</button>
        </div>}
      </div>}
      {inTeam && team && <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "6px 10px 0", flexShrink: 0 }}>
        {workspaceTabs.map(({ id, label, path }) => {
          const active = location.pathname.startsWith(path);
          // Real gap found live: this button's tap target was exactly
          // text-sized (padding "0 0 8px" -- no top/side padding at all), so
          // the green underline under an active tab read as clickable but
          // the actual hit box around it was as skinny as the label itself.
          // Padding widened on all sides; the row's gap shrank to
          // compensate so five tabs still fit without more horizontal
          // scrolling than before.
          return (<button key={id} onClick={() => navigate(path)} style={{ flexShrink: 0, whiteSpace: "nowrap", padding: "8px 6px", border: "none", background: "none", cursor: "pointer", fontFamily: "Barlow Condensed,sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: ".02em", color: active ? "var(--green)" : "var(--td)", borderBottom: "2px solid " + (active ? "var(--green)" : "transparent") }}>
            {label}
          </button>);
        })}
      </div>}
      <div className="screen">
        <Outlet/>
      </div>
      {!hideTabBar && <nav className={"tabbar" + (isOrgMode ? " org" : "")} style={orgBarStyle}>
        {GLOBAL_TABS.map(({ id, label, path, I }) => {
          // A team workspace (/team/:teamId/*) is reachable straight from
          // Home too, not just the Teams list -- but Teams is still the
          // tab that conceptually owns it (it's where the team list lives,
          // and the new back button above always returns there), so it's
          // the one that should stay lit up rather than leaving all three
          // dark the whole time you're inside a team.
          const active = path === "/" ? location.pathname === "/"
            : id === "teams" ? (location.pathname.startsWith(path) || location.pathname.startsWith("/team/"))
            : location.pathname.startsWith(path);
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
