import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { uid, sumMins, localDateStr, planningState, teamsForMode } from "../constants.js";
import { ActConfig, ChecklistConfig, StationConfig, useActivityDnd, useDndSensors, ActivityDndContext, SortableActivityRow, arrayMove } from "./ActivityConfigs.jsx";
import { PublicLibraryScreen } from "./PublicLibraryScreen.jsx";
import { archiveDrill, setDrillOrgShares, setDrillPrivate, copyDrillToMyLibrary, findMissingEquipment, saveTemplateTree, savePracticeTree, archiveTemplate, reorderDrills, createSkillTag, createOrgSkillTag, archiveSkillTag, checkIsAdmin, createGlobalSkillTag, createSkillCategory, archiveSkillCategory, createAsset, createOrgAsset, updateAsset, setAssetLocations, archiveAsset, archiveLocation, createOrgLocation, createLocation, createSublocation, fetchDrillInsightSummaries, fetchTeamGoalReport } from "../supabase.js";
import EquipmentMismatchDialog from "./EquipmentMismatchDialog.jsx";
import DrillInsightsView from "./DrillInsightsView.jsx";

// ── Local icon subset needed by this screen ───────────────────────────────────
const Ic_Dots=()=><svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="4" cy="3.5" r="1.4"/><circle cx="10" cy="3.5" r="1.4"/><circle cx="4" cy="7" r="1.4"/><circle cx="10" cy="7" r="1.4"/><circle cx="4" cy="10.5" r="1.4"/><circle cx="10" cy="10.5" r="1.4"/></svg>;
const Ic_Chev=({up})=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points={up?"4 10 8 6 12 10":"4 6 8 10 12 6"}/></svg>;
// At-a-glance private-drill indicator (direct feedback, twenty-sixth
// session continued) -- small enough to sit inline next to the drill name
// without competing with it.
const Ic_Lock=()=><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2.5" y="5.2" width="7" height="5.3" rx="1"/><path d="M4 5.2V3.6a2 2 0 0 1 4 0v1.6"/></svg>;

// ── ActConfig, ChecklistConfig, StationConfig ─────────────────────────────────
// (kept here since they are only used inside Library/Builder/TemplateWorkspace)

// ── LocationsSection ──────────────────────────────────────────────────────────
// Moved from SettingsScreen.jsx (Library 5-tab redesign) -- a director
// managing an org's shared stuff wants one place for all five content types.
export function LocationsSection({data,openModal,refreshPlanning,coachId,mode}){
  const [menu,setMenu]=useState(null);
  const isOrgMode=mode&&mode.type==="org";
  const locations=(data.locations||[]).filter(l=>isOrgMode?l.organizationId===mode.orgId:l.ownerUserId===coachId);
  const addPayload=isOrgMode?{organizationId:mode.orgId}:undefined;
  return(<div onClick={()=>setMenu(null)}>
    <div className="sechdr mb10"><span className="sectitle">{locations.length} Locations</span><button className="btn primary bsm" onClick={()=>openModal("addLocation",addPayload)}>+ Add</button></div>
    {locations.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No locations yet.</div>}
    {locations.map(loc=>(<div key={loc.id} className="card" style={{position:"relative",marginBottom:10}}>
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

// ── AddLocationDialog ──────────────────────────────────────────────────────────
// Standalone (not the shared openModal("addLocation",...) flow, which has
// no way to hand the new location's id back to the caller) -- Builder and
// SchedulePracticeModal both need to auto-select whatever gets created here
// and resume what the coach was doing, not just refresh a list somewhere
// else. Optional sublocations in the same step so a coach adding "Eastside
// Park" can also set up "Field 1"/"Field 2" right then, but doesn't have to.
// orgId (not the global Coach/Org mode toggle) decides ownership -- based
// on whatever team the caller is actually scheduling/building for, so this
// works correctly even from Builder's own team picker, which isn't
// mode-scoped (a separate, already-known gap this doesn't need to wait on).
export function AddLocationDialog({coachId,orgId,onClose,onCreated}){
  const [name,setName]=useState("");
  const [subNames,setSubNames]=useState([""]);
  const [saving,setSaving]=useState(false);
  const updateSub=(i,v)=>setSubNames(s=>s.map((x,idx)=>idx===i?v:x));
  const submit=async()=>{
    if(!name.trim()||saving)return;
    setSaving(true);
    const {data:loc}=orgId?await createOrgLocation(orgId,name.trim()):await createLocation(coachId,name.trim());
    if(loc){
      for(const s of subNames.map(s=>s.trim()).filter(Boolean))await createSublocation(loc.id,s);
    }
    setSaving(false);
    if(loc&&onCreated)onCreated(loc);
    if(onClose)onClose();
  };
  return (<div className="movly" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal">
      <div className="mhandle"/>
      <div className="mtitle">Add a Location</div>
      <div className="fld mb10"><label className="lbl">Location Name</label><input className="inp" autoFocus placeholder="e.g. Eastside Park" value={name} onChange={e=>setName(e.target.value)}/></div>
      <div className="fld mb10">
        <label className="lbl">Sub-locations (optional)</label>
        {subNames.map((s,i)=>(<div key={i} style={{display:"flex",gap:6,marginBottom:6}}>
          <input className="inp" placeholder="e.g. Field 2" value={s} onChange={e=>updateSub(i,e.target.value)}/>
          {subNames.length>1&&<button type="button" className="btn ghost bxs" onClick={()=>setSubNames(s=>s.filter((_,idx)=>idx!==i))}>&times;</button>}
        </div>))}
        <button type="button" className="btn ghost bxs" onClick={()=>setSubNames(s=>[...s,""])}>+ Add Another</button>
      </div>
      <div className="brow"><button className="btn ghost bmd" onClick={onClose}>Cancel</button><button className="btn primary bmd" disabled={!name.trim()||saving} onClick={submit}>{saving?"Saving...":"Save Location"}</button></div>
    </div>
  </div>);
}

// -- LocationChips, multi-select for which locations a piece of equipment
// is available at. No selection = travels with the coach (available
// everywhere), same convention the schema uses (no asset_locations rows).
export function LocationChips({locations,selectedIds,onToggle,label,emptyHint,selectedHint}){
  if(!locations||locations.length===0)return null;
  return(<div className="fld"><label className="lbl">{label||"Available At"}</label>
    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:4}}>
      {locations.map(l=>(<button key={l.id} type="button" onClick={()=>onToggle(l.id)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:selectedIds.includes(l.id)?"var(--green)":"var(--s1)",color:selectedIds.includes(l.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{l.name}</button>))}
    </div>
    <div style={{fontSize:11,color:"var(--td)"}}>{selectedIds.length===0?(emptyHint||"Travels with you -- available at every location."):(selectedHint||"Only available at the selected location(s).")}</div>
  </div>);
}

// -- GearEditRow, inline edit for a player gear item --
function GearEditRow({asset,locations,refreshLibrary,onDone}){
  const [name,setName]=useState(asset.name);
  const [sport,setSport]=useState(asset.sport||"General");
  const [locationIds,setLocationIds]=useState(asset.locationIds||[]);
  const toggleLoc=id=>setLocationIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const save=async()=>{
    if(!name.trim())return;
    await updateAsset(asset.id,{name:name.trim(),sport});
    await setAssetLocations(asset.id,locationIds);
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
    <LocationChips locations={locations} selectedIds={locationIds} onToggle={toggleLoc}/>
    <div className="brow"><button className="btn ghost bxs" onClick={onDone}>Cancel</button><button className="btn primary bxs" onClick={save} disabled={!name.trim()}>Save</button></div>
  </div>);
}

// ── EquipmentTab ──────────────────────────────────────────────────────────────
// Moved from SettingsScreen.jsx (Library 5-tab redesign). Used two ways:
// unfiltered from Library's Equipment tab (no `forceType`, no `sportFilter`
// -- everything visible for the current Coach/Org mode, across every sport),
// and sport-filtered from inside a team's workspace (sportFilter=team.sport,
// still imported by App.jsx's TeamEquipmentRoute, always Coach-owned there
// since team equipment isn't part of the org/coach split).
// (Renamed the old `mode` param to `forceType` -- it meant "team"/"player"
// equipment-type, a naming collision with the app-wide Coach/Org `mode`
// this function now also needs. It was never actually passed by any call
// site either way.)
export function visibleEquipment(data,coachId,mode){
  const coachTeamSports=new Set((data.teams||[]).map(t=>t.sport).filter(Boolean));
  const isOrgMode=mode&&mode.type==="org";
  return (data.assets||[]).filter(a=>{
    const sport=a.sport||"General";
    if(!(coachTeamSports.has(sport)||sport==="General"))return false;
    // Team-owned equipment (assets.team_id set, organization_id/owner_user_id
    // both null per the exactly-one-owner constraint) never matches either
    // branch below, so it's excluded here the same way it always was --
    // it has its own dedicated per-team Equipment screen.
    return isOrgMode?a.organizationId===mode.orgId:a.ownerUserId===coachId;
  });
}

export function EquipmentTab({data,coachId,refreshLibrary,openModal,forceType,sportFilter,mode}){
  const [equipTabState,setEquipTabState]=useState(forceType||"team");
  const equipTab=forceType||equipTabState;
  const [openMenu,setOpenMenu]=useState(null);
  const [newName,setNewName]=useState("");
  const [newSport,setNewSport]=useState(sportFilter||"General");
  const [newLocationIds,setNewLocationIds]=useState([]);
  const toggleNewLoc=id=>setNewLocationIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const [showAdd,setShowAdd]=useState(false);
  const [collapsed,setCollapsed]=useState({});
  const isOrgMode=mode&&mode.type==="org";
  const myLocations=(data.locations||[]).filter(l=>isOrgMode?l.organizationId===mode.orgId:l.ownerUserId===coachId);
  // Real bug found live: the sportFilter (Team-tab) path used to filter
  // *only* by sport against the raw, RLS-scoped-but-unfiltered data.assets
  // -- with no owner/org check at all, so it leaked in Public Library
  // catalog equipment (source_catalog_id rows, visible to every coach via
  // a deliberate RLS carve-out for catalog content) and, in principle, any
  // other coach's owned assets that happened to share a sport. That's what
  // produced "9 baseball items already there, cones twice" for a coach who
  // never added any. Reusing the same visibleEquipment scoping the Library
  // tab already uses (own/org, catalog rows excluded) and narrowing to
  // just this one team's sport fixes both the leak and the cross-screen
  // inconsistency in one move.
  const baseAssets=sportFilter
    ?visibleEquipment(data,coachId,mode).filter(a=>(a.sport||"General")===sportFilter||(a.sport||"General")==="General")
    :visibleEquipment(data,coachId,mode);
  const teamAssets=baseAssets.filter(a=>!a.type||a.type==="team");
  const playerAssets=baseAssets.filter(a=>a.type==="player");
  const locNames=ids=>(ids||[]).map(id=>{const l=myLocations.find(l=>l.id===id);return l?l.name:null;}).filter(Boolean);
  const addNew=async()=>{
    if(!newName.trim())return;
    const sport=(equipTab==="player"||!sportFilter)?newSport:sportFilter;
    let created=null;
    if(isOrgMode&&!sportFilter){const {data:d}=await createOrgAsset(mode.orgId,{name:newName.trim(),type:equipTab,sport});created=d;}
    else{const {data:d}=await createAsset(coachId,{name:newName.trim(),type:equipTab,sport});created=d;}
    if(created&&newLocationIds.length)await setAssetLocations(created.id,newLocationIds);
    await refreshLibrary();
    setNewName("");setNewLocationIds([]);setShowAdd(false);
  };
  const del=async id=>{await archiveAsset(id);await refreshLibrary();};
  const AssetRow=({a,borderBottom,onEdit})=>{
    const locs=locNames(a.locationIds);
    return(<div className="li" style={{position:"relative",marginBottom:borderBottom===undefined?6:0,borderBottom,borderRadius:borderBottom!==undefined?0:undefined}}>
      <div className="lim">
        <div className="lin">{a.name}</div>
        {locs.length>0&&<div className="limt">📍 {locs.join(", ")}</div>}
      </div>
      <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===a.id?null:a.id);}}><span/><span/><span/></button>
      {openMenu===a.id&&<div className="mini-menu">
        <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);(onEdit||(()=>openModal("editAsset",{asset:a})))();}}>Edit</button>
        <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);del(a.id);}}>Delete</button>
      </div>}
    </div>);
  };
  // Grouped by sport whenever the sport isn't already fixed by context
  // (sportFilter) -- keeps the unfiltered Library/Org equipment screen from
  // dumping every sport's gear into one noisy flat list, same treatment
  // Player Gear already had.
  const BySportList=({items,prefix,renderRow})=>{
    if(!sportFilter){
      const bySport={};
      items.forEach(a=>{const s=a.sport||"General";if(!bySport[s])bySport[s]=[];bySport[s].push(a);});
      const sportKeys=Object.keys(bySport).sort();
      return sportKeys.map(sport=>{
        const isCollapsed=collapsed[prefix+sport];
        const its=bySport[sport];
        return(<div key={sport} style={{marginBottom:8}}>
          <button onClick={()=>setCollapsed(c=>Object.assign({},c,{[prefix+sport]:!c[prefix+sport]}))} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"var(--s1)",border:"none",borderRadius:isCollapsed?"var(--r)":"var(--r) var(--r) 0 0",cursor:"pointer"}}>
            <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,color:"var(--green)"}}>{sport}</span>
            <span style={{fontSize:12,color:"var(--td)"}}>{its.length} item{its.length!==1?"s":""} {isCollapsed?"▶":"▼"}</span>
          </button>
          {!isCollapsed&&<div style={{border:"1px solid var(--b)",borderTop:"none",borderRadius:"0 0 var(--r) var(--r)"}}>
            {its.map((a,i)=>renderRow(a,i<its.length-1?"1px solid var(--b)":"none"))}
          </div>}
        </div>);
      });
    }
    return items.map(a=>renderRow(a));
  };
  return(<div onClick={()=>setOpenMenu(null)}>
    {!forceType&&<div style={{display:"flex",gap:0,background:"var(--s2)",borderRadius:"var(--r)",padding:3,marginBottom:16}}>
      {["team","player"].map(t=>(<button key={t} onClick={()=>{setEquipTabState(t);setShowAdd(false);}} style={{flex:1,padding:"8px 0",border:"none",cursor:"pointer",borderRadius:"calc(var(--r) - 2px)",background:equipTab===t?"#fff":"transparent",fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".03em",textTransform:"uppercase",color:equipTab===t?"var(--black)":"var(--td)"}}>{t==="team"?"Team Equipment":"Player Gear"}</button>))}
    </div>}

    {equipTab==="team"&&<div>
      <div className="sechdr mb10">
        <span className="sectitle">{teamAssets.length} items</span>
        <button className="btn primary bsm" onClick={()=>setShowAdd(s=>!s)}>+ Add</button>
      </div>
      {showAdd&&<div className="card mb10">
        <div className={sportFilter?undefined:"g2"}>
          <div className="fld"><label className="lbl">Equipment Name</label><input className="inp" autoFocus placeholder="e.g. Ball Rack" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNew()}/></div>
          {!sportFilter&&<div className="fld"><label className="lbl">Sport</label>
            <select className="sel" value={newSport} onChange={e=>setNewSport(e.target.value)}>
              {["General","Baseball","Basketball","Football","Soccer","Softball","Lacrosse","Hockey","Volleyball","Tennis","Swimming","Other"].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>}
        </div>
        <LocationChips locations={myLocations} selectedIds={newLocationIds} onToggle={toggleNewLoc}/>
        <div className="brow"><button className="btn ghost bsm" onClick={()=>{setShowAdd(false);setNewLocationIds([]);}}>Cancel</button><button className="btn primary bsm" onClick={addNew} disabled={!newName.trim()}>Add</button></div>
      </div>}
      {teamAssets.length===0&&!showAdd&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No team equipment yet.</div>}
      <BySportList items={teamAssets} prefix="te_" renderRow={(a,borderBottom)=><AssetRow key={a.id} a={a} borderBottom={borderBottom}/>}/>
    </div>}

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
        <LocationChips locations={myLocations} selectedIds={newLocationIds} onToggle={toggleNewLoc}/>
        <div className="brow"><button className="btn ghost bsm" onClick={()=>{setShowAdd(false);setNewName("");setNewLocationIds([]);}}>Cancel</button><button className="btn primary bsm" onClick={addNew} disabled={!newName.trim()}>Add</button></div>
      </div>}
      {playerAssets.length===0&&!showAdd&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No player gear yet.</div>}
      {(()=>{
        const bySport={};
        playerAssets.forEach(a=>{const s=a.sport||"General";if(!bySport[s])bySport[s]=[];bySport[s].push(a);});
        const sportKeys=Object.keys(bySport).sort();
        return sportKeys.map(sport=>{
          const isCollapsed=collapsed["pg_"+sport];
          const items=bySport[sport];
          return(<div key={sport} style={{marginBottom:8}}>
            <button onClick={()=>setCollapsed(c=>Object.assign({},c,{["pg_"+sport]:!c["pg_"+sport]}))} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"var(--s1)",border:"none",borderRadius:isCollapsed?"var(--r)":"var(--r) var(--r) 0 0",cursor:"pointer"}}>
              <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,color:"var(--green)"}}>{sport}</span>
              <span style={{fontSize:12,color:"var(--td)"}}>{items.length} item{items.length!==1?"s":""} {isCollapsed?"▶":"▼"}</span>
            </button>
            {!isCollapsed&&<div style={{border:"1px solid var(--b)",borderTop:"none",borderRadius:"0 0 var(--r) var(--r)"}}>
              {items.map((a,i)=>{
                const isEditing=openMenu==="edit_"+a.id;
                return(<div key={a.id}>
                  {!isEditing&&<AssetRow a={a} borderBottom={i<items.length-1?"1px solid var(--b)":"none"} onEdit={()=>setOpenMenu("edit_"+a.id)}/>}
                  {isEditing&&<GearEditRow asset={a} locations={myLocations} refreshLibrary={refreshLibrary} onDone={()=>setOpenMenu(null)}/>}
                </div>);
              })}
            </div>}
          </div>);
        });
      })()}
    </div>}
  </div>);
}

// ── SkillsTab ─────────────────────────────────────────────────────────────────
// skill_categories are curated/read-only (no coach-writable INSERT policy),
// but skill_tags underneath each category are per-coach (scope='coach') --
// seeded with starter tags on signup, fully add/removable here after that.
// Broken out by sport since a category name like "Team Play" exists under
// both Baseball and Basketball with different tags underneath.
// Exported for SettingsScreen (nav restructure, 2026-07-15): the taxonomy is
// coaching *vocabulary* -- configuration, not content -- so its management
// page moved out of Library into Settings. The drill editor's own inline
// Add/Edit Skill Tags flow still covers the frequent in-context case.
export function SkillsTab({data,coachId,refreshLibrary,isAdmin,mode}){
  const [collapsed,setCollapsed]=useState({});
  const [drafts,setDrafts]=useState({});
  const [globalDrafts,setGlobalDrafts]=useState({});
  const [newCatDrafts,setNewCatDrafts]=useState({});
  const cats=(data.skillCategories||[]).filter(c=>!c.archived_at);
  const isOrgMode=mode&&mode.type==="org";
  // Global tags (curated, everyone's) always show. Coach mode adds this
  // coach's own scope='coach' tags; Org mode adds the org's scope='org'
  // tags instead -- mirrors the Drills/Templates own-vs-org split.
  const tags=(data.skillTags||[]).filter(t=>t.scope==="global"||(isOrgMode?(t.scope==="org"&&t.organizationId===mode.orgId):(t.scope==="coach"&&t.ownerUserId===coachId)));
  // Every coach gets starter tags seeded for every sport with a curated
  // taxonomy, regardless of which teams they actually coach -- a
  // basketball-only coach doesn't want to wade through Baseball's 7
  // categories to find their own. Scope the sport groupings shown here to
  // the sports of the coach's own teams -- unless this is the founder-admin
  // managing the taxonomy itself, who needs every sport regardless of what
  // teams they personally coach.
  // teamsForMode, not a bare data.teams map: data.teams also includes any
  // team the coach has a pending (not yet accepted) invite to -- teams_
  // select_access intentionally makes that row visible so the Home accept/
  // decline card can show its name, but that's not real membership yet.
  // Without this, an invited-but-not-accepted coach saw that team's sport's
  // skill tags here before they'd actually joined anything.
  const myTeamSports=new Set(teamsForMode(data.teams,mode,coachId).map(t=>t.sport).filter(Boolean));
  const sports=[...new Set(cats.map(c=>c.sport))].filter(s=>isAdmin||myTeamSports.has(s)).sort();
  const del=async id=>{await archiveSkillTag(id);await refreshLibrary();};
  const add=async categoryId=>{
    const name=(drafts[categoryId]||"").trim();
    if(!name)return;
    if(isOrgMode)await createOrgSkillTag(mode.orgId,{categoryId,name});
    else await createSkillTag(coachId,{categoryId,name});
    setDrafts(p=>Object.assign({},p,{[categoryId]:""}));
    await refreshLibrary();
  };
  const addGlobal=async categoryId=>{
    const name=(globalDrafts[categoryId]||"").trim();
    if(!name)return;
    await createGlobalSkillTag({categoryId,name});
    setGlobalDrafts(p=>Object.assign({},p,{[categoryId]:""}));
    await refreshLibrary();
  };
  const addCategory=async sport=>{
    const name=(newCatDrafts[sport]||"").trim();
    if(!name)return;
    const sportCats=cats.filter(c=>c.sport===sport);
    const sortOrder=sportCats.length?Math.max(...sportCats.map(c=>c.sort_order||0))+1:0;
    await createSkillCategory({sport,name,sortOrder});
    setNewCatDrafts(p=>Object.assign({},p,{[sport]:""}));
    await refreshLibrary();
  };
  const delCategory=async id=>{await archiveSkillCategory(id);await refreshLibrary();};
  if(cats.length===0)return <div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No skill categories set up yet.</div>;
  if(sports.length===0)return <div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>Add or join a team to see skill tags for its sport here.</div>;
  return(<div>
    {sports.map(sport=>{
      const isCollapsed=collapsed[sport];
      const sportCats=cats.filter(c=>c.sport===sport).slice().sort((a,b)=>a.sort_order-b.sort_order);
      const tagCount=tags.filter(t=>sportCats.some(c=>c.id===t.categoryId)).length;
      return(<div key={sport} style={{marginBottom:8}}>
        <button onClick={()=>setCollapsed(c=>Object.assign({},c,{[sport]:!c[sport]}))} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"var(--s1)",border:"none",borderRadius:isCollapsed?"var(--r)":"var(--r) var(--r) 0 0",cursor:"pointer"}}>
          <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,color:"var(--green)"}}>{sport}</span>
          <span style={{fontSize:12,color:"var(--td)"}}>{tagCount} tag{tagCount!==1?"s":""} {isCollapsed?"▶":"▼"}</span>
        </button>
        {!isCollapsed&&<div style={{border:"1px solid var(--b)",borderTop:"none",borderRadius:"0 0 var(--r) var(--r)",padding:"12px"}}>
          {sportCats.map((cat,i)=>{
            const catTags=tags.filter(t=>t.categoryId===cat.id);
            return(<div key={cat.id} style={{marginBottom:i<sportCats.length-1?16:0}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--td)",textTransform:"uppercase",letterSpacing:".06em"}}>{cat.name}</div>
                {isAdmin&&<button type="button" onClick={()=>delCategory(cat.id)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--td)",fontSize:11}}>Remove category</button>}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                {catTags.map(t=>(<span key={t.id} className="bdg bs" style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 6px 4px 10px"}}>
                  {t.name}
                  <button type="button" onClick={()=>del(t.id)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--td)",fontSize:14,lineHeight:1,padding:"0 2px"}}>×</button>
                </span>))}
                {catTags.length===0&&<span style={{fontSize:12,color:"var(--td)"}}>No tags yet</span>}
              </div>
              <div style={{display:"flex",gap:6}}>
                <input className="inp" placeholder={"Add a "+cat.name.toLowerCase()+" tag..."} style={{flex:1}} value={drafts[cat.id]||""} onChange={e=>setDrafts(p=>Object.assign({},p,{[cat.id]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&add(cat.id)}/>
                <button type="button" className="btn ghost bxs" onClick={()=>add(cat.id)}>Add</button>
              </div>
              {isAdmin&&<div style={{display:"flex",gap:6,marginTop:6}}>
                <input className="inp" placeholder={"Add a global "+cat.name.toLowerCase()+" tag (visible to everyone)..."} style={{flex:1}} value={globalDrafts[cat.id]||""} onChange={e=>setGlobalDrafts(p=>Object.assign({},p,{[cat.id]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addGlobal(cat.id)}/>
                <button type="button" className="btn ghost bxs" onClick={()=>addGlobal(cat.id)}>Add Global</button>
              </div>}
            </div>);
          })}
          {isAdmin&&<div style={{display:"flex",gap:6,marginTop:sportCats.length?16:0,paddingTop:sportCats.length?12:0,borderTop:sportCats.length?"1px solid var(--b)":"none"}}>
            <input className="inp" placeholder="New category name..." style={{flex:1}} value={newCatDrafts[sport]||""} onChange={e=>setNewCatDrafts(p=>Object.assign({},p,{[sport]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addCategory(sport)}/>
            <button type="button" className="btn ghost bxs" onClick={()=>addCategory(sport)}>+ Category</button>
          </div>}
        </div>}
      </div>);
    })}
  </div>);
}

// ── TemplateWorkspace ─────────────────────────────────────────────────────────
// team/players/coach assignment is deliberately NOT shown while editing a
// template (team={null} passed to ActConfig/StationConfig below) -- templates
// aren't team-scoped in the new schema (reusable across every team a coach
// coaches), so there's nowhere to persist a specific coach or player
// assignment at the template level, only sublocation (coach/org-owned, not
// team-owned). teamId is a real persisted column (default_team_id) even
// though it's optional -- defaults to "" (None), never auto-picked, so a
// coach's explicit "None" choice sticks across reopens instead of reverting.
// This screen is purely for building/editing the template itself -- no
// Schedule here. Turning a template into an actual practice happens two
// ways: "Build Practice from Template" (once saved) hands off to Builder as
// a brand-new, non-editing practice seeded with the template's activities;
// "Run Now" skips Builder and launches a live session directly from
// whatever's currently in the editor, saved or not.
export function TemplateWorkspace({data,template,onBack,openModal,coachId,refreshLibrary,refreshPlanning,onStartFromTemplate,onRunNow}){
  const [name,setName]=useState(template.name);
  const [sport,setSport]=useState(template.sport||"General");
  const [teamId,setTeamId]=useState(template.defaultTeamId||"");
  const [locId,setLocId]=useState(()=>template.locationId||(data.locations[0]?data.locations[0].id:""));
  const [acts,setActs]=useState(()=>JSON.parse(JSON.stringify(template.activities||[])));
  const [existingId,setExistingId]=useState(template.id);
  const [expandedId,setExpandedId]=useState(null);
  const [savedMsg,setSavedMsg]=useState(null);
  const [newTplName,setNewTplName]=useState("");
  const [showNewTpl,setShowNewTpl]=useState(false);
  const [confirmLeave,setConfirmLeave]=useState(null); // null | "startFromTemplate"
  const [runBusy,setRunBusy]=useState(false);
  // Direct feedback: this screen's Location field had no way to add a new
  // location inline -- a coach whose actual location wasn't in the list yet
  // had to abandon the template, go add it elsewhere, then come back. Same
  // "+ Add New Location..." option (and zero-locations fallback button)
  // Builder already offers.
  const [showAddLocation,setShowAddLocation]=useState(false);
  // A freshly-created template placeholder (from "+ New Template") has a
  // locally-generated uid(), not a real UUID -- checked live off existingId
  // (not frozen at mount) so Save as New/Start from Template appear the
  // moment a brand-new template's first save returns a real row.
  const isSaved=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existingId||"");
  const loc=data.locations.find(l=>l.id===locId)||null;
  // Same team-scoped Location filtering as Builder -- no default team, or a
  // team with no locations assigned yet, shows every location; the current
  // value always stays in the list even if it falls outside the team's set.
  const defaultTeam=data.teams.find(t=>t.id===teamId)||null;
  const teamLocations=(!defaultTeam||!defaultTeam.locationIds||!defaultTeam.locationIds.length)
    ?data.locations
    :data.locations.filter(l=>defaultTeam.locationIds.includes(l.id)||l.id===locId);
  const updAct=(id,ch)=>setActs(p=>p.map(a=>a.id===id?Object.assign({},a,ch):a));
  const updSt=(aid,sid,ch)=>setActs(p=>p.map(a=>a.id===aid?Object.assign({},a,{stations:a.stations.map(s=>s.id===sid?Object.assign({},s,ch):s)}):a));
  const remAct=id=>{setActs(p=>p.filter(a=>a.id!==id));if(lastAddedId===id)setLastAddedId(null);};
  const {sensors:dndSensors,onDragEnd:onActDragEnd}=useActivityDnd(setActs);
  // See BuilderScreen's identical field for why this exists -- pins the
  // just-tapped drill to the top of the screen as tap feedback while
  // scrolled deep in the "Add to Template" picker below.
  const [lastAddedId,setLastAddedId]=useState(null);
  const equipNames=ids=>(Array.isArray(ids)?ids:[]).map(id=>{const a=data.assets.find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);
  const skillTagsById=Object.fromEntries((data.skillTags||[]).map(t=>[t.id,t]));
  const tagNames=ids=>(ids||[]).map(id=>skillTagsById[id]?skillTagsById[id].name:null).filter(Boolean);

  // A template activity is a snapshot of the drill at add-time (by design --
  // see the handoff note above on TemplateWorkspace not doing live drill
  // references), so it silently drifts from the library drill's current
  // fields whenever that drill gets edited afterward. Rather than either
  // auto-syncing (would clobber an intentionally-customized field) or
  // staying silent (a coach has no way to notice), flag the drift and let
  // the coach decide per activity.
  const drillById=Object.fromEntries((data.activityLibrary||[]).map(d=>[d.id,d]));
  const idsEqual=(a,b)=>{const sa=[...(a||[])].sort(),sb=[...(b||[])].sort();return sa.length===sb.length&&sa.every((v,i)=>v===sb[i]);};
  // Duration is deliberately excluded -- coaches shorten/lengthen a drill
  // per-instance often enough that comparing it against the library
  // default would flag practically every activity, drowning out the
  // signal for fields that actually mean the drill itself changed.
  const isStale=act=>{
    if(act.type!=="activity"||!act.libraryId)return false;
    const d=drillById[act.libraryId];
    if(!d)return false;
    return act.name!==d.name||(act.description||"")!==(d.description||"")||(act.coachingPoints||"")!==(d.coachingPoints||"")||(act.grouping||"whole")!==(d.grouping||"whole")||(act.numGroups||2)!==(d.numGroups||2)||(act.playerGear||"")!==(d.playerGear||"")||!idsEqual(act.equipment,d.equipment);
  };
  const refreshFromLibrary=act=>{
    const d=drillById[act.libraryId];
    if(!d)return;
    updAct(act.id,{name:d.name,description:d.description||"",coachingPoints:d.coachingPoints||"",grouping:d.grouping||"whole",numGroups:d.numGroups||2,playerGear:d.playerGear||"",equipment:Array.isArray(d.equipment)?d.equipment:[]});
    setStaleMenuId(null);
  };
  const [staleMenuId,setStaleMenuId]=useState(null);

  // Dirty-tracking mirrors BuilderScreen's savedSnapshotRef pattern -- lets
  // Save Template gray out when there's nothing to save, and lets Back/
  // Build Practice from Template warn before silently discarding edits
  // (previously this screen had no such guard at all).
  const snapshot=()=>JSON.stringify({name,sport,teamId,locId,acts});
  const savedSnapshotRef=useRef();
  if(savedSnapshotRef.current===undefined)savedSnapshotRef.current=snapshot();
  const [dirty,setDirty]=useState(false);
  useEffect(()=>{setDirty(snapshot()!==savedSnapshotRef.current);},[name,sport,teamId,locId,acts]);
  useEffect(()=>{
    if(!dirty)return;
    const onBeforeUnload=e=>{e.preventDefault();e.returnValue="";};
    window.addEventListener("beforeunload",onBeforeUnload);
    return()=>window.removeEventListener("beforeunload",onBeforeUnload);
  },[dirty]);

  const handleSave=async()=>{
    const {data:saved}=await saveTemplateTree(coachId,existingId,{name,sport,locationId:locId,teamId,activities:acts});
    if(saved)setExistingId(saved.id);
    savedSnapshotRef.current=snapshot();
    setDirty(false);
    await refreshPlanning();
    setSavedMsg("Template saved!");
    setTimeout(()=>setSavedMsg(null),2000);
  };

  const handleSaveAsNew=async()=>{
    if(!newTplName.trim())return;
    await saveTemplateTree(coachId,null,{name:newTplName.trim(),sport,locationId:locId,teamId,activities:acts});
    await refreshPlanning();
    setSavedMsg("Saved as \""+newTplName.trim()+"\"!");
    setShowNewTpl(false);setNewTplName("");
    setTimeout(()=>setSavedMsg(null),2000);
  };

  const handleBack=()=>{
    if(dirty&&!window.confirm("You have unsaved changes to this template. Leave without saving?"))return;
    onBack();
  };

  // "Build Practice from Template" hands off to Builder using whatever's
  // currently persisted for this template (stripIdsForCopy happens on the
  // Builder side) -- if there are in-editor edits that were never saved,
  // Builder would silently start from the old, saved version, so this
  // confirms first rather than losing them without warning.
  const goBuildPractice=()=>{
    if(dirty){setConfirmLeave("startFromTemplate");return;}
    onStartFromTemplate&&onStartFromTemplate(existingId);
  };
  const confirmSaveAndContinue=async()=>{
    await handleSave();
    setConfirmLeave(null);
    onStartFromTemplate&&onStartFromTemplate(existingId);
  };
  const confirmDiscardAndContinue=()=>{
    setConfirmLeave(null);
    onStartFromTemplate&&onStartFromTemplate(existingId);
  };

  // Run Now skips Builder entirely -- spins up a one-off practice straight
  // from whatever's in the editor right now (saved or not) and jumps into
  // a live session, same as Builder's own Run Now. Doesn't touch the
  // template row, so there's no unsaved-changes risk to warn about here.
  const handleRunNow=async()=>{
    if(!teamId||runBusy)return;
    setRunBusy(true);
    const team=data.teams.find(t=>t.id===teamId);
    const {data:saved}=await savePracticeTree(null,{teamId,locationId:locId,date:localDateStr(),startTime:new Date().toTimeString().slice(0,5),timezone:team&&team.timezone,activities:acts,coachId});
    setRunBusy(false);
    if(saved&&onRunNow)onRunNow(saved.id);
  };

  return (<div style={{paddingBottom:100}}>
    {/* Header */}
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
      <button className="btn ghost bxs" onClick={handleBack}>Back</button>
      <div style={{flex:1,minWidth:0}}>
        <input className="inp" value={name} onChange={e=>setName(e.target.value)} style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,border:"none",background:"transparent",padding:0,width:"100%"}}/>
      </div>
    </div>

    {/* Template meta */}
    <div className="card mb10">
      <div className="clbl mb8">Template Settings</div>
      <div className="g2">
        <div className="fld"><label className="lbl">Sport</label>
          <select className="sel" value={sport} onChange={e=>setSport(e.target.value)}>
            {["General","Baseball","Basketball","Football","Soccer","Softball","Volleyball","Other"].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="fld"><label className="lbl">Default Team</label>
          <select className="sel" value={teamId} onChange={e=>{
            const tid=e.target.value;
            setTeamId(tid);
            const t=data.teams.find(t=>t.id===tid);
            if(t&&t.sport)setSport(t.sport);
          }}>
            <option value="">None</option>
            {data.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div className="fld"><label className="lbl">Default Location</label>
        {teamLocations.length>0?(
          <select className="sel" value={locId} onChange={e=>{const v=e.target.value;if(v==="__add_new__"){setShowAddLocation(true);return;}setLocId(v);}}>
            <option value="">None</option>
            {teamLocations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="__add_new__">+ Add New Location...</option>
          </select>
        ):(
          <button type="button" className="btn outline bsm bfull" onClick={()=>setShowAddLocation(true)}>+ Add a Location</button>
        )}
      </div>
    </div>
    {showAddLocation&&<AddLocationDialog coachId={coachId} orgId={defaultTeam&&defaultTeam.organizationId} onClose={()=>setShowAddLocation(false)} onCreated={async(loc)=>{await refreshPlanning();setLocId(loc.id);}}/>}

    <div className="sechdr mb8"><span className="sectitle">{acts.length} Activities</span><span className="pill">{sumMins(acts)}m</span></div>

    <ActivityDndContext sensors={dndSensors} onDragEnd={onActDragEnd} items={acts.map(a=>a.id)}>
    {acts.map((act)=>(<SortableActivityRow key={act.id} id={act.id} sticky={act.id===lastAddedId&&expandedId!==act.id}>{dragHandle=>(<div>
      <div className="ablk">
        {/* See BuilderScreen's identical comment -- expanding a just-added
            station block (very tall once open) used to stay pinned via the
            sticky feedback, making scrolling past it feel broken. */}
        <div className="abhdr" onClick={()=>{const willExpand=expandedId!==act.id;setExpandedId(willExpand?act.id:null);if(willExpand&&act.id===lastAddedId)setLastAddedId(null);}}>
          {dragHandle}
          <div style={{flex:1,minWidth:0}}>
            <div style={{font:"700 14px Barlow Condensed,sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {act.type==="station_block"?"Station Block":act.name}
            </div>
            {act.type==="station_block"&&<div className="limt">{act.stations.map(s=>s.activityName||s.name).join(" / ")} · {act.stationDuration}m×{act.stations.length}{act.rotate!==false?" rotates":""}</div>}
            {act.type==="activity"&&<div className="limt">
              {act.duration}min
              {act.grouping&&act.grouping!=="whole"?" · "+(act.grouping==="partners"?"Partners":act.numGroups+" groups"):""}
              {equipNames(act.equipment).length>0?" · "+equipNames(act.equipment).join(", "):""}
              {act.playerGear?" · "+act.playerGear:""}
            </div>}
          </div>
          <div className="row">
            {act.type==="activity"&&isStale(act)&&<div style={{position:"relative"}}>
              <button type="button" onClick={e=>{e.stopPropagation();setStaleMenuId(staleMenuId===act.id?null:act.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 2px",display:"flex",alignItems:"center"}} aria-label="Drill updated since added" title="This drill has changed in your library since it was added here">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 2L18.5 17H1.5L10 2Z" fill="#f59e0b" stroke="#b45309" strokeWidth="1" strokeLinejoin="round"/><rect x="9.1" y="7.5" width="1.8" height="5" rx="0.9" fill="#fff"/><rect x="9.1" y="13.3" width="1.8" height="1.8" rx="0.9" fill="#fff"/></svg>
              </button>
              {staleMenuId===act.id&&<div className="mini-menu" style={{right:0,minWidth:220,padding:10}} onClick={e=>e.stopPropagation()}>
                <div style={{fontSize:12,color:"var(--td)",marginBottom:8,lineHeight:1.4}}>This drill has changed in your library since it was added here.</div>
                <button type="button" className="btn primary bxs bfull" style={{marginBottom:6}} onClick={()=>refreshFromLibrary(act)}>Refresh to Latest</button>
                <button type="button" className="btn ghost bxs bfull" onClick={()=>setStaleMenuId(null)}>Keep This Version</button>
              </div>}
            </div>}
            {act.type!=="station_block"&&<span className="bdg bp">{act.duration}m</span>}
            {act.type==="station_block"&&<span className="bdg bp">{act.stations.length*act.stationDuration+(act.rotate!==false?Math.max(0,act.stations.length-1)*(act.transitionDuration||0):0)}m</span>}
            <button className="btn danger bxs" onClick={e=>{e.stopPropagation();remAct(act.id);}}>×</button>
          </div>
        </div>
        {expandedId===act.id&&(<div className="abbody">
          {act.type==="activity"&&<ActConfig assets={data.assets} coachId={coachId} refreshLibrary={refreshLibrary} act={act} team={null} loc={loc} sport={sport} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)} libraryDrills={data.activityLibrary} skillTags={data.skillTags}/>}
          {act.type==="checklist"&&<ChecklistConfig act={act} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
          {act.type==="station_block"&&<StationConfig assets={data.assets} coachId={coachId} refreshLibrary={refreshLibrary} act={act} team={null} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)} teamSport={sport} libraryDrills={data.activityLibrary} skillTags={data.skillTags}/>}
        </div>)}
      </div>
    </div>)}</SortableActivityRow>
    ))}
    </ActivityDndContext>

    {/* Add drills panel, same as builder */}
    <div style={{borderTop:"1px solid var(--b)",paddingTop:14,marginTop:8}}>
      <div className="sechdr mb8">
        <span className="sectitle">Add to Template</span>
        <button className="btn ghost bxs" onClick={()=>openModal&&openModal("addActivity")}>+ New Drill</button>
      </div>
      <div className="g2" style={{marginBottom:6}}>
        <div className="li tap" style={{marginBottom:0}} onClick={()=>{const id=uid();setActs(p=>[...p,{id,type:"checklist",name:"Intro",items:[],notes:"",duration:5}]);setLastAddedId(id);}}>
          <div className="lim"><div className="lin">Intro</div><div className="limt">Checklist</div></div>
          <span style={{color:"var(--green)",fontSize:18,fontWeight:700}}>+</span>
        </div>
        <div className="li tap" style={{marginBottom:0}} onClick={()=>{const id=uid();setActs(p=>[...p,{id,type:"checklist",name:"Closer",items:[],notes:"",duration:5}]);setLastAddedId(id);}}>
          <div className="lim"><div className="lin">Closer</div><div className="limt">Checklist</div></div>
          <span style={{color:"var(--green)",fontSize:18,fontWeight:700}}>+</span>
        </div>
      </div>
      <div className="li tap" style={{marginBottom:6,background:"var(--gbg)",borderColor:"var(--gb)"}} onClick={()=>{
        const b={id:uid(),type:"station_block",rotate:true,stationDuration:10,transitionDuration:2,stations:[
          {id:uid(),name:"Station 1",activityName:"",coachId:"",sublocationId:"",assignments:[],coachingPoints:"",equipment:[],playerGear:""},
          {id:uid(),name:"Station 2",activityName:"",coachId:"",sublocationId:"",assignments:[],coachingPoints:"",equipment:[],playerGear:""},
        ]};
        setActs(p=>[...p,b]);setExpandedId(b.id);setLastAddedId(b.id);
      }}>
        <div className="lim"><div className="lin" style={{color:"var(--green)"}}>Station Block</div><div className="limt">2 stations, add or remove as needed</div></div>
        <span style={{color:"var(--green)",fontSize:22,fontWeight:700,flexShrink:0}}>+</span>
      </div>
      {(()=>{
        const tplSport=sport||"General";
        // Same exclusion as StationConfig's quick-picker -- public-catalog
        // drills reference catalog-owned equipment, which can't link to a
        // personal template. Copy from Explore first.
        const filtered=(data.activityLibrary||[]).filter(a=>!a.sourceCatalogId).filter(a=>(a.sport||"General")===tplSport||(a.sport||"General")==="General");
        if(filtered.length===0)return(<div style={{padding:"16px 0",textAlign:"center",color:"var(--td)",fontSize:13}}>No drills in library for {tplSport} yet.</div>);
        return(<div>
          <div className="clbl" style={{marginBottom:8}}>{tplSport} + General</div>
          {filtered.map(lib=>(<div key={lib.id} className="li tap" onClick={()=>{const id=uid();setActs(p=>[...p,{id,type:"activity",libraryId:lib.id,name:lib.name,duration:lib.duration,assignments:[],coachId:"",sublocationId:"",notes:"",description:lib.description||"",coachingPoints:lib.coachingPoints||"",grouping:lib.grouping||"whole",numGroups:lib.numGroups||2,playerGear:lib.playerGear||"",equipment:Array.isArray(lib.equipment)?lib.equipment:[]}]);setLastAddedId(id);}}>
            <div className="lim">
              <div className="lin">{lib.name}</div>
              <div className="limt">{lib.duration}min{lib.description?" - "+lib.description:""}</div>
              {lib.coachingPoints&&<div style={{fontSize:11,color:"var(--green2)",marginTop:2}}>{lib.coachingPoints}</div>}
              {lib.skillTagIds&&lib.skillTagIds.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
                {tagNames(lib.skillTagIds).map(name=>(<span key={name} className="bdg bs" style={{fontSize:10}}>{name}</span>))}
              </div>}
            </div>
            <div className="lir"><span className="bdg bp">{lib.duration}m</span><span style={{color:"var(--green)",fontSize:20,fontWeight:700,marginLeft:4}}>+</span></div>
          </div>))}
        </div>);
      })()}
    </div>

    {/* Saved confirmation */}
    {savedMsg&&<div style={{textAlign:"center",padding:"10px",color:"var(--green)",fontWeight:700,fontSize:14}}>{savedMsg}</div>}

    {/* Save as new template */}
    {showNewTpl&&<div className="card mt10">
      <div className="clbl mb8">Save as New Template</div>
      <div className="fld"><input className="inp" autoFocus placeholder="New template name..." value={newTplName} onChange={e=>setNewTplName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSaveAsNew()}/></div>
      <div className="brow"><button className="btn ghost bsm" onClick={()=>{setShowNewTpl(false);setNewTplName("");}}>Cancel</button><button className="btn primary bsm" onClick={handleSaveAsNew} disabled={!newTplName.trim()}>Save</button></div>
    </div>}

    {/* Leave-without-saving confirm -- Build Practice from Template would
        otherwise hand off to Builder using the last-saved version of this
        template, silently dropping whatever's been edited since. */}
    {confirmLeave==="startFromTemplate"&&<div className="movly" onClick={()=>setConfirmLeave(null)}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mtitle">Unsaved changes</div>
      <div style={{fontSize:14,color:"var(--td)",marginBottom:16}}>This template has changes that haven't been saved. Save before building a practice from it, or continue without saving and lose them?</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <button className="btn primary bmd bfull" onClick={confirmSaveAndContinue}>Save, then continue</button>
        <button className="btn outline bmd bfull" onClick={confirmDiscardAndContinue}>Continue without saving</button>
        <button className="btn ghost bmd bfull" onClick={()=>setConfirmLeave(null)}>Cancel</button>
      </div>
    </div></div>}

    {/* Bottom action bar */}
    {!showNewTpl&&<div style={{position:"fixed",bottom:"calc(var(--tab))",left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#fff",borderTop:"1px solid var(--b)",padding:"10px 14px",zIndex:50}}>
      <div className="brow" style={{marginBottom:8}}>
        {isSaved&&<button className="btn primary bmd" style={{flex:2,height:48,fontSize:15}} onClick={goBuildPractice}>Build Practice from Template</button>}
        <button className="btn primary bmd" style={{flex:1,height:48,fontSize:15,opacity:teamId?1:.5}} disabled={!teamId||runBusy} title={teamId?"":"Pick a Default Team to run now"} onClick={handleRunNow}>{runBusy?"Starting...":"Run Now"}</button>
      </div>
      <div className="brow">
        <button className="btn outline bmd" style={{flex:1,opacity:(!dirty&&isSaved)?.5:1}} onClick={handleSave} disabled={!dirty&&isSaved}>Save Template</button>
        <button className="btn ghost bmd" style={{flex:1}} onClick={()=>setShowNewTpl(true)}>Save as New</button>
      </div>
    </div>}
  </div>);
}

// ── SchedulePracticePicker ─────────────────────────────────────────────────────
// "Build Practice" from the Library used to only ever mean "start a brand
// new, unscheduled plan" (goToBuilder(null)) -- there was no way to instead
// pick an already-scheduled practice to plan without leaving Library for the
// Schedule tab first. This gives the same choice an agenda/calendar-style
// picker, scoped to upcoming practices only (a past one belongs in History,
// not the Builder). Deliberately a light read-only picker, not a reuse of
// the full ScheduleScreen -- that screen owns its own routing/PracticeDetail
// drill-in, which isn't what tapping a row here should do (this always hands
// off straight to Builder).
const plTimeLbl=p=>{if(!p.startTime)return "";const [h,m]=p.startTime.split(":").map(Number);return (h%12||12)+":"+(m<10?"0"+m:m)+(h>=12?" PM":" AM");};
const plDayLbl=(dateStr,todayStr,tomorrowStr)=>{
  if(dateStr===todayStr)return "Today";
  if(dateStr===tomorrowStr)return "Tomorrow";
  return new Date(dateStr+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"});
};
function SchedulePracticePicker({data,onPick,onClose}){
  const [mode,setMode]=useState("agenda");
  const [monthCursor,setMonthCursor]=useState(()=>{const n=new Date();return new Date(n.getFullYear(),n.getMonth(),1);});
  const [daySheetDate,setDaySheetDate]=useState(null);
  const todayStr=localDateStr();
  const tomorrowStr=localDateStr(new Date(Date.now()+864e5));
  const teamById=id=>(data.teams||[]).find(t=>t.id===id);
  const upcoming=(data.practices||[]).filter(p=>p.date>=todayStr&&p.status!=="cancelled").sort((a,b)=>a.date===b.date?(a.startTime||"").localeCompare(b.startTime||""):a.date.localeCompare(b.date));
  const groupByDay=list=>{const g=[];let cur=null;for(const p of list){if(!cur||cur.date!==p.date){cur={date:p.date,items:[]};g.push(cur);}cur.items.push(p);}return g;};
  const rowFor=p=>{
    const team=teamById(p.teamId),planned=(p.activities||[]).length>0;
    return (<div key={p.id} className="li tap" onClick={()=>onPick(p)}>
      <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
        {team&&team.colorPrimary&&<span style={{width:8,height:8,borderRadius:"50%",boxSizing:"border-box",background:planned?team.colorPrimary:"transparent",border:"1.5px solid "+team.colorPrimary,flexShrink:0}}/>}
        <div className="lim" style={{minWidth:0}}>
          <div className="lin">{team?team.name:"Practice"}</div>
          <div className="limt">{plDayLbl(p.date,todayStr,tomorrowStr)}{p.startTime?" · "+plTimeLbl(p):""}{!planned?" · Needs plan":planningState(p)==="under"?" · Under-planned":""}</div>
        </div>
      </div>
      <span style={{color:"var(--td)",fontSize:18}}>&#8250;</span>
    </div>);
  };
  const monthStart=monthCursor;
  const monthEnd=new Date(monthStart.getFullYear(),monthStart.getMonth()+1,0);
  const gridStart=new Date(monthStart);gridStart.setDate(gridStart.getDate()-gridStart.getDay());
  const gridEnd=new Date(monthEnd);gridEnd.setDate(gridEnd.getDate()+(6-gridEnd.getDay()));
  const days=[];for(let d=new Date(gridStart);d<=gridEnd;d.setDate(d.getDate()+1))days.push(new Date(d));
  const toDateStr=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  const practicesByDate={};upcoming.forEach(p=>{(practicesByDate[p.date]||=[]).push(p);});
  return (<div className="movly" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{maxHeight:"80vh",overflowY:"auto"}}>
      <div className="mhandle"/>
      <div className="mtitle">Choose a Scheduled Practice</div>
      <div style={{display:"flex",gap:0,background:"var(--s2)",borderRadius:"var(--r)",padding:3,marginBottom:12}}>
        {["agenda","month"].map(m=>(<button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:"7px 0",border:"none",cursor:"pointer",borderRadius:"calc(var(--r) - 2px)",background:mode===m?"#fff":"transparent",fontFamily:"Barlow Condensed,sans-serif",fontSize:12,fontWeight:700,letterSpacing:".03em",textTransform:"uppercase",color:mode===m?"var(--black)":"var(--td)"}}>{m}</button>))}
      </div>
      {mode==="agenda"&&<div>
        {groupByDay(upcoming).map(g=>(<div key={g.date} style={{marginBottom:14}}>
          <div className="clbl" style={{marginBottom:6}}>{plDayLbl(g.date,todayStr,tomorrowStr)}</div>
          {g.items.map(rowFor)}
        </div>))}
        {upcoming.length===0&&<div style={{padding:"20px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>Nothing scheduled yet. Schedule a practice first, or build an unscheduled one instead.</div>}
      </div>}
      {mode==="month"&&<div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <button className="btn ghost bxs" onClick={()=>setMonthCursor(new Date(monthStart.getFullYear(),monthStart.getMonth()-1,1))}>&#8249;</button>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700}}>{monthStart.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>
          <button className="btn ghost bxs" onClick={()=>setMonthCursor(new Date(monthStart.getFullYear(),monthStart.getMonth()+1,1))}>&#8250;</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
          {["S","M","T","W","T","F","S"].map((d,i)=>(<div key={i} style={{textAlign:"center",fontSize:11,fontWeight:700,color:"var(--td)"}}>{d}</div>))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
          {days.map((d,i)=>{
            const ds=toDateStr(d);
            const dayPractices=practicesByDate[ds]||[];
            const inMonth=d.getMonth()===monthStart.getMonth();
            return (<div key={i} onClick={()=>dayPractices.length&&setDaySheetDate(ds)} style={{aspectRatio:"1",border:"1px solid var(--b)",borderRadius:6,padding:3,cursor:dayPractices.length?"pointer":"default",opacity:inMonth?1:.35,background:ds===todayStr?"var(--gbg)":"#fff"}}>
              <div style={{fontSize:10,color:"var(--td)",marginBottom:2}}>{d.getDate()}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:2}}>
                {dayPractices.slice(0,4).map(p=>{const team=teamById(p.teamId);const planned=(p.activities||[]).length>0;const color=(team&&team.colorPrimary)||"var(--green)";return (<span key={p.id} style={{width:6,height:6,borderRadius:"50%",background:planned?color:"transparent",border:"1.5px solid "+color}}/>);})}
              </div>
            </div>);
          })}
        </div>
        {daySheetDate&&<div style={{marginTop:14,borderTop:"1px solid var(--b)",paddingTop:12}}>
          <div className="clbl" style={{marginBottom:6}}>{plDayLbl(daySheetDate,todayStr,tomorrowStr)}</div>
          {(practicesByDate[daySheetDate]||[]).map(rowFor)}
        </div>}
      </div>}
      <button className="btn ghost bmd bfull" style={{marginTop:8}} onClick={onClose}>Cancel</button>
    </div>
  </div>);
}

// ── NewLibraryScreen ──────────────────────────────────────────────────────────
// Library split (nav restructure, 2026-07-15): two shelves -- "My Library"
// (your drills + templates, with a sub-toggle) and "Explore" (content that
// isn't yours: org libraries and coach-shared drills today, the deferred
// chunk-6 curated catalogs later). Establishing Explore now means future
// browse-others' content lands in an existing mental slot instead of
// forcing another restructure. The Skills tab moved to Settings (see
// SkillsTab's comment above). The old window.__ropLibTab global was set
// here but never read anywhere -- deleted, not migrated.
export default function NewLibraryScreen({data,openModal,goToBuilder,goToRun,refreshLibrary,coachId,refreshPlanning,mode}){
  const isOrgMode = mode && mode.type === "org";
  // Same "so it looks like their org" treatment as the org-mode bottom tab
  // bar (Layout.jsx) -- a colored accent bar under the title, using the
  // org's own color, so Club Library reads as this specific club's space
  // rather than a generic screen that happens to say "Club" on it.
  const activeOrg = isOrgMode ? (data.myOrgs||[]).find(o=>o.id===mode.orgId) : null;
  // Goals & Insights' "Review Untagged Drills" CTA lands here via
  // location.state.untaggedForSport -- one-time initializer, same
  // convention as every other cross-screen deep link in this app, so the
  // coach's own navigation afterward (switching sports/shelves) isn't
  // fought by a re-forced state on every render.
  const location=useLocation();
  const navigate=useNavigate();
  const untaggedDeepLink=location.state&&location.state.untaggedForSport?location.state:null;
  const [section,setSection]=useState("mine"); // "mine" | "explore" -- the untagged deep link only ever means My Drills, already the default
  const [mineTab,setMineTab]=useState("drills"); // sub-toggle within My Library
  // Only-untagged filter: forced on when arriving via the deep link, but a
  // plain toggle afterward so the coach can drop back to the full list
  // without losing the "Back to Goals & Insights" exit or leaving the page.
  const [untaggedOnly,setUntaggedOnly]=useState(!!untaggedDeepLink);
  const [openMenu,setOpenMenu]=useState(null);
  const [editingTpl,setEditingTpl]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const [collapsed,setCollapsed]=useState({});
  const [drillMenu,setDrillMenu]=useState(null);
  const [insightSummaries,setInsightSummaries]=useState({});
  const [openInsightsId,setOpenInsightsId]=useState(null);
  // Confirm-before-Make-Public (direct feedback): a real prompt, not an
  // instant toggle, since going public changes who can see a drill.
  const [confirmMakePublicId,setConfirmMakePublicId]=useState(null);
  // Direct feedback: Custom (drag-and-drop) stays the default, but a coach
  // can switch to three other orderings. "Suggested" needs a specific
  // team's goal deficits to rank against -- the library itself isn't
  // team-scoped, so a small team picker appears only when that mode is
  // selected, defaulting to the coach's first team.
  const [drillSort,setDrillSort]=useState("custom");
  const myTeamsForSort=(data.teams||[]).filter(t=>!t.archivedAt);
  const [suggestedTeamId,setSuggestedTeamId]=useState("");
  useEffect(()=>{
    if(!suggestedTeamId&&myTeamsForSort.length)setSuggestedTeamId(myTeamsForSort[0].id);
  },[myTeamsForSort.length]);
  const [suggestedReport,setSuggestedReport]=useState(null);
  useEffect(()=>{
    if(drillSort!=="suggested"||!suggestedTeamId){setSuggestedReport(null);return;}
    fetchTeamGoalReport(suggestedTeamId).then(setSuggestedReport);
  },[drillSort,suggestedTeamId]);
  // Deficit per category (target - actual, or planned when no actual
  // history yet -- same fallback rule the rest of Goals & Insights already
  // uses), 0 for categories at/above target. A drill's priority is the
  // largest deficit among the categories any of its tags roll up to, so a
  // drill tagged to the single most-needed category always sorts highest.
  const categoryDeficits=(()=>{
    if(!suggestedReport)return{};
    const hasActual=(suggestedReport.denominators||{}).actual_minutes_total>0;
    const out={};
    (suggestedReport.skills||[]).forEach(s=>{
      if(s.target_pct==null)return;
      const current=hasActual?s.actual_pct:s.planned_pct;
      out[s.skill_category_id]=Math.max(0,s.target_pct-(current||0));
    });
    return out;
  })();
  const drillPriority=act=>{
    const tagIds=act.skillTagIds||[];
    if(!tagIds.length)return 0;
    const cats=tagIds.map(tid=>skillTagsById[tid]&&skillTagsById[tid].categoryId).filter(Boolean);
    if(!cats.length)return 0;
    return Math.max(0,...cats.map(cid=>categoryDeficits[cid]||0));
  };
  const [shelf,setShelf]=useState("mine");
  const [shareMenuId,setShareMenuId]=useState(null);
  const [copyingId,setCopyingId]=useState(null);
  const [tagFilter,setTagFilter]=useState([]);
  const [tagSearch,setTagSearch]=useState("");
  const [publisherFilter,setPublisherFilter]=useState([]);
  const [showFilter,setShowFilter]=useState(false);
  const [newTplPrompt,setNewTplPrompt]=useState(false);
  const [newTplNameDraft,setNewTplNameDraft]=useState("");
  const [showBuildChoice,setShowBuildChoice]=useState(false);
  const [showSchedulePicker,setShowSchedulePicker]=useState(false);
  const [isAdmin,setIsAdmin]=useState(false);
  useEffect(()=>{checkIsAdmin().then(setIsAdmin);},[]);
  const toggle=sport=>setCollapsed(c=>Object.assign({},c,{[sport]:!c[sport]}));
  // Drill-library drag-to-reorder is persisted server-side per drag (unlike
  // the practice/template builders, where reordering is local state until an
  // explicit Save) -- an optimistic per-sport override keeps the drop feeling
  // instant instead of the row flying to its new spot and then snapping back
  // until reorderDrills+refreshLibrary's round trip resolves. Cleared once
  // that round trip lands, since data.activityLibrary should match by then.
  const drillDndSensors=useDndSensors();
  const [drillOrderOverride,setDrillOrderOverride]=useState({});
  const onDrillDragEnd=sport=>async(event)=>{
    const {active,over}=event;
    if(!over||active.id===over.id)return;
    const base=(drillOrderOverride[sport]||shelfDrills.filter(a=>(a.sport||"General")===sport).slice().sort((a,b)=>a.position-b.position).map(a=>a.id));
    const oldIndex=base.indexOf(active.id),newIndex=base.indexOf(over.id);
    if(oldIndex===-1||newIndex===-1)return;
    const next=arrayMove(base,oldIndex,newIndex);
    setDrillOrderOverride(p=>Object.assign({},p,{[sport]:next}));
    await reorderDrills(next);
    await refreshLibrary();
    setDrillOrderOverride(p=>{const n=Object.assign({},p);delete n[sport];return n;});
  };
  const myOrgs=data.myOrgs||[];
  // Coach display names for shelf labels: profiles is locked down to
  // "own row, or an org co-member's row via org_staff" (profiles_select_
  // org_co_member) -- a coach who's just team_staff on one of the org's
  // teams, not personally an org_staff director, won't resolve there even
  // though they're perfectly able to share a drill into the org (see
  // can_share_drill_to_org's team_staff branch). team_staff already stores
  // first/last name directly for exactly this cross-user-display reason
  // (its own table comment), so fall back to it before giving up.
  const coachNameByUserId={};
  (data.teams||[]).forEach(t=>(t.coaches||[]).forEach(c=>{if(c.userId&&!coachNameByUserId[c.userId])coachNameByUserId[c.userId]=c.name;}));
  const coachDisplayName=userId=>(data.profilesById&&data.profilesById[userId]&&data.profilesById[userId].name)||coachNameByUserId[userId]||"A coach";
  // Public Library shown regardless of org membership (spec §3 -- public is
  // public), always first so it's the default Team Libraries landing shelf.
  // Per-org shelves: the org's own curated library, then one shelf *per
  // coach* who's shared at least one drill to that org -- replaces a single
  // flat "From {org}" shelf that lumped every coach's shared drills
  // together with no way to tell whose was whose. A director managing a
  // multi-coach club wants to browse "what has Coach Jane shared" as its
  // own destination, not dig through a merged list.
  const exploreShelves=[{key:"public",label:"Public Library"},...myOrgs.flatMap(org=>{
    const sharedByCoach={};
    (data.activityLibrary||[]).forEach(a=>{
      if(!a.ownerUserId||a.ownerUserId===coachId)return;
      if(!(a.sharedWithOrganizationIds||[]).includes(org.id))return;
      (sharedByCoach[a.ownerUserId]=sharedByCoach[a.ownerUserId]||[]).push(a);
    });
    const coachShelves=Object.keys(sharedByCoach)
      .map(ownerId=>({ownerId,name:coachDisplayName(ownerId),count:sharedByCoach[ownerId].length}))
      .sort((a,b)=>a.name.localeCompare(b.name))
      .map(c=>({key:"sharedBy:"+org.id+":"+c.ownerId,label:c.name+" ("+c.count+")",org}));
    return [{key:"orgLib:"+org.id,label:org.name+" Library",org},...coachShelves];
  }),...(()=>{
    // Peer-shared personal drills (2026-08-01): one shelf per rostered
    // head coach/assistant sharing their library via Permissions, on a
    // personal (non-org) team -- same "one shelf per coach, not a flat
    // merged list" treatment the org shelves above already use. Anything
    // showing up here at all already passed can_access_activity's RLS, so
    // no client-side permission check is needed -- just group what's
    // already visible.
    const sharedByPeer={};
    (data.activityLibrary||[]).forEach(a=>{
      if(!a.ownerUserId||a.ownerUserId===coachId||a.organizationId)return;
      (sharedByPeer[a.ownerUserId]=sharedByPeer[a.ownerUserId]||[]).push(a);
    });
    return Object.keys(sharedByPeer)
      .map(ownerId=>({ownerId,name:coachDisplayName(ownerId),count:sharedByPeer[ownerId].length}))
      .sort((a,b)=>a.name.localeCompare(b.name))
      .map(c=>({key:"sharedBy:peer:"+c.ownerId,label:c.name+" ("+c.count+")"}));
  })()];
  const goSection=s=>{
    setSection(s);
    setShelf(s==="mine"?"mine":(exploreShelves[0]?exploreShelves[0].key:""));
    setTagFilter([]);setTagSearch("");setPublisherFilter([]);
  };
  const showDrillList=mineTab==="drills"&&(section==="mine"||exploreShelves.length>0);
  // shelf==="public" is handled entirely by PublicLibraryScreen (search-first
  // browsing, 2026-07-19) -- not computed here at all.
  const shelfDrillsAll=(()=>{
    if(shelf==="mine")return (data.activityLibrary||[]).filter(a=>isOrgMode?a.organizationId===mode.orgId:a.ownerUserId===coachId);
    if(shelf.startsWith("orgLib:")){const orgId=shelf.slice(7);return (data.activityLibrary||[]).filter(a=>a.organizationId===orgId);}
    if(shelf.startsWith("sharedBy:peer:")){const ownerId=shelf.slice(14);return (data.activityLibrary||[]).filter(a=>a.ownerUserId===ownerId&&!a.organizationId);}
    if(shelf.startsWith("sharedBy:")){const [,orgId,ownerId]=shelf.split(":");return (data.activityLibrary||[]).filter(a=>a.ownerUserId===ownerId&&(a.sharedWithOrganizationIds||[]).includes(orgId));}
    return [];
  })();
  // Enhancement 6: one batch call for the whole owned-drill shelf (My
  // Drills/Org Drills only -- isMine below gates where this even renders),
  // never per card. Re-fetched when the visible id set changes, not on
  // every render.
  const mineShelfIdsKey=shelf==="mine"?shelfDrillsAll.map(a=>a.id).join(","):"";
  useEffect(()=>{
    if(!mineShelfIdsKey){setInsightSummaries({});return;}
    fetchDrillInsightSummaries(mineShelfIdsKey.split(",")).then(rows=>{
      setInsightSummaries(Object.fromEntries((rows||[]).map(r=>[r.library_activity_id,r])));
    });
  },[mineShelfIdsKey]);
  const isMine=shelf==="mine";
  const skillTagsById=Object.fromEntries((data.skillTags||[]).map(t=>[t.id,t]));
  const tagNames=ids=>(ids||[]).map(id=>skillTagsById[id]?skillTagsById[id].name:null).filter(Boolean);
  // Only offer tags that at least one drill on this shelf actually has --
  // filtering by a tag with zero drills would just be a dead end.
  const tagCounts={};
  shelfDrillsAll.forEach(a=>(a.skillTagIds||[]).forEach(id=>{tagCounts[id]=(tagCounts[id]||0)+1;}));
  const availableTags=Object.keys(tagCounts).map(id=>skillTagsById[id]).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name));
  const tagSearchQ=tagSearch.trim().toLowerCase();
  const visibleTagChips=tagSearchQ?availableTags.filter(t=>t.name.toLowerCase().includes(tagSearchQ)):availableTags;
  const toggleTagFilter=id=>setTagFilter(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  // "My Library" can contain drills you typed in yourself alongside ones
  // copied in from an assistant's shared drill, an org library, or the
  // public catalog -- copyDrillToMyLibrary snapshots that origin once, at
  // copy time, into copied_from_owner_user_id/organization_id/catalog_id
  // (2026-07-29), since a bare copy is otherwise indistinguishable from a
  // self-authored row. Publisher filter only makes sense on the "mine"
  // shelf -- every other shelf is already a single source by definition.
  const catalogsById=Object.fromEntries((data.catalogs||[]).map(c=>[c.id,c]));
  const publisherKeyOf=a=>a.copiedFromOwnerUserId?"coach:"+a.copiedFromOwnerUserId:a.copiedFromOrganizationId?"org:"+a.copiedFromOrganizationId:a.copiedFromCatalogId?"catalog:"+a.copiedFromCatalogId:"self";
  const publisherLabelOf=key=>{
    if(key==="self")return "My Own";
    const [kind,id]=key.split(/:(.+)/);
    if(kind==="coach")return (data.profilesById&&data.profilesById[id]&&data.profilesById[id].name)||"A coach";
    if(kind==="org"){const org=myOrgs.find(o=>o.id===id);return org?org.name+" Library":"An org library";}
    if(kind==="catalog"){const cat=catalogsById[id];return cat?cat.publisherName:"Public Library";}
    return "Unknown";
  };
  const publisherCounts={};
  shelfDrillsAll.forEach(a=>{const k=publisherKeyOf(a);publisherCounts[k]=(publisherCounts[k]||0)+1;});
  const availablePublishers=Object.keys(publisherCounts).map(key=>({key,label:publisherLabelOf(key),count:publisherCounts[key]})).sort((a,b)=>a.key==="self"?-1:b.key==="self"?1:a.label.localeCompare(b.label));
  const togglePublisherFilter=key=>setPublisherFilter(p=>p.includes(key)?p.filter(x=>x!==key):[...p,key]);
  const shelfDrillsTagged=tagFilter.length===0?shelfDrillsAll:shelfDrillsAll.filter(a=>(a.skillTagIds||[]).some(id=>tagFilter.includes(id)));
  const shelfDrillsPublisher=publisherFilter.length===0?shelfDrillsTagged:shelfDrillsTagged.filter(a=>publisherFilter.includes(publisherKeyOf(a)));
  // Goals & Insights' untagged-drills deep link: scoped to the team's sport
  // regardless of the untaggedOnly toggle (that's inherent to "why you're
  // here"), with the no-tag filter itself independently toggleable so the
  // coach can peek at the sport's already-tagged drills without leaving.
  const shelfDrillsSportScoped=untaggedDeepLink?shelfDrillsPublisher.filter(a=>(a.sport||"General")===untaggedDeepLink.untaggedForSport):shelfDrillsPublisher;
  const shelfDrills=untaggedOnly?shelfDrillsSportScoped.filter(a=>!(a.skillTagIds&&a.skillTagIds.length)):shelfDrillsSportScoped;
  const sports=[...new Set(shelfDrills.map(a=>a.sport||"General").filter(Boolean))].sort();
  const assetsById=Object.fromEntries((data.assets||[]).map(a=>[a.id,a]));
  const equipNames=ids=>(ids||[]).map(id=>assetsById[id]?assetsById[id].name:null).filter(Boolean);
  // Toggle one org in/out of a drill's share set -- a drill can be shared to
  // more than one org, so this is a multi-select toggle, not a single pick.
  const toggleShare=async(drillId,orgId)=>{const drill=(data.activityLibrary||[]).find(a=>a.id===drillId);const cur=(drill&&drill.sharedWithOrganizationIds)||[];const next=cur.includes(orgId)?cur.filter(id=>id!==orgId):[...cur,orgId];await setDrillOrgShares(drillId,next);await refreshLibrary();};
  const makePrivate=async(drillId)=>{setShareMenuId(null);await setDrillOrgShares(drillId,[]);await refreshLibrary();};
  // Separate axis from org sharing above -- excludes a drill from the
  // default sharing a coach's Permissions screen grants to a rostered
  // head coach/assistant. Deliberately never labeled "Private" in this
  // menu (organization sharing already uses that word for a different
  // thing, "Make Private" above means "remove all org shares") --
  // "hide/show from my coaches" avoids the collision.
  const toggleDrillPrivate=async(drillId,isPrivate)=>{setDrillMenu(null);await setDrillPrivate(drillId,isPrivate);await refreshLibrary();};
  // Equipment-mismatch check before copying (2026-08-01): a drill copied
  // from Public Library/an org/a peer may need equipment the destination
  // pool (the coach's own, or the org's in Org mode) doesn't have yet --
  // copyDrillToMyLibrary used to always silently create the missing pieces
  // with no choice offered. Pure client-side check against already-loaded
  // data.assets, no extra query -- only opens the dialog when there's
  // actually a gap.
  const ownPoolForCopy=isOrgMode?(data.assets||[]).filter(a=>a.organizationId===mode.orgId):(data.assets||[]).filter(a=>a.ownerUserId===coachId);
  const [copyDialogDrill,setCopyDialogDrill]=useState(null);
  const runCopy=async(drill,createMissingEquipment)=>{
    setCopyingId(drill.id);
    await copyDrillToMyLibrary(coachId,drill,assetsById,skillTagsById,mode,{createMissingEquipment});
    await refreshLibrary();
    setCopyingId(null);
    setCopyDialogDrill(null);
  };
  const doCopy=async(drill)=>{
    const missing=findMissingEquipment(drill.equipment,assetsById,ownPoolForCopy);
    if(missing.length===0){await runCopy(drill,true);return;}
    setCopyDialogDrill(drill);
  };
  // Coach mode: templates I own. Org mode: the org's own templates. (Coach
  // mode's own-only filter is new here -- this list previously showed every
  // RLS-visible template unfiltered, which happened to work when org
  // templates didn't really exist yet; now that Org mode is a real
  // destination for those, Coach mode needs to actually exclude them.)
  const templates=(data.templates||[]).filter(t=>isOrgMode?t.organizationId===mode.orgId:t.ownerUserId===coachId);
  const fmtShort=iso=>iso?new Date(iso).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):null;
  // Templates snapshot drill fields at add-time and don't carry their own
  // skillTagIds -- same lookup-through-libraryId approach as the drill rows
  // above, just aggregated with a count across every activity (including
  // station-block stations) so the coach can tell what a template actually
  // develops without opening it.
  const skillBreakdown=activities=>{
    const counts={};
    (activities||[]).forEach(act=>{
      const libIds=act.type==="station_block"?(act.stations||[]).map(st=>st.libraryId):[act.libraryId];
      libIds.filter(Boolean).forEach(libId=>{
        const drill=(data.activityLibrary||[]).find(a=>a.id===libId);
        (drill&&drill.skillTagIds||[]).forEach(id=>{counts[id]=(counts[id]||0)+1;});
      });
    });
    return Object.keys(counts).map(id=>({id,name:skillTagsById[id]?skillTagsById[id].name:null,count:counts[id]})).filter(t=>t.name).sort((a,b)=>b.count-a.count);
  };
  const createNewTpl=()=>{
    if(!newTplNameDraft.trim())return;
    setEditingTpl({id:uid(),name:newTplNameDraft.trim(),activities:[],durMin:0});
    setNewTplPrompt(false);
  };
  if(editingTpl)return (<div style={{padding:"0 16px 80px"}}><TemplateWorkspace data={data} template={editingTpl} openModal={openModal} coachId={coachId} refreshLibrary={refreshLibrary} refreshPlanning={refreshPlanning} onBack={()=>setEditingTpl(null)} onStartFromTemplate={tplId=>goToBuilder(null,tplId)} onRunNow={goToRun}/></div>);
  return (<div style={{paddingBottom:80}}>
    <div style={{padding:"20px 16px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900}}>{isOrgMode?"Club Library":"Library"}</div>
        {isOrgMode&&activeOrg&&activeOrg.color&&<div style={{width:48,height:4,borderRadius:2,background:activeOrg.color,marginTop:6}}/>}
      </div>
      <button className="btn primary bsm" onClick={()=>setShowBuildChoice(true)}>+ Build Practice</button>
    </div>
    <div style={{padding:"0 16px 12px"}}>
      {/* 5-tab content-type sub-nav (Drills default): Locations/Equipment/
          Skill Tags moved here from Settings -- a director managing an
          org's shared stuff wants one place for all five content types,
          which already share the identical coach-or-org ownership pattern
          in the schema. Always visible now (used to be gated behind the
          My/Explore pill, which meant switching to Explore hid Templates/
          Locations/Equipment/Skill Tags entirely, even though Explore never
          applied to any of them -- only Drills has cross-coach/org content
          to browse, so that pill moved down into just the Drills tab below). */}
      {/* Tap-target fix (same class of bug as Layout.jsx's team-workspace
          tabs): padding was "2px 0" -- no side padding at all -- so the hit
          box was exactly text-sized. Padding widened, row gap shrank to
          compensate so all 5 tabs still fit without extra scrolling. */}
      <div style={{display:"flex",gap:8,padding:"6px 2px 0",overflowX:"auto"}}>
        {[{k:"drills",label:"Drills"},{k:"templates",label:"Templates"},{k:"locations",label:"Locations"},{k:"equipment",label:"Equipment"},{k:"skills",label:"Skill Tags"}].map(t=>(<button key={t.k} onClick={()=>setMineTab(t.k)} style={{flexShrink:0,background:"none",border:"none",cursor:"pointer",padding:"8px 6px",fontFamily:"Barlow Condensed,sans-serif",fontSize:14,fontWeight:700,letterSpacing:".04em",textTransform:"uppercase",whiteSpace:"nowrap",color:mineTab===t.k?"var(--green)":"var(--td)",borderBottom:"2px solid "+(mineTab===t.k?"var(--green)":"transparent")}}>{t.label}</button>))}
      </div>
      {/* My Drills / Team Libraries -- Drills-only, since Explore never
          applied to Templates/Locations/Equipment/Skill Tags in the first
          place (each of those is always just "mine," coach- or org-scoped). */}
      {mineTab==="drills"&&<div style={{display:"flex",gap:0,background:"var(--s2)",borderRadius:"var(--r)",padding:3,marginTop:10}}>
        {[{k:"mine",label:isOrgMode?"Org Drills":"My Drills"},{k:"explore",label:"Explore"}].map(t=>(<button key={t.k} onClick={()=>goSection(t.k)} style={{flex:1,padding:"7px 0",border:"none",cursor:"pointer",borderRadius:"calc(var(--r) - 2px)",background:section===t.k?"#fff":"transparent",fontFamily:"Barlow Condensed,sans-serif",fontSize:12,fontWeight:700,letterSpacing:".03em",textTransform:"uppercase",color:section===t.k?"var(--black)":"var(--td)"}}>{t.label}</button>))}
      </div>}
    </div>
    {mineTab==="locations"&&<div style={{padding:"0 16px"}}><LocationsSection data={data} openModal={openModal} refreshPlanning={refreshPlanning} coachId={coachId} mode={mode}/></div>}
    {mineTab==="equipment"&&<div style={{padding:"0 16px"}}><EquipmentTab data={data} coachId={coachId} refreshLibrary={refreshLibrary} openModal={openModal} mode={mode}/></div>}
    {mineTab==="skills"&&<div style={{padding:"0 16px"}}><SkillsTab data={data} coachId={coachId} refreshLibrary={refreshLibrary} isAdmin={isAdmin} mode={mode}/></div>}
    {showDrillList&&<div style={{padding:"0 16px"}} onClick={()=>{setDrillMenu(null);setShareMenuId(null);}}>
      {untaggedDeepLink&&<div className="card" style={{marginBottom:12,background:"var(--ambg)",border:"1px solid var(--ambb)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <div style={{fontSize:13}}>
            {untaggedOnly?"Showing "+untaggedDeepLink.untaggedForSport+" drills with no skill tag yet.":"Showing all "+untaggedDeepLink.untaggedForSport+" drills."} Tag one and it'll {untaggedOnly?"drop off this list":"update below"} automatically.
          </div>
          <button type="button" className="btn ghost bxs" onClick={()=>setUntaggedOnly(u=>!u)}>{untaggedOnly?"Show All Drills":"Show Untagged Only"}</button>
        </div>
        <button type="button" className="btn outline bsm" style={{marginTop:8}} onClick={()=>navigate(untaggedDeepLink.returnTo||"/team/"+untaggedDeepLink.teamId+"/goals")}>&larr; Back to Goals &amp; Insights</button>
      </div>}
      {section==="explore"&&exploreShelves.length>1&&<div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:12,paddingBottom:2}}>
        {exploreShelves.map(s=>(<button key={s.key} onClick={()=>{setShelf(s.key);setTagFilter([]);setTagSearch("");}} style={{flexShrink:0,padding:"6px 12px",borderRadius:20,border:"1.5px solid var(--b)",background:shelf===s.key?"var(--green)":"var(--s1)",color:shelf===s.key?"#fff":"var(--black)",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{s.label}</button>))}
      </div>}
      {shelf==="public"?(
        <div onClick={e=>e.stopPropagation()}><PublicLibraryScreen data={data} isAdmin={isAdmin} refreshLibrary={refreshLibrary} openModal={openModal} doCopy={doCopy} copyingId={copyingId} mode={mode}/></div>
      ):(<>
      {drillSort==="suggested"&&isMine&&!suggestedReport&&<div style={{fontSize:12,color:"var(--td)",marginBottom:10}}>Loading goal priorities...</div>}
      {/* Direct feedback: Sort used to be its own plain label+select row,
          styled nothing like Filter/+Add Drill right below it -- now a
          real .btn ghost bsm select sharing the same row, so the whole
          row reads as one consistent set of controls. */}
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:6,marginBottom:12,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
        {isMine&&<select className="btn ghost bsm" value={drillSort} onChange={e=>setDrillSort(e.target.value)} style={{flexShrink:0}}>
          <option value="custom">Sort: Custom</option>
          <option value="frequency">Sort: Most Used</option>
          <option value="alpha">Sort: Alphabetical</option>
          <option value="suggested">Sort: Suggested</option>
          <option value="byskill">Group by Skill</option>
        </select>}
        {isMine&&drillSort==="suggested"&&myTeamsForSort.length>1&&<select className="btn ghost bsm" value={suggestedTeamId} onChange={e=>setSuggestedTeamId(e.target.value)} style={{flexShrink:0}}>
          {myTeamsForSort.map(t=>(<option key={t.id} value={t.id}>{t.name}</option>))}
        </select>}
        {(availableTags.length>0||(isMine&&availablePublishers.length>1))&&<button className="btn ghost bsm" onClick={e=>{e.stopPropagation();setShowFilter(true);}}>Filter{(tagFilter.length+publisherFilter.length)>0?" ("+(tagFilter.length+publisherFilter.length)+")":""}</button>}
        {isMine&&<button className="btn primary bsm" onClick={()=>openModal("addActivity")}>+ Add Drill</button>}
      </div>
      {(tagFilter.length>0||publisherFilter.length>0)&&<div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center",marginBottom:12}} onClick={e=>e.stopPropagation()}>
        {tagFilter.map(id=>{const t=skillTagsById[id];if(!t)return null;return(<span key={id} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 4px 3px 10px",borderRadius:20,background:"var(--green)",color:"#fff",fontSize:12,fontWeight:600}}>
          {t.name}
          <button type="button" onClick={()=>toggleTagFilter(id)} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",fontSize:14,lineHeight:1,padding:"2px 4px"}}>&times;</button>
        </span>);})}
        {publisherFilter.map(key=>(<span key={key} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 4px 3px 10px",borderRadius:20,background:"#7c3aed",color:"#fff",fontSize:12,fontWeight:600}}>
          {publisherLabelOf(key)}
          <button type="button" onClick={()=>togglePublisherFilter(key)} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",fontSize:14,lineHeight:1,padding:"2px 4px"}}>&times;</button>
        </span>))}
        <button type="button" onClick={()=>{setTagFilter([]);setPublisherFilter([]);}} style={{background:"none",border:"none",color:"var(--td)",fontSize:12,cursor:"pointer",textDecoration:"underline",padding:0}}>Clear all</button>
      </div>}
      {showFilter&&<div className="movly" style={{zIndex:300}} onClick={e=>{if(e.target===e.currentTarget)setShowFilter(false);}}>
        <div className="modal">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:900}}>Filter Drills</div>
            <button type="button" className="btn ghost bxs" onClick={()=>setShowFilter(false)}>Done</button>
          </div>
          {isMine&&availablePublishers.length>1&&<>
            <div className="clbl mb8">Publisher</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
              {availablePublishers.map(p=>(<button key={p.key} type="button" onClick={()=>togglePublisherFilter(p.key)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:publisherFilter.includes(p.key)?"#7c3aed":"var(--s1)",color:publisherFilter.includes(p.key)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{p.label} <span style={{opacity:.7}}>{p.count}</span></button>))}
            </div>
          </>}
          <div className="clbl mb8">Skill Tags</div>
          {availableTags.length>8&&<input className="inp" placeholder="Search skill tags..." value={tagSearch} onChange={e=>setTagSearch(e.target.value)} style={{marginBottom:10}}/>}
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {visibleTagChips.map(t=>(<button key={t.id} type="button" onClick={()=>toggleTagFilter(t.id)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:tagFilter.includes(t.id)?"var(--green)":"var(--s1)",color:tagFilter.includes(t.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{t.name} <span style={{opacity:.7}}>{tagCounts[t.id]}</span></button>))}
            {visibleTagChips.length===0&&<span style={{fontSize:13,color:"var(--td)"}}>No skill tags match "{tagSearch}"</span>}
          </div>
          {(tagFilter.length>0||publisherFilter.length>0)&&<button type="button" className="btn ghost bxs" onClick={()=>{setTagFilter([]);setPublisherFilter([]);}}>Clear all filters</button>}
          <button type="button" className="btn primary bmd bfull" style={{marginTop:14}} onClick={()=>setShowFilter(false)}>Done</button>
        </div>
      </div>}
      {shelfDrillsAll.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>{isMine?"No drills yet. Tap + Add Drill.":shelf.startsWith("orgLib:")?"No drills shared to this org yet -- share one from My Library.":"No drills shared by other coaches yet."}</div>}
      {shelfDrillsAll.length>0&&shelfDrills.length===0&&untaggedDeepLink&&untaggedOnly&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>All caught up -- every {untaggedDeepLink.untaggedForSport} drill has a skill tag.</div>}
      {shelfDrillsAll.length>0&&shelfDrills.length===0&&!(untaggedDeepLink&&untaggedOnly)&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No drills match the selected filters.</div>}
      {sports.map(sport=>(<div key={sport} style={{marginBottom:8}}>
        <button onClick={()=>toggle(sport)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"var(--s1)",border:"none",borderRadius:"var(--r)",cursor:"pointer"}}>
          <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,color:"var(--green)"}}>{sport}</span>
          <span style={{fontSize:12,color:"var(--td)"}}>{shelfDrills.filter(a=>(a.sport||"General")===sport).length} drills {collapsed[sport]?"▶":"▼"}</span>
        </button>
        {!collapsed[sport]&&(()=>{
          const bySport=shelfDrills.filter(a=>(a.sport||"General")===sport);
          const naturalOrder=bySport.slice().sort((a,b)=>isMine?a.position-b.position:a.name.localeCompare(b.name));
          // Custom (default) keeps the existing drag-reorder path untouched.
          // The other three modes are plain derived sorts -- no persisted
          // order, no drag affordance while active (dragging while sorted
          // by frequency/alphabetical/suggested wouldn't mean anything
          // stable to drop back into).
          let sportDrills;
          if(isMine&&drillSort==="alpha"){
            sportDrills=bySport.slice().sort((a,b)=>a.name.localeCompare(b.name));
          }else if(isMine&&drillSort==="frequency"){
            sportDrills=bySport.slice().sort((a,b)=>{
              const na=(insightSummaries[a.id]&&insightSummaries[a.id].completed_uses_trailing_12_months)||0;
              const nb=(insightSummaries[b.id]&&insightSummaries[b.id].completed_uses_trailing_12_months)||0;
              return nb-na||a.name.localeCompare(b.name);
            });
          }else if(isMine&&drillSort==="suggested"){
            sportDrills=bySport.slice().sort((a,b)=>drillPriority(b)-drillPriority(a)||a.name.localeCompare(b.name));
          }else{
            sportDrills=(isMine&&drillOrderOverride[sport])
              ?drillOrderOverride[sport].map(id=>naturalOrder.find(a=>a.id===id)).filter(Boolean)
              :naturalOrder;
          }
          const Row=({act,dragHandle})=>(<div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 12px",borderBottom:"1px solid var(--b)",background:"#fff"}}>
            {dragHandle}
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                <span style={{fontWeight:700,fontSize:14}}>{act.name}</span>
                {isMine&&act.isPrivate&&<span title="Private -- not visible to coaches you share your library with" aria-label="Private drill" style={{color:"var(--td)",display:"flex",flexShrink:0}}><Ic_Lock/></span>}
                {isMine&&(act.sharedWithOrganizationIds||[]).length>0&&<span className="bdg bp" style={{fontSize:10}}>Shared</span>}
              </div>
              {isMine&&publisherKeyOf(act)!=="self"&&<div style={{fontSize:11,color:"#7c3aed",marginBottom:2}}>From {publisherLabelOf(publisherKeyOf(act))}</div>}
              {act.description&&<div style={{fontSize:12,color:"var(--td)",marginBottom:2,lineHeight:1.4}}>{act.description}</div>}
              {act.coachingPoints&&<div style={{fontSize:12,color:"var(--td)",marginBottom:2}}>{act.coachingPoints}</div>}
              {act.equipment&&act.equipment.length>0&&<div style={{fontSize:11,color:"var(--td)",marginTop:2}}>Needs: {equipNames(act.equipment).join(", ")}</div>}
              {act.grouping&&act.grouping!=="whole"&&<div style={{fontSize:11,color:"var(--td)",marginTop:2}}>{act.grouping==="partners"?"Partners":act.numGroups+" groups"}</div>}
              {act.skillTagIds&&act.skillTagIds.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
                {tagNames(act.skillTagIds).map(name=>(<span key={name} className="bdg bs" style={{fontSize:10}}>{name}</span>))}
              </div>}
              {!isMine&&<div style={{fontSize:11,color:"var(--green2)",marginTop:4}}>Shared by {(data.profilesById&&data.profilesById[act.ownerUserId]&&data.profilesById[act.ownerUserId].name)||"a coach"}</div>}
              {!isMine&&shelf.startsWith("sharedBy:")&&<button className="btn outline bxs" style={{marginTop:6}} onClick={()=>doCopy(act)} disabled={copyingId===act.id}>{copyingId===act.id?"Copying...":isOrgMode?"Copy to Org Library":"Copy to My Library"}</button>}
            </div>
            {isMine&&<div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
              <div style={{position:"relative",flexShrink:0}}>
              <button className="ell-btn" onClick={e=>{e.stopPropagation();setDrillMenu(drillMenu===act.id?null:act.id);setShareMenuId(null);}}><span/><span/><span/></button>
              {drillMenu===act.id&&<div className="mini-menu" style={{right:0,minWidth:140}}>
                <button className="mm-item" onClick={()=>{setDrillMenu(null);openModal("editActivity",{activity:act});}}>Edit</button>
                {myOrgs.length>0&&<button className="mm-item" onClick={e=>{e.stopPropagation();setDrillMenu(null);setShareMenuId(shareMenuId===act.id?null:act.id);}}>{(act.sharedWithOrganizationIds||[]).length>0?"Change Sharing":"Share..."}</button>}
                {(act.sharedWithOrganizationIds||[]).length>0&&<button className="mm-item" onClick={()=>makePrivate(act.id)}>Make Private</button>}
                {/* "Keep Private"/"Make Public" (direct feedback, twenty-
                    sixth session continued) -- deliberately not "Make
                    Private" for the private->shared-with-coaches toggle,
                    since that label is already taken above for the
                    unrelated org-share-clearing action in this same menu.
                    Going public gets a real confirm step; going private is
                    a safe, instant, one-way-reversible action. */}
                <button className="mm-item" onClick={()=>{setDrillMenu(null);act.isPrivate?setConfirmMakePublicId(act.id):toggleDrillPrivate(act.id,true);}}>{act.isPrivate?"Make Public":"Keep Private"}</button>
                <button className="mm-item" onClick={()=>{setDrillMenu(null);setOpenInsightsId(act.id);}}>View Drill Insights</button>
                <button className="mm-item mm-danger" onClick={async()=>{setDrillMenu(null);await archiveDrill(act.id);await refreshLibrary();}}>Delete</button>
              </div>}
              {shareMenuId===act.id&&<div className="mini-menu" style={{right:0,top:"100%",minWidth:160}} onClick={e=>e.stopPropagation()}>
                {myOrgs.map(org=>(<button key={org.id} className="mm-item" onClick={()=>toggleShare(act.id,org.id)}>{(act.sharedWithOrganizationIds||[]).includes(org.id)?"✓ ":""}{org.name}</button>))}
              </div>}
              </div>
            </div>}
          </div>);
          // Direct feedback: a new grouping mode, distinct from the other
          // three (which just reorder the same flat list) -- headers are
          // the sport's own skill tags (global, not per-coach), each
          // listing every drill tagged with it; a multi-tagged drill shows
          // up under every one of its tags, same "lives in every applicable
          // spot" rule the untagged-drills deep link already established
          // for the inverse case. Derived straight from this sport's own
          // drills (not a separate skill-category fetch), sorted
          // alphabetically by tag name so the header order is stable.
          if(isMine&&drillSort==="byskill"){
            const byTag={};
            const untagged=[];
            sportDrills.forEach(act=>{
              if(!act.skillTagIds||!act.skillTagIds.length){untagged.push(act);return;}
              act.skillTagIds.forEach(tid=>{(byTag[tid]=byTag[tid]||[]).push(act);});
            });
            const tagIds=Object.keys(byTag).sort((a,b)=>{
              const na=(skillTagsById[a]&&skillTagsById[a].name)||"";
              const nb=(skillTagsById[b]&&skillTagsById[b].name)||"";
              return na.localeCompare(nb);
            });
            return (<>
              {tagIds.map(tid=>(<div key={tid} style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--green)",textTransform:"uppercase",letterSpacing:".05em",padding:"6px 12px",background:"var(--gbg)"}}>{(skillTagsById[tid]&&skillTagsById[tid].name)||"Tag"} ({byTag[tid].length})</div>
                {byTag[tid].map(act=>(<Row key={act.id} act={act} dragHandle={null}/>))}
              </div>))}
              {untagged.length>0&&<div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--td)",textTransform:"uppercase",letterSpacing:".05em",padding:"6px 12px",background:"var(--s2)"}}>Untagged ({untagged.length})</div>
                {untagged.map(act=>(<Row key={act.id} act={act} dragHandle={null}/>))}
              </div>}
            </>);
          }
          if(!isMine||drillSort!=="custom")return sportDrills.map(act=>(<Row key={act.id} act={act} dragHandle={null}/>));
          return (<ActivityDndContext sensors={drillDndSensors} onDragEnd={onDrillDragEnd(sport)} items={sportDrills.map(a=>a.id)}>
            {sportDrills.map(act=>(<SortableActivityRow key={act.id} id={act.id} raised={drillMenu===act.id||shareMenuId===act.id}>{dragHandle=><Row act={act} dragHandle={dragHandle}/>}</SortableActivityRow>))}
          </ActivityDndContext>);
        })()}
      </div>))}
      </>)}
    </div>}
    {mineTab==="templates"&&<div style={{padding:"0 16px"}}>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}><button className="btn primary bsm" onClick={()=>{setNewTplNameDraft("");setNewTplPrompt(true);}}>+ New Template</button></div>
      {newTplPrompt&&<div className="movly" onClick={()=>setNewTplPrompt(false)}><div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="mtitle">Name your template</div>
        <div className="fld"><label className="lbl">Template Name</label><input className="inp" autoFocus placeholder="e.g. Tuesday Skills Day" value={newTplNameDraft} onChange={e=>setNewTplNameDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createNewTpl()}/></div>
        <div className="brow"><button className="btn ghost bmd" onClick={()=>setNewTplPrompt(false)}>Cancel</button><button className="btn primary bmd" disabled={!newTplNameDraft.trim()} onClick={createNewTpl}>Create</button></div>
      </div></div>}
      {templates.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No templates yet.<br/>Build a practice and save it as a template.</div>}
      {templates.map(tpl=>{
        const breakdown=skillBreakdown(tpl.activities);
        return(<div key={tpl.id} className="card" style={{marginBottom:10}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:6}}>
          <div>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:900,lineHeight:1}}>{tpl.name}</div>
            <div style={{fontSize:12,color:"var(--td)",marginTop:2}}>{(tpl.activities||[]).length} activities - {tpl.durMin||0}min</div>
            {(tpl.createdAt||tpl.updatedAt)&&<div style={{fontSize:11,color:"var(--td)",marginTop:2}}>
              {tpl.createdAt&&<span>Created {fmtShort(tpl.createdAt)}</span>}
              {tpl.updatedAt&&tpl.createdAt&&fmtShort(tpl.updatedAt)!==fmtShort(tpl.createdAt)&&<span> - Updated {fmtShort(tpl.updatedAt)}</span>}
            </div>}
            {breakdown.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
              {breakdown.slice(0,6).map(t=>(<span key={t.id} className="bdg bs" style={{fontSize:10}}>{t.name}</span>))}
              {breakdown.length>6&&<span style={{fontSize:10,color:"var(--td)",alignSelf:"center"}}>+{breakdown.length-6} more</span>}
            </div>}
          </div>
          <div style={{position:"relative"}}>
            <button className="ell-btn" onClick={()=>setOpenMenu(openMenu===tpl.id?null:tpl.id)}><span/><span/><span/></button>
            {openMenu===tpl.id&&<div className="mini-menu" style={{right:0}}>
              <button className="mm-item" onClick={()=>{setEditingTpl(tpl);setOpenMenu(null);}}>Edit</button>
              <button className="mm-item" onClick={()=>{setConfirmDel(tpl.id);setOpenMenu(null);}}>Delete</button>
            </div>}
          </div>
        </div>
        <div className="brow">
          <button className="btn outline bmd" style={{flex:1}} onClick={()=>setEditingTpl(tpl)}>View / Edit</button>
          <button className="btn primary bmd" style={{flex:1}} onClick={()=>goToBuilder(null,tpl.id)}>Run Now</button>
        </div>
      </div>);})}
      {confirmDel&&<div className="movly" onClick={()=>setConfirmDel(null)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="mtitle">Delete template?</div><div style={{fontSize:14,color:"var(--td)",marginBottom:16}}>This cannot be undone.</div><div className="brow"><button className="btn ghost bmd" onClick={()=>setConfirmDel(null)}>Cancel</button><button className="btn primary bmd" onClick={async()=>{await archiveTemplate(confirmDel);await refreshPlanning();setConfirmDel(null);}}>Delete</button></div></div></div>}
    </div>}
    {showBuildChoice&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setShowBuildChoice(false);}}>
      <div className="modal">
        <div className="mhandle"/>
        <div className="mtitle">Build Practice</div>
        <div className="li tap" style={{marginBottom:8}} onClick={()=>{setShowBuildChoice(false);goToBuilder(null);}}>
          <div className="lim"><div className="lin">Unscheduled Practice</div><div className="limt">Build now, then save it as a template or run it right away.</div></div>
          <span style={{color:"var(--td)",fontSize:18}}>&#8250;</span>
        </div>
        <div className="li tap" onClick={()=>{setShowBuildChoice(false);setShowSchedulePicker(true);}}>
          <div className="lim"><div className="lin">A Scheduled Practice</div><div className="limt">Pick an upcoming practice from your schedule to plan.</div></div>
          <span style={{color:"var(--td)",fontSize:18}}>&#8250;</span>
        </div>
        <button className="btn ghost bmd bfull" style={{marginTop:12}} onClick={()=>setShowBuildChoice(false)}>Cancel</button>
      </div>
    </div>}
    {showSchedulePicker&&<SchedulePracticePicker data={data} onClose={()=>setShowSchedulePicker(false)} onPick={p=>{setShowSchedulePicker(false);goToBuilder(p.id);}}/>}
    {copyDialogDrill&&<EquipmentMismatchDialog drillName={copyDialogDrill.name} missing={findMissingEquipment(copyDialogDrill.equipment,assetsById,ownPoolForCopy)} context="library" onAddWithEquipment={()=>runCopy(copyDialogDrill,true)} onAddAnyway={()=>runCopy(copyDialogDrill,false)} onCancel={()=>setCopyDialogDrill(null)}/>}
    {openInsightsId&&<DrillInsightsView libraryActivityId={openInsightsId} drillName={(data.activityLibrary||[]).find(a=>a.id===openInsightsId)?.name||"Drill"} onClose={()=>setOpenInsightsId(null)}/>}
    {confirmMakePublicId&&<div className="movly" onClick={()=>setConfirmMakePublicId(null)}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mtitle">Make this drill public?</div>
      <div style={{fontSize:14,color:"var(--td)",marginBottom:16}}>This drill will be visible to coaches you share your library with.</div>
      <div className="brow">
        <button className="btn ghost bmd" onClick={()=>setConfirmMakePublicId(null)}>Cancel</button>
        <button className="btn primary bmd" onClick={()=>{const id=confirmMakePublicId;setConfirmMakePublicId(null);toggleDrillPrivate(id,false);}}>Make Public</button>
      </div>
    </div></div>}
  </div>);
}
