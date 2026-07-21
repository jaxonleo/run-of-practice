import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOrgSentInvites, orgInviteCoach, orgCreateTeam, fetchOrgWeeklyPracticeRollup } from "../supabase.js";

// Org Experience handoff Sec 4: lead content in order is (1) pending
// invites & member-management shortcuts, (2) team roster/overview grid,
// (3) org-wide weekly-practices-run rollup. Org-library activity feed is
// explicitly deferred per the handoff, not built here.
export default function OrgHomeScreen({ data, orgId, goToTeam, coachId, refreshTeams }) {
  const navigate = useNavigate();
  const org = (data.myOrgs || []).find(o => o.id === orgId);
  const orgTeams = (data.teams || []).filter(t => t.organizationId === orgId);

  const [sentInvites, setSentInvites] = useState([]);
  const [rollup, setRollup] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);

  const refreshInvites = () => { if (orgId) fetchOrgSentInvites(orgId).then(setSentInvites); };
  useEffect(() => { refreshInvites(); }, [orgId]);
  useEffect(() => { if (orgId) fetchOrgWeeklyPracticeRollup(orgId, 8).then(setRollup); }, [orgId]);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    await orgInviteCoach(orgId, inviteEmail.trim());
    setInviteEmail("");
    setInviting(false);
    setShowInvite(false);
    refreshInvites();
  };

  const createTeam = async () => {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    const { data: teamId } = await orgCreateTeam(orgId, { name: newTeamName.trim(), sport: "General" });
    // The app-wide teams list (data.teams) has to be refreshed before
    // navigating there, or Layout's team-workspace tab bar, the Teams tab,
    // and this very screen's own team grid all silently fail to find the
    // just-created team (they all read data.teams, which nothing else here
    // touches) -- same convention every other team-mutating action in the
    // app already follows (see ModalLayer.jsx's addTeam/editTeam handlers).
    if (teamId && refreshTeams) await refreshTeams();
    setNewTeamName("");
    setCreatingTeam(false);
    setShowCreateTeam(false);
    if (teamId) goToTeam(teamId);
  };

  if (!org) return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}>
    <div style={{ padding: "12px 14px 0" }}><button className="btn ghost bxs" onClick={() => navigate(-1)}>&#8249; Back</button></div>
    <div className="empty"><div className="emtx">You're not part of this organization.</div></div>
  </div>);

  const maxRun = Math.max(1, ...rollup.map(w => w.live_practices || 0));

  return (<div style={{ padding: "0 0 calc(var(--tab) + 20px)" }}>
    <div style={{ padding: "12px 14px 0" }}><button className="btn ghost bxs" onClick={() => navigate(-1)}>&#8249; Back</button></div>
    <div style={{ padding: "12px 16px 12px" }}>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 28, fontWeight: 900 }}>{org.name}</div>
      <div style={{ fontSize: 12, color: "var(--td)" }}>{org.role === "director" ? "Director" : org.role}</div>
    </div>

    {/* 1. Pending invites & member-management shortcuts */}
    <div style={{ padding: "0 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div className="clbl">Coaches</div>
        <button className="btn ghost bxs" onClick={() => setShowInvite(s => !s)}>{showInvite ? "Cancel" : "+ Invite Coach"}</button>
      </div>
      {showInvite && <div className="card" style={{ padding: 12, marginBottom: 8, display: "flex", gap: 6 }}>
        <input className="inp" style={{ flex: 1 }} placeholder="coach@email.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
        <button className="btn primary bxs" disabled={inviting} onClick={sendInvite}>{inviting ? "Sending..." : "Send"}</button>
      </div>}
      {sentInvites.length === 0 && <div style={{ fontSize: 13, color: "var(--td)" }}>No pending invites.</div>}
      {sentInvites.map(inv => (<div key={inv.id} className="li" style={{ marginBottom: 6 }}>
        <div className="lim"><div className="lin">{inv.email}</div><div className="limt">Invited, awaiting response</div></div>
      </div>))}
    </div>

    {/* 2. Team roster/overview grid */}
    <div style={{ padding: "0 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div className="clbl">Teams</div>
        <button className="btn ghost bxs" onClick={() => setShowCreateTeam(s => !s)}>{showCreateTeam ? "Cancel" : "+ Team"}</button>
      </div>
      {showCreateTeam && <div className="card" style={{ padding: 12, marginBottom: 8, display: "flex", gap: 6 }}>
        <input className="inp" style={{ flex: 1 }} placeholder="Team name" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} />
        <button className="btn primary bxs" disabled={creatingTeam} onClick={createTeam}>{creatingTeam ? "Creating..." : "Create"}</button>
      </div>}
      {orgTeams.length === 0 && <div style={{ fontSize: 13, color: "var(--td)" }}>No teams in this org yet.</div>}
      {orgTeams.map(t => (<div key={t.id} className="li tap" style={{ marginBottom: 8, borderLeft: "4px solid " + (t.colorPrimary || "transparent") }} onClick={() => goToTeam(t.id)}>
        <div className="lim">
          <div className="lin">{t.name}</div>
          <div className="limt">{t.sport} · {t.players.length} player{t.players.length === 1 ? "" : "s"} · {t.coaches.length} staff</div>
        </div>
        <span style={{ color: "var(--green)", fontSize: 22 }}>&#8250;</span>
      </div>))}
    </div>

    {/* 3. Org-wide weekly live-practices-run rollup */}
    <div style={{ padding: "0 16px" }}>
      <div className="clbl" style={{ marginBottom: 8 }}>Weekly Live Practices</div>
      <div className="card" style={{ padding: 12 }}>
        {rollup.length === 0 && <div style={{ fontSize: 13, color: "var(--td)" }}>No live practices run yet.</div>}
        {rollup.length > 0 && <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60 }}>
          {rollup.map(w => (<div key={w.wk} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            <div style={{ width: "100%", background: "var(--green)", borderRadius: 3, height: Math.max(2, (w.live_practices / maxRun) * 52) }} />
            <div style={{ fontSize: 9, color: "var(--td)", marginTop: 2 }}>{w.live_practices}</div>
          </div>))}
        </div>}
      </div>
    </div>
  </div>);
}
