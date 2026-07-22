import React, { useState, useEffect } from "react";
import { fetchOrgMembers, fetchOrgSentInvites, orgInviteCoach, cancelOrgInvite, updateOrganization, setOrgMemberRole, removeOrgMember, ORG_ROLE_LABELS } from "../supabase.js";
import { SPORTS, TEAM_COLORS } from "../constants.js";

// Org details (Jax's ask): the Teams list itself just shows a tappable
// org card now, no inline Edit/Add-Member buttons -- everything lives one
// tap in, here. Name/sport/color editing, member-since, the member list
// with a real role selector and removal, add-member (with role), and
// cancel-invite. Team management (head/assistant/helper/players) stays
// exactly where it already was -- inside each team's own Roster tab.
function OrgDetailsView({ org, refreshLibrary, onBack, coachId }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(org.name);
  const [sport, setSport] = useState(org.sport || "");
  const [color, setColor] = useState(org.color || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setName(org.name); setSport(org.sport || ""); setColor(org.color || ""); }, [org.id, org.name, org.sport, org.color]);

  const [members, setMembers] = useState([]);
  const [sentInvites, setSentInvites] = useState([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberEmail, setAddMemberEmail] = useState("");
  const [addMemberRole, setAddMemberRole] = useState("director");
  const [addingMember, setAddingMember] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [draftRole, setDraftRole] = useState(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const refresh = () => {
    fetchOrgMembers(org.id).then(setMembers);
    fetchOrgSentInvites(org.id).then(setSentInvites);
  };
  useEffect(refresh, [org.id]);
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

  const saveOrgDetails = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await updateOrganization(org.id, { name: name.trim(), sport: sport || null, color: color || null });
    setSaving(false);
    setEditing(false);
    if (refreshLibrary) await refreshLibrary();
  };
  const submitAddMember = async () => {
    if (!addMemberEmail.trim()) return;
    setAddingMember(true);
    await orgInviteCoach(org.id, addMemberEmail.trim(), null, null, addMemberRole);
    setAddMemberEmail("");
    setAddMemberRole("director");
    setAddingMember(false);
    setShowAddMember(false);
    refresh();
  };
  const doCancelInvite = async id => { await cancelOrgInvite(id); refresh(); };
  const startEditRole = m => { setOpenMenuId(null); setEditingMemberId(m.id); setDraftRole(m.role); };
  const saveRole = async memberId => {
    setBusyMemberId(memberId);
    await setOrgMemberRole(memberId, draftRole);
    await refresh();
    setBusyMemberId(null);
    setEditingMemberId(null);
  };
  const doRemoveMember = async memberId => {
    setBusyMemberId(memberId);
    await removeOrgMember(memberId);
    await refresh();
    setBusyMemberId(null);
    setConfirmRemoveId(null);
  };
  const memberSince = org.createdAt ? new Date(org.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : null;

  return (<div style={{ paddingBottom: 80 }}>
    <div style={{ padding: "12px 14px 0" }}><button className="btn ghost bxs" onClick={onBack}>&#8249; Teams</button></div>
    <div style={{ padding: "12px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 28, fontWeight: 900 }}>Organization</div>
      <button className="btn ghost bxs" onClick={() => setEditing(e => !e)}>{editing ? "Cancel" : "Edit"}</button>
    </div>
    <div style={{ padding: "0 16px" }}>
      <div className="card" style={{ marginBottom: 16 }}>
        {editing ? (<div>
          <div className="fld" style={{ marginBottom: 8 }}><label className="lbl">Organization Name</label><input className="inp" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="fld" style={{ marginBottom: 8 }}><label className="lbl">Sport</label>
            <select className="sel" value={sport} onChange={e => setSport(e.target.value)}>
              <option value="">-- Select a sport --</option>
              {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="fld" style={{ marginBottom: 8 }}>
            <label className="lbl">Color</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {TEAM_COLORS.map(c => (<button key={c} type="button" onClick={() => setColor(c)} style={{ width: 32, height: 32, borderRadius: "50%", background: c, border: color === c ? "3px solid var(--black)" : "3px solid transparent", cursor: "pointer", padding: 0 }} />))}
            </div>
          </div>
          <button className="btn primary bxs" disabled={saving || !name.trim()} onClick={saveOrgDetails}>{saving ? "Saving..." : "Save"}</button>
        </div>) : (<div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {org.color && <span style={{ width: 14, height: 14, borderRadius: "50%", background: org.color, flexShrink: 0 }} />}
            <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 18, fontWeight: 900 }}>{org.name}</div>
          </div>
          {org.sport && <div style={{ fontSize: 13, color: "var(--td)", marginTop: 4 }}>{org.sport}</div>}
          {memberSince && <div style={{ fontSize: 12, color: "var(--td)", marginTop: 4 }}>Member since {memberSince}</div>}
        </div>)}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div className="clbl">Org Members</div>
        <button className="btn ghost bxs" onClick={() => setShowAddMember(s => !s)}>{showAddMember ? "Cancel" : "+ Add Org Member"}</button>
      </div>
      {showAddMember && <div className="card" style={{ padding: 12, marginBottom: 8 }}>
        <div className="fld" style={{ marginBottom: 8 }}><label className="lbl">Email</label><input className="inp" placeholder="coach@email.com" value={addMemberEmail} onChange={e => setAddMemberEmail(e.target.value)} /></div>
        <div className="fld" style={{ marginBottom: 8 }}>
          <label className="lbl">Role</label>
          <div className="brow">
            {Object.entries(ORG_ROLE_LABELS).map(([val, label]) => (<button key={val} type="button" className={"btn bsm " + (addMemberRole === val ? "primary" : "ghost")} onClick={() => setAddMemberRole(val)}>{label}</button>))}
          </div>
        </div>
        <button className="btn primary bxs" disabled={addingMember || !addMemberEmail.trim()} onClick={submitAddMember}>{addingMember ? "Adding..." : "Add"}</button>
      </div>}
      {members.map(m => {
        const isSelf = m.userId === coachId;
        const isEditing = editingMemberId === m.id;
        const isConfirmingRemove = confirmRemoveId === m.id;
        return (<div key={m.id} className="li" style={{ position: "relative", marginBottom: 8, display: "block" }} onClick={() => setOpenMenuId(null)}>
          {!isEditing && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="lim">
              <div className="lin">{m.name}{isSelf ? " (You)" : ""}{m.email ? " · " + m.email : ""}</div>
              <div className="limt">{ORG_ROLE_LABELS[m.role] || m.role} · Added {fmtDate(m.createdAt)}</div>
            </div>
            <button className="ell-btn" onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === m.id ? null : m.id); }}><span/><span/><span/></button>
            {openMenuId === m.id && <div className="mini-menu" style={{ right: 0, top: "100%" }} onClick={e => e.stopPropagation()}>
              <button className="mm-item" onClick={() => startEditRole(m)}>Edit Role</button>
              {members.length > 1 && <button className="mm-item mm-danger" onClick={() => { setOpenMenuId(null); setConfirmRemoveId(m.id); }}>Remove</button>}
            </div>}
          </div>}
          {isEditing && <div onClick={e => e.stopPropagation()}>
            <div className="lin" style={{ marginBottom: 8 }}>{m.name}{isSelf ? " (You)" : ""}</div>
            <div className="brow" style={{ marginBottom: 8 }}>
              {Object.entries(ORG_ROLE_LABELS).map(([val, label]) => (<button key={val} type="button" className={"btn bsm " + (draftRole === val ? "primary" : "ghost")} onClick={() => setDraftRole(val)}>{label}</button>))}
            </div>
            {isSelf && draftRole !== m.role && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 8 }}>This changes your own role.</div>}
            <div className="brow">
              <button className="btn ghost bsm" onClick={() => setEditingMemberId(null)}>Cancel</button>
              <button className="btn primary bsm" style={{ flex: 1 }} disabled={busyMemberId === m.id} onClick={() => saveRole(m.id)}>{busyMemberId === m.id ? "Saving..." : "Save"}</button>
            </div>
          </div>}
          {isConfirmingRemove && <div className="confirm-box" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Remove {isSelf ? "yourself" : m.name}?</div>
            <div className="confirm-body">{isSelf ? "You'll lose director/admin access to this organization immediately -- someone else will need to add you back." : m.name + " will lose director/admin access to this organization."}</div>
            <div className="brow"><button className="btn ghost bsm" onClick={() => setConfirmRemoveId(null)}>Cancel</button><button className="btn danger bsm" disabled={busyMemberId === m.id} onClick={() => doRemoveMember(m.id)}>{busyMemberId === m.id ? "Removing..." : "Remove"}</button></div>
          </div>}
        </div>);
      })}
      {sentInvites.map(inv => (<div key={inv.id} className="li tap" style={{ marginBottom: 6 }} onClick={() => doCancelInvite(inv.id)}>
        <div className="lim"><div className="lin">{inv.email}</div><div className="limt">Invited as {ORG_ROLE_LABELS[inv.role] || inv.role}, awaiting response · tap to cancel</div></div>
      </div>))}
    </div>
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
export default function TeamsListScreen({ data, goToTeam, openModal, mode, refreshLibrary, coachId }) {
  const teams = data.teams || [];
  const isOrgMode = mode && mode.type === "org";
  const activeOrg = isOrgMode ? (data.myOrgs || []).find(o => o.id === mode.orgId) : null;
  const [showOrgDetails, setShowOrgDetails] = useState(false);
  // Org mode's +Team opens the same addTeam modal, just with organizationId
  // in the payload -- that's what tells ModalLayer.save() to call
  // orgCreateTeam instead of createTeam (see ModalLayer.jsx), and lets it
  // default the sport to the org's own sport.
  const addTeamPayload = isOrgMode ? { organizationId: mode.orgId, orgSport: activeOrg && activeOrg.sport } : undefined;

  if (isOrgMode && activeOrg && showOrgDetails) {
    return <OrgDetailsView org={activeOrg} refreshLibrary={refreshLibrary} onBack={() => setShowOrgDetails(false)} coachId={coachId} />;
  }

  return (<div style={{ paddingBottom: 80 }}>
    <div style={{ padding: "20px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 28, fontWeight: 900 }}>{isOrgMode ? "Org Teams" : "Teams"}</div>
      <button className="btn primary bsm" onClick={() => openModal("addTeam", addTeamPayload)}>+ Team</button>
    </div>
    {isOrgMode && activeOrg && <div style={{ padding: "0 16px 16px" }}>
      <div className="card tap" style={{ display: "flex", alignItems: "center", gap: 10 }} onClick={() => setShowOrgDetails(true)}>
        {activeOrg.color && <span style={{ width: 14, height: 14, borderRadius: "50%", background: activeOrg.color, flexShrink: 0 }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 18, fontWeight: 900 }}>{activeOrg.name}</div>
          {activeOrg.sport && <div style={{ fontSize: 12, color: "var(--td)" }}>{activeOrg.sport}</div>}
        </div>
        <span style={{ color: "var(--green)", fontSize: 22 }}>&#8250;</span>
      </div>
    </div>}
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
