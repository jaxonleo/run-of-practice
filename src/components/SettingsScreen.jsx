import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { checkIsAdmin, listAdmins, grantAdmin, revokeAdmin, createOrganization, leaveTeam, setTeamStaffShowOnHome } from "../supabase.js";
import { myTeamRole } from "../constants.js";

// Settings hub (nav restructure, 2026-07-15; narrowed again in the Library
// 5-tab redesign): originally held Account, Locations, Equipment & Gear, and
// Skill Tags as "configuration, not coaching content." Locations/Equipment/
// Skill Tags moved to Library, since a director managing an org's shared
// stuff wants one place for all five content types (drills, templates,
// locations, equipment, skill tags -- they already share the identical
// coach-or-org ownership pattern in the schema). What's left here is
// genuinely per-device account config, plus founder-admin and org-creation
// entry points that don't belong anywhere else.

// ── TeamAssignmentsSection ───────────────────────────────────────────────────
// Real gap found live: a coach added to a team they don't personally plan
// for (an org's team they're not responsible for, or another coach's
// personal team they help on) had no single place to see everything
// they're on, leave one, or hide it from their own Home agenda without
// leaving it. Built from data.teams directly -- every team RLS lets this
// user see already IS every team they're actually on in some capacity, no
// new fetch needed. Team-workspace pages (clicking a team from Teams) are
// completely unaffected by this -- show_on_home only gates Home's own
// agenda scoping (homeTeamsForMode in constants.js).
function TeamAssignmentsSection({data,coachId,refreshTeams}){
  const [busyId,setBusyId]=useState(null);
  const [confirmLeaveId,setConfirmLeaveId]=useState(null);
  const mine=(data.teams||[]).map(t=>{
    const staff=(t.coaches||[]).find(c=>c.userId===coachId);
    const role=myTeamRole(t,coachId);
    return role?{team:t,staff,role}:null;
  }).filter(Boolean);
  const toggleShowOnHome=async(staffId,show)=>{
    if(!staffId)return;
    setBusyId(staffId);
    await setTeamStaffShowOnHome(staffId,show);
    await refreshTeams();
    setBusyId(null);
  };
  const doLeave=async teamId=>{
    setBusyId(teamId);
    await leaveTeam(teamId);
    await refreshTeams();
    setBusyId(null);
    setConfirmLeaveId(null);
  };
  if(mine.length===0)return <div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>You're not on any teams yet.</div>;
  return(<div>
    <div style={{fontSize:13,color:"var(--td)",marginBottom:14,lineHeight:1.4}}>Every team you're on, across every organization. "Show on Home" controls whether its practices show up in your own Home agenda -- turning it off doesn't remove you from the team, and you'll still see everything if you open the team directly.</div>
    {mine.map(({team,staff,role})=>{
      const isOwner=team.ownerUserId===coachId;
      return(<div key={team.id} className="card" style={{marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700}}>{team.name}</div>
            <div style={{fontSize:12,color:"var(--td)"}}>{role}{team.organizationId?" · org team":""}</div>
          </div>
          {!isOwner&&(confirmLeaveId===team.id?(
            <div className="row" style={{gap:6}}>
              <button className="btn ghost bxs" onClick={()=>setConfirmLeaveId(null)}>Cancel</button>
              <button className="btn danger bxs" disabled={busyId===team.id} onClick={()=>doLeave(team.id)}>{busyId===team.id?"Leaving...":"Confirm Leave"}</button>
            </div>
          ):(
            <button className="btn ghost bxs" style={{color:"var(--red)"}} onClick={()=>setConfirmLeaveId(team.id)}>Leave</button>
          ))}
        </div>
        {staff&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:13}}>Show on Home</span>
          <button type="button" onClick={()=>toggleShowOnHome(staff.id,!staff.showOnHome)} disabled={busyId===staff.id} style={{width:44,height:26,borderRadius:13,border:"none",cursor:"pointer",background:staff.showOnHome?"var(--green)":"var(--s2)",position:"relative",flexShrink:0}}>
            <span style={{position:"absolute",top:2,left:staff.showOnHome?20:2,width:22,height:22,borderRadius:"50%",background:"#fff",transition:"left .15s"}}/>
          </button>
        </div>}
      </div>);
    })}
  </div>);
}

// ── AccountSection ────────────────────────────────────────────────────────────
function AccountSection({profile,coachEmail,saveName,onSignOut,onDeactivate}){
  const [firstName,setFirstName]=useState(profile?profile.first_name||"":"");
  const [lastName,setLastName]=useState(profile?profile.last_name||"":"");
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [confirmDeactivate,setConfirmDeactivate]=useState(false);
  // Profile loads async after this screen can already be mounted -- sync
  // the fields once it arrives instead of only reading it at first render.
  useEffect(()=>{setFirstName(profile?profile.first_name||"":"");setLastName(profile?profile.last_name||"":"");},[profile]);
  const dirty=!!profile&&(firstName.trim()!==(profile.first_name||"")||lastName.trim()!==(profile.last_name||""));
  const save=async()=>{
    if(!firstName.trim()||saving)return;
    setSaving(true);
    await saveName(firstName.trim(),lastName.trim());
    setSaving(false);setSaved(true);
    setTimeout(()=>setSaved(false),2000);
  };
  return (<div>
    <div className="clbl mb8">Your Info</div>
    <div className="fld mb10"><label className="lbl">First Name</label><input className="inp" value={firstName} onChange={e=>setFirstName(e.target.value)}/></div>
    <div className="fld mb10"><label className="lbl">Last Name</label><input className="inp" placeholder="(optional)" value={lastName} onChange={e=>setLastName(e.target.value)}/></div>
    <div className="fld" style={{marginBottom:12}}><label className="lbl">Email</label><div style={{fontSize:14,color:"var(--td)",padding:"8px 0"}}>{coachEmail||"--"}</div></div>
    {dirty&&<button className="btn primary bmd bfull" style={{marginBottom:24}} onClick={save} disabled={!firstName.trim()||saving}>{saving?"Saving...":"Save Changes"}</button>}
    {!dirty&&saved&&<div style={{fontSize:13,color:"var(--green)",marginBottom:24}}>Saved.</div>}
    {!dirty&&!saved&&<div style={{marginBottom:24}}/>}

    <div className="clbl mb8">Legal</div>
    <a href="/terms" className="li" style={{textDecoration:"none",marginBottom:6}}><div className="lim"><div className="lin">Terms of Service</div></div><span style={{color:"var(--td)",fontSize:18}}>&#8250;</span></a>
    <a href="/privacy" className="li" style={{textDecoration:"none",marginBottom:24}}><div className="lim"><div className="lin">Privacy Policy</div></div><span style={{color:"var(--td)",fontSize:18}}>&#8250;</span></a>

    <div className="clbl mb8" style={{color:"var(--red)"}}>Danger Zone</div>
    {!confirmDeactivate&&<button className="btn ghost bmd bfull" style={{marginBottom:24,color:"var(--red)"}} onClick={()=>setConfirmDeactivate(true)}>Deactivate Account</button>}
    {confirmDeactivate&&<div className="confirm-box" style={{marginBottom:24}}>
      <div className="confirm-title">Deactivate your account?</div>
      <div className="confirm-body">You'll be signed out and hidden from your teammates' rosters. All your teams, practices, and data stay exactly as they are -- just sign back in any time to pick up right where you left off.</div>
      <div className="brow"><button className="btn ghost bsm" onClick={()=>setConfirmDeactivate(false)}>Cancel</button><button className="btn danger bsm" onClick={()=>{if(onDeactivate)onDeactivate();}}>Deactivate</button></div>
    </div>}

    <button className="btn outline bmd bfull" onClick={()=>{if(onSignOut)onSignOut();}}>Sign Out</button>
  </div>);
}

// LocationsSection moved to NewLibraryScreen.jsx (Library 5-tab redesign).

// ── AdminsSection ──────────────────────────────────────────────────────────
// Founder-admin only. This IS the extensibility path from the plan: granting
// the same public-library/skill-tag write rights to another user later is
// just adding them here by email -- grant_admin/revoke_admin (RLS: caller
// must already be_admin()), same shape as LocationsSection above.
function AdminsSection({}){
  const [admins,setAdmins]=useState([]);
  const [loading,setLoading]=useState(true);
  const [email,setEmail]=useState("");
  const [error,setError]=useState("");
  const load=async()=>{setLoading(true);setAdmins(await listAdmins());setLoading(false);};
  useEffect(()=>{load();},[]);
  const add=async()=>{
    if(!email.trim())return;
    setError("");
    const {error}=await grantAdmin(email.trim());
    if(error){setError("No account found for that email, or it's already an admin.");return;}
    setEmail("");
    await load();
  };
  const remove=async userId=>{
    const {error}=await revokeAdmin(userId);
    if(error){setError("Can't remove the last remaining admin.");return;}
    await load();
  };
  return(<div>
    <div className="sechdr mb10"><span className="sectitle">{admins.length} Admin{admins.length!==1?"s":""}</span></div>
    <div style={{fontSize:13,color:"var(--td)",marginBottom:14,lineHeight:1.4}}>Admins can add, edit, and remove Public Library drills and manage the global skill-tag taxonomy for every sport.</div>
    {loading&&<div style={{padding:"20px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>Loading...</div>}
    {!loading&&admins.map(a=>(<div key={a.user_id} className="card" style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
      <div><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700}}>{a.name||a.email}</div>{a.name&&<div style={{fontSize:12,color:"var(--td)"}}>{a.email}</div>}</div>
      {admins.length>1&&<button className="btn ghost bxs" style={{color:"var(--red)"}} onClick={()=>remove(a.user_id)}>Remove</button>}
    </div>))}
    <div className="fld"><label className="lbl">Grant admin by email</label>
      <div style={{display:"flex",gap:6}}>
        <input className="inp" type="email" placeholder="coach@example.com" style={{flex:1}} value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()}/>
        <button type="button" className="btn primary bxs" onClick={add}>Grant</button>
      </div>
      {error&&<div style={{fontSize:12,color:"var(--red)",marginTop:6}}>{error}</div>}
    </div>
  </div>);
}

export default function SettingsScreen({data,coachId,refreshLibrary,refreshTeams,profile,coachEmail,saveName,onSignOut,onDeactivate,setMode}){
  const navigate=useNavigate();
  // null = the top-level list; otherwise which section is drilled into.
  const [section,setSection]=useState(null);
  // Founder-only row -- checkIsAdmin() resolves false for everyone else, so
  // this quietly stays absent rather than showing and then disappearing.
  const [isAdmin,setIsAdmin]=useState(false);
  useEffect(()=>{checkIsAdmin().then(setIsAdmin);},[]);
  // No RPC needed here (see createOrganization's comment in supabase.js) --
  // this is the one piece the org handoff never covered, since everything
  // else assumes an org already exists.
  const [showCreateOrg,setShowCreateOrg]=useState(false);
  const [newOrgName,setNewOrgName]=useState("");
  const [creatingOrg,setCreatingOrg]=useState(false);
  const submitCreateOrg=async()=>{
    if(!newOrgName.trim())return;
    setCreatingOrg(true);
    const {data:org}=await createOrganization(coachId,newOrgName.trim());
    setNewOrgName("");setCreatingOrg(false);setShowCreateOrg(false);
    if(refreshLibrary)await refreshLibrary();
    // Org Home was folded into Home's Organization mode -- switching mode
    // and returning there is now the entry point, not a separate route.
    if(org){setMode({type:"org",orgId:org.id});navigate("/");}
  };
  // Locations/Equipment & Gear/Skill Tags moved to Library (5-tab redesign,
  // ROP-Org-Experience follow-up) -- Account is what's left here that's
  // genuinely per-device configuration, not coaching content.
  const NAV_ITEMS=[
    {id:"account",label:"Account",sub:coachEmail||undefined},
    {id:"assignments",label:"My Team Assignments",sub:"Leave a team or hide it from your Home agenda"},
  ];
  const BackRow=()=>(<div style={{padding:"12px 14px 0"}}><button className="btn ghost bxs" onClick={()=>setSection(null)}>&#8249; Settings</button></div>);
  const titles={account:"Account",assignments:"My Team Assignments",admins:"Admins"};

  if(section)return(<div style={{paddingBottom:80}}>
    <BackRow/>
    <div style={{padding:"12px 16px 0"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,marginBottom:14}}>{titles[section]}</div>
      {section==="account"&&<AccountSection profile={profile} coachEmail={coachEmail} saveName={saveName} onSignOut={onSignOut} onDeactivate={onDeactivate}/>}
      {section==="assignments"&&<TeamAssignmentsSection data={data} coachId={coachId} refreshTeams={refreshTeams}/>}
      {section==="admins"&&<AdminsSection/>}
    </div>
  </div>);

  return(<div style={{paddingBottom:80}}>
    {/* Back-button audit (2026-07-15): Settings is reached via a gear icon,
        not a tab, so unlike Home/Teams/Library it isn't a navigable root --
        it needs its own explicit way out instead of relying on the coach to
        notice the tab bar still works underneath it. navigate(-1) returns
        to wherever the gear icon was tapped from. */}
    <div style={{padding:"12px 14px 0"}}><button className="btn ghost bxs" onClick={()=>navigate(-1)}>&#8249; Back</button></div>
    <div style={{padding:"12px 16px 12px"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900}}>Settings</div>
    </div>
    <div style={{padding:"0 16px"}}>
      {NAV_ITEMS.map(item=>(<div key={item.id} className="li tap" style={{marginBottom:8}} onClick={()=>setSection(item.id)}>
        <div className="lim"><div className="lin">{item.label}</div>{item.sub&&<div className="limt">{item.sub}</div>}</div>
        <span style={{color:"var(--td)",fontSize:18}}>&#8250;</span>
      </div>))}
      {(data.myOrgs||[]).map(org=>(<div key={org.id} className="li tap" style={{marginBottom:8}} onClick={()=>{setMode({type:"org",orgId:org.id});navigate("/");}}>
        <div className="lim"><div className="lin">{org.name}</div><div className="limt">Switch to Organization mode</div></div>
        <span style={{color:"var(--td)",fontSize:18}}>&#8250;</span>
      </div>))}
      {showCreateOrg?(<div className="card" style={{padding:12,marginBottom:8,display:"flex",gap:6}}>
        <input className="inp" style={{flex:1}} placeholder="Organization name" value={newOrgName} onChange={e=>setNewOrgName(e.target.value)} autoFocus/>
        <button className="btn primary bxs" disabled={creatingOrg} onClick={submitCreateOrg}>{creatingOrg?"Creating...":"Create"}</button>
        <button className="btn ghost bxs" onClick={()=>{setShowCreateOrg(false);setNewOrgName("");}}>Cancel</button>
      </div>):(
        <div className="li tap" style={{marginBottom:8}} onClick={()=>setShowCreateOrg(true)}>
          <div className="lim"><div className="lin">+ Create Organization</div></div>
        </div>
      )}
      {isAdmin&&<div className="li tap" style={{marginBottom:8}} onClick={()=>navigate("/admin/metrics")}>
        <div className="lim"><div className="lin">Founder Metrics</div></div>
        <span style={{color:"var(--td)",fontSize:18}}>&#8250;</span>
      </div>}
      {isAdmin&&<div className="li tap" style={{marginBottom:8}} onClick={()=>setSection("admins")}>
        <div className="lim"><div className="lin">Admins</div><div className="limt">Who can manage the Public Library and skill tags</div></div>
        <span style={{color:"var(--td)",fontSize:18}}>&#8250;</span>
      </div>}
    </div>
  </div>);
}
