import React, { useState, useRef, useEffect } from "react";
import { uid, TEAM_COLORS, nextTeamColor, POSITIONS_BY_SPORT, HAND_FIELDS_BY_SPORT, HAND_LABELS } from "../constants.js";
import { createTeam, updateTeam, createPlayer, createStaff, updateStaff, createAsset, updateAsset, createDrill, updateDrill, createSkillTag, createLocation, updateLocation, createSublocation, fetchStaffSuggestions, createCatalogDrill, updateCatalogDrill, createCatalogAsset, createGlobalSkillTag } from "../supabase.js";
import { AutoTextarea } from "./ActivityConfigs.jsx";

const SPORTS=["Basketball","Soccer","Baseball","Lacrosse","Football","Softball","Volleyball","Hockey","Tennis","Swimming","General","Other"];
const STAFF_ROLES=["Head Coach","Assistant Coach","Helper"];

// Chip-grid picker for a sport's fixed position list, falling back to a
// freeform text input for sports with no defined list (Tennis, General,
// Other, ...) so those rosters aren't blocked from recording anything.
export function PositionPicker({sport,value,onChange}){
  const options=POSITIONS_BY_SPORT[sport]||[];
  const toggle=pos=>{const has=value.includes(pos);onChange(has?value.filter(x=>x!==pos):[...value,pos]);};
  if(!options.length)return(<div className="fld"><label className="lbl">Positions</label><input className="inp" placeholder="e.g. Forward, Midfielder" value={value.join(", ")} onChange={e=>onChange(e.target.value.split(",").map(x=>x.trim()).filter(Boolean))}/></div>);
  return(<div className="fld"><label className="lbl">Positions</label>
    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
      {options.map(pos=>(<button key={pos} type="button" onClick={()=>toggle(pos)} style={{padding:"6px 12px",borderRadius:20,border:"1.5px solid var(--b)",background:value.includes(pos)?"var(--green)":"var(--s1)",color:value.includes(pos)?"#fff":"var(--black)",fontSize:13,fontWeight:600,cursor:"pointer"}}>{pos}</button>))}
    </div>
  </div>);
}

// One button row per applicable hand field (Bats/Throws for baseball,
// just Throws for football, none at all for sports where it doesn't
// matter) -- see HAND_FIELDS_BY_SPORT for which sports get which fields.
export function HandednessPicker({sport,value,onChange}){
  const fields=HAND_FIELDS_BY_SPORT[sport]||[];
  if(!fields.length)return null;
  return(<div className="fld"><label className="lbl">Handedness</label>
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {fields.map(f=>(<div key={f.key}>
        <div style={{fontSize:11,color:"var(--td)",marginBottom:4}}>{f.label}</div>
        <div style={{display:"flex",gap:6}}>
          {f.options.map(opt=>(<button key={opt} type="button" onClick={()=>onChange(f.key,value[f.key]===opt?"":opt)} style={{flex:1,padding:"7px 0",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:value[f.key]===opt?"var(--green)":"var(--s1)",color:value[f.key]===opt?"#fff":"var(--black)",fontSize:13,fontWeight:700,cursor:"pointer"}}>{HAND_LABELS[opt]}</button>))}
        </div>
      </div>))}
    </div>
  </div>);
}

// Closed by default: shows only the selected tags as removable chips plus an
// "Add/Edit" button that opens the full category-grouped, searchable picker
// in an overlay. A flat always-open pill grid stopped scaling once a coach's
// tag set grew past a handful of categories (56 seeded tags across 7
// categories x2 sports) -- most of that space was pills the coach hadn't
// picked and never would for this particular drill.
// catalogId set = editing/adding a public-catalog drill -- spec §2.4, these
// may only carry scope='global' tags (never a personal/org one that would
// be invisible to other viewers), and new tags added here go global too.
function SkillTagPicker({data,coachId,sport,selectedIds,onChange,refreshLibrary,catalogId}){
  const [open,setOpen]=useState(false);
  const [search,setSearch]=useState("");
  const [newTagName,setNewTagName]=useState("");
  const [newTagCategoryId,setNewTagCategoryId]=useState("");
  const cats=(data.skillCategories||[]).filter(c=>c.sport===sport&&!c.archived_at);
  if(cats.length===0)return null;
  const allTags=(data.skillTags||[]).filter(t=>!catalogId||t.scope==="global");
  const selectedTags=selectedIds.map(id=>allTags.find(t=>t.id===id)).filter(Boolean);
  const toggleTag=id=>{const has=selectedIds.includes(id);onChange(has?selectedIds.filter(x=>x!==id):[...selectedIds,id]);};
  const addTag=async()=>{
    if(!newTagName.trim())return;
    const catId=newTagCategoryId||(cats[0]&&cats[0].id);
    if(!catId)return;
    const{data:newTag}=catalogId
      ?await createGlobalSkillTag({categoryId:catId,name:newTagName.trim()})
      :await createSkillTag(coachId,{categoryId:catId,name:newTagName.trim()});
    if(newTag)onChange([...selectedIds,newTag.id]);
    setNewTagName("");
    await refreshLibrary();
  };
  const q=search.trim().toLowerCase();
  return(<div className="fld"><label className="lbl">Skill Tags</label>
    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
      {selectedTags.map(t=>(<span key={t.id} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 4px 4px 10px",borderRadius:20,background:"var(--green)",color:"#fff",fontSize:13}}>
        {t.name}
        <button type="button" onClick={()=>toggleTag(t.id)} aria-label={"Remove "+t.name} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",fontSize:15,lineHeight:1,padding:"2px 4px"}}>&times;</button>
      </span>))}
      <button type="button" className="btn ghost bxs" onClick={()=>setOpen(true)}>{selectedTags.length?"Edit":"+ Add"} Skill Tags</button>
    </div>
    {open&&(<div className="movly" style={{zIndex:300}} onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
      <div className="modal">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:900}}>Skill Tags</div>
          <button type="button" className="btn ghost bxs" onClick={()=>setOpen(false)}>Done</button>
        </div>
        <input className="inp" placeholder="Search skills..." value={search} onChange={e=>setSearch(e.target.value)} style={{marginBottom:14}}/>
        {cats.map(cat=>{
          const tags=allTags.filter(t=>t.categoryId===cat.id&&(!q||t.name.toLowerCase().includes(q)));
          if(tags.length===0)return null;
          return(<div key={cat.id} style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--td)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>{cat.name}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {tags.map(t=>(<button key={t.id} type="button" onClick={()=>toggleTag(t.id)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:selectedIds.includes(t.id)?"var(--green)":"var(--s1)",color:selectedIds.includes(t.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{t.name}</button>))}
            </div>
          </div>);
        })}
        {q&&cats.every(cat=>allTags.filter(t=>t.categoryId===cat.id&&t.name.toLowerCase().includes(q)).length===0)&&<div style={{fontSize:13,color:"var(--td)",marginBottom:10}}>No skills match "{search}"</div>}
        <div style={{display:"flex",gap:6,marginTop:4}}>
          <select className="sel" style={{maxWidth:140}} value={newTagCategoryId||cats[0].id} onChange={e=>setNewTagCategoryId(e.target.value)}>
            {cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className="inp" placeholder={catalogId?"Add a global tag...":"Add my own tag..."} style={{flex:1}} value={newTagName} onChange={e=>setNewTagName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag()}/>
          <button type="button" className="btn ghost bxs" onClick={addTag}>Add</button>
        </div>
        <button type="button" className="btn primary bmd bfull" style={{marginTop:14}} onClick={()=>setOpen(false)}>Done</button>
      </div>
    </div>)}
  </div>);
}

function DurStepper({value,min,onChange,step}){
  const s=step||1;
  const mn=min||1;
  return (<div style={{display:"flex",alignItems:"center",gap:0,border:"1.5px solid var(--b)",borderRadius:"var(--rs)",overflow:"hidden",background:"#fff"}}>
      <button onClick={()=>onChange(Math.max(mn,value-s))} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>-</button>
      <div style={{flex:1,textAlign:"center",fontFamily:"DM Mono,monospace",fontSize:15,fontWeight:600,color:"var(--black)"}}>{value}m</div>
      <button onClick={()=>onChange(value+s)} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
    </div>
  );
}

export default function ModalLayer({modal,data,update,closeModal,refreshTeams,refreshLibrary,refreshPlanning,coachId}){
  const defaultSport=()=>{
    const lib=data.activityLibrary||[];
    if(lib.length>0)return lib[lib.length-1].sport||"Basketball";
    const sports=[...new Set((data.teams||[]).map(t=>t.sport).filter(Boolean))];
    if(sports.length===1)return sports[0];
    return "Basketball";
  };
  const lastSportRef=useRef(defaultSport());
  const playerTeamId=modal.type==="addPlayer"?modal.payload.teamId:null;
  const playerTeam=playerTeamId?(data.teams||[]).find(t=>t.id===playerTeamId):null;
  const playerSport=(playerTeam&&playerTeam.sport)||"General";
  const activity=modal.type==="editActivity"?modal.payload.activity:null;
  // Public-library authoring: editing an existing catalog drill carries its
  // own source_catalog_id; adding a brand-new one only knows "this is going
  // into the public library" (isPublicLibrary), and resolves which sport's
  // catalog once the Sport field below is set, since one catalog exists per
  // sport (spec §2.2). Recomputed on every render since f.sport is state.
  const isPublicLibraryAdd=modal.type==="addActivity"&&modal.payload&&modal.payload.isPublicLibrary;
  const location=modal.type==="editLocation"?modal.payload.location:null;
  const editTeamData=modal.type==="editTeam"?modal.payload.team:null;
  const asset=modal.type==="editAsset"?modal.payload.asset:null;
  const coach=modal.type==="editCoach"?modal.payload.coach:null;
  const template=modal.type==="editTemplate"?modal.payload.template:null;
  const [f,setF]=useState(()=>{
    if(modal.type==="addPlayer")return{firstName:"",lastName:"",jersey:"",notes:"",positions:[],bats:"",throws:""};
    if(activity){
      lastSportRef.current=activity.sport||"Basketball";
      return{
        name:activity.name,
        sport:activity.sport||"Basketball",
        duration:activity.duration,
        description:activity.description||"",
        coachingPoints:activity.coachingPoints||"",
        equipment:Array.isArray(activity.equipment)?activity.equipment:[],
        grouping:activity.grouping||"whole",
        numGroups:activity.numGroups||2,
        skillTagIds:Array.isArray(activity.skillTagIds)?activity.skillTagIds:[],
      };
    }
    if(location)return{name:location.name};
    if(asset)return{name:asset.name};
    if(coach)return{name:coach.name,role:coach.role||"Assistant Coach",inviteEmail:coach.inviteEmail||""};
    if(template)return{name:template.name,sport:template.sport||"General"};
    if(editTeamData)return{name:editTeamData.name,sport:editTeamData.sport||"Basketball",colorPrimary:editTeamData.colorPrimary||""};
    return{sport:lastSportRef.current||"Basketball",colorPrimary:nextTeamColor(data.teams)};
  });
  const set=(k,v)=>setF(p=>Object.assign({},p,{[k]:v}));
  const catalogId=activity?activity.sourceCatalogId:(
    isPublicLibraryAdd?((data.catalogs||[]).find(c=>c.sport===(f.sport||"General")&&c.publisherType==="system")||{}).id:null
  );
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState("");
  const savingRef=useRef(false);
  const [addedCoachInfo,setAddedCoachInfo]=useState(null);
  const [staffSuggestions,setStaffSuggestions]=useState([]);
  useEffect(()=>{
    if(modal.type==="addCoach")fetchStaffSuggestions(coachId,modal.payload.teamId).then(setStaffSuggestions);
  },[modal.type]);
  const save=async()=>{
    // useState alone isn't a safe reentrancy guard here: rapid synchronous
    // double-clicks/taps all fire before React re-renders with the updated
    // `saving` value, so they'd all read the same stale `false`. A ref
    // mutates immediately, so the second call sees the block right away.
    if(savingRef.current)return;
    savingRef.current=true;
    setSaving(true);
    setSaveError("");
    try{
    const t=modal.type,p=modal.payload;
    let res=null;
    if(t==="addTeam"){if(!f.name)return;await createTeam(coachId,{name:f.name,sport:f.sport||"Basketball",colorPrimary:f.colorPrimary||nextTeamColor(data.teams)});await refreshTeams();}
    if(t==="editTeam"){if(!f.name)return;await updateTeam(p.team.id,{name:f.name,sport:f.sport||"Basketball",colorPrimary:f.colorPrimary||p.team.colorPrimary});await refreshTeams();}
    if(t==="addPlayer"){if(!f.firstName)return;await createPlayer(p.teamId,{firstName:f.firstName,lastName:f.lastName||"",jersey:f.jersey||"",positions:f.positions||[],bats:f.bats||"",throws:f.throws||"",notes:f.notes||""});await refreshTeams();}
    if(t==="addCoach"){if(!f.name||!f.inviteEmail)return;await createStaff(p.teamId,{name:f.name,role:f.role||"Assistant Coach",inviteEmail:f.inviteEmail});await refreshTeams();}
    if(t==="editCoach"){if(!f.name)return;if(!coach.userId&&!f.inviteEmail)return;await updateStaff(p.coach.id,{name:f.name,role:f.role||"Assistant Coach",inviteEmail:f.inviteEmail||""});await refreshTeams();}
    if(t==="addLocation"){if(!f.name)return;await createLocation(coachId,f.name);await refreshPlanning();}
    if(t==="editLocation"){if(!f.name)return;await updateLocation(p.location.id,f.name);await refreshPlanning();}
    if(t==="addSublocation"){if(!f.name)return;await createSublocation(p.locationId,f.name);await refreshPlanning();}
    if(t==="addAsset"){if(!f.name)return;await createAsset(coachId,{name:f.name,type:f.assetType||"team",sport:f.assetSport||"General"});await refreshLibrary();}
    if(t==="editAsset"){if(!f.name)return;await updateAsset(p.asset.id,{name:f.name,sport:p.asset.sport||"General"});await refreshLibrary();}
    if(t==="addActivity"){
      if(!f.name)return;
      if(isPublicLibraryAdd&&!catalogId){setSaveError("No public catalog exists for "+(f.sport||"this sport")+" yet.");return;}
      const payload={
        name:f.name,sport:f.sport||"General",duration:+(f.duration||10),
        description:f.description||"",coachingPoints:f.coachingPoints||"",
        grouping:f.grouping||"whole",numGroups:f.numGroups||2,
        equipment:f.equipment||[],skillTagIds:f.skillTagIds||[],
      };
      res=isPublicLibraryAdd?await createCatalogDrill(catalogId,payload):await createDrill(coachId,payload);
      await refreshLibrary();
    }
    if(t==="editActivity"){
      if(!f.name)return;
      const payload={
        name:f.name,sport:f.sport||"General",duration:+(f.duration||10),
        description:f.description||"",coachingPoints:f.coachingPoints||"",
        grouping:f.grouping||"whole",numGroups:f.numGroups||2,
        equipment:f.equipment||[],skillTagIds:f.skillTagIds||[],
      };
      res=activity.sourceCatalogId?await updateCatalogDrill(p.activity.id,payload):await updateDrill(p.activity.id,payload);
      await refreshLibrary();
    }
    if(t==="editTemplate"){if(!f.name)return;update(d=>{const tpl=d.templates.find(t=>t.id===p.template.id);if(tpl){tpl.name=f.name;tpl.sport=f.sport||"General";}return d;});}
    // addActivity/editActivity are the only callers that populate `res` --
    // a failed drill/tag/equipment write (e.g. an RLS rejection) used to
    // close the modal silently, same as a successful save, so the user had
    // no way to tell their change hadn't actually persisted.
    if(res&&res.error){setSaveError("Something went wrong saving. Try again.");return;}
    if(t==="addCoach"){setAddedCoachInfo({name:f.name,email:f.inviteEmail});}else{closeModal();}
    }finally{savingRef.current=false;setSaving(false);}
  };
  const TITLES={addTemplate:"New Template",editTemplate:"Edit Template",addTeam:"New Team",editTeam:"Edit Team",addPlayer:"Add Player",addCoach:"Add Coach",editCoach:"Edit Coach",addLocation:"Add Location",editLocation:"Edit Location",addSublocation:"Add Area",addAsset:"Add Equipment",editAsset:"Edit Equipment",addActivity:"New Drill",editActivity:"Edit Drill"};
  return (<div className="movly" onClick={e=>{if(e.target===e.currentTarget)closeModal();}}>
      <div className="modal">
        <div className="mhandle"/>
        <div className="mtitle">{addedCoachInfo?"Added":(TITLES[modal.type]||"Add")}</div>
        {addedCoachInfo&&<div className="fld"><div style={{fontSize:14,lineHeight:1.5}}>{addedCoachInfo.name} will get an email at {addedCoachInfo.email}, and you can also just tell them: sign in at runofpractice.com with {addedCoachInfo.email}.</div></div>}
        {!addedCoachInfo&&modal.type==="addTeam"&&(<div><div className="fld"><label className="lbl">Team Name</label><input className="inp" autoFocus placeholder="e.g. Peoria Eagles 10U" onChange={e=>set("name",e.target.value)}/></div>
          <div className="fld"><label className="lbl">Sport</label><select className="sel" onChange={e=>{set("sport",e.target.value);lastSportRef.current=e.target.value;}}>{SPORTS.map(s=><option key={s}>{s}</option>)}</select></div>
          <div className="fld">
            <label className="lbl">Team Color</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {TEAM_COLORS.map(c=>(<button key={c} type="button" onClick={()=>set("colorPrimary",c)} style={{width:32,height:32,borderRadius:"50%",background:c,border:f.colorPrimary===c?"3px solid var(--black)":"3px solid transparent",cursor:"pointer",padding:0}}/>))}
            </div>
          </div>
        </div>
        )}
        {modal.type==="addPlayer"&&(<div>
            <div className="g2"><div className="fld"><label className="lbl">First Name</label><input className="inp" autoFocus value={f.firstName||""} onChange={e=>set("firstName",e.target.value)}/></div><div className="fld"><label className="lbl">Last Name</label><input className="inp" value={f.lastName||""} onChange={e=>set("lastName",e.target.value)}/></div></div>
            <div className="fld"><label className="lbl">Jersey #</label><input className="inp" type="number" inputMode="numeric" value={f.jersey||""} onChange={e=>set("jersey",e.target.value)}/></div>
            <PositionPicker sport={playerSport} value={f.positions||[]} onChange={v=>set("positions",v)}/>
            <HandednessPicker sport={playerSport} value={f} onChange={(k,v)=>set(k,v)}/>
            <div className="fld"><label className="lbl">Notes</label><textarea className="ta" value={f.notes||""} onChange={e=>set("notes",e.target.value)}/></div>
          </div>
        )}
        {!addedCoachInfo&&modal.type==="addCoach"&&staffSuggestions.length>0&&(
          <div className="fld"><label className="lbl">From your other teams</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {staffSuggestions.map(s=>(<button key={s.email} type="button" className="btn bxs ghost" onClick={()=>{set("name",s.name);set("inviteEmail",s.email);}}>{s.name}</button>))}
            </div>
          </div>
        )}
        {!addedCoachInfo&&(modal.type==="addCoach"||modal.type==="editCoach")&&(<div>
            <div className="fld"><label className="lbl">Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Role</label>
              <div className="brow">
                {STAFF_ROLES.map(r=>(<button key={r} type="button" className={"btn bsm "+((f.role||"Assistant Coach")===r?"primary":"ghost")} onClick={()=>set("role",r)}>{r}</button>))}
              </div>
            </div>
            {!(coach&&coach.userId)&&<div className="fld"><label className="lbl">Invite Email</label><input className="inp" type="email" placeholder="Required until they create an account" value={f.inviteEmail||""} onChange={e=>set("inviteEmail",e.target.value)}/></div>}
          </div>
        )}
        {(modal.type==="addLocation"||modal.type==="editLocation"||modal.type==="addSublocation")&&(<div className="fld"><label className="lbl">Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
        )}
        {(modal.type==="addAsset"||modal.type==="editAsset")&&(<div>
            <div className="fld"><label className="lbl">Equipment Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
          </div>
        )}
        {(modal.type==="editTeam")&&(<div>
            <div className="fld"><label className="lbl">Team Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Sport</label><select className="sel" value={f.sport||"Basketball"} onChange={e=>set("sport",e.target.value)}>{["General","Baseball","Basketball","Football","Soccer","Softball","Volleyball","Other"].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div className="fld">
              <label className="lbl">Team Color</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {TEAM_COLORS.map(c=>(<button key={c} type="button" onClick={()=>set("colorPrimary",c)} style={{width:32,height:32,borderRadius:"50%",background:c,border:(f.colorPrimary||editTeamData.colorPrimary)===c?"3px solid var(--black)":"3px solid transparent",cursor:"pointer",padding:0}}/>))}
              </div>
            </div>
          </div>
        )}
        {(modal.type==="editTemplate")&&(<div>
            <div className="fld"><label className="lbl">Template Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Sport</label><select className="sel" value={f.sport||"General"} onChange={e=>set("sport",e.target.value)}>{["General","Baseball","Basketball","Football","Soccer","Softball","Volleyball","Other"].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          </div>
        )}
        {(modal.type==="addActivity"||modal.type==="editActivity")&&(<div>
            <div className="fld"><label className="lbl">Name</label><input className="inp" autoFocus={!activity} value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
            <div className="g2">
              <div className="fld"><label className="lbl">Sport</label><select className="sel" value={f.sport||"General"} onChange={e=>set("sport",e.target.value)}>{SPORTS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
              <div className="fld"><label className="lbl">Default Duration (min)</label><DurStepper value={f.duration||10} min={1} onChange={v=>set("duration",v)}/></div>
            </div>
            <div className="fld"><label className="lbl">Description</label><AutoTextarea minHeight={50} value={f.description||""} onChange={e=>set("description",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Coaching Points</label><AutoTextarea minHeight={50} value={f.coachingPoints||""} onChange={e=>set("coachingPoints",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Player Grouping</label>
              <div style={{display:"flex",gap:6}}>
                {[{v:"whole",l:"Whole Team",sub:"All players together"},{v:"partners",l:"Partners",sub:"Paired in groups of 2"},{v:"groups",l:"Groups",sub:"Split into groups"}].map(({v,l,sub})=>(
                  <button key={v} type="button" onClick={()=>set("grouping",v)} style={{flex:1,padding:"8px 4px",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:(f.grouping||"whole")===v?"var(--green)":"var(--s1)",color:(f.grouping||"whole")===v?"#fff":"var(--black)",fontSize:13,cursor:"pointer",lineHeight:1.3}}>
                    <div style={{fontWeight:700}}>{l}</div>
                    {(f.grouping||"whole")===v&&<div style={{fontSize:10,opacity:.8,marginTop:2}}>{sub}</div>}
                  </button>
                ))}
              </div>
              {(f.grouping||"whole")==="groups"&&<div style={{marginTop:8}}>
                <div style={{fontSize:12,color:"var(--td)",marginBottom:6}}>How many groups?</div>
                <div style={{display:"flex",gap:6}}>
                  {[2,3,4,5,6].map(n=>(<button key={n} type="button" onClick={()=>set("numGroups",n)} style={{flex:1,padding:"8px 0",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:f.numGroups===n?"var(--green)":"var(--s1)",color:f.numGroups===n?"#fff":"var(--black)",fontSize:14,fontWeight:700,cursor:"pointer"}}>{n}</button>))}
                </div>
              </div>}
            </div>
            {(()=>{
              const drillSport=f.sport||"General";
              const toggleEquip=id=>{const cur=(f.equipment||[]);const has=cur.includes(id);set("equipment",has?cur.filter(x=>x!==id):[...cur,id]);};
              const addInline=async(inputId,type)=>{
                const el=document.getElementById(inputId);
                if(!el||!el.value.trim())return;
                const nm=el.value.trim();
                const {data:newAsset}=catalogId
                  ?await createCatalogAsset(catalogId,{name:nm,type,sport:drillSport})
                  :await createAsset(coachId,{name:nm,type,sport:type==="player"?drillSport:"General"});
                if(newAsset)set("equipment",[...(f.equipment||[]),newAsset.id]);
                el.value="";
                await refreshLibrary();
              };
              // Catalog drills may only use that SAME catalog's own equipment
              // (RLS: can_link_asset_to_activity) -- a personal/org drill's
              // picker excludes catalog-owned assets the same way, since
              // linking them would be rejected server-side anyway.
              const teamAssets=(data.assets||[]).filter(a=>a.type==="team"&&(catalogId?a.sourceCatalogId===catalogId:!a.sourceCatalogId));
              const playerAssets=(data.assets||[]).filter(a=>a.type==="player"&&(a.sport===drillSport||a.sport==="General")&&(catalogId?a.sourceCatalogId===catalogId:!a.sourceCatalogId));
              return(<div>
                <div className="fld"><label className="lbl">Team Equipment</label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
                    {teamAssets.map(a=>(<button key={a.id} type="button" onClick={()=>toggleEquip(a.id)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:(f.equipment||[]).includes(a.id)?"var(--green)":"var(--s1)",color:(f.equipment||[]).includes(a.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>))}
                    {teamAssets.length===0&&<span style={{fontSize:12,color:"var(--td)"}}>No team equipment in library yet</span>}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <input className="inp" placeholder="Add new equipment..." id="new-equip-inp" style={{flex:1}}/>
                    <button type="button" className="btn ghost bxs" onClick={()=>addInline("new-equip-inp","team")}>Add</button>
                  </div>
                </div>
                <div className="fld"><label className="lbl">Player Gear Needed</label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
                    {playerAssets.map(a=>(<button key={a.id} type="button" onClick={()=>toggleEquip(a.id)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:(f.equipment||[]).includes(a.id)?"var(--green)":"var(--s1)",color:(f.equipment||[]).includes(a.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>))}
                    {playerAssets.length===0&&<span style={{fontSize:12,color:"var(--td)"}}>No player gear set up for {drillSport} yet</span>}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <input className="inp" placeholder="e.g. Batting Helmet" id="new-gear-inp" style={{flex:1}}/>
                    <button type="button" className="btn ghost bxs" onClick={()=>addInline("new-gear-inp","player")}>Add</button>
                  </div>
                </div>
              </div>);
            })()}
            <SkillTagPicker data={data} coachId={coachId} sport={f.sport||"General"} selectedIds={f.skillTagIds||[]} onChange={ids=>set("skillTagIds",ids)} refreshLibrary={refreshLibrary} catalogId={catalogId}/>
          </div>
        )}
        {saveError&&<div style={{fontSize:13,color:"var(--red)",marginTop:4}}>{saveError}</div>}
        <div className="mfooter">{addedCoachInfo?<button className="btn primary bmd" style={{flex:1}} onClick={closeModal}>Got it</button>:(<React.Fragment><button className="btn ghost bmd" onClick={closeModal} disabled={saving}>Cancel</button><button className="btn primary bmd" onClick={save} disabled={saving}>{saving?"Saving...":"Save"}</button></React.Fragment>)}</div>
      </div>
    </div>
  );
}
