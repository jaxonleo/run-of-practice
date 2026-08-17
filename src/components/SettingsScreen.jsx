import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { checkIsAdmin, listAdmins, grantAdmin, revokeAdmin, createOrganization, orgInviteCoach, leaveTeam, setTeamStaffShowOnHome } from "../supabase.js";
import { myTeamRole, AUDIO_CUES, getAudioCuePref, setAudioCuePref, getVoiceURIPref, setVoiceURIPref, loadVoices, resolveDefaultVoice, setGettingStartedHidden, useBigBrowser } from "../constants.js";
import { ConsultationRequestForm } from "./LegalPages.jsx";

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
    <div style={{fontSize:13,color:"var(--td)",marginBottom:14,lineHeight:1.4}}>Every team you're on, across every organization. "Show on Home" controls where the team's practices show up in your own Home agenda. Turning it off doesn't remove you from the team, and you'll still see everything if you open the team directly.</div>
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
function AccountSection({profile,coachEmail,saveName,onSignOut,onDeactivate,navigate,coachId,isAdmin}){
  const [firstName,setFirstName]=useState(profile?profile.first_name||"":"");
  const [lastName,setLastName]=useState(profile?profile.last_name||"":"");
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [confirmDeactivate,setConfirmDeactivate]=useState(false);
  const [showConsult,setShowConsult]=useState(false);
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

    {/* Moved here from the main Settings list -- that top-level list is
        the first thing anyone poking around Settings sees, and a card
        reading as "this needs us to set it up for you" isn't the right
        first impression for a prospective club. Admins already have the
        real self-serve create-org flow (still on the main list), so this
        is coach-only. */}
    {!isAdmin&&<>
      <div className="clbl mb8">Membership</div>
      <div className="card" style={{marginBottom:24,padding:"14px 16px"}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700,marginBottom:4}}>Part of an organization with multiple teams?</div>
        <div style={{fontSize:13,color:"var(--td)",marginBottom:10,lineHeight:1.4}}>Organizations give a director (or a few) visibility across every team they oversee. Request a consultation and we'll walk through how Run of Practice can support your organization.</div>
        <button type="button" className="btn outline bmd bfull" onClick={()=>setShowConsult(true)}>Request a Consultation</button>
      </div>
      {showConsult&&<ConsultationRequestForm coachId={coachId} coachEmail={coachEmail} pageContext="Settings > Account" onClose={()=>setShowConsult(false)}/>}
    </>}

    <div className="clbl mb8">Legal</div>
    <div className="li tap" style={{marginBottom:6}} onClick={()=>navigate("/terms",{state:{openSection:"account"}})}><div className="lim"><div className="lin">Terms of Service</div></div><span style={{color:"var(--td)",fontSize:18}}>&#8250;</span></div>
    <div className="li tap" style={{marginBottom:24}} onClick={()=>navigate("/privacy",{state:{openSection:"account"}})}><div className="lim"><div className="lin">Privacy Policy</div></div><span style={{color:"var(--td)",fontSize:18}}>&#8250;</span></div>

    <div className="clbl mb8">Deactivate Account</div>
    {!confirmDeactivate&&<button className="btn ghost bmd bfull" style={{marginBottom:24,color:"var(--red)"}} onClick={()=>setConfirmDeactivate(true)}>Deactivate Account</button>}
    {confirmDeactivate&&<div className="confirm-box" style={{marginBottom:24}}>
      <div className="confirm-title">Deactivate your account?</div>
      <div className="confirm-body">You'll be signed out and hidden from rosters. All your teams, practices, and data stay exactly as they are. To pick up right where you left off, sign in and reactivate your account.</div>
      <div className="brow"><button className="btn ghost bsm" onClick={()=>setConfirmDeactivate(false)}>Cancel</button><button className="btn danger bsm" onClick={()=>{if(onDeactivate)onDeactivate();}}>Deactivate</button></div>
    </div>}

    <button className="btn outline bmd bfull" onClick={()=>{if(onSignOut)onSignOut();}}>Sign Out</button>
  </div>);
}

// ── LivePracticeAudioSection ─────────────────────────────────────────────────
// Coach-selectable time's-up cue + announcer voice, requested after the
// default whistle+"Time" combo didn't land for everyone. Stored in
// localStorage (constants.js) rather than the database -- both are
// inherently per-device: available speechSynthesis voices differ entirely
// by browser/OS, so a specific voice chosen on one device may not exist
// on another, and re-resolving at speak-time on whichever device is
// playing is simpler and more correct than trying to sync a voice across
// devices.
//
// First version picked "Male"/"Female" via a name-based heuristic (the
// Web Speech API has no real gender metadata) and used whichever voice
// matched first -- on a real device that surfaced an old, dated-sounding
// voice ahead of much better ones the heuristic didn't know about, since
// there's no way to infer voice *quality* from a name. This lists every
// voice actually installed on the device instead, so the coach can
// preview and pick whichever one genuinely sounds best to them.
// Jax's read after trying the full device list: every option was "simply
// awful" -- real recorded audio is coming later (see BUILD-STATUS), but
// until then the list is narrowed to just the two names that actually
// sounded acceptable (Samantha/Daniel) rather than leaving a long list of
// novelty/character voices that just waste the coach's time previewing.
// Curated by name, not hardcoded voiceURIs, since voiceURI includes
// platform-specific bits that won't match across devices -- name is what
// stays stable. On a device with neither installed, this list is just
// empty and Device Default is the only choice, same as it already was.
const CURATED_VOICE_NAMES=["samantha","daniel"];
function LivePracticeAudioSection(){
  const [cue,setCue]=useState(getAudioCuePref());
  const [voiceURI,setVoiceURI]=useState(getVoiceURIPref());
  const [voices,setVoices]=useState([]);
  const [loadingVoices,setLoadingVoices]=useState(true);
  const previewAudioRef=useRef(null);
  useEffect(()=>{
    loadVoices().then(list=>{
      const en=list.filter(v=>/^en/i.test(v.lang));
      const pool=en.length?en:list;
      setVoices(pool.filter(v=>CURATED_VOICE_NAMES.includes(v.name.trim().toLowerCase())));
      setLoadingVoices(false);
    });
  },[]);
  const previewCue=id=>{
    try{
      if(previewAudioRef.current)previewAudioRef.current.pause();
      const found=AUDIO_CUES.find(c=>c.id===id);
      if(!found)return;
      const audio=new Audio(found.file);
      previewAudioRef.current=audio;
      audio.play().catch(()=>{});
    }catch(e){}
  };
  const chooseCue=id=>{setCue(id);setAudioCuePref(id);previewCue(id);};
  const previewVoice=uri=>{
    try{
      window.speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance("Two minutes remaining.");
      u.rate=0.9;
      const v=uri?voices.find(v=>v.voiceURI===uri):resolveDefaultVoice();
      if(v)u.voice=v;
      window.speechSynthesis.speak(u);
    }catch(e){}
  };
  const chooseVoice=uri=>{setVoiceURI(uri);setVoiceURIPref(uri);previewVoice(uri);};
  const VoiceRow=({selected,label,sub,onClick})=>(
    <button onClick={onClick} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 10px",border:"none",background:selected?"var(--gbg)":"transparent",borderRadius:8,cursor:"pointer",textAlign:"left",width:"100%"}}>
      <span style={{fontSize:14,color:"var(--black)",fontWeight:selected?700:500}}>{label}{sub&&<span style={{color:"var(--td)",fontWeight:400,fontSize:11,marginLeft:6}}>{sub}</span>}</span>
      {selected&&<span style={{color:"var(--green)",fontWeight:700}}>&#10003;</span>}
    </button>
  );
  return (<div>
    <div className="clbl mb8">Time's Up Sound</div>
    <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:24}}>
      {AUDIO_CUES.map(c=>(<button key={c.id} className={"btn bsm "+(cue===c.id?"primary":"outline")} onClick={()=>chooseCue(c.id)}>{c.label}</button>))}
    </div>
    <div className="clbl mb8">Announcer Voice</div>
    {loadingVoices&&<div style={{fontSize:13,color:"var(--td)",marginBottom:10}}>Loading voices...</div>}
    {!loadingVoices&&<div style={{display:"flex",flexDirection:"column",gap:2,marginBottom:10,maxHeight:340,overflowY:"auto",border:"1px solid var(--b)",borderRadius:"var(--r)",padding:4}}>
      <VoiceRow selected={!voiceURI} label="Default" sub="(Daniel, if available)" onClick={()=>chooseVoice("")}/>
      {voices.map(v=>(<VoiceRow key={v.voiceURI} selected={voiceURI===v.voiceURI} label={v.name} sub={v.lang} onClick={()=>chooseVoice(v.voiceURI)}/>))}
    </div>}
    <div style={{fontSize:12,color:"var(--td)",lineHeight:1.5}}>Select a sound and voice for live practice audio.</div>
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
  // BB layout pass: a width cap, same .bb-centered-page treatment as
  // Library/Roster -- this screen is already genuinely single-column
  // (Locations/Equipment/Skill Tags moved to Library), nothing else changes.
  const isBB=useBigBrowser();
  const navigate=useNavigate();
  const location=useLocation();
  // null = the top-level list; otherwise which section is drilled into.
  // Initialized from location.state.openSection when arriving back from
  // Terms/Privacy (see LegalPages.jsx) so "Back" from there actually lands
  // on Account, not the Settings root.
  const [section,setSection]=useState(()=>(location.state&&location.state.openSection)||null);
  // Founder-only row -- checkIsAdmin() resolves false for everyone else, so
  // this quietly stays absent rather than showing and then disappearing.
  const [isAdmin,setIsAdmin]=useState(false);
  useEffect(()=>{checkIsAdmin().then(setIsAdmin);},[]);
  // No RPC needed here (see createOrganization's comment in supabase.js) --
  // this is the one piece the org handoff never covered, since everything
  // else assumes an org already exists.
  const [showCreateOrg,setShowCreateOrg]=useState(false);
  const [newOrgName,setNewOrgName]=useState("");
  const [newOrgDirectorEmail,setNewOrgDirectorEmail]=useState("");
  const [creatingOrg,setCreatingOrg]=useState(false);
  const submitCreateOrg=async()=>{
    if(!newOrgName.trim())return;
    setCreatingOrg(true);
    const {data:org}=await createOrganization(coachId,newOrgName.trim());
    // Admin-created orgs are meant to be handed off, not run by the admin
    // long-term -- inviting the real director right away (reusing the same
    // consent-based org_invites flow a director would use for anyone else)
    // means the admin never has to touch org_staff rows by hand to hand it
    // over. Left blank, the admin just stays director for now.
    if(org&&newOrgDirectorEmail.trim())await orgInviteCoach(org.id,newOrgDirectorEmail.trim(),null,null,"director");
    setNewOrgName("");setNewOrgDirectorEmail("");setCreatingOrg(false);setShowCreateOrg(false);
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
    {id:"audio",label:"Live Practice Audio",sub:"Time's-up sound and announcer voice"},
  ];
  const BackRow=()=>(<div style={{padding:"12px 14px 0"}}><button className="btn ghost bxs" onClick={()=>setSection(null)}>&#8249; Settings</button></div>);
  const titles={account:"Account",assignments:"My Team Assignments",admins:"Admins",audio:"Live Practice Audio"};

  if(section)return(<div className={isBB?"bb-centered-page":undefined} style={{paddingBottom:80}}>
    <BackRow/>
    <div style={{padding:"12px 16px 0"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,marginBottom:14}}>{titles[section]}</div>
      {section==="account"&&<AccountSection profile={profile} coachEmail={coachEmail} saveName={saveName} onSignOut={onSignOut} onDeactivate={onDeactivate} navigate={navigate} coachId={coachId} isAdmin={isAdmin}/>}
      {section==="assignments"&&<TeamAssignmentsSection data={data} coachId={coachId} refreshTeams={refreshTeams}/>}
      {section==="admins"&&<AdminsSection/>}
      {section==="audio"&&<LivePracticeAudioSection/>}
    </div>
  </div>);

  return(<div className={isBB?"bb-centered-page":undefined} style={{paddingBottom:80}}>
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
      {/* Brings back the Home checklist for a coach who hid it (see
          HomeScreen.jsx's GettingStartedCard) -- a no-op if it was never
          hidden, or if every step is already done, since Home's own gate
          only shows the card when there's still something left to do. */}
      <div className="li tap" style={{marginBottom:8}} onClick={()=>{setGettingStartedHidden(coachId,false);navigate("/");}}>
        <div className="lim"><div className="lin">Getting Started</div><div className="limt">Show the setup checklist on Home again</div></div>
        <span style={{color:"var(--td)",fontSize:18}}>&#8250;</span>
      </div>
      {/* Per-org rows to "switch to Organization mode" were removed here --
          Home's own Coach/Org toggle already covers this, and duplicating
          it in Settings just as a list of links was redundant now that
          every org shows there directly. */}
      {/* Non-admin coaches used to see a "Running a club with multiple
          teams?" consultation card right here -- moved to Settings >
          Account > Membership instead, since this top-level list is the
          first thing anyone poking around Settings sees, and a card that
          reads as "this feature needs us to set it up for you" isn't the
          first impression a prospective club should get. Founder-admins
          still get the real create-org flow here, unchanged. */}
      {isAdmin&&(
        showCreateOrg?(<div className="card" style={{padding:12,marginBottom:8}}>
          <div className="fld mb8"><label className="lbl">Organization name</label><input className="inp" placeholder="Organization name" value={newOrgName} onChange={e=>setNewOrgName(e.target.value)} autoFocus/></div>
          <div className="fld mb8"><label className="lbl">Director's email (optional)</label><input className="inp" type="email" placeholder="Leave blank to stay director yourself for now" value={newOrgDirectorEmail} onChange={e=>setNewOrgDirectorEmail(e.target.value)}/></div>
          <div className="brow"><button className="btn ghost bsm" onClick={()=>{setShowCreateOrg(false);setNewOrgName("");setNewOrgDirectorEmail("");}}>Cancel</button><button className="btn primary bsm" disabled={creatingOrg||!newOrgName.trim()} onClick={submitCreateOrg}>{creatingOrg?"Creating...":"Create"}</button></div>
        </div>):(
          <div className="li tap" style={{marginBottom:8}} onClick={()=>setShowCreateOrg(true)}>
            <div className="lim"><div className="lin">+ Create Organization</div><div className="limt">Admin-only: create an org and hand it to a director</div></div>
          </div>
        )
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
