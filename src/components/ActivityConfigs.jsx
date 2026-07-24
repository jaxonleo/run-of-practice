import React, { useState, useRef, useEffect } from "react";
import { uid, POSITIONS_BY_SPORT, HAND_FIELDS_BY_SPORT, HAND_LABELS, groupByAttribute } from "../constants.js";
import { createAsset } from "../supabase.js";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ── Drag-to-reorder for the practice/template activity list ──────────────────
// Shared by BuilderScreen (App.jsx) and TemplateWorkspace (NewLibraryScreen.jsx)
// so both builders get the same touch/mouse press-and-hold-then-slide
// behavior instead of duplicating dnd-kit setup in each. TouchSensor's delay
// is what makes this reliable on a touchscreen -- without it, a plain drag
// listener would swallow the page's own vertical scroll the instant a finger
// lands on a row; requiring a brief hold before a drag "arms" leaves a quick
// finger-down-then-scroll gesture alone.
export function useActivityDnd(setActs) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );
  const onDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setActs(p => {
      const oldIndex = p.findIndex(a => a.id === active.id);
      const newIndex = p.findIndex(a => a.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return p;
      return arrayMove(p, oldIndex, newIndex);
    });
  };
  return { sensors, onDragEnd };
}
export function ActivityDndContext({sensors,onDragEnd,items,children}){
  return (<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
    <SortableContext items={items} strategy={verticalListSortingStrategy}>{children}</SortableContext>
  </DndContext>);
}
const Ic_Grip=()=><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.3"/><circle cx="11" cy="3" r="1.3"/><circle cx="5" cy="8" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="5" cy="13" r="1.3"/><circle cx="11" cy="13" r="1.3"/></svg>;
// children is a render-prop: (dragHandleEl) => JSX, so callers can place the
// handle wherever it fits their row layout while the wrapper itself owns the
// sortable positioning/transform.
// `sticky` pins this one row to the top of the scroll container via native
// CSS position:sticky -- no scroll-tracking JS needed. A sticky element only
// stays pinned while its own normal-flow position is above the viewport, and
// falls back into place the moment scrolling returns it to where it actually
// sits in the list -- exactly "stays on top until you've scrolled up enough
// for it to reach its real spot," for free from the browser.
export function SortableActivityRow({id,children,sticky}){
  const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id});
  const style={transform:CSS.Transform.toString(transform),transition,opacity:isDragging?0.5:1,position:sticky?"sticky":"relative",top:sticky?0:undefined,zIndex:isDragging?1:(sticky?5:undefined)};
  // touchAction:"none" alone stops the page from scrolling under a drag,
  // but iOS Safari still fires its own long-press text-selection callout
  // (the magnifying-glass loupe) independently of that -- WebkitTouchCallout
  // is the property that actually suppresses it; WebkitUserSelect covers
  // the same long-press turning into a text-selection highlight instead.
  const handle=(<button type="button" {...attributes} {...listeners} onClick={e=>e.stopPropagation()} style={{background:"none",border:"none",cursor:isDragging?"grabbing":"grab",padding:"6px 4px",marginRight:6,color:"var(--td)",touchAction:"none",WebkitTouchCallout:"none",WebkitUserSelect:"none",userSelect:"none",flexShrink:0,display:"flex",alignItems:"center"}} aria-label="Drag to reorder"><Ic_Grip/></button>);
  return <div ref={setNodeRef} style={style}>{children(handle)}</div>;
}

// Grows to fit its content instead of scrolling internally -- coaches were
// hitting the fixed-height "ta" box on long descriptions/coaching points and
// having to scroll a tiny window to see what they'd written.
export function AutoTextarea({className,value,onChange,style,minHeight,...rest}){
  const ref=useRef(null);
  useEffect(()=>{
    const el=ref.current;
    if(!el)return;
    el.style.height="auto";
    el.style.height=el.scrollHeight+"px";
  },[value]);
  return <textarea ref={ref} className={className||"ta"} value={value} onChange={onChange} style={Object.assign({resize:"none",overflow:"hidden",minHeight:minHeight||58},style)} {...rest}/>;
}

function DurStepper({value,min,onChange,step}){
  const s=step||1;const mn=min||1;
  return (<div style={{display:"flex",alignItems:"center",gap:0,border:"1.5px solid var(--b)",borderRadius:"var(--rs)",overflow:"hidden",background:"#fff"}}>
    <button onClick={()=>onChange(Math.max(mn,value-s))} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>-</button>
    <div style={{flex:1,textAlign:"center",fontFamily:"DM Mono,monospace",fontSize:15,fontWeight:600,color:"var(--black)"}}>{value}m</div>
    <button onClick={()=>onChange(value+s)} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
  </div>);
}

export function ActConfig({act,team,loc,sport:sportProp,onChange,onDone,assets,coachId,refreshLibrary,libraryDrills,skillTags}){
  const [newGearOpen,setNewGearOpen]=useState(false);
  // act itself never carries a sport (practice/template activities don't
  // have their own sport column) -- sportProp is the team's sport (Builder)
  // or the template's own Sport field (TemplateWorkspace), threaded down by
  // the caller the same way StationConfig already gets teamSport.
  const sport=sportProp||"General";
  // Builder assigns equipment a coach actually owns to a real practice --
  // catalog-owned equipment (public library) is excluded here the same way
  // it's excluded from a personal drill's picker in ModalLayer, never
  // surfaced until a coach explicitly copies a drill into their own library.
  // Also scoped to this sport and (if this activity has a location) to
  // equipment available there -- no locationIds means it travels with the
  // coach, so it's never excluded on location grounds.
  const atLoc=a=>!loc||!Array.isArray(a.locationIds)||a.locationIds.length===0||a.locationIds.includes(loc.id);
  const teamEquip=(assets||[]).filter(a=>(!a.type||a.type==="team")&&(a.sport===sport||a.sport==="General")&&!a.sourceCatalogId&&atLoc(a));
  const playerGearAssets=(assets||[]).filter(a=>a.type==="player"&&(a.sport===sport||a.sport==="General"||sport==="General")&&!a.sourceCatalogId&&atLoc(a));
  const equip=Array.isArray(act.equipment)?act.equipment:[];
  const toggleEquip=id=>{const has=equip.includes(id);onChange({equipment:has?equip.filter(x=>x!==id):[...equip,id]});};
  // Practice/template activities are a snapshot copy of the drill at
  // add-time and don't carry their own skillTagIds -- look them up on the
  // source library drill, same as the Library screen and live view do.
  const drillTagNames=(()=>{
    if(!act.libraryId)return [];
    const drill=(libraryDrills||[]).find(d=>d.id===act.libraryId);
    if(!drill||!drill.skillTagIds||!drill.skillTagIds.length)return [];
    return drill.skillTagIds.map(id=>{const t=(skillTags||[]).find(t=>t.id===id);return t?t.name:null;}).filter(Boolean);
  })();
  const addInline=async(inputId,type,gearSport)=>{
    const el=document.getElementById(inputId);
    if(!el||!el.value.trim())return;
    const nm=el.value.trim();
    const {data:newAsset}=await createAsset(coachId,{name:nm,type,sport:type==="player"?gearSport:sport});
    if(newAsset)onChange({equipment:[...equip,newAsset.id]});
    el.value="";
    if(refreshLibrary)await refreshLibrary();
    if(type==="player")setNewGearOpen(false);
  };
  return (<div>
    <div className="fld"><label className="lbl">Name</label><input className="inp" value={act.name} onChange={e=>onChange({name:e.target.value})}/></div>
    <div className="fld"><label className="lbl">Duration (min)</label><DurStepper value={act.duration||10} min={1} onChange={v=>onChange({duration:v})}/></div>
    <div className="fld"><label className="lbl">Description</label><AutoTextarea value={act.description||""} onChange={e=>onChange({description:e.target.value})}/></div>
    <div className="fld"><label className="lbl">Coaching Points</label><AutoTextarea value={act.coachingPoints||""} onChange={e=>onChange({coachingPoints:e.target.value})}/></div>
    {team&&<div className="fld"><label className="lbl">Coach</label><select className="sel" value={act.coachId||""} onChange={e=>onChange({coachId:e.target.value})}><option value="">Unassigned</option>{team.coaches.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
    {loc&&loc.sublocations&&loc.sublocations.length>0&&<div className="fld"><label className="lbl">Area</label><select className="sel" value={act.sublocationId||""} onChange={e=>onChange({sublocationId:e.target.value})}><option value="">Any</option>{loc.sublocations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
    {/* Player Grouping */}
    <div className="fld"><label className="lbl">Player Grouping</label>
      <div style={{display:"flex",gap:6}}>
        {[{v:"whole",l:"Whole Team"},{v:"partners",l:"Partners"},{v:"groups",l:"Groups"}].map(({v,l})=>(
          <button key={v} type="button" onClick={()=>onChange({grouping:v})} style={{flex:1,padding:"8px 4px",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:(act.grouping||"whole")===v?"var(--green)":"var(--s1)",color:(act.grouping||"whole")===v?"#fff":"var(--black)",fontSize:13,cursor:"pointer",fontWeight:700}}>
            {l}
          </button>
        ))}
      </div>
      {(act.grouping||"whole")==="groups"&&<div style={{marginTop:8}}>
        <div style={{fontSize:12,color:"var(--td)",marginBottom:6}}>How many groups?</div>
        <div style={{display:"flex",gap:6}}>
          {[2,3,4,5,6].map(n=>(<button key={n} type="button" onClick={()=>onChange({numGroups:n})} style={{flex:1,padding:"8px 0",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:(act.numGroups||2)===n?"var(--green)":"var(--s1)",color:(act.numGroups||2)===n?"#fff":"var(--black)",fontSize:14,fontWeight:700,cursor:"pointer"}}>{n}</button>))}
        </div>
      </div>}
    </div>
    {/* Team Equipment */}
    <div className="fld"><label className="lbl">Team Equipment</label>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
        {teamEquip.map(a=>(<button key={a.id} type="button" onClick={()=>toggleEquip(a.id)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:equip.includes(a.id)?"var(--green)":"var(--s1)",color:equip.includes(a.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>))}
        {teamEquip.length===0&&<span style={{fontSize:12,color:"var(--td)"}}>No team equipment in library yet</span>}
      </div>
      <div style={{display:"flex",gap:6}}>
        <input className="inp" placeholder="Add new equipment..." id="actcfg-equip-inp" style={{flex:1}}/>
        <button type="button" className="btn ghost bxs" onClick={()=>addInline("actcfg-equip-inp","team")}>Add</button>
      </div>
    </div>
    {/* Player Gear */}
    {playerGearAssets.length>0&&<div className="fld"><label className="lbl">Player Gear Needed</label>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
        {playerGearAssets.map(a=>(<button key={a.id} type="button" onClick={()=>toggleEquip(a.id)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:equip.includes(a.id)?"var(--green)":"var(--s1)",color:equip.includes(a.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>))}
      </div>
      {newGearOpen?<div style={{display:"flex",gap:6}}>
        <input className="inp" style={{flex:1}} placeholder="Gear name..." id="actcfg-gear-inp" autoFocus/>
        <button type="button" className="btn ghost bxs" onClick={()=>addInline("actcfg-gear-inp","player",sport)}>Add</button>
        <button type="button" className="btn ghost bxs" onClick={()=>setNewGearOpen(false)}>✕</button>
      </div>:<button type="button" className="btn ghost bxs" onClick={()=>setNewGearOpen(true)}>+ New Gear</button>}
    </div>}
    {playerGearAssets.length===0&&<div className="fld"><label className="lbl">Player Gear Needed</label>
      <div style={{fontSize:12,color:"var(--td)",marginBottom:6}}>No player gear for {sport} yet.</div>
      {newGearOpen?<div style={{display:"flex",gap:6}}>
        <input className="inp" style={{flex:1}} placeholder="Gear name..." id="actcfg-gear-inp" autoFocus/>
        <button type="button" className="btn ghost bxs" onClick={()=>addInline("actcfg-gear-inp","player",sport)}>Add</button>
        <button type="button" className="btn ghost bxs" onClick={()=>setNewGearOpen(false)}>✕</button>
      </div>:<button type="button" className="btn ghost bxs" onClick={()=>setNewGearOpen(true)}>+ Add Gear</button>}
    </div>}
    {drillTagNames.length>0&&<div className="fld"><label className="lbl">Skill Tags</label>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {drillTagNames.map(n=>(<span key={n} className="bdg bs">{n}</span>))}
      </div>
    </div>}
    <button className="btn ghost bsm bfull mt8" onClick={onDone}>Done</button>
  </div>);
}

export function ChecklistConfig({act,onChange,onDone}){
  const [newItem,setNewItem]=useState("");
  const addItem=()=>{if(!newItem.trim())return;const items=[...(act.items||[]),{id:uid(),text:newItem.trim(),done:false}];onChange({items});setNewItem("");};
  const remItem=id=>onChange({items:(act.items||[]).filter(it=>it.id!==id)});
  return (<div>
    <div className="fld"><label className="lbl">Name</label><input className="inp" value={act.name} onChange={e=>onChange({name:e.target.value})}/></div>
    <div className="fld"><label className="lbl">Duration (min)</label><DurStepper value={act.duration||5} min={1} onChange={v=>onChange({duration:v})}/></div>
    <div className="fld"><label className="lbl">Items</label>
      {(act.items||[]).map(it=>(<div key={it.id} className="row" style={{marginBottom:6}}>
        <span style={{flex:1,fontSize:14}}>{it.text}</span>
        <button className="btn danger bxs" onClick={()=>remItem(it.id)}>x</button>
      </div>))}
      <div className="row mt6"><input className="inp" style={{flex:1}} placeholder="Add item..." value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addItem()}/><button className="btn outline bxs" onClick={addItem}>Add</button></div>
    </div>
    <div className="fld"><label className="lbl">Notes</label><textarea className="ta" value={act.notes||""} onChange={e=>onChange({notes:e.target.value})}/></div>
    <button className="btn ghost bsm bfull mt8" onClick={onDone}>Done</button>
  </div>);
}

export function StationConfig({act,team,loc,onChange,onSt,onDone,assets,coachId,refreshLibrary,teamSport,libraryDrills,skillTags}){
  const rotate=act.rotate!==false;
  const [newEquipIdx,setNewEquipIdx]=useState(null);
  const [newGearIdx,setNewGearIdx]=useState(null);
  const [libraryPickerIdx,setLibraryPickerIdx]=useState(null);
  const [groupByOpen,setGroupByOpen]=useState(false);
  const [helperIdx,setHelperIdx]=useState(null);
  const sport=teamSport||"General";
  const players=team?team.players:[];
  // Same catalog-equipment/sport/location scoping as ActConfig -- see its
  // comment.
  const atLoc=a=>!loc||!Array.isArray(a.locationIds)||a.locationIds.length===0||a.locationIds.includes(loc.id);
  const teamEquipAssets=(assets||[]).filter(a=>(!a.type||a.type==="team")&&(a.sport===sport||a.sport==="General")&&!a.sourceCatalogId&&atLoc(a));
  const playerGearAssets=(assets||[]).filter(a=>a.type==="player"&&(a.sport===sport||a.sport==="General"||sport==="General")&&!a.sourceCatalogId&&atLoc(a));
  // Public-catalog drills are excluded from this quick-pick list -- their
  // equipment is catalog-owned, which can't be linked to a real team's
  // practice (same "copy not reference" rule org-shared equipment already
  // follows). Copy from Explore's Public Library shelf first; the copy is a
  // normal personal drill and shows up here like any other.
  const filteredLibrary=(libraryDrills||[]).filter(a=>!a.sourceCatalogId).filter(a=>(a.sport||"General")===sport||(a.sport||"General")==="General");
  const skillTagsById=Object.fromEntries((skillTags||[]).map(t=>[t.id,t]));
  const tagNames=ids=>(ids||[]).map(id=>skillTagsById[id]?skillTagsById[id].name:null).filter(Boolean);
  const chooseFromLibrary=(si,lib)=>{
    const st=act.stations[si];
    onSt(st.id,{
      activityName:lib.name,name:lib.name,
      description:lib.description||st.description||"",
      coachingPoints:lib.coachingPoints||st.coachingPoints||"",
      equipment:Array.isArray(lib.equipment)?lib.equipment:[],
      libraryId:lib.id,
      grouping:lib.grouping||"whole",numGroups:lib.numGroups||2,
    });
    setLibraryPickerIdx(null);
  };

  const genRandom=()=>{
    const n=act.stations.length;
    const shuffled=[...players].sort(()=>Math.random()-.5);
    const groups=Array.from({length:n},()=>[]);
    shuffled.forEach((p,i)=>groups[i%n].push(p.id));
    onChange({stations:act.stations.map((st,i)=>Object.assign({},st,{assignments:groups[i]||[],groupLabel:""}))});
  };
  const clearGroups=()=>onChange({stations:act.stations.map(st=>Object.assign({},st,{assignments:[],groupLabel:""}))});
  // Buckets whole-station assignments by a shared attribute (first listed
  // position, or a handedness field) instead of shuffling -- e.g. every
  // catcher ends up at the same station rather than scattered one-per-group
  // the way Generate Random would leave them. The attribute value that
  // produced each group (e.g. "Lefties") rides along as groupLabel so
  // whoever leads that station later knows who's coming without having to
  // recheck the roster.
  const HAND_GROUP_LABELS={L:"Lefties",R:"Righties",S:"Switch"};
  const groupByPosition=()=>{
    const groups=groupByAttribute(players,act.stations.length,p=>(p.positions&&p.positions[0])||"",v=>v);
    onChange({stations:act.stations.map((st,i)=>Object.assign({},st,{assignments:(groups[i]&&groups[i].ids)||[],groupLabel:(groups[i]&&groups[i].label)||""}))});
    setGroupByOpen(false);
  };
  const groupByHand=key=>{
    const groups=groupByAttribute(players,act.stations.length,p=>p[key]||"",v=>HAND_GROUP_LABELS[v]||v);
    onChange({stations:act.stations.map((st,i)=>Object.assign({},st,{assignments:(groups[i]&&groups[i].ids)||[],groupLabel:(groups[i]&&groups[i].label)||""}))});
    setGroupByOpen(false);
  };
  const handFields=HAND_FIELDS_BY_SPORT[sport]||[];
  const addStation=()=>{
    const n=act.stations.length+1;
    onChange({stations:[...act.stations,{id:uid(),name:"Station "+n,activityName:"",coachId:"",coachName:"",sublocationId:"",equipment:[],playerGear:"",coachingPoints:"",assignments:[]}]});
  };
  const removeStation=si=>{if(act.stations.length<=1)return;onChange({stations:act.stations.filter((_,i)=>i!==si)});};
  const handleChip=(si,p)=>{
    const st=act.stations[si];
    const assigned=(st.assignments||[]).includes(p.id);
    if(assigned){onSt(st.id,{assignments:(st.assignments||[]).filter(x=>x!==p.id),groupLabel:""});}
    else{const newSts=act.stations.map((s2,i2)=>{if(i2===si)return Object.assign({},s2,{assignments:[...(s2.assignments||[]),p.id],groupLabel:""});const had=(s2.assignments||[]).includes(p.id);return Object.assign({},s2,{assignments:(s2.assignments||[]).filter(x=>x!==p.id),groupLabel:had?"":s2.groupLabel});});onChange({stations:newSts});}
  };

  return (<div>
    <div className="fld"><label className="lbl">Player Movement</label>
      <div style={{display:"flex",gap:0,borderRadius:"var(--r)",overflow:"hidden",border:"1.5px solid var(--b)"}}>
        <button type="button" onClick={()=>onChange({rotate:true})} style={{flex:1,padding:"10px 0",border:"none",background:rotate?"var(--green)":"var(--s1)",color:rotate?"#fff":"var(--black)",fontFamily:"Barlow Condensed,sans-serif",fontSize:14,fontWeight:700,cursor:"pointer",letterSpacing:".03em"}}>ROTATE</button>
        <button type="button" onClick={()=>onChange({rotate:false})} style={{flex:1,padding:"10px 0",border:"none",background:!rotate?"var(--green)":"var(--s1)",color:!rotate?"#fff":"var(--black)",fontFamily:"Barlow Condensed,sans-serif",fontSize:14,fontWeight:700,cursor:"pointer",letterSpacing:".03em"}}>STATIC</button>
      </div>
      <div style={{fontSize:11,color:"var(--td)",marginTop:4}}>{rotate?"Players rotate through all stations on a timer":"Players stay at their assigned station"}</div>
    </div>
    <div className={rotate?"g2":"fld"} style={rotate?{}:{maxWidth:160}}>
      <div className="fld"><label className="lbl">Time at Station (min)</label><DurStepper value={act.stationDuration||10} min={1} onChange={v=>onChange({stationDuration:v})}/></div>
      {rotate&&<div className="fld"><label className="lbl">Transition (min)</label><DurStepper value={act.transitionDuration||2} min={0} onChange={v=>onChange({transitionDuration:v})}/></div>}
    </div>
    {players.length>0&&<div className="brow mb10" style={{flexWrap:"wrap"}}>
      <button className="btn outline bmd" style={{flex:1}} onClick={genRandom}>Generate Random Groups</button>
      <button className="btn ghost bmd" style={{flex:1}} onClick={clearGroups}>Clear Groups</button>
      <div style={{position:"relative",flex:1}}>
        <button type="button" className="btn ghost bmd bfull" onClick={()=>setGroupByOpen(o=>!o)}>Group By...</button>
        {groupByOpen&&<div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,background:"#fff",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:8,zIndex:20,boxShadow:"0 4px 16px rgba(0,0,0,.12)"}}>
          <button type="button" className="mm-item" onClick={groupByPosition}>Position</button>
          {handFields.map(hf=>(<button key={hf.key} type="button" className="mm-item" onClick={()=>groupByHand(hf.key)}>{hf.label}</button>))}
          <button type="button" className="mm-item" style={{color:"var(--td)"}} onClick={()=>setGroupByOpen(false)}>Cancel</button>
        </div>}
      </div>
    </div>}
    {act.stations.map((st,si)=>{
      const stEquip=Array.isArray(st.equipment)?st.equipment:[];
      return(<div key={st.id} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 12px 10px",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:900,color:"var(--green)",letterSpacing:".05em"}}>STATION {si+1}</div>
          {act.stations.length>1&&<button type="button" onClick={()=>removeStation(si)} style={{background:"none",border:"none",color:"var(--td)",fontSize:12,cursor:"pointer",padding:"2px 6px"}}>Remove</button>}
        </div>
        <div className="fld">
          <label className="lbl">Name</label>
          <input className="inp" placeholder="Write your own, or choose from library below" value={st.activityName||st.name||""} onChange={e=>onSt(st.id,{activityName:e.target.value,name:e.target.value})}/>
          <button type="button" className="btn ghost bxs mt6" onClick={()=>setLibraryPickerIdx(libraryPickerIdx===si?null:si)}>{st.libraryId?"Change Library Drill":"Choose from Library"}</button>
          {libraryPickerIdx===si&&<div style={{marginTop:6,border:"1px solid var(--b)",borderRadius:"var(--rs)",maxHeight:180,overflowY:"auto",background:"#fff"}}>
            {filteredLibrary.length===0&&<div style={{padding:10,fontSize:12,color:"var(--td)"}}>No drills in library for {sport} yet.</div>}
            {filteredLibrary.map(lib=>(<div key={lib.id} className="li tap" style={{marginBottom:0,borderRadius:0,borderLeft:"none",borderRight:"none",borderTop:"none"}} onClick={()=>chooseFromLibrary(si,lib)}>
              <div className="lim">
                <div className="lin">{lib.name}</div>
                {lib.description&&<div className="limt">{lib.description}</div>}
                {lib.skillTagIds&&lib.skillTagIds.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
                  {tagNames(lib.skillTagIds).map(name=>(<span key={name} className="bdg bs" style={{fontSize:10}}>{name}</span>))}
                </div>}
              </div>
            </div>))}
          </div>}
        </div>
        <div className="fld"><label className="lbl">Description</label><AutoTextarea minHeight={40} value={st.description||""} onChange={e=>onSt(st.id,{description:e.target.value})}/></div>
        {/* This is the drill's own internal split (e.g. partners within this
            station), independent of -- and on top of -- which players rotate
            into this station via the Generate Random/Group By controls
            above. Same UI as a standalone activity's Player Grouping. */}
        <div className="fld"><label className="lbl">Player Grouping (within this station)</label>
          <div style={{display:"flex",gap:6}}>
            {[{v:"whole",l:"Whole Station"},{v:"partners",l:"Partners"},{v:"groups",l:"Groups"}].map(({v,l})=>(
              <button key={v} type="button" onClick={()=>onSt(st.id,{grouping:v})} style={{flex:1,padding:"8px 4px",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:(st.grouping||"whole")===v?"var(--green)":"var(--s1)",color:(st.grouping||"whole")===v?"#fff":"var(--black)",fontSize:13,cursor:"pointer",fontWeight:700}}>
                {l}
              </button>
            ))}
          </div>
          {(st.grouping||"whole")==="groups"&&<div style={{marginTop:8}}>
            <div style={{fontSize:12,color:"var(--td)",marginBottom:6}}>How many groups?</div>
            <div style={{display:"flex",gap:6}}>
              {[2,3,4,5,6].map(n=>(<button key={n} type="button" onClick={()=>onSt(st.id,{numGroups:n})} style={{flex:1,padding:"8px 0",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:(st.numGroups||2)===n?"var(--green)":"var(--s1)",color:(st.numGroups||2)===n?"#fff":"var(--black)",fontSize:14,fontWeight:700,cursor:"pointer"}}>{n}</button>))}
            </div>
          </div>}
        </div>
        {team&&<div className="fld"><label className="lbl">Coach</label>
          {!st.helperName&&<>
            {team.coaches.length>0&&<select className="sel" value={st.coachId||""} onChange={e=>onSt(st.id,{coachId:e.target.value,helperName:""})}>
              <option value="">Unassigned</option>{team.coaches.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>}
            <button type="button" className="btn ghost bxs mt6" onClick={()=>{setHelperIdx(si);onSt(st.id,{coachId:""});}}>+ Assign a Helper (not on roster)</button>
          </>}
          {(st.helperName||helperIdx===si)&&<div style={{display:"flex",gap:6,marginTop:st.helperName?0:6}}>
            <input className="inp" style={{flex:1}} placeholder="Helper's name" autoFocus={helperIdx===si&&!st.helperName} value={st.helperName||""} onChange={e=>onSt(st.id,{helperName:e.target.value,coachId:""})}/>
            <button type="button" className="btn ghost bxs" onClick={()=>{onSt(st.id,{helperName:""});setHelperIdx(null);}}>✕</button>
          </div>}
        </div>}
        {loc&&loc.sublocations&&loc.sublocations.length>0&&<div className="fld"><label className="lbl">Area</label>
          <select className="sel" value={st.sublocationId||""} onChange={e=>onSt(st.id,{sublocationId:e.target.value})}>
            <option value="">Any</option>{loc.sublocations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>}
        <div className="fld"><label className="lbl">Coaching Points</label><AutoTextarea minHeight={40} value={st.coachingPoints||""} onChange={e=>onSt(st.id,{coachingPoints:e.target.value})}/></div>
        <div className="fld"><label className="lbl">Equipment</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
            {teamEquipAssets.map(a=>(<button key={a.id} type="button" onClick={()=>{const has=stEquip.includes(a.id);onSt(st.id,{equipment:has?stEquip.filter(x=>x!==a.id):[...stEquip,a.id]});}} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:stEquip.includes(a.id)?"var(--green)":"#fff",color:stEquip.includes(a.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>))}
            {teamEquipAssets.length===0&&<span style={{fontSize:12,color:"var(--td)"}}>No team equipment in library</span>}
          </div>
          {newEquipIdx===si?<div style={{display:"flex",gap:6}}>
            <input className="inp" style={{flex:1}} placeholder="Equipment name..." id={"new-st-equip-"+si} autoFocus/>
            <button type="button" className="btn ghost bxs" onClick={async()=>{const el=document.getElementById("new-st-equip-"+si);if(!el||!el.value.trim())return;const nm=el.value.trim();const {data:newAsset}=await createAsset(coachId,{name:nm,type:"team",sport});if(newAsset)onSt(st.id,{equipment:[...stEquip,newAsset.id]});el.value="";if(refreshLibrary)await refreshLibrary();setNewEquipIdx(null);}}>Add</button>
            <button type="button" className="btn ghost bxs" onClick={()=>setNewEquipIdx(null)}>✕</button>
          </div>:<button type="button" className="btn ghost bxs" onClick={()=>setNewEquipIdx(si)}>+ New</button>}
        </div>
        {(playerGearAssets.length>0||newGearIdx===si)&&<div className="fld"><label className="lbl">Player Gear Needed</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
            {playerGearAssets.map(a=>(<button key={a.id} type="button" onClick={()=>{const has=stEquip.includes(a.id);onSt(st.id,{equipment:has?stEquip.filter(x=>x!==a.id):[...stEquip,a.id]});}} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:stEquip.includes(a.id)?"var(--green)":"#fff",color:stEquip.includes(a.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>))}
          </div>
          {newGearIdx===si?<div style={{display:"flex",gap:6}}>
            <input className="inp" style={{flex:1}} placeholder="Gear name..." id={"new-st-gear-"+si} autoFocus/>
            <button type="button" className="btn ghost bxs" onClick={async()=>{const el=document.getElementById("new-st-gear-"+si);if(!el||!el.value.trim())return;const nm=el.value.trim();const {data:newAsset}=await createAsset(coachId,{name:nm,type:"player",sport});if(newAsset)onSt(st.id,{equipment:[...stEquip,newAsset.id]});el.value="";if(refreshLibrary)await refreshLibrary();setNewGearIdx(null);}}>Add</button>
            <button type="button" className="btn ghost bxs" onClick={()=>setNewGearIdx(null)}>✕</button>
          </div>:<button type="button" className="btn ghost bxs" onClick={()=>setNewGearIdx(si)}>+ New Gear</button>}
        </div>}
        {playerGearAssets.length===0&&newGearIdx!==si&&<div className="fld">
          <label className="lbl">Player Gear Needed</label>
          <div style={{fontSize:12,color:"var(--td)",marginBottom:4}}>No player gear for {sport} yet.</div>
          <button type="button" className="btn ghost bxs" onClick={()=>setNewGearIdx(si)}>+ Add Gear</button>
        </div>}
        {players.length>0&&<div className="fld"><label className="lbl">Players</label>
          {st.groupLabel&&<div style={{marginBottom:6}}><span className="bdg bp">Group: {st.groupLabel}</span></div>}
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {players.map(p=>{
              const here=(st.assignments||[]).includes(p.id);
              const otherIdx=!here?act.stations.findIndex((s2,i2)=>i2!==si&&(s2.assignments||[]).includes(p.id)):-1;
              const elsewhere=otherIdx>=0;
              return(<button key={p.id} type="button" onClick={()=>handleChip(si,p)} style={{padding:"7px 12px",borderRadius:8,border:"1.5px solid",borderColor:here?"var(--green)":elsewhere?"#d97706":"var(--b)",background:here?"var(--green)":elsewhere?"#fef3c7":"var(--s1)",color:here?"#fff":elsewhere?"#92400e":"var(--black)",fontSize:13,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"flex-start",gap:1,minWidth:72}}>
                <span style={{fontWeight:700}}>{p.jersey?<span style={{fontFamily:"DM Mono,monospace",fontSize:11,marginRight:3}}>#{p.jersey}</span>:null}{p.firstName}</span>
                {elsewhere&&<span style={{fontSize:10,opacity:.85}}>→ St {otherIdx+1}</span>}
                {here&&<span style={{fontSize:10,opacity:.8}}>✓ here</span>}
              </button>);
            })}
          </div>
          <div style={{fontSize:11,color:"var(--td)",marginTop:4}}>
            <span style={{color:"var(--green)",fontWeight:700}}>Green</span> = here &nbsp;
            <span style={{color:"#d97706",fontWeight:700}}>Yellow</span> = other station &nbsp;
            <span style={{color:"var(--td)"}}>Gray</span> = unassigned
          </div>
        </div>}
      </div>);
    })}
    <button type="button" className="btn outline bsm bfull mb8" onClick={addStation}>+ Add Station</button>
    <button className="btn ghost bsm bfull mt4" onClick={onDone}>Done</button>
  </div>);
}
