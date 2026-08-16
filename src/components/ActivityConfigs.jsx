import React, { useState, useRef, useEffect } from "react";
import { uid, POSITIONS_BY_SPORT, HAND_FIELDS_BY_SPORT, HAND_LABELS, groupByAttribute } from "../constants.js";
import { createAsset, updateAsset, findMissingEquipment, resolveDrillEquipmentForCoach } from "../supabase.js";
import { Ic } from "../icons.jsx";
import EquipmentMismatchDialog from "./EquipmentMismatchDialog.jsx";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ── Drag-to-reorder ────────────────────────────────────────────────────────
// Shared sensor config for every reorderable list in the app (practice/
// template activities, drill library) so they all get the same touch/mouse
// press-and-hold-then-slide behavior instead of duplicating dnd-kit setup
// per screen. TouchSensor's delay is what makes this reliable on a
// touchscreen -- without it, a plain drag listener would swallow the page's
// own vertical scroll the instant a finger lands on a row; requiring a
// brief hold before a drag "arms" leaves a quick finger-down-then-scroll
// gesture alone.
export function useDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  );
}
// For lists that are plain local React state (acts arrays in the practice/
// template builders) -- reordering is just an in-memory arrayMove, nothing
// to persist until the screen's own Save button is used.
export function useActivityDnd(setActs) {
  const sensors = useDndSensors();
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
export { arrayMove };
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
// `stickyTop` offsets that pin point -- needed when the screen already has
// its own sticky header above this list (e.g. Builder's Save/Run Now bar),
// since two siblings can't both actually occupy top:0 -- the later one just
// renders hidden underneath the first.
// `stickyBg` paints this row's own wrapper green (and lightly padded) while
// it's sticky, matching the horizontal green margin the shared backdrop
// gives every row when it's still within that backdrop's own natural
// height -- a sticky row that's been scrolled past that point has nothing
// green left behind it otherwise (the backdrop is a fixed-height absolute
// div, not something that grows to cover scrolled-past sticky content), so
// without this it would land on the plain page background instead, looking
// like a stray white card rather than still being "the Run of Practice."
export function SortableActivityRow({id,children,sticky,stickyTop,raised,stickyBg}){
  const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id});
  // zIndex always at least 1 (not just when dragging/sticky) -- Builder's
  // Run of Practice paints its green background as an absolutely
  // positioned backdrop behind these rows (position:absolute, zIndex:0),
  // not a real wrapping box, so every row needs to reliably stack above it
  // regardless of its own sticky/dragging state.
  //
  // Real bug found live (Library drill list, direct feedback): every row
  // here already gets its own stacking context (position:relative + an
  // explicit zIndex, together always create one), all at the same zIndex
  // level -- so a row's own interior popover (a mini-menu with its own
  // higher zIndex) can never visually escape above the *next* row, since
  // z-index only resolves within a shared stacking context and the next
  // row is a sibling context painted after it in DOM order regardless of
  // any zIndex set deep inside the first row. `raised` lets a caller lift
  // one specific row above its siblings while something inside it (like an
  // open dropdown) needs to render over what comes after it -- the last
  // row in a list needs this exactly as much as a middle one, since
  // without it the row's own trailing padding/the list's own edge clips
  // the popover the same way a sibling row's background would.
  const style={transform:CSS.Transform.toString(transform),transition,opacity:isDragging?0.5:1,position:sticky?"sticky":"relative",top:sticky?(stickyTop||0):undefined,zIndex:isDragging?1:(raised?10:(sticky?5:1)),background:sticky&&stickyBg?stickyBg:undefined,paddingTop:sticky&&stickyBg?8:undefined,paddingBottom:sticky&&stickyBg?10:undefined};
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

// Equipment picker scoping shared by ActConfig/StationConfig: a coach's own
// equipment, plus -- if this team belongs to an org and the asset is tagged
// to this activity's own location -- that org's shared equipment too. Lets a
// coach use the club's gear without switching into Org mode, as long as
// they're actually standing at a location the org stocks it at (an org
// asset with no location tags at all is "untagged," not "everywhere," so it
// doesn't merge in here the way a coach's own untagged equipment does).
// Without this, every asset visible under RLS for *any* org the coach
// belongs to showed up regardless of team/location -- the same class of
// leak already fixed once this session in EquipmentTab's Team-tab view.
function ownedOrOrgAtLoc(a,coachId,team,loc){
  if(a.ownerUserId&&a.ownerUserId===coachId)return true;
  const orgId=team&&team.organizationId;
  if(orgId&&a.organizationId===orgId&&loc&&Array.isArray(a.locationIds)&&a.locationIds.includes(loc.id))return true;
  return false;
}

// Direct feedback: "Add Drill Anyway" on a missing-equipment dialog
// creates a real acquired:false asset row so the drill can keep pointing
// at *something* (findMissingEquipment, buildEquipmentNeeded, etc. all
// resolve equipment by id) -- but that row was showing up in the coach's
// own Equipment Library right alongside gear they actually have, and
// every drill/station equipment picker let it be toggled onto *other*
// drills too, as if it were regular owned equipment. Neither is right: a
// drill should be able to keep referencing equipment the coach doesn't
// own (and get warned about it elsewhere), but the coach can't newly
// *add* equipment to a drill unless it's really in their library --
// distinct from removing a reference they already have. This is the
// shared picker-list rule for both: equipment the coach actually owns is
// always offered to add; anything already linked to this specific drill/
// station (owned or not, including one whose real asset row was since
// archived) still renders so it stays visible and removable, but nothing
// unowned is ever offered as a fresh, clickable "add" option. `allAssets`
// (not the location/sport-scoped `pool`) is the fallback lookup source
// for an already-linked id, since a since-relocated or since-archived
// asset shouldn't just vanish off a drill that still references it.
// `isType` (e.g. a=>a.type==="team") scopes the fallback lookup to the
// same team-equipment-vs-player-gear partition `pool` itself was already
// filtered to -- without it, a selected team-equipment id not in `pool`
// (unowned) would resolve by bare id against the *whole* asset list and
// leak into the player-gear picker too, a real cross-contamination bug
// caught live testing this (an unowned team item showing up under
// "Player Gear Needed" as well).
export function equipmentPickerAssets(pool,selectedIds,allAssets,isType){
  const owned=pool.filter(a=>a.acquired!==false);
  const ownedIds=new Set(owned.map(a=>a.id));
  const source=isType?(allAssets||pool).filter(isType):(allAssets||pool);
  const linkedElsewhere=(selectedIds||[]).filter(id=>!ownedIds.has(id)).map(id=>source.find(a=>a.id===id)).filter(Boolean);
  return [...owned,...linkedElsewhere];
}
// Shared pill for every equipment/gear picker in the app (ModalLayer's
// drill editor originated this exact amber/"Got it" treatment for a
// selected-but-unacquired item; ActConfig/StationConfig reuse it here
// rather than a near-duplicate). A plain tap unlinks it from this drill
// (the underlying asset, if any, is untouched); "Got it" marks the real
// asset acquired in one tap instead of making the coach go find it in
// their Equipment Library separately.
export function EquipmentPickerPill({asset,selected,onToggle,refreshLibrary}){
  const needsAcquire=selected&&asset.acquired===false;
  return (<span style={{display:"inline-flex",alignItems:"stretch"}}>
    <button type="button" onClick={onToggle} title={needsAcquire?asset.name+" -- not yet acquired":undefined} style={{padding:"4px 10px",borderRadius:needsAcquire?"20px 0 0 20px":20,border:"1.5px solid "+(needsAcquire?"var(--amber)":"var(--b)"),background:needsAcquire?"var(--ambg)":selected?"var(--green)":"var(--s1)",color:needsAcquire?"var(--amber)":selected?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{asset.name}{needsAcquire&&" · Need to acquire"}</button>
    {needsAcquire&&<button type="button" onClick={async()=>{await updateAsset(asset.id,{acquired:true});if(refreshLibrary)await refreshLibrary();}} title="Mark as acquired" style={{padding:"4px 8px",borderRadius:"0 20px 20px 0",border:"1.5px solid var(--amber)",borderLeft:"none",background:"var(--amber)",color:"#fff",fontSize:12,cursor:"pointer"}}>✓ Got it</button>}
  </span>);
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
  const equip=Array.isArray(act.equipment)?act.equipment:[];
  const teamEquipPool=(assets||[]).filter(a=>(!a.type||a.type==="team")&&(a.sport===sport||a.sport==="General")&&!a.sourceCatalogId&&atLoc(a)&&ownedOrOrgAtLoc(a,coachId,team,loc));
  const playerGearPool=(assets||[]).filter(a=>a.type==="player"&&(a.sport===sport||a.sport==="General"||sport==="General")&&!a.sourceCatalogId&&atLoc(a)&&ownedOrOrgAtLoc(a,coachId,team,loc));
  const teamEquip=equipmentPickerAssets(teamEquipPool,equip,assets,a=>!a.type||a.type==="team");
  const playerGearAssets=equipmentPickerAssets(playerGearPool,equip,assets,a=>a.type==="player");
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
      {(act.grouping||"whole")!=="whole"&&team&&team.players&&team.players.length>0&&<ManualGroupAssign act={act} team={team} sport={sport} onChange={onChange}/>}
    </div>
    {/* Team Equipment */}
    <div className="fld"><label className="lbl">Team Equipment</label>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
        {teamEquip.map(a=>(<EquipmentPickerPill key={a.id} asset={a} selected={equip.includes(a.id)} onToggle={()=>toggleEquip(a.id)} refreshLibrary={refreshLibrary}/>))}
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
        {playerGearAssets.map(a=>(<EquipmentPickerPill key={a.id} asset={a} selected={equip.includes(a.id)} onToggle={()=>toggleEquip(a.id)} refreshLibrary={refreshLibrary}/>))}
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

// Direct feedback: when Partners/Groups is picked for a plain drill (not a
// station block), a coach should be able to decide who lands in which group
// at plan time instead of it always being silently randomized fresh once
// attendance is taken. Picks are stored on the activity itself
// (groupAssignments, ids only, against the full roster since attendance
// isn't known yet at plan time) and only ever used as a *seed* -- Practice
// Setup still filters to whoever actually shows up and treats anyone left
// out as unassigned, same as it already does for station-block assignments.
// Leaving it untouched (empty groupAssignments) preserves the old
// random-after-attendance behavior.
function ManualGroupAssign({act,team,sport,onChange}){
  const [groupByOpen,setGroupByOpen]=useState(false);
  const groupCount=act.grouping==="partners"?Math.max(1,Math.ceil(team.players.length/2)):(act.numGroups||2);
  const groups=Array.from({length:groupCount},(_,i)=>(act.groupAssignments&&act.groupAssignments[i])||[]);
  const handFields=HAND_FIELDS_BY_SPORT[sport]||[];
  const HAND_GROUP_LABELS={L:"Lefties",R:"Righties",S:"Switch"};
  const genRandom=()=>{
    const shuffled=[...team.players].sort(()=>Math.random()-.5);
    const g=Array.from({length:groupCount},()=>[]);
    shuffled.forEach((p,i)=>g[i%groupCount].push(p.id));
    onChange({groupAssignments:g});
  };
  const groupByPosition=()=>{
    const g=groupByAttribute(team.players,groupCount,p=>(p.positions&&p.positions[0])||"",v=>v);
    onChange({groupAssignments:g.map(x=>(x&&x.ids)||[])});
    setGroupByOpen(false);
  };
  const groupByHand=key=>{
    const g=groupByAttribute(team.players,groupCount,p=>p[key]||"",v=>HAND_GROUP_LABELS[v]||v);
    onChange({groupAssignments:g.map(x=>(x&&x.ids)||[])});
    setGroupByOpen(false);
  };
  const clearGroups=()=>onChange({groupAssignments:[]});
  const handleChip=(gi,playerId)=>{
    const here=groups[gi].includes(playerId);
    const next=groups.map((g,i)=>{
      if(i===gi)return here?g.filter(id=>id!==playerId):[...g,playerId];
      return g.filter(id=>id!==playerId);
    });
    onChange({groupAssignments:next});
  };
  const noun=act.grouping==="partners"?"Pair":"Group";
  return (<div style={{marginTop:8}}>
    <div style={{fontSize:12,color:"var(--td)",marginBottom:6}}>Manually assign now, or leave blank to randomize once attendance is taken.</div>
    <div className="brow mb10" style={{flexWrap:"wrap"}}>
      <button type="button" className="btn outline bmd" style={{flex:1}} onClick={genRandom}>Generate Random Groups</button>
      <button type="button" className="btn ghost bmd" style={{flex:1}} onClick={clearGroups}>Clear Groups</button>
      <div style={{position:"relative",flex:1}}>
        <button type="button" className="btn ghost bmd bfull" onClick={()=>setGroupByOpen(o=>!o)}>Group By...</button>
        {groupByOpen&&<div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,background:"#fff",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:8,zIndex:20,boxShadow:"0 4px 16px rgba(0,0,0,.12)"}}>
          <button type="button" className="mm-item" onClick={groupByPosition}>Position</button>
          {handFields.map(hf=>(<button key={hf.key} type="button" className="mm-item" onClick={()=>groupByHand(hf.key)}>{hf.label}</button>))}
          <button type="button" className="mm-item" style={{color:"var(--td)"}} onClick={()=>setGroupByOpen(false)}>Cancel</button>
        </div>}
      </div>
    </div>
    {groups.map((g,gi)=>(<div key={gi} style={{marginBottom:10}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"var(--td)",marginBottom:4}}>{noun} {gi+1}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {team.players.map(p=>{
          const here=g.includes(p.id);
          const otherIdx=!here?groups.findIndex((g2,i2)=>i2!==gi&&g2.includes(p.id)):-1;
          const elsewhere=otherIdx>=0;
          return (<button key={p.id} type="button" onClick={()=>handleChip(gi,p.id)} style={{padding:"6px 10px",borderRadius:8,border:"1.5px solid",borderColor:here?"var(--green)":elsewhere?"#d97706":"var(--b)",background:here?"var(--green)":elsewhere?"#fef3c7":"var(--s1)",color:here?"#fff":elsewhere?"#92400e":"var(--black)",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}>
            {p.jersey?<span style={{fontFamily:"DM Mono,monospace",fontSize:10}}>#{p.jersey}</span>:null}{p.firstName}{elsewhere?" → "+noun[0]+(otherIdx+1):""}
          </button>);
        })}
      </div>
    </div>))}
    <div style={{fontSize:11,color:"var(--td)",marginTop:2}}>
      <span style={{color:"var(--green)",fontWeight:700}}>Green</span> = here &nbsp;
      <span style={{color:"#d97706",fontWeight:700}}>Yellow</span> = in another {noun.toLowerCase()} &nbsp;
      <span style={{color:"var(--td)"}}>Gray</span> = unassigned
    </div>
  </div>);
}

export function ChecklistConfig({act,onChange,onDone}){
  const [newItem,setNewItem]=useState("");
  const addItem=()=>{if(!newItem.trim())return;const items=[...(act.items||[]),{id:uid(),text:newItem.trim(),done:false}];onChange({items});setNewItem("");};
  const remItem=id=>onChange({items:(act.items||[]).filter(it=>it.id!==id)});
  return (<div>
    {/* select() on focus -- most useful for a default placeholder name
        like "Other" that's meant to always be renamed, but applies to any
        practice component (Intro/Closer/Water Break/...) so tapping in and
        typing immediately replaces the old name instead of requiring a
        manual select-all first. */}
    <div className="fld"><label className="lbl">Name</label><input className="inp" value={act.name} onChange={e=>onChange({name:e.target.value})} onFocus={e=>e.target.select()}/></div>
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

export function StationConfig({act,team,loc,onChange,onSt,onDone,assets,coachId,refreshLibrary,teamSport,libraryDrills,librarySources,libSource,setLibSource,skillTags,absentPlayerIds}){
  const rotate=act.rotate!==false;
  const [newEquipIdx,setNewEquipIdx]=useState(null);
  const [newGearIdx,setNewGearIdx]=useState(null);
  const [libraryPickerIdx,setLibraryPickerIdx]=useState(null);
  const [groupByOpen,setGroupByOpen]=useState(false);
  // Purely a UI label, not persisted -- once a coach picks a criterion the
  // button itself should reflect the choice ("Group By...Position") instead
  // of staying generic, so it's clear what's currently applied and that
  // tapping it again lets them change it.
  const [groupByLabel,setGroupByLabel]=useState("");
  const [helperIdx,setHelperIdx]=useState(null);
  // Per-station collapse -- a station block with several fully-configured
  // stations got very long to scroll through. Collapsing one down to just
  // its number + drill name (manual, no auto-collapse) lets a coach shrink
  // the ones they're not actively editing without losing the overview.
  const [collapsedStations,setCollapsedStations]=useState(new Set());
  const toggleStationCollapsed=id=>setCollapsedStations(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const sport=teamSport||"General";
  const players=team?team.players:[];
  // Direct feedback: a player marked out for this specific practice (Who's
  // Out?, planned_absences) still showed up here as plainly assignable, no
  // different from anyone else -- easy to auto-shuffle or hand-pick them
  // into a station. Still shown (a coach should be able to see who's out,
  // not just guess why someone's missing), but excluded from both bulk
  // auto-assignment and manual per-station picking.
  const outIds=absentPlayerIds||new Set();
  const assignablePlayers=players.filter(p=>!outIds.has(p.id));
  // A player already assigned to a station before being marked out (or
  // whose absence is only just loading in) is actually removed from every
  // station's assignments, not just visually greyed out -- otherwise the
  // saved plan could still list them at a station even though the UI no
  // longer shows them as "here."
  const outIdsKey=[...outIds].sort().join(",");
  useEffect(()=>{
    if(!outIds.size)return;
    const anyOut=act.stations.some(st=>(st.assignments||[]).some(id=>outIds.has(id)));
    if(!anyOut)return;
    onChange({stations:act.stations.map(st=>Object.assign({},st,{assignments:(st.assignments||[]).filter(id=>!outIds.has(id))}))});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[outIdsKey]);
  // Same catalog-equipment/sport/location scoping as ActConfig -- see its
  // comment.
  const atLoc=a=>!loc||!Array.isArray(a.locationIds)||a.locationIds.length===0||a.locationIds.includes(loc.id);
  // Base pools only -- each station has its own equipment list, so the
  // owned-plus-already-linked merge (equipmentPickerAssets) happens per
  // station below, not once here.
  const teamEquipPool=(assets||[]).filter(a=>(!a.type||a.type==="team")&&(a.sport===sport||a.sport==="General")&&!a.sourceCatalogId&&atLoc(a)&&ownedOrOrgAtLoc(a,coachId,team,loc));
  const playerGearPool=(assets||[]).filter(a=>a.type==="player"&&(a.sport===sport||a.sport==="General"||sport==="General")&&!a.sourceCatalogId&&atLoc(a)&&ownedOrOrgAtLoc(a,coachId,team,loc));
  // Public-catalog drills are excluded from this quick-pick list -- their
  // equipment is catalog-owned, which can't be linked to a real team's
  // practice (same "copy not reference" rule org-shared equipment already
  // follows). Copy from Explore's Public Library shelf first; the copy is a
  // normal personal drill and shows up here like any other.
  // libraryDrills (sourceFilteredLib from BuilderScreen) is already scoped
  // to whichever source is currently selected, including a real "Public
  // Library" option -- re-excluding sourceCatalogId here unconditionally
  // used to make that source always render empty.
  const filteredLibrary=(libraryDrills||[]).filter(a=>(a.sport||"General")===sport||(a.sport||"General")==="General");
  const skillTagsById=Object.fromEntries((skillTags||[]).map(t=>[t.id,t]));
  const tagNames=ids=>(ids||[]).map(id=>skillTagsById[id]?skillTagsById[id].name:null).filter(Boolean);
  const applyLibraryChoice=(si,lib,equipmentOverride)=>{
    const st=act.stations[si];
    onSt(st.id,{
      activityName:lib.name,name:lib.name,
      description:lib.description||st.description||"",
      coachingPoints:lib.coachingPoints||st.coachingPoints||"",
      equipment:equipmentOverride!==undefined?equipmentOverride:(Array.isArray(lib.equipment)?lib.equipment:[]),
      libraryId:lib.id,
      grouping:lib.grouping||"whole",numGroups:lib.numGroups||2,
    });
    setLibraryPickerIdx(null);
  };
  // Same equipment-mismatch check as Builder's own drill-add (2026-08-01) --
  // a station's drill can come from Explore (org-shared, peer-shared) and
  // reference equipment ids the coach doesn't own, which
  // practice_activity_equipment's RLS would otherwise silently reject at
  // save time. Always resolves against the coach's own personal pool, same
  // reasoning as Builder's: no Coach/Org mode awareness needed here either.
  const assetsById=Object.fromEntries((assets||[]).map(a=>[a.id,a]));
  const ownAssetPool=(assets||[]).filter(a=>a.ownerUserId===coachId);
  const [equipDialog,setEquipDialog]=useState(null); // {si, lib}
  const chooseFromLibrary=(si,lib)=>{
    const missing=findMissingEquipment(lib.equipment,assetsById,ownAssetPool);
    if(missing.length===0){applyLibraryChoice(si,lib);return;}
    setEquipDialog({si,lib});
  };
  const resolveAndChoose=async(createMissingEquipment)=>{
    const {si,lib}=equipDialog;
    const resolvedIds=await resolveDrillEquipmentForCoach(coachId,lib.equipment,assetsById,ownAssetPool,createMissingEquipment);
    applyLibraryChoice(si,lib,resolvedIds);
    setEquipDialog(null);
    if(createMissingEquipment)await refreshLibrary();
  };

  const genRandom=()=>{
    const n=act.stations.length;
    const shuffled=[...assignablePlayers].sort(()=>Math.random()-.5);
    const groups=Array.from({length:n},()=>[]);
    shuffled.forEach((p,i)=>groups[i%n].push(p.id));
    onChange({stations:act.stations.map((st,i)=>Object.assign({},st,{assignments:groups[i]||[],groupLabel:""}))});
    setGroupByLabel("");
  };
  const clearGroups=()=>{onChange({stations:act.stations.map(st=>Object.assign({},st,{assignments:[],groupLabel:""}))});setGroupByLabel("");};
  // Buckets whole-station assignments by a shared attribute (first listed
  // position, or a handedness field) instead of shuffling -- e.g. every
  // catcher ends up at the same station rather than scattered one-per-group
  // the way Generate Random would leave them. The attribute value that
  // produced each group (e.g. "Lefties") rides along as groupLabel so
  // whoever leads that station later knows who's coming without having to
  // recheck the roster.
  const HAND_GROUP_LABELS={L:"Lefties",R:"Righties",S:"Switch"};
  const groupByPosition=()=>{
    const groups=groupByAttribute(assignablePlayers,act.stations.length,p=>(p.positions&&p.positions[0])||"",v=>v);
    onChange({stations:act.stations.map((st,i)=>Object.assign({},st,{assignments:(groups[i]&&groups[i].ids)||[],groupLabel:(groups[i]&&groups[i].label)||""}))});
    setGroupByLabel("Position");
    setGroupByOpen(false);
  };
  const groupByHand=(key,label)=>{
    const groups=groupByAttribute(assignablePlayers,act.stations.length,p=>p[key]||"",v=>HAND_GROUP_LABELS[v]||v);
    onChange({stations:act.stations.map((st,i)=>Object.assign({},st,{assignments:(groups[i]&&groups[i].ids)||[],groupLabel:(groups[i]&&groups[i].label)||""}))});
    setGroupByLabel(label);
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
    {/* Direct feedback: a station block always displayed as the bare word
        "Station Block" everywhere (Builder, Practice Setup, live), no
        different from any other block in the same practice -- a coach
        running e.g. rapid-fire warmup drills through one block and skill
        work through another had no way to tell them apart at a glance.
        Optional; falls back to "Station Block" everywhere this is blank. */}
    <div className="fld"><label className="lbl">Block Name</label><input className="inp" value={act.name||""} onChange={e=>onChange({name:e.target.value})} placeholder="Station Block" onFocus={e=>e.target.select()}/></div>
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
        <button type="button" className="btn ghost bmd bfull" onClick={()=>setGroupByOpen(o=>!o)}>Group By...{groupByLabel}</button>
        {groupByOpen&&<div style={{position:"absolute",top:"100%",left:0,right:0,marginTop:4,background:"#fff",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:8,zIndex:20,boxShadow:"0 4px 16px rgba(0,0,0,.12)"}}>
          <button type="button" className="mm-item" onClick={groupByPosition}>Position</button>
          {handFields.map(hf=>(<button key={hf.key} type="button" className="mm-item" onClick={()=>groupByHand(hf.key,hf.label)}>{hf.label}</button>))}
          <button type="button" className="mm-item" style={{color:"var(--td)"}} onClick={()=>setGroupByOpen(false)}>Cancel</button>
        </div>}
      </div>
    </div>}
    {act.stations.map((st,si)=>{
      const stEquip=Array.isArray(st.equipment)?st.equipment:[];
      const teamEquipAssets=equipmentPickerAssets(teamEquipPool,stEquip,assets,a=>!a.type||a.type==="team");
      const playerGearAssets=equipmentPickerAssets(playerGearPool,stEquip,assets,a=>a.type==="player");
      const collapsed=collapsedStations.has(st.id);
      return(<div key={st.id} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 12px 10px",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:collapsed?0:10}}>
          <button type="button" onClick={()=>toggleStationCollapsed(st.id)} aria-label={collapsed?"Expand station":"Collapse station"} style={{background:"none",border:"none",color:"var(--green)",cursor:"pointer",padding:"2px 6px 2px 0",display:"flex",alignItems:"center",gap:8,minWidth:0,flex:1}}>
            <Ic.Chev up={!collapsed}/>
            <span style={{minWidth:0,overflow:"hidden"}}>
              <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:900,color:"var(--green)",letterSpacing:".05em"}}>STATION {si+1}</span>
              {collapsed&&<span style={{display:"block",fontSize:12,color:"var(--black2)",fontWeight:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{st.activityName||st.name||"No drill set yet"}</span>}
            </span>
          </button>
          {act.stations.length>1&&<button type="button" onClick={()=>removeStation(si)} style={{background:"none",border:"none",color:"var(--td)",fontSize:12,cursor:"pointer",padding:"2px 6px",flexShrink:0}}>Remove</button>}
        </div>
        {!collapsed&&<>
        <div className="fld">
          <label className="lbl">Name</label>
          <input className="inp" placeholder="Write your own, or choose from library below" value={st.activityName||st.name||""} onChange={e=>onSt(st.id,{activityName:e.target.value,name:e.target.value})}/>
          <button type="button" className="btn ghost bxs mt6" onClick={()=>setLibraryPickerIdx(si)}>{st.libraryId?"Change Library Drill":"Choose from Library"}</button>
          {/* Direct feedback: the old inline dropdown (max-height 220px,
              squeezed into the station's own card) felt claustrophobic --
              a real full-screen popup (same movly/modal overlay pattern
              used elsewhere) gives the whole viewport to browse instead of
              a small scrolling box. */}
          {libraryPickerIdx===si&&<div className="movly" style={{zIndex:300}} onClick={e=>{if(e.target===e.currentTarget)setLibraryPickerIdx(null);}}>
            <div className="modal" style={{maxHeight:"85vh",display:"flex",flexDirection:"column",padding:"20px 0 0"}}>
              <div className="mhandle"/>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 20px",marginBottom:12}}>
                <div className="mtitle" style={{marginBottom:0}}>Choose a Drill</div>
                <button type="button" className="btn ghost bxs" onClick={()=>setLibraryPickerIdx(null)}>Close</button>
              </div>
              {/* Direct feedback: this picker used to silently merge every
                  accessible drill (own + org + any peer sharing with the
                  coach) with no way to tell which library a result came
                  from -- same gap the main "My Drill Library" section
                  already closed with its own librarySources switcher.
                  Sharing that exact switcher's state (passed down from
                  BuilderScreen) rather than a second, independent one keeps
                  "which library am I browsing" answered the same way in
                  both places at once; defaults to "My Library" either way. */}
              {librarySources&&librarySources.length>1&&<div style={{padding:"0 20px 12px"}}>
                <select className="sel" value={libSource} onChange={e=>setLibSource(e.target.value)}>
                  {librarySources.map(s=>(<option key={s.key} value={s.key}>{s.label}</option>))}
                </select>
              </div>}
              {/* Direct feedback: the last drill in this list was cut off by
                  the app's own fixed bottom tab bar -- this popup renders
                  above it in stacking order (movly's z-index beats the tab
                  bar's), but that only means it's drawn on top, not that
                  the scrollable content inside knows to leave room for it.
                  Generous bottom padding, plus the safe-area inset for a
                  home-indicator device on top of that, gives the real
                  last row somewhere to scroll to. */}
              <div style={{overflowY:"auto",flex:1,padding:"0 20px calc(20px + var(--tab) + env(safe-area-inset-bottom,0px))"}}>
                {filteredLibrary.length===0&&<div style={{padding:10,fontSize:13,color:"var(--td)"}}>No drills in this library for {sport} yet.</div>}
                {filteredLibrary.map(lib=>(<div key={lib.id} className="li tap" onClick={()=>chooseFromLibrary(si,lib)}>
                  <div className="lim">
                    <div className="lin">{lib.name}</div>
                    {lib.description&&<div className="limt">{lib.description}</div>}
                    {lib.skillTagIds&&lib.skillTagIds.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
                      {tagNames(lib.skillTagIds).map(name=>(<span key={name} className="bdg bs" style={{fontSize:10}}>{name}</span>))}
                    </div>}
                  </div>
                  <div className="lir"><span className="bdg bp">{lib.duration}m</span></div>
                </div>))}
              </div>
            </div>
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
        {/* Direct feedback: coach assignment is a pill row now, same idea
            as the player chips -- green means assigned to *this* station,
            white/plain means available, yellow means already assigned to a
            different station in this same block (named, so it's obvious
            where). Tapping a yellow pill *moves* that coach here rather
            than creating a second assignment -- this is what actually
            prevents a coach ending up double-booked across two stations at
            once, which a plain per-station dropdown couldn't catch since
            each station's own field had no idea what any other station had
            picked. */}
        {/* Multi-Coach Builder: this specific picker (Builder, pre-live) is
            the one that actually grants write access to the station's own
            content once saved -- station.team_staff_id is what
            update_station_content checks the caller against. Narrowed to
            coaches with canBuildPractices ("Share Practice Planning",
            unlimited-per-team as of this feature) so assigning someone here
            always means they can actually come edit it, not a silent dead
            end. The live/Practice Setup reassignment picker
            (SetupStationBlockRow, CommandScreen.jsx) is deliberately left
            unrestricted -- that one is about who physically runs the
            station during the session, a different, lower-stakes concept
            that already supports any coach or a freeform helper name. */}
        {team&&team.coaches.length>0&&<div className="fld"><label className="lbl">Coach</label>
          {team.coaches.filter(c=>c.canBuildPractices).length===0&&<div style={{fontSize:12,color:"var(--td)",marginBottom:6}}>No assistant has Share Practice Planning yet -- grant it from the roster's Permissions to make them assignable here.</div>}
          {!st.helperName&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
            {team.coaches.filter(c=>c.canBuildPractices).map(c=>{
              const isHere=st.coachId===c.id;
              const elsewhereIdx=act.stations.findIndex((os,oi)=>oi!==si&&os.coachId===c.id);
              const isElsewhere=!isHere&&elsewhereIdx!==-1;
              const label=isElsewhere?c.name+" · "+(act.stations[elsewhereIdx].name||act.stations[elsewhereIdx].activityName||"Station "+(elsewhereIdx+1)):c.name;
              return (<button key={c.id} type="button" onClick={()=>{
                if(isHere){onSt(st.id,{coachId:""});return;}
                if(isElsewhere){
                  onChange({stations:act.stations.map((os,oi)=>oi===elsewhereIdx?Object.assign({},os,{coachId:""}):oi===si?Object.assign({},os,{coachId:c.id,helperName:""}):os)});
                  return;
                }
                onSt(st.id,{coachId:c.id,helperName:""});
              }} style={{padding:"6px 12px",borderRadius:20,border:"1.5px solid "+(isHere?"var(--green)":isElsewhere?"#fbbf24":"var(--b)"),background:isHere?"var(--green)":isElsewhere?"#fef3c7":"#fff",color:isHere?"#fff":isElsewhere?"#92400e":"var(--black)",fontSize:13,fontWeight:600,cursor:"pointer"}}>{label}</button>);
            })}
          </div>}
          {!st.helperName&&<button type="button" className="btn ghost bxs" onClick={()=>{setHelperIdx(si);onSt(st.id,{coachId:""});}}>+ Assign a Helper (not on roster)</button>}
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
            {teamEquipAssets.map(a=>(<EquipmentPickerPill key={a.id} asset={a} selected={stEquip.includes(a.id)} onToggle={()=>{const has=stEquip.includes(a.id);onSt(st.id,{equipment:has?stEquip.filter(x=>x!==a.id):[...stEquip,a.id]});}} refreshLibrary={refreshLibrary}/>))}
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
            {playerGearAssets.map(a=>(<EquipmentPickerPill key={a.id} asset={a} selected={stEquip.includes(a.id)} onToggle={()=>{const has=stEquip.includes(a.id);onSt(st.id,{equipment:has?stEquip.filter(x=>x!==a.id):[...stEquip,a.id]});}} refreshLibrary={refreshLibrary}/>))}
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
              const out=outIds.has(p.id);
              const here=!out&&(st.assignments||[]).includes(p.id);
              const otherIdx=!out&&!here?act.stations.findIndex((s2,i2)=>i2!==si&&(s2.assignments||[]).includes(p.id)):-1;
              const elsewhere=otherIdx>=0;
              return(<button key={p.id} type="button" onClick={()=>{if(!out)handleChip(si,p);}} disabled={out} title={out?p.firstName+" is marked out for this practice":undefined} style={{padding:"7px 12px",borderRadius:8,border:"1.5px solid",borderColor:out?"var(--b)":here?"var(--green)":elsewhere?"#d97706":"var(--b)",background:out?"var(--s2)":here?"var(--green)":elsewhere?"#fef3c7":"var(--s1)",color:out?"var(--td)":here?"#fff":elsewhere?"#92400e":"var(--black)",fontSize:13,cursor:out?"not-allowed":"pointer",display:"flex",flexDirection:"column",alignItems:"flex-start",gap:1,minWidth:72,opacity:out?0.7:1}}>
                <span style={{fontWeight:700,textDecoration:out?"line-through":"none"}}>{p.jersey?<span style={{fontFamily:"DM Mono,monospace",fontSize:11,marginRight:3}}>#{p.jersey}</span>:null}{p.firstName}</span>
                {out&&<span style={{fontSize:10,fontWeight:700,color:"var(--red)"}}>Out</span>}
                {elsewhere&&<span style={{fontSize:10,opacity:.85}}>→ St {otherIdx+1}</span>}
                {here&&<span style={{fontSize:10,opacity:.8}}>✓ here</span>}
              </button>);
            })}
          </div>
          <div style={{fontSize:11,color:"var(--td)",marginTop:4}}>
            <span style={{color:"var(--green)",fontWeight:700}}>Green</span> = here &nbsp;
            <span style={{color:"#d97706",fontWeight:700}}>Yellow</span> = other station &nbsp;
            <span style={{color:"var(--td)"}}>Gray</span> = unassigned &nbsp;
            <span style={{color:"var(--red)",fontWeight:700}}>Out</span> = marked out for this practice
          </div>
        </div>}
        </>}
      </div>);
    })}
    <button type="button" className="btn outline bsm bfull mb8" onClick={addStation}>+ Add Station</button>
    <button className="btn ghost bsm bfull mt4" onClick={onDone}>Done</button>
    {equipDialog&&<EquipmentMismatchDialog drillName={equipDialog.lib.name} missing={findMissingEquipment(equipDialog.lib.equipment,assetsById,ownAssetPool)} context="practice" onAddWithEquipment={()=>resolveAndChoose(true)} onAddAnyway={()=>resolveAndChoose(false)} onCancel={()=>setEquipDialog(null)}/>}
  </div>);
}
