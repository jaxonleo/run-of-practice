import React, { useState, useEffect } from "react";
import { fetchOrgMembers, fetchOrgSentInvites, orgInviteCoach, cancelOrgInvite, updateOrganization } from "../supabase.js";

// Organization management (Teams tab, Org mode only) -- per direct feedback,
// Home isn't the right long-term place for org-member management as
// membership grows. Lives here instead: edit the org itself (name/sport),
// see when it joined ROP, see current directors, add a new one, and cancel
// a pending invite that's stuck (e.g. the notification email never
// arrived -- there's no org-invite email yet, a known separate gap).
// Team management (the classic head/assistant/helper/player roster) stays
// exactly where it already was -- inside each team's own Roster tab, one
// tap below this list.
function OrganizationSection({ org, refreshLibrary }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(org.name);
  const [sport, setSport] = useState(org.sport || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setName(org.name); setSport(org.sport || ""); }, [org.id, org.name, org.sport]);

  const [members, setMembers] = useState([]);
  const [sentInvites, setSentInvites] = useState([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberEmail, setAddMemberEmail] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const refresh = () => {
    fetchOrgMembers(org.id).then(setMembers);
    fetchOrgSentInvites(org.id).then(setSentInvites);
  };
  useEffect(refresh, [org.id]);

  const saveOrgDetails = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await updateOrganization(org.id, { name: name.trim(), sport: sport.trim() });
    setSaving(false);
    setEditing(false);
    if (refreshLibrary) await refreshLibrary();
  };
  const submitAddMember = async () => {
    if (!addMemberEmail.trim()) return;
    setAddingMember(true);
    await orgInviteCoach(org.id, addMemberEmail.trim());
    setAddMemberEmail("");
    setAddingMember(false);
    setShowAddMember(false);
    refresh();
  };
  const doCancelInvite = async id => { await cancelOrgInvite(id); refresh(); };
  const memberSince = org.createdAt ? new Date(org.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : null;

  return (<div style={{ padding: "0 16px 20px" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
      <div className="clbl">Organization</div>
      <button className="btn ghost bxs" onClick={() => setEditing(e => !e)}>{editing ? "Cancel" : "Edit"}</button>
    </div>
    <div className="card" style={{ marginBottom: 12 }}>
      {editing ? (<div>
        <div className="fld" style={{ marginBottom: 8 }}><label className="lbl">Organization Name</label><input className="inp" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="fld" style={{ marginBottom: 8 }}><label className="lbl">Sport</label><input className="inp" placeholder="e.g. Baseball" value={sport} onChange={e => setSport(e.target.value)} /></div>
        <button className="btn primary bxs" disabled={saving || !name.trim()} onClick={saveOrgDetails}>{saving ? "Saving..." : "Save"}</button>
      </div>) : (<div>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 18, fontWeight: 900 }}>{org.name}</div>
        {org.sport && <div style={{ fontSize: 13, color: "var(--td)", marginTop: 2 }}>{org.sport}</div>}
        {memberSince && <div style={{ fontSize: 12, color: "var(--td)", marginTop: 4 }}>Member since {memberSince}</div>}
      </div>)}
    </div>

    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
      <div className="clbl">Org Members</div>
      <button className="btn ghost bxs" onClick={() => setShowAddMember(s => !s)}>{showAddMember ? "Cancel" : "+ Add Org Member"}</button>
    </div>
    {showAddMember && <div className="card" style={{ padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <input className="inp" style={{ flex: 1 }} placeholder="coach@email.com" value={addMemberEmail} onChange={e => setAddMemberEmail(e.target.value)} />
        <button className="btn primary bxs" disabled={addingMember} onClick={submitAddMember}>{addingMember ? "Adding..." : "Add"}</button>
      </div>
      {/* v1 has one org role (director) -- accepting makes them a co-director
          of the whole org, same standing as whoever added them, not a
          scoped "coach" role. Worth being upfront about here. */}
      <div style={{ fontSize: 11, color: "var(--td)" }}>They'll become a director of {org.name} once accepted -- able to create teams and add other members, same as you.</div>
    </div>}
    {members.map(m => (<div key={m.id} className="li" style={{ marginBottom: 6 }}>
      <div className="lim"><div className="lin">{m.name}</div><div className="limt">Director</div></div>
    </div>))}
    {sentInvites.map(inv => (<div key={inv.id} className="li tap" style={{ marginBottom: 6 }} onClick={() => doCancelInvite(inv.id)}>
      <div className="lim"><div className="lin">{inv.email}</div><div className="limt">Invited, awaiting response · tap to cancel</div></div>
    </div>))}
  </div>);
}

// Dedicated "Teams" tab (added 2026-07-15 per direct feedback): a plain
// navigable list, not the pill/chip styling Home used to use for the same
// job -- pills read as an in-place filter control, not "tap to leave this
// page," which is exactly what tapping one of these rows does. Reachable
// from anywhere (Library included), not just from Home.
// openModal("addTeam") lives here now -- the old Manage screen's "My Teams"
// list carried the only + Team button, and that list is gone (2026-07-15
// settings restructure), so this became team creation's one entry point.
export default function TeamsListScreen({ data, goToTeam, openModal, mode, refreshLibrary }) {
  const teams = data.teams || [];
  const isOrgMode = mode && mode.type === "org";
  const activeOrg = isOrgMode ? (data.myOrgs || []).find(o => o.id === mode.orgId) : null;
  // Org mode's +Team opens the same addTeam modal, just with organizationId
  // in the payload -- that's what tells ModalLayer.save() to call
  // orgCreateTeam instead of createTeam (see ModalLayer.jsx).
  const addTeamPayload = isOrgMode ? { organizationId: mode.orgId } : undefined;
  return (<div style={{ paddingBottom: 80 }}>
    <div style={{ padding: "20px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 28, fontWeight: 900 }}>{isOrgMode ? "Org Teams" : "Teams"}</div>
      <button className="btn primary bsm" onClick={() => openModal("addTeam", addTeamPayload)}>+ Team</button>
    </div>
    {isOrgMode && activeOrg && <OrganizationSection org={activeOrg} refreshLibrary={refreshLibrary} />}
    <div style={{ padding: "0 16px" }}>
      {teams.length === 0 && <div className="empty"><div className="emtx">{isOrgMode ? "No teams in this org yet. Tap + Team to get started." : "No teams yet. Tap + Team to get started."}</div></div>}
      {teams.map(t => (<div key={t.id} className="li tap" style={{ marginBottom: 8, borderLeft: "4px solid " + (t.colorPrimary || "transparent") }} onClick={() => goToTeam(t.id)}>
        <div className="lim">
          <div className="lin">{t.name}</div>
          <div className="limt">{t.sport} · {t.players.length} player{t.players.length === 1 ? "" : "s"}</div>
        </div>
        <span style={{ color: "var(--green)", fontSize: 22 }}>&#8250;</span>
      </div>))}
    </div>
  </div>);
}
