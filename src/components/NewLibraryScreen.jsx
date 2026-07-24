import React, { useState, useEffect, useRef } from "react";
import { uid, sumMins, localDateStr } from "../constants.js";
import { ActConfig, ChecklistConfig, StationConfig, useActivityDnd, useDndSensors, ActivityDndContext, SortableActivityRow, arrayMove } from "./ActivityConfigs.jsx";
import { PublicLibraryScreen } from "./PublicLibraryScreen.jsx";
import { archiveDrill, setDrillOrgShares, copyDrillToMyLibrary, saveTemplateTree, savePracticeTree, archiveTemplate, reorderDrills, createSkillTag, createOrgSkillTag, archiveSkillTag, checkIsAdmin, createGlobalSkillTag, createSkillCategory, archiveSkillCategory, createAsset, createOrgAsset, updateAsset, setAssetLocations, archiveAsset, archiveLocation, createOrgLocation } from "../supabase.js";

// ── Local icon subset needed by this screen ───────────────────────────────────
const Ic_Dots=()=><svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="4" cy="3.5" r="1.4"/><circle cx="10" cy="3.5" r="1.4"/><circle cx="4" cy="7" r="1.4"/><circle cx="10" cy="7" r="1.4"/><circle cx="4" cy="10.5" r="1.4"/><circle cx="10" cy="10.5" r="1.4"/></svg>;
const Ic_Chev=({up})=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points={up?"4 10 8 6 12 10":"4 6 8 10 12 6"}/></svg>;

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

// ── LocationChips — multi-select for which locations a piece of equipment
// is available at. No selection = travels with the coach (available
// everywhere), same convention the schema uses (no asset_locations rows).
export function LocationChips({locations,selectedIds,onToggle}){
  if(!locations||locations.length===0)return null;
  return(<div className="fld"><label className="lbl">Available At</label>
    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:4}}>
      {locations.map(l=>(<button key={l.id} type="button" onClick={()=>onToggle(l.id)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:selectedIds.includes(l.id)?"var(--green)":"var(--s1)",color:selectedIds.includes(l.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{l.name}</button>))}
    </div>
    <div style={{fontSize:11,color:"var(--td)"}}>{selectedIds.length===0?"Travels with you -- available at every location.":"Only available at the selected location(s)."}</div>
  </div>);
}

// ── GearEditRow — inline edit for a player gear item ─────────────────────────
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
  const baseAssets=sportFilter
    ?(data.assets||[]).filter(a=>(a.sport||"General")===sportFilter||(a.sport||"General")==="General")
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
            <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,color:"var(--black)"}}>{sport}</span>
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
      {playerAssets.length===0&&!showAdd&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>
        <div style={{marginBottom:8}}>No player gear yet.</div>
        <div style={{fontSize:12}}>Add gear here and it will appear as chips when building drills for that sport. Basketball coaches may not need this at all.</div>
      </div>}
      {(()=>{
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
  const myTeamSports=new Set((data.teams||[]).map(t=>t.sport).filter(Boolean));
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
  if(sports.length===0)return <div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>Add a team to see skill tags for its sport here.</div>;
  return(<div>
    {sports.map(sport=>{
      const isCollapsed=collapsed[sport];
      const sportCats=cats.filter(c=>c.sport===sport).slice().sort((a,b)=>a.sort_order-b.sort_order);
      const tagCount=tags.filter(t=>sportCats.some(c=>c.id===t.categoryId)).length;
      return(<div key={sport} style={{marginBottom:8}}>
        <button onClick={()=>setCollapsed(c=>Object.assign({},c,{[sport]:!c[sport]}))} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"var(--s1)",border:"none",borderRadius:isCollapsed?"var(--r)":"var(--r) var(--r) 0 0",cursor:"pointer"}}>
          <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,color:"var(--black)"}}>{sport}</span>
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
  // A freshly-created template placeholder (from "+ New Template") has a
  // locally-generated uid(), not a real UUID -- checked live off existingId
  // (not frozen at mount) so Save as New/Start from Template appear the
  // moment a brand-new template's first save returns a real row.
  const isSaved=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existingId||"");
  const loc=data.locations.find(l=>l.id===locId)||null;
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
    const {data:saved}=await savePracticeTree(null,{teamId,locationId:locId,date:localDateStr(),startTime:new Date().toTimeString().slice(0,5),timezone:team&&team.timezone,activities:acts});
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
        <select className="sel" value={locId} onChange={e=>setLocId(e.target.value)}>
          <option value="">None</option>
          {data.locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
    </div>

    <div className="sechdr mb8"><span className="sectitle">{acts.length} Activities</span><span className="pill">{sumMins(acts)}m</span></div>

    <ActivityDndContext sensors={dndSensors} onDragEnd={onActDragEnd} items={acts.map(a=>a.id)}>
    {acts.map((act)=>(<SortableActivityRow key={act.id} id={act.id} sticky={act.id===lastAddedId}>{dragHandle=>(<div>
      <div className="ablk">
        <div className="abhdr" onClick={()=>setExpandedId(expandedId===act.id?null:act.id)}>
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

    {/* Add drills panel — same as builder */}
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
  const [section,setSection]=useState("mine"); // "mine" | "explore"
  const [mineTab,setMineTab]=useState("drills"); // sub-toggle within My Library
  const [openMenu,setOpenMenu]=useState(null);
  const [editingTpl,setEditingTpl]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const [collapsed,setCollapsed]=useState({});
  const [drillMenu,setDrillMenu]=useState(null);
  const [shelf,setShelf]=useState("mine");
  const [shareMenuId,setShareMenuId]=useState(null);
  const [copyingId,setCopyingId]=useState(null);
  const [tagFilter,setTagFilter]=useState([]);
  const [tagSearch,setTagSearch]=useState("");
  const [showFilter,setShowFilter]=useState(false);
  const [newTplPrompt,setNewTplPrompt]=useState(false);
  const [newTplNameDraft,setNewTplNameDraft]=useState("");
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
  // Public Library shown regardless of org membership (spec §3 -- public is
  // public), always first so it's the default Explore landing shelf.
  const exploreShelves=[{key:"public",label:"Public Library"},...myOrgs.flatMap(org=>[{key:"orgLib:"+org.id,label:org.name+" Library",org},{key:"shared:"+org.id,label:"From "+org.name,org}])];
  const goSection=s=>{
    setSection(s);
    setShelf(s==="mine"?"mine":(exploreShelves[0]?exploreShelves[0].key:""));
    setTagFilter([]);setTagSearch("");
  };
  const showDrillList=(section==="mine"&&mineTab==="drills")||(section==="explore"&&exploreShelves.length>0);
  // shelf==="public" is handled entirely by PublicLibraryScreen (search-first
  // browsing, 2026-07-19) -- not computed here at all.
  const shelfDrillsAll=(()=>{
    if(shelf==="mine")return (data.activityLibrary||[]).filter(a=>isOrgMode?a.organizationId===mode.orgId:a.ownerUserId===coachId);
    if(shelf.startsWith("orgLib:")){const orgId=shelf.slice(7);return (data.activityLibrary||[]).filter(a=>a.organizationId===orgId);}
    if(shelf.startsWith("shared:")){const orgId=shelf.slice(7);return (data.activityLibrary||[]).filter(a=>(a.sharedWithOrganizationIds||[]).includes(orgId)&&a.ownerUserId!==coachId);}
    return [];
  })();
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
  const shelfDrills=tagFilter.length===0?shelfDrillsAll:shelfDrillsAll.filter(a=>(a.skillTagIds||[]).some(id=>tagFilter.includes(id)));
  const sports=[...new Set(shelfDrills.map(a=>a.sport||"General").filter(Boolean))].sort();
  const assetsById=Object.fromEntries((data.assets||[]).map(a=>[a.id,a]));
  const equipNames=ids=>(ids||[]).map(id=>assetsById[id]?assetsById[id].name:null).filter(Boolean);
  // Toggle one org in/out of a drill's share set -- a drill can be shared to
  // more than one org, so this is a multi-select toggle, not a single pick.
  const toggleShare=async(drillId,orgId)=>{const drill=(data.activityLibrary||[]).find(a=>a.id===drillId);const cur=(drill&&drill.sharedWithOrganizationIds)||[];const next=cur.includes(orgId)?cur.filter(id=>id!==orgId):[...cur,orgId];await setDrillOrgShares(drillId,next);await refreshLibrary();};
  const makePrivate=async(drillId)=>{setShareMenuId(null);await setDrillOrgShares(drillId,[]);await refreshLibrary();};
  const doCopy=async(drill)=>{setCopyingId(drill.id);await copyDrillToMyLibrary(coachId,drill,assetsById,skillTagsById);await refreshLibrary();setCopyingId(null);};
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
  if(editingTpl)return (<div style={{paddingBottom:80}}><TemplateWorkspace data={data} template={editingTpl} openModal={openModal} coachId={coachId} refreshLibrary={refreshLibrary} refreshPlanning={refreshPlanning} onBack={()=>setEditingTpl(null)} onStartFromTemplate={tplId=>goToBuilder(null,tplId)} onRunNow={goToRun}/></div>);
  return (<div style={{paddingBottom:80}}>
    <div style={{padding:"20px 16px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900}}>{isOrgMode?"Club Library":"Library"}</div>
      <button className="btn primary bsm" onClick={()=>goToBuilder(null)}>+ Build Practice</button>
    </div>
    <div style={{padding:"0 16px 12px"}}>
      <div style={{display:"flex",gap:0,background:"var(--s2)",borderRadius:"var(--r)",padding:3,marginBottom:0}}>
        {[{k:"mine",label:isOrgMode?"Org Library":"My Library"},{k:"explore",label:"Explore"}].map(t=>(<button key={t.k} onClick={()=>goSection(t.k)} style={{flex:1,padding:"7px 0",border:"none",cursor:"pointer",borderRadius:"calc(var(--r) - 2px)",background:section===t.k?"#fff":"transparent",fontFamily:"Barlow Condensed,sans-serif",fontSize:12,fontWeight:700,letterSpacing:".03em",textTransform:"uppercase",color:section===t.k?"var(--black)":"var(--td)"}}>{t.label}</button>))}
      </div>
      {/* 5-tab content-type sub-nav (Drills default): Locations/Equipment/
          Skill Tags moved here from Settings -- a director managing an
          org's shared stuff wants one place for all five content types,
          which already share the identical coach-or-org ownership pattern
          in the schema. Explore only applies to drills (cross-coach/org
          browsing), so this row is My/Org Library only, same as before. */}
      {/* Tap-target fix (same class of bug as Layout.jsx's team-workspace
          tabs): padding was "2px 0" -- no side padding at all -- so the hit
          box was exactly text-sized. Padding widened, row gap shrank to
          compensate so all 5 tabs still fit without extra scrolling. */}
      {section==="mine"&&<div style={{display:"flex",gap:8,padding:"6px 2px 0",overflowX:"auto"}}>
        {[{k:"drills",label:"Drills"},{k:"templates",label:"Templates"},{k:"locations",label:"Locations"},{k:"equipment",label:"Equipment"},{k:"skills",label:"Skill Tags"}].map(t=>(<button key={t.k} onClick={()=>setMineTab(t.k)} style={{flexShrink:0,background:"none",border:"none",cursor:"pointer",padding:"8px 6px",fontFamily:"Barlow Condensed,sans-serif",fontSize:14,fontWeight:700,letterSpacing:".04em",textTransform:"uppercase",whiteSpace:"nowrap",color:mineTab===t.k?"var(--green)":"var(--td)",borderBottom:"2px solid "+(mineTab===t.k?"var(--green)":"transparent")}}>{t.label}</button>))}
      </div>}
    </div>
    {section==="mine"&&mineTab==="locations"&&<div style={{padding:"0 16px"}}><LocationsSection data={data} openModal={openModal} refreshPlanning={refreshPlanning} coachId={coachId} mode={mode}/></div>}
    {section==="mine"&&mineTab==="equipment"&&<div style={{padding:"0 16px"}}><EquipmentTab data={data} coachId={coachId} refreshLibrary={refreshLibrary} openModal={openModal} mode={mode}/></div>}
    {section==="mine"&&mineTab==="skills"&&<div style={{padding:"0 16px"}}><SkillsTab data={data} coachId={coachId} refreshLibrary={refreshLibrary} isAdmin={isAdmin} mode={mode}/></div>}
    {showDrillList&&<div style={{padding:"0 16px"}} onClick={()=>{setDrillMenu(null);setShareMenuId(null);}}>
      {section==="explore"&&exploreShelves.length>1&&<div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:12,paddingBottom:2}}>
        {exploreShelves.map(s=>(<button key={s.key} onClick={()=>{setShelf(s.key);setTagFilter([]);setTagSearch("");}} style={{flexShrink:0,padding:"6px 12px",borderRadius:20,border:"1.5px solid var(--b)",background:shelf===s.key?"var(--green)":"var(--s1)",color:shelf===s.key?"#fff":"var(--black)",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{s.label}</button>))}
      </div>}
      {shelf==="public"?(
        <div onClick={e=>e.stopPropagation()}><PublicLibraryScreen data={data} isAdmin={isAdmin} refreshLibrary={refreshLibrary} openModal={openModal} doCopy={doCopy} copyingId={copyingId}/></div>
      ):(<>
      <div style={{display:"flex",justifyContent:"flex-end",gap:6,marginBottom:12}}>
        {availableTags.length>0&&<button className="btn ghost bsm" onClick={e=>{e.stopPropagation();setShowFilter(true);}}>Filter{tagFilter.length>0?" ("+tagFilter.length+")":""}</button>}
        {isMine&&<button className="btn primary bsm" onClick={()=>openModal("addActivity")}>+ Add Drill</button>}
      </div>
      {tagFilter.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center",marginBottom:12}} onClick={e=>e.stopPropagation()}>
        {tagFilter.map(id=>{const t=skillTagsById[id];if(!t)return null;return(<span key={id} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 4px 3px 10px",borderRadius:20,background:"var(--green)",color:"#fff",fontSize:12,fontWeight:600}}>
          {t.name}
          <button type="button" onClick={()=>toggleTagFilter(id)} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",fontSize:14,lineHeight:1,padding:"2px 4px"}}>&times;</button>
        </span>);})}
        <button type="button" onClick={()=>setTagFilter([])} style={{background:"none",border:"none",color:"var(--td)",fontSize:12,cursor:"pointer",textDecoration:"underline",padding:0}}>Clear all</button>
      </div>}
      {showFilter&&<div className="movly" style={{zIndex:300}} onClick={e=>{if(e.target===e.currentTarget)setShowFilter(false);}}>
        <div className="modal">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:900}}>Filter Drills</div>
            <button type="button" className="btn ghost bxs" onClick={()=>setShowFilter(false)}>Done</button>
          </div>
          <div className="clbl mb8">Skill Tags</div>
          {availableTags.length>8&&<input className="inp" placeholder="Search skill tags..." value={tagSearch} onChange={e=>setTagSearch(e.target.value)} style={{marginBottom:10}}/>}
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {visibleTagChips.map(t=>(<button key={t.id} type="button" onClick={()=>toggleTagFilter(t.id)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:tagFilter.includes(t.id)?"var(--green)":"var(--s1)",color:tagFilter.includes(t.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{t.name} <span style={{opacity:.7}}>{tagCounts[t.id]}</span></button>))}
            {visibleTagChips.length===0&&<span style={{fontSize:13,color:"var(--td)"}}>No skill tags match "{tagSearch}"</span>}
          </div>
          {tagFilter.length>0&&<button type="button" className="btn ghost bxs" onClick={()=>setTagFilter([])}>Clear all filters</button>}
          <button type="button" className="btn primary bmd bfull" style={{marginTop:14}} onClick={()=>setShowFilter(false)}>Done</button>
        </div>
      </div>}
      {shelfDrillsAll.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>{isMine?"No drills yet. Tap + Add Drill.":shelf.startsWith("orgLib:")?"No drills shared to this org yet -- share one from My Library.":"No drills shared by other coaches yet."}</div>}
      {shelfDrillsAll.length>0&&shelfDrills.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No drills match the selected skill tags.</div>}
      {sports.map(sport=>(<div key={sport} style={{marginBottom:8}}>
        <button onClick={()=>toggle(sport)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"var(--s1)",border:"none",borderRadius:"var(--r)",cursor:"pointer"}}>
          <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700}}>{sport}</span>
          <span style={{fontSize:12,color:"var(--td)"}}>{shelfDrills.filter(a=>(a.sport||"General")===sport).length} drills {collapsed[sport]?"":"v"}</span>
        </button>
        {!collapsed[sport]&&(()=>{
          const naturalOrder=shelfDrills.filter(a=>(a.sport||"General")===sport).slice().sort((a,b)=>isMine?a.position-b.position:a.name.localeCompare(b.name));
          const sportDrills=(isMine&&drillOrderOverride[sport])
            ?drillOrderOverride[sport].map(id=>naturalOrder.find(a=>a.id===id)).filter(Boolean)
            :naturalOrder;
          const Row=({act,dragHandle})=>(<div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 12px",borderBottom:"1px solid var(--b)",background:"#fff"}}>
            {dragHandle}
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                <span style={{fontWeight:700,fontSize:14}}>{act.name}</span>
                {isMine&&(act.sharedWithOrganizationIds||[]).length>0&&<span className="bdg bp" style={{fontSize:10}}>Shared</span>}
              </div>
              {act.description&&<div style={{fontSize:12,color:"var(--td)",marginBottom:2,lineHeight:1.4}}>{act.description}</div>}
              {act.coachingPoints&&<div style={{fontSize:12,color:"var(--td)",marginBottom:2}}>{act.coachingPoints}</div>}
              {act.equipment&&act.equipment.length>0&&<div style={{fontSize:11,color:"var(--td)",marginTop:2}}>Needs: {equipNames(act.equipment).join(", ")}</div>}
              {act.grouping&&act.grouping!=="whole"&&<div style={{fontSize:11,color:"var(--td)",marginTop:2}}>{act.grouping==="partners"?"Partners":act.numGroups+" groups"}</div>}
              {act.skillTagIds&&act.skillTagIds.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
                {tagNames(act.skillTagIds).map(name=>(<span key={name} className="bdg bs" style={{fontSize:10}}>{name}</span>))}
              </div>}
              {!isMine&&<div style={{fontSize:11,color:"var(--green2)",marginTop:4}}>Shared by {(data.profilesById&&data.profilesById[act.ownerUserId]&&data.profilesById[act.ownerUserId].name)||"a coach"}</div>}
              {!isMine&&shelf.startsWith("shared:")&&<button className="btn outline bxs" style={{marginTop:6}} onClick={()=>doCopy(act)} disabled={copyingId===act.id}>{copyingId===act.id?"Copying...":"Copy to My Library"}</button>}
            </div>
            {isMine&&<div style={{position:"relative",flexShrink:0}}>
              <button className="ell-btn" onClick={e=>{e.stopPropagation();setDrillMenu(drillMenu===act.id?null:act.id);setShareMenuId(null);}}><span/><span/><span/></button>
              {drillMenu===act.id&&<div className="mini-menu" style={{right:0,minWidth:140}}>
                <button className="mm-item" onClick={()=>{setDrillMenu(null);openModal("editActivity",{activity:act});}}>Edit</button>
                {myOrgs.length>0&&<button className="mm-item" onClick={e=>{e.stopPropagation();setDrillMenu(null);setShareMenuId(shareMenuId===act.id?null:act.id);}}>{(act.sharedWithOrganizationIds||[]).length>0?"Change Sharing":"Share..."}</button>}
                {(act.sharedWithOrganizationIds||[]).length>0&&<button className="mm-item" onClick={()=>makePrivate(act.id)}>Make Private</button>}
                <button className="mm-item mm-danger" onClick={async()=>{setDrillMenu(null);await archiveDrill(act.id);await refreshLibrary();}}>Delete</button>
              </div>}
              {shareMenuId===act.id&&<div className="mini-menu" style={{right:0,top:"100%",minWidth:160}} onClick={e=>e.stopPropagation()}>
                {myOrgs.map(org=>(<button key={org.id} className="mm-item" onClick={()=>toggleShare(act.id,org.id)}>{(act.sharedWithOrganizationIds||[]).includes(org.id)?"✓ ":""}{org.name}</button>))}
              </div>}
            </div>}
          </div>);
          if(!isMine)return sportDrills.map(act=>(<Row key={act.id} act={act} dragHandle={null}/>));
          return (<ActivityDndContext sensors={drillDndSensors} onDragEnd={onDrillDragEnd(sport)} items={sportDrills.map(a=>a.id)}>
            {sportDrills.map(act=>(<SortableActivityRow key={act.id} id={act.id}>{dragHandle=><Row act={act} dragHandle={dragHandle}/>}</SortableActivityRow>))}
          </ActivityDndContext>);
        })()}
      </div>))}
      </>)}
    </div>}
    {section==="mine"&&mineTab==="templates"&&<div style={{padding:"0 16px"}}>
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
  </div>);
}
