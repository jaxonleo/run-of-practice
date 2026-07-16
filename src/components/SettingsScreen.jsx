import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createAsset, updateAsset, archiveAsset, archiveLocation } from "../supabase.js";
import { SkillsTab } from "./NewLibraryScreen.jsx";

// Settings hub (nav restructure, 2026-07-15): one home for the low-frequency
// "manage my setup" tasks that were orphaned when the old Manage screen
// dissolved into the team-first navigation -- Account, Locations, Equipment &
// Gear, and Skill Tags. These are configuration, not coaching content, which
// is exactly why none of them belonged in Library (content you browse) or a
// team workspace (they're all coach-owned and cross-team). Entered via the
// gear icon on Home. All four sections keep their inline-create escape
// hatches where they're actually used (drill editor creates equipment,
// scheduling creates locations), so living one level deep costs nothing
// day-to-day.
//
// GearEditRow / EquipmentTab / AccountSection moved here verbatim from
// App.jsx (they had no other call sites); SkillsTab is imported from
// NewLibraryScreen (one-way import, no cycle), where it no longer has a tab.

// ── GearEditRow — inline edit for a player gear item ─────────────────────────
function GearEditRow({asset,refreshLibrary,onDone}){
  const [name,setName]=useState(asset.name);
  const [sport,setSport]=useState(asset.sport||"General");
  const save=async()=>{
    if(!name.trim())return;
    await updateAsset(asset.id,{name:name.trim(),sport});
    await refreshLibrary();
    onDone();
  };
  return(<div style={{padding:"10px 12px",background:"var(--s2)",borderBottom:"1px solid var(--b)"}}>
    <div className="g2" style={{marginBottom:8}}>
      <div className="fld"><label className="lbl">Name</label><input className="inp" autoFocus value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()}/></div>
      <div className="fld"><label className="lbl">Sport</label>
        <select className="sel" value={sport} onChange={e=>setSport(e.target.value)}>
          {["General","Baseball","Basketball","Football","Soccer","Softball","Lacrosse","Hockey","Volleyball","Tennis","Swimming","Other"].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>
    <div className="brow"><button className="btn ghost bxs" onClick={onDone}>Cancel</button><button className="btn primary bxs" onClick={save} disabled={!name.trim()}>Save</button></div>
  </div>);
}

// ── EquipmentTab ──────────────────────────────────────────────────────────────
// Used two ways: unfiltered from Settings (no `mode`, no `sportFilter` --
// everything the coach owns, across every sport), and sport-filtered from
// inside a team's workspace (mode + sportFilter=team.sport). Exported so
// ManageScreen's Team tab (App.jsx) can reuse it.
//
// sportFilter (added 2026-07-15, per direct feedback: showing baseball gear
// while looking at a basketball team would be "weird"): Team Equipment
// never actually had per-item sport before this -- creation hardcoded
// sport='General' for every team-equipment row, so there was no way to tell
// them apart. New team-equipment items now stamp the current team's sport
// automatically (no picker needed, since the context already answers it);
// existing 'General' rows still show everywhere as a shared/generic bucket,
// which is deliberate backward-compat, not a bug -- no migration needed.
// Player gear already had a real sport picker; sportFilter only changes its
// *default* selection, since gear can legitimately be sport-specific in a
// way team equipment generally isn't (a player might own gear for a sport
// other than the team you're currently viewing them through).
// NOTE: this only prevents cross-*sport* bleed. Two different teams that
// play the *same* sport still share one identical equipment pool -- that
// needs real team-scoped ownership in the data model, deliberately deferred
// (confirmed with Jax) as its own project once org equipment is real too.
export function EquipmentTab({data,coachId,refreshLibrary,openModal,mode,sportFilter}){
  const [equipTabState,setEquipTabState]=useState(mode||"team");
  const equipTab=mode||equipTabState;
  const [openMenu,setOpenMenu]=useState(null);
  const [newName,setNewName]=useState("");
  const [newSport,setNewSport]=useState(sportFilter||"General");
  const [showAdd,setShowAdd]=useState(false);
  const [collapsed,setCollapsed]=useState({});
  const matchesSport=a=>!sportFilter||(a.sport||"General")===sportFilter||(a.sport||"General")==="General";
  const teamAssets=(data.assets||[]).filter(a=>(!a.type||a.type==="team")&&matchesSport(a));
  const playerAssets=(data.assets||[]).filter(a=>a.type==="player"&&matchesSport(a));
  const addNew=async()=>{
    if(!newName.trim())return;
    const sport=equipTab==="player"?newSport:(sportFilter||"General");
    await createAsset(coachId,{name:newName.trim(),type:equipTab,sport});
    await refreshLibrary();
    setNewName("");setShowAdd(false);
  };
  const del=async id=>{await archiveAsset(id);await refreshLibrary();};
  return(<div onClick={()=>setOpenMenu(null)}>
    {/* Toggle */}
    {!mode&&<div style={{display:"flex",gap:0,background:"var(--s2)",borderRadius:"var(--r)",padding:3,marginBottom:16}}>
      {["team","player"].map(t=>(<button key={t} onClick={()=>{setEquipTabState(t);setShowAdd(false);}} style={{flex:1,padding:"8px 0",border:"none",cursor:"pointer",borderRadius:"calc(var(--r) - 2px)",background:equipTab===t?"#fff":"transparent",fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".03em",textTransform:"uppercase",color:equipTab===t?"var(--black)":"var(--td)"}}>{t==="team"?"Team Equipment":"Player Gear"}</button>))}
    </div>}

    {/* Team Equipment */}
    {equipTab==="team"&&<div>
      <div className="sechdr mb10">
        <span className="sectitle">{teamAssets.length} items</span>
        <button className="btn primary bsm" onClick={()=>setShowAdd(s=>!s)}>+ Add</button>
      </div>
      {showAdd&&<div className="card mb10">
        <div className="fld"><label className="lbl">Equipment Name</label><input className="inp" autoFocus placeholder="e.g. Ball Rack" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNew()}/></div>
        <div className="brow"><button className="btn ghost bsm" onClick={()=>setShowAdd(false)}>Cancel</button><button className="btn primary bsm" onClick={addNew} disabled={!newName.trim()}>Add</button></div>
      </div>}
      {teamAssets.length===0&&!showAdd&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No team equipment yet.</div>}
      {teamAssets.map(a=>(<div key={a.id} className="li" style={{position:"relative",marginBottom:6}}>
        <div className="lim">
          <div className="lin">{a.name}</div>
        </div>
        <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===a.id?null:a.id);}}><span/><span/><span/></button>
        {openMenu===a.id&&<div className="mini-menu">
          <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editAsset",{asset:a});}}>Edit</button>
          <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);del(a.id);}}>Delete</button>
        </div>}
      </div>))}
    </div>}

    {/* Player Gear */}
    {equipTab==="player"&&<div>
      <div className="sechdr mb10">
        <span className="sectitle">{playerAssets.length} items</span>
        <button className="btn primary bsm" onClick={()=>setShowAdd(s=>!s)}>+ Add Gear</button>
      </div>
      {showAdd&&<div className="card mb12">
        <div className="g2">
          <div className="fld"><label className="lbl">Gear Name</label><input className="inp" autoFocus placeholder="e.g. Batting Helmet" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNew()}/></div>
          <div className="fld"><label className="lbl">Sport</label>
            <select className="sel" value={newSport} onChange={e=>setNewSport(e.target.value)}>
              {["General","Baseball","Basketball","Football","Soccer","Softball","Lacrosse","Hockey","Volleyball","Tennis","Swimming","Other"].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="brow"><button className="btn ghost bsm" onClick={()=>{setShowAdd(false);setNewName("");}}>Cancel</button><button className="btn primary bsm" onClick={addNew} disabled={!newName.trim()}>Add</button></div>
      </div>}
      {playerAssets.length===0&&!showAdd&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>
        <div style={{marginBottom:8}}>No player gear yet.</div>
        <div style={{fontSize:12}}>Add gear here and it will appear as chips when building drills for that sport. Basketball coaches may not need this at all.</div>
      </div>}
      {(()=>{
        // Group by sport
        const bySport={};
        playerAssets.forEach(a=>{const s=a.sport||"General";if(!bySport[s])bySport[s]=[];bySport[s].push(a);});
        const sportKeys=Object.keys(bySport).sort();
        return sportKeys.map(sport=>{
          const isCollapsed=collapsed["pg_"+sport];
          const items=bySport[sport];
          return(<div key={sport} style={{marginBottom:8}}>
            <button onClick={()=>setCollapsed(c=>Object.assign({},c,{["pg_"+sport]:!c["pg_"+sport]}))} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"var(--s1)",border:"none",borderRadius:isCollapsed?"var(--r)":"var(--r) var(--r) 0 0",cursor:"pointer"}}>
              <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,color:"var(--black)"}}>{sport}</span>
              <span style={{fontSize:12,color:"var(--td)"}}>{items.length} item{items.length!==1?"s":""} {isCollapsed?"▶":"▼"}</span>
            </button>
            {!isCollapsed&&<div style={{border:"1px solid var(--b)",borderTop:"none",borderRadius:"0 0 var(--r) var(--r)"}}>
              {items.map((a,i)=>{
                const isEditing=openMenu==="edit_"+a.id;
                return(<div key={a.id}>
                  {!isEditing&&<div className="li" style={{position:"relative",borderBottom:i<items.length-1?"1px solid var(--b)":"none",borderRadius:0}}>
                    <div className="lim"><div className="lin">{a.name}</div></div>
                    <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===a.id?null:a.id);}}><span/><span/><span/></button>
                    {openMenu===a.id&&<div className="mini-menu">
                      <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu("edit_"+a.id);}}>Edit</button>
                      <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);del(a.id);}}>Delete</button>
                    </div>}
                  </div>}
                  {isEditing&&<GearEditRow asset={a} refreshLibrary={refreshLibrary} onDone={()=>setOpenMenu(null)}/>}
                </div>);
              })}
            </div>}
          </div>);
        });
      })()}
    </div>}
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

// ── LocationsSection ──────────────────────────────────────────────────────────
function LocationsSection({data,openModal,refreshPlanning}){
  const [menu,setMenu]=useState(null);
  return(<div onClick={()=>setMenu(null)}>
    <div className="sechdr mb10"><span className="sectitle">{data.locations.length} Locations</span><button className="btn primary bsm" onClick={()=>openModal("addLocation")}>+ Add</button></div>
    {data.locations.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No locations yet.</div>}
    {data.locations.map(loc=>(<div key={loc.id} className="card" style={{position:"relative",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700}}>{loc.name}</span>
        <div className="row">
          <button className="btn ghost bxs" onClick={()=>openModal("addSublocation",{locationId:loc.id})}>+ Area</button>
          <button className="ell-btn" onClick={e=>{e.stopPropagation();setMenu(menu===loc.id?null:loc.id);}}><span/><span/><span/></button>
        </div>
      </div>
      {menu===loc.id&&<div className="mini-menu" style={{right:8,top:44}}>
        <button className="mm-item" onClick={e=>{e.stopPropagation();setMenu(null);openModal("editLocation",{location:loc});}}>Edit</button>
        <button className="mm-item mm-danger" onClick={async e=>{e.stopPropagation();setMenu(null);await archiveLocation(loc.id);await refreshPlanning();}}>Delete</button>
      </div>}
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {loc.sublocations.map(sl=>(<span key={sl.id} className="bdg bs">{sl.name}</span>))}
        {!loc.sublocations.length&&<span style={{fontSize:12,color:"var(--td)"}}>No areas yet</span>}
      </div>
    </div>))}
  </div>);
}

export default function SettingsScreen({data,coachId,openModal,refreshLibrary,refreshPlanning,profile,coachEmail,saveName,onSignOut,onDeactivate}){
  const navigate=useNavigate();
  // null = the top-level list; otherwise which section is drilled into.
  const [section,setSection]=useState(null);
  const NAV_ITEMS=[
    {id:"account",label:"Account",sub:coachEmail||undefined},
    {id:"locations",label:"My Locations",sub:data.locations.length+" location"+(data.locations.length===1?"":"s")},
    {id:"equipment",label:"Equipment & Gear",sub:(data.assets||[]).length+" item"+((data.assets||[]).length===1?"":"s")},
    {id:"skills",label:"Skill Tags",sub:"Your coaching vocabulary for drills and goals"},
  ];
  const BackRow=()=>(<div style={{padding:"12px 14px 0"}}><button className="btn ghost bxs" onClick={()=>setSection(null)}>&#8249; Settings</button></div>);
  const titles={account:"Account",locations:"My Locations",equipment:"Equipment & Gear",skills:"Skill Tags"};

  if(section)return(<div style={{paddingBottom:80}}>
    <BackRow/>
    <div style={{padding:"12px 16px 0"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,marginBottom:14}}>{titles[section]}</div>
      {section==="account"&&<AccountSection profile={profile} coachEmail={coachEmail} saveName={saveName} onSignOut={onSignOut} onDeactivate={onDeactivate}/>}
      {section==="locations"&&<LocationsSection data={data} openModal={openModal} refreshPlanning={refreshPlanning}/>}
      {section==="equipment"&&<EquipmentTab data={data} coachId={coachId} refreshLibrary={refreshLibrary} openModal={openModal}/>}
      {section==="skills"&&<SkillsTab data={data} coachId={coachId} refreshLibrary={refreshLibrary}/>}
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
    </div>
  </div>);
}
