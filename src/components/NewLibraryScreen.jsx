import React, { useState, useEffect, useRef } from "react";
import { uid, sumMins } from "../constants.js";

// ── Local icon subset needed by this screen ───────────────────────────────────
const Ic_Dots=()=><svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="4" cy="3.5" r="1.4"/><circle cx="10" cy="3.5" r="1.4"/><circle cx="4" cy="7" r="1.4"/><circle cx="10" cy="7" r="1.4"/><circle cx="4" cy="10.5" r="1.4"/><circle cx="10" cy="10.5" r="1.4"/></svg>;
const Ic_Chev=({up})=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points={up?"4 10 8 6 12 10":"4 6 8 10 12 6"}/></svg>;

// ── ActConfig, ChecklistConfig, StationConfig ─────────────────────────────────
// (kept here since they are only used inside Library/Builder/TemplateWorkspace)

function DurStepper({value,min,onChange,step}){
  const s=step||1;const mn=min||1;
  return (<div style={{display:"flex",alignItems:"center",gap:0,border:"1.5px solid var(--b)",borderRadius:"var(--rs)",overflow:"hidden",background:"#fff"}}>
    <button onClick={()=>onChange(Math.max(mn,value-s))} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>-</button>
    <div style={{flex:1,textAlign:"center",fontFamily:"DM Mono,monospace",fontSize:15,fontWeight:600,color:"var(--black)"}}>{value}m</div>
    <button onClick={()=>onChange(value+s)} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
  </div>);
}

export function ActConfig({act,team,loc,onChange,onDone,assets,update}){
  return (<div>
    <div className="fld"><label className="lbl">Name</label><input className="inp" value={act.name} onChange={e=>onChange({name:e.target.value})}/></div>
    <div className="fld"><label className="lbl">Duration (min)</label><DurStepper value={act.duration} min={1} onChange={v=>onChange({duration:v})}/></div>
    <div className="fld"><label className="lbl">Coaching Points</label><textarea className="ta" value={act.coachingPoints||""} onChange={e=>onChange({coachingPoints:e.target.value})}/></div>
    {team&&<div className="fld"><label className="lbl">Coach</label><select className="sel" value={act.coachId||""} onChange={e=>onChange({coachId:e.target.value,coachName:(team.coaches.find(c=>c.id===e.target.value)||{}).name||""})}><option value="">Unassigned</option>{team.coaches.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
    {loc&&loc.sublocations&&loc.sublocations.length>0&&<div className="fld"><label className="lbl">Area</label><select className="sel" value={act.sublocationId||""} onChange={e=>onChange({sublocationId:e.target.value})}><option value="">Any</option>{loc.sublocations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
    <button className="btn ghost bsm bfull mt8" onClick={onDone}>Done</button>
  </div>);
}

export function ChecklistConfig({act,onChange,onDone}){
  const [newItem,setNewItem]=useState("");
  const addItem=()=>{if(!newItem.trim())return;const items=[...(act.items||[]),{id:uid(),text:newItem.trim(),done:false}];onChange({items});setNewItem("");};
  const remItem=id=>onChange({items:(act.items||[]).filter(it=>it.id!==id)});
  return (<div>
    <div className="fld"><label className="lbl">Name</label><input className="inp" value={act.name} onChange={e=>onChange({name:e.target.value})}/></div>
    <div className="fld"><label className="lbl">Duration (min)</label><DurStepper value={act.duration} min={1} onChange={v=>onChange({duration:v})}/></div>
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

export function StationConfig({act,team,loc,onChange,onSt,onDone,assets,update,teamSport}){
  const rotate=act.rotate!==false;
  const players=team?team.players:[];
  const [newEquipIdx,setNewEquipIdx]=useState(null);
  const [newGearIdx,setNewGearIdx]=useState(null);
  const sport=teamSport||"General";
  const teamEquipAssets=(assets||[]).filter(a=>!a.type||a.type==="team");
  const playerGearAssets=(assets||[]).filter(a=>a.type==="player"&&(a.sport===sport||a.sport==="General"||sport==="General"));

  // ── Random groups ──────────────────────────────────────────────────────────
  const genRandom=()=>{
    const n=act.stations.length;
    const shuffled=[...players].sort(()=>Math.random()-.5);
    const groups=Array.from({length:n},()=>[]);
    shuffled.forEach((p,i)=>groups[i%n].push(p.id));
    onChange({stations:act.stations.map((st,i)=>Object.assign({},st,{assignments:groups[i]||[]}))});
  };
  const clearGroups=()=>onChange({stations:act.stations.map(st=>Object.assign({},st,{assignments:[]}))});

  // ── Add / remove stations ─────────────────────────────────────────────────
  const addStation=()=>{
    const n=act.stations.length+1;
    onChange({stations:[...act.stations,{id:Math.random().toString(36).slice(2,9),name:"Station "+n,activityName:"",coachId:"",coachName:"",sublocationId:"",equipment:[],playerGear:"",coachingPoints:"",assignments:[]}]});
  };
  const removeStation=si=>{
    if(act.stations.length<=1)return;
    onChange({stations:act.stations.filter((_,i)=>i!==si)});
  };

  // ── Player chip click ─────────────────────────────────────────────────────
  const handleChip=(si,p)=>{
    const st=act.stations[si];
    const assigned=(st.assignments||[]).includes(p.id);
    if(assigned){
      // unassign → gray
      onSt(st.id,{assignments:(st.assignments||[]).filter(x=>x!==p.id)});
    } else {
      // move from any other station → assign here
      const newSts=act.stations.map((s2,i2)=>{
        if(i2===si)return Object.assign({},s2,{assignments:[...(s2.assignments||[]),p.id]});
        return Object.assign({},s2,{assignments:(s2.assignments||[]).filter(x=>x!==p.id)});
      });
      onChange({stations:newSts});
    }
  };

  return (<div>
    {/* ── Rotate / Static toggle ── */}
    <div className="fld">
      <label className="lbl">Player Movement</label>
      <div style={{display:"flex",gap:0,borderRadius:"var(--r)",overflow:"hidden",border:"1.5px solid var(--b)"}}>
        <button type="button" onClick={()=>onChange({rotate:true})} style={{flex:1,padding:"10px 0",border:"none",background:rotate?"var(--green)":"var(--s1)",color:rotate?"#fff":"var(--black)",fontFamily:"Barlow Condensed,sans-serif",fontSize:14,fontWeight:700,cursor:"pointer",letterSpacing:".03em"}}>
          ROTATE
        </button>
        <button type="button" onClick={()=>onChange({rotate:false})} style={{flex:1,padding:"10px 0",border:"none",background:!rotate?"var(--green)":"var(--s1)",color:!rotate?"#fff":"var(--black)",fontFamily:"Barlow Condensed,sans-serif",fontSize:14,fontWeight:700,cursor:"pointer",letterSpacing:".03em"}}>
          STATIC
        </button>
      </div>
      <div style={{fontSize:11,color:"var(--td)",marginTop:4}}>{rotate?"Players rotate through all stations on a timer":"Players stay at their assigned station"}</div>
    </div>

    {/* ── Durations ── */}
    <div className={rotate?"g2":"fld"} style={rotate?{}:{maxWidth:160}}>
      <div className="fld"><label className="lbl">Time at Station (min)</label><DurStepper value={act.stationDuration||10} min={1} onChange={v=>onChange({stationDuration:v})}/></div>
      {rotate&&<div className="fld"><label className="lbl">Transition (min)</label><DurStepper value={act.transitionDuration||2} min={0} onChange={v=>onChange({transitionDuration:v})}/></div>}
    </div>

    {/* ── Random groups bar ── */}
    {players.length>0&&<div className="brow mb10">
      <button className="btn outline bmd" style={{flex:1}} onClick={genRandom}>Generate Random Groups</button>
      <button className="btn ghost bmd" style={{flex:1}} onClick={clearGroups}>Clear Groups</button>
    </div>}

    {/* ── Stations ── */}
    {act.stations.map((st,si)=>{
      const stEquip=Array.isArray(st.equipment)?st.equipment:[];
      return (<div key={st.id} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 12px 10px",marginBottom:10}}>
        {/* station header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:900,color:"var(--green)",letterSpacing:".05em"}}>STATION {si+1}</div>
          {act.stations.length>1&&<button type="button" onClick={()=>removeStation(si)} style={{background:"none",border:"none",color:"var(--td)",fontSize:12,cursor:"pointer",padding:"2px 6px"}}>Remove</button>}
        </div>

        <div className="fld"><label className="lbl">Name</label><input className="inp" value={st.activityName||st.name||""} onChange={e=>onSt(st.id,{activityName:e.target.value,name:e.target.value})}/></div>

        {team&&team.coaches.length>0&&<div className="fld"><label className="lbl">Coach</label>
          <select className="sel" value={st.coachId||""} onChange={e=>{const c=team.coaches.find(c=>c.id===e.target.value);onSt(st.id,{coachId:e.target.value,coachName:c?c.name:""});}}>
            <option value="">Unassigned</option>
            {team.coaches.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>}

        {loc&&loc.sublocations&&loc.sublocations.length>0&&<div className="fld"><label className="lbl">Area</label>
          <select className="sel" value={st.sublocationId||""} onChange={e=>onSt(st.id,{sublocationId:e.target.value})}>
            <option value="">Any</option>
            {loc.sublocations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>}

        <div className="fld"><label className="lbl">Coaching Points</label>
          <textarea className="ta" style={{minHeight:40}} value={st.coachingPoints||""} onChange={e=>onSt(st.id,{coachingPoints:e.target.value})}/>
        </div>

        {/* Equipment */}
        <div className="fld"><label className="lbl">Equipment</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
            {teamEquipAssets.map(a=>(<button key={a.id} type="button" onClick={()=>{const cur=stEquip;const has=cur.includes(a.id);onSt(st.id,{equipment:has?cur.filter(x=>x!==a.id):[...cur,a.id]});}} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:stEquip.includes(a.id)?"var(--green)":"#fff",color:stEquip.includes(a.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>))}
            {teamEquipAssets.length===0&&<span style={{fontSize:12,color:"var(--td)"}}>No team equipment in library</span>}
          </div>
          {newEquipIdx===si
            ?<div style={{display:"flex",gap:6}}>
                <input className="inp" style={{flex:1}} placeholder="Equipment name..." id={"new-st-equip-"+si} autoFocus/>
                <button type="button" className="btn ghost bxs" onClick={()=>{const el=document.getElementById("new-st-equip-"+si);if(!el||!el.value.trim())return;const nm=el.value.trim();const newId=uid();update(d=>{d.assets.push({id:newId,name:nm,type:"team",sport:"General",locationTags:[]});return d;});onSt(st.id,{equipment:[...stEquip,newId]});setNewEquipIdx(null);}}>Add</button>
                <button type="button" className="btn ghost bxs" onClick={()=>setNewEquipIdx(null)}>✕</button>
              </div>
            :<button type="button" className="btn ghost bxs" onClick={()=>setNewEquipIdx(si)}>+ New</button>
          }
        </div>

        {/* Player Gear */}
        {(playerGearAssets.length>0||newGearIdx===si)&&<div className="fld"><label className="lbl">Player Gear Needed</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
            {playerGearAssets.map(a=>{const gearList=(st.playerGear||"").split(",").map(s=>s.trim()).filter(Boolean);const sel=gearList.includes(a.name);return(<button key={a.id} type="button" onClick={()=>{const cur=gearList;const next=sel?cur.filter(x=>x!==a.name):[...cur,a.name];onSt(st.id,{playerGear:next.join(", ")});}} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:sel?"var(--green)":"#fff",color:sel?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>);})}
          </div>
          {newGearIdx===si
            ?<div style={{display:"flex",gap:6}}>
                <input className="inp" style={{flex:1}} placeholder="Gear name..." id={"new-st-gear-"+si} autoFocus/>
                <button type="button" className="btn ghost bxs" onClick={()=>{const el=document.getElementById("new-st-gear-"+si);if(!el||!el.value.trim())return;const nm=el.value.trim();const newId=uid();update(d=>{d.assets.push({id:newId,name:nm,type:"player",sport,locationTags:[]});return d;});const cur=(st.playerGear||"").split(",").map(s=>s.trim()).filter(Boolean);onSt(st.id,{playerGear:[...cur,nm].join(", ")});setNewGearIdx(null);}}>Add</button>
                <button type="button" className="btn ghost bxs" onClick={()=>setNewGearIdx(null)}>✕</button>
              </div>
            :<button type="button" className="btn ghost bxs" onClick={()=>setNewGearIdx(si)}>+ New Gear</button>
          }
        </div>}
        {playerGearAssets.length===0&&newGearIdx!==si&&<div className="fld">
          <label className="lbl">Player Gear Needed</label>
          <div style={{fontSize:12,color:"var(--td)",marginBottom:4}}>No player gear set up for {sport} yet.</div>
          <button type="button" className="btn ghost bxs" onClick={()=>setNewGearIdx(si)}>+ Add Gear</button>
        </div>}

        {/* Player chips */}
        {players.length>0&&<div className="fld"><label className="lbl">Players</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {players.map(p=>{
              const here=(st.assignments||[]).includes(p.id);
              const otherIdx=!here?act.stations.findIndex((s2,i2)=>i2!==si&&(s2.assignments||[]).includes(p.id)):-1;
              const elsewhere=otherIdx>=0;
              return (<button key={p.id} type="button" onClick={()=>handleChip(si,p)}
                style={{padding:"7px 12px",borderRadius:8,border:"1.5px solid",
                  borderColor:here?"var(--green)":elsewhere?"#d97706":"var(--b)",
                  background:here?"var(--green)":elsewhere?"#fef3c7":"var(--s1)",
                  color:here?"#fff":elsewhere?"#92400e":"var(--black)",
                  fontSize:13,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"flex-start",gap:1,minWidth:72}}>
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

    {/* ── Add station ── */}
    <button type="button" className="btn outline bsm bfull mb8" onClick={addStation}>+ Add Station</button>
    <button className="btn ghost bsm bfull mt4" onClick={onDone}>Done</button>
  </div>);
}

// ── GearEditRow — inline edit for a player gear item ─────────────────────────
function GearEditRow({asset,update,onDone}){
  const [name,setName]=useState(asset.name);
  const [sport,setSport]=useState(asset.sport||"General");
  const save=()=>{
    if(!name.trim())return;
    update(d=>{const a=d.assets.find(a=>a.id===asset.id);if(a){a.name=name.trim();a.sport=sport;}return d;});
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
function EquipmentTab({data,update,openModal}){
  const [equipTab,setEquipTab]=useState("team");
  const [openMenu,setOpenMenu]=useState(null);
  const [newName,setNewName]=useState("");
  const [newSport,setNewSport]=useState("General");
  const [showAdd,setShowAdd]=useState(false);
  const [collapsed,setCollapsed]=useState({});
  const teamAssets=(data.assets||[]).filter(a=>!a.type||a.type==="team");
  const playerAssets=(data.assets||[]).filter(a=>a.type==="player");
  const addNew=()=>{
    if(!newName.trim())return;
    const newId=uid();
    update(d=>{d.assets.push({id:newId,name:newName.trim(),type:equipTab,sport:equipTab==="player"?newSport:"General",locationTags:[]});return d;});
    setNewName("");setShowAdd(false);
  };
  const del=id=>update(d=>{d.assets=d.assets.filter(a=>a.id!==id);return d;});
  return(<div onClick={()=>setOpenMenu(null)}>
    {/* Toggle */}
    <div style={{display:"flex",gap:0,background:"var(--s2)",borderRadius:"var(--r)",padding:3,marginBottom:16}}>
      {["team","player"].map(t=>(<button key={t} onClick={()=>{setEquipTab(t);setSportFilter("All");setShowAdd(false);}} style={{flex:1,padding:"8px 0",border:"none",cursor:"pointer",borderRadius:"calc(var(--r) - 2px)",background:equipTab===t?"#fff":"transparent",fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".03em",textTransform:"uppercase",color:equipTab===t?"var(--black)":"var(--td)"}}>{t==="team"?"Team Equipment":"Player Gear"}</button>))}
    </div>

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
          {a.locationTags&&a.locationTags.length>0&&<div className="limt">{a.locationTags.map(lid=>{const l=data.locations.find(l=>l.id===lid);return l?l.name:null;}).filter(Boolean).join(", ")}</div>}
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
            <button onClick={()=>setCollapsed(c=>Object.assign({},c,{["pg_"+sport]:!c["pg_"+sport]}))} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"var(--s1)",border:"none",borderRadius:"var(--r)",cursor:"pointer"}}>
              <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700}}>{sport}</span>
              <span style={{fontSize:12,color:"var(--td)"}}>{items.length} item{items.length!==1?"s":""} {isCollapsed?"▶":"▼"}</span>
            </button>
            {!isCollapsed&&<div style={{border:"1px solid var(--b)",borderTop:"none",borderRadius:"0 0 var(--r) var(--r)",overflow:"hidden"}}>
              {items.map((a,i)=>{
                const isEditing=openMenu==="edit_"+a.id;
                return(<div key={a.id}>
                  {!isEditing&&<div className="li" style={{position:"relative",borderBottom:i<items.length-1?"1px solid var(--b)":"none"}}>
                    <div className="lim"><div className="lin">{a.name}</div></div>
                    <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===a.id?null:a.id);}}><span/><span/><span/></button>
                    {openMenu===a.id&&<div className="mini-menu">
                      <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu("edit_"+a.id);}}>Edit</button>
                      <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);del(a.id);}}>Delete</button>
                    </div>}
                  </div>}
                  {isEditing&&<GearEditRow asset={a} update={update} onDone={()=>setOpenMenu(null)}/>}
                </div>);
              })}
            </div>}
          </div>);
        });
      })()}
    </div>}
  </div>);
}

// ── TemplateWorkspace ─────────────────────────────────────────────────────────
function TemplateWorkspace({data,update,template,mode,onRun,onSave,onBack}){
  const isEdit=mode==="edit";
  const [name,setName]=useState(template.name);
  const [sport,setSport]=useState(template.sport||"General");
  const [teamId,setTeamId]=useState(()=>{
    if(template.teamId&&data.teams.find(t=>t.id===template.teamId))return template.teamId;
    const match=data.teams.find(t=>(t.sport||"General")===template.sport);
    return match?match.id:(data.teams[0]?data.teams[0].id:"");
  });
  const [locId,setLocId]=useState(data.locations[0]?data.locations[0].id:"");
  const [acts,setActs]=useState(()=>JSON.parse(JSON.stringify(template.activities||[])));
  const [expandedId,setExpandedId]=useState(null);
  const [saved,setSaved]=useState(false);
  const team=data.teams.find(t=>t.id===teamId)||null;
  const loc=data.locations.find(l=>l.id===locId)||null;
  const dragIdx=useRef(null);
  const updAct=(id,ch)=>setActs(p=>p.map(a=>a.id===id?Object.assign({},a,ch):a));
  const updSt=(aid,sid,ch)=>setActs(p=>p.map(a=>a.id===aid?Object.assign({},a,{stations:a.stations.map(s=>s.id===sid?Object.assign({},s,ch):s)}):a));
  const remAct=id=>setActs(p=>p.filter(a=>a.id!==id));
  const handleRun=()=>{
    const now=new Date();
    const p={id:uid(),teamId,locationId:locId,date:now.toISOString().slice(0,10),startTime:now.toTimeString().slice(0,5),durMin:sumMins(acts),activities:acts,fromTemplate:template.id};
    if(onRun)onRun(p);
  };
  const [schedMode,setSchedMode]=useState(false);
  const [schedDate,setSchedDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [schedTime,setSchedTime]=useState("16:00");
  const [schedDone,setSchedDone]=useState(false);
  const handleSchedule=()=>{
    if(!schedDate)return;
    const p={id:uid(),teamId,locationId:locId,date:schedDate,startTime:schedTime,durMin:sumMins(acts),activities:JSON.parse(JSON.stringify(acts)),fromTemplate:template.id};
    update(d=>{d.practices.push(p);return d;});
    setSchedDone(true);
    setTimeout(()=>{setSchedDone(false);setSchedMode(false);if(onBack)onBack();},1500);
  };
  const handleSave=()=>{
    update(d=>{
      const idx=d.templates.findIndex(t=>t.id===template.id);
      if(idx>=0)d.templates[idx]=Object.assign({},d.templates[idx],{name,sport,activities:acts});
      return d;
    });
    setSaved(true);setTimeout(()=>{setSaved(false);if(onSave)onSave();},1200);
  };
  return (<div style={{paddingBottom:80}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
      <button className="btn ghost bxs" onClick={onBack}>Back</button>
      <div className="ptitle" style={{fontSize:20}}>{isEdit?"Edit: "+name:name}</div>
    </div>
    {isEdit&&(<div className="card mb10">
      <div className="g2">
        <div className="fld"><label className="lbl">Name</label><input className="inp" value={name} onChange={e=>setName(e.target.value)}/></div>
        <div className="fld"><label className="lbl">Sport</label>
          <select className="sel" value={sport} onChange={e=>setSport(e.target.value)}>
            {["General","Baseball","Basketball","Football","Soccer","Softball","Volleyball","Other"].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
    </div>)}
    <div className="card mb10">
      <div className="clbl">{isEdit?"Default Team & Location":"Run Setup"}</div>
      <div className="fld"><label className="lbl">Team</label>
        <select className="sel" value={teamId} onChange={e=>setTeamId(e.target.value)}>
          {data.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="fld"><label className="lbl">Location</label>
        <select className="sel" value={locId} onChange={e=>setLocId(e.target.value)}>
          <option value="">None</option>
          {data.locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      {!isEdit&&<div style={{fontSize:12,color:"var(--td)",marginTop:4}}>Editing here only affects this run. The template stays unchanged.</div>}
    </div>
    <div className="sechdr mb8"><span className="sectitle">{acts.length} Activities</span><span className="pill">{sumMins(acts)}m</span></div>
    {acts.map((act,i)=>(<div key={act.id}>
      <div className="ablk">
        <div className="abhdr" onClick={()=>setExpandedId(expandedId===act.id?null:act.id)}>
          {/* Up/down arrows matching builder style */}
          <div style={{display:"flex",flexDirection:"column",gap:2,marginRight:6,flexShrink:0}}>
            <button onClick={e=>{e.stopPropagation();if(i>0)setActs(p=>{const a=[...p];[a[i-1],a[i]]=[a[i],a[i-1]];return a;});}} disabled={i===0} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",color:i===0?"var(--s3)":"var(--td)",fontSize:14,lineHeight:1}}>&#8593;</button>
            <button onClick={e=>{e.stopPropagation();if(i<acts.length-1)setActs(p=>{const a=[...p];[a[i],a[i+1]]=[a[i+1],a[i]];return a;});}} disabled={i===acts.length-1} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",color:i===acts.length-1?"var(--s3)":"var(--td)",fontSize:14,lineHeight:1}}>&#8595;</button>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{font:"700 14px Barlow Condensed,sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{act.type==="station_block"?"Station Block":act.name}</div>
            {act.type==="station_block"
              ?<div className="limt">{act.stations.map(s=>s.activityName||s.name).join(" / ")} - {act.stationDuration}m x{act.stations.length}{act.rotate!==false?" + "+(act.transitionDuration||0)+"m trans":""}</div>
              :<div className="limt">{act.duration}min{act.grouping&&act.grouping!=="whole"?" · "+(act.grouping==="partners"?"Partners":act.numGroups+" groups"):""}</div>}
          </div>
          <div className="row">
            {act.type!=="station_block"&&<span className="bdg bp">{act.duration}m</span>}
            {act.type==="station_block"&&<span className="bdg bp">{act.stations.length*act.stationDuration+(act.rotate!==false?Math.max(0,act.stations.length-1)*(act.transitionDuration||0):0)}m</span>}
            <button className="btn danger bxs" onClick={e=>{e.stopPropagation();remAct(act.id);}}>x</button>
          </div>
        </div>
        {expandedId===act.id&&(<div className="abbody">
          {act.type==="activity"&&<ActConfig assets={data.assets} update={update} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
          {act.type==="checklist"&&<ChecklistConfig act={act} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
          {act.type==="station_block"&&<StationConfig assets={data.assets} update={update} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)} teamSport={team?team.sport:sport}/>}
        </div>)}
      </div>
    </div>))}
    <div style={{marginTop:12}}>
      {isEdit&&<div className="brow">
        <button className="btn ghost bmd" onClick={onBack}>Cancel</button>
        <button className="btn primary bmd" onClick={handleSave}>{saved?"Saved":"Save Template"}</button>
      </div>}
      {!isEdit&&!schedMode&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
        <button className="btn primary bxl bfull" onClick={handleRun}>Run Now</button>
        <button className="btn outline bmd bfull" onClick={()=>setSchedMode(true)}>Schedule for Later</button>
      </div>}
      {!isEdit&&schedMode&&<div className="card">
        <div className="clbl mb10">Schedule Practice</div>
        <div className="g2">
          <div className="fld"><label className="lbl">Date</label><input className="inp" type="date" value={schedDate} onChange={e=>setSchedDate(e.target.value)}/></div>
          <div className="fld"><label className="lbl">Start Time</label><input className="inp" type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)}/></div>
        </div>
        <div style={{fontSize:12,color:"var(--td)",marginBottom:12}}>Saves to your calendar. You can share a setup link from the practice detail.</div>
        <div className="brow">
          <button className="btn ghost bmd" onClick={()=>setSchedMode(false)}>Cancel</button>
          <button className="btn primary bmd" onClick={handleSchedule} disabled={!schedDate}>{schedDone?"Scheduled!":"Schedule"}</button>
        </div>
      </div>}
    </div>
  </div>);
}

// ── NewLibraryScreen ──────────────────────────────────────────────────────────
export default function NewLibraryScreen({data,update,openModal,setView,setLiveId,launchRun,setEditPracticeId}){
  const [libTab,setLibTab]=useState("drills");
  useEffect(()=>{window.__ropLibTab=setLibTab;return()=>{delete window.__ropLibTab;};},[]);
  const [openMenu,setOpenMenu]=useState(null);
  const [editingTpl,setEditingTpl]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const [collapsed,setCollapsed]=useState({});
  const [drillMenu,setDrillMenu]=useState(null);
  const toggle=sport=>setCollapsed(c=>Object.assign({},c,{[sport]:!c[sport]}));
  const sports=[...new Set(data.activityLibrary.map(a=>a.sport||"General").filter(Boolean))].sort();
  const templates=data.templates||[];
  const LTABS=["drills","templates","locations","equipment"];
  if(editingTpl)return (<div style={{paddingBottom:80}}><TemplateWorkspace data={data} template={editingTpl} mode="edit" onSave={tpl=>{update(d=>{const i=d.templates.findIndex(t=>t.id===tpl.id);if(i>=0)d.templates[i]=tpl;else d.templates.push(tpl);return d;});setEditingTpl(null);}} onBack={()=>setEditingTpl(null)}/></div>);
  return (<div style={{paddingBottom:80}}>
    <div style={{padding:"20px 16px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900}}>Library</div>
      <button className="btn primary bsm" onClick={()=>{if(setEditPracticeId)setEditPracticeId(null);setView("builder");}}>+ Build Practice</button>
    </div>
    <div style={{padding:"0 16px 12px"}}>
      <div style={{display:"flex",gap:0,background:"var(--s2)",borderRadius:"var(--r)",padding:3,marginBottom:0}}>
        {LTABS.map(t=>(<button key={t} onClick={()=>setLibTab(t)} style={{flex:1,padding:"7px 0",border:"none",cursor:"pointer",borderRadius:"calc(var(--r) - 2px)",background:libTab===t?"#fff":"transparent",fontFamily:"Barlow Condensed,sans-serif",fontSize:12,fontWeight:700,letterSpacing:".03em",textTransform:"uppercase",color:libTab===t?"var(--black)":"var(--td)"}}>{t}</button>))}
      </div>
    </div>
    {libTab==="drills"&&<div style={{padding:"0 16px"}}>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}><button className="btn primary bsm" onClick={()=>openModal("addActivity")}>+ Add Drill</button></div>
      {data.activityLibrary.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No drills yet. Tap + Add Drill.</div>}
      {sports.map(sport=>(<div key={sport} style={{marginBottom:8}}>
        <button onClick={()=>toggle(sport)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"var(--s1)",border:"none",borderRadius:"var(--r)",cursor:"pointer"}}>
          <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700}}>{sport}</span>
          <span style={{fontSize:12,color:"var(--td)"}}>{data.activityLibrary.filter(a=>a.sport===sport).length} drills {collapsed[sport]?"":"v"}</span>
        </button>
        {!collapsed[sport]&&(()=>{
          const sportDrills=data.activityLibrary.map((a,gi)=>({...a,_gi:gi,sport:a.sport||"General"})).filter(a=>a.sport===sport);
          const moveUp=act=>{const si=sportDrills.findIndex(a=>a.id===act.id);if(si===0)return;const pi=sportDrills[si-1]._gi;const ci=act._gi;update(d=>{const tmp=d.activityLibrary[ci];d.activityLibrary[ci]=d.activityLibrary[pi];d.activityLibrary[pi]=tmp;return d;});};
          const moveDown=act=>{const si=sportDrills.findIndex(a=>a.id===act.id);if(si===sportDrills.length-1)return;const ni=sportDrills[si+1]._gi;const ci=act._gi;update(d=>{const tmp=d.activityLibrary[ci];d.activityLibrary[ci]=d.activityLibrary[ni];d.activityLibrary[ni]=tmp;return d;});};
          return sportDrills.map((act,si)=>(<div key={act.id} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 12px",borderBottom:"1px solid var(--b)",background:"#fff"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",paddingTop:2,gap:1,flexShrink:0,width:20}}>
              {si>0&&<button onClick={()=>moveUp(act)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"var(--td)",padding:0,lineHeight:1}}>▲</button>}
              {si<sportDrills.length-1&&<button onClick={()=>moveDown(act)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"var(--td)",padding:0,lineHeight:1}}>▼</button>}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:2}}>{act.name}</div>
              {act.description&&<div style={{fontSize:12,color:"var(--td)",marginBottom:2,lineHeight:1.4}}>{act.description}</div>}
              {act.coachingPoints&&<div style={{fontSize:12,color:"var(--td)",marginBottom:2}}>{act.coachingPoints}</div>}
              {act.playerGear&&<div style={{fontSize:11,color:"#92400e",marginTop:2}}>Player gear: {act.playerGear}</div>}
              {act.equipment&&Array.isArray(act.equipment)&&act.equipment.length>0&&<div style={{fontSize:11,color:"var(--td)",marginTop:2}}>Needs: {act.equipment.map(id=>{const a=data.assets.find(x=>x.id===id);return a?a.name:id;}).join(", ")}</div>}
              {act.grouping&&act.grouping!=="whole"&&<div style={{fontSize:11,color:"var(--td)",marginTop:2}}>{act.grouping==="partners"?"Partners":act.numGroups+" groups"}</div>}
            </div>
            <div style={{position:"relative",flexShrink:0}}>
              <button className="ell-btn" onClick={e=>{e.stopPropagation();setDrillMenu(drillMenu===act.id?null:act.id);}}><span/><span/><span/></button>
              {drillMenu===act.id&&<div className="mini-menu" style={{right:0,minWidth:120}}>
                <button className="mm-item" onClick={()=>{setDrillMenu(null);openModal("editActivity",{activity:act});}}>Edit</button>
                <button className="mm-item mm-danger" onClick={()=>{setDrillMenu(null);update(d=>{d.activityLibrary=d.activityLibrary.filter(a=>a.id!==act.id);return d;});}}>Delete</button>
              </div>}
            </div>
          </div>));
        })()}
      </div>))}
    </div>}
    {libTab==="templates"&&<div style={{padding:"0 16px"}}>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}><button className="btn primary bsm" onClick={()=>setEditingTpl({id:uid(),name:"New Template",activities:[],durMin:0})}>+ New Template</button></div>
      {templates.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No templates yet.<br/>Build a practice and save it as a template.</div>}
      {templates.map(tpl=>(<div key={tpl.id} className="card" style={{marginBottom:10}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:6}}>
          <div><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:900,lineHeight:1}}>{tpl.name}</div><div style={{fontSize:12,color:"var(--td)",marginTop:2}}>{(tpl.activities||[]).length} activities - {tpl.durMin||0}min</div></div>
          <div style={{position:"relative"}}>
            <button className="ell-btn" onClick={()=>setOpenMenu(openMenu===tpl.id?null:tpl.id)}><span/><span/><span/></button>
            {openMenu===tpl.id&&<div className="mini-menu" style={{right:0}}>
              <button className="mm-item" onClick={()=>{setEditingTpl(tpl);setOpenMenu(null);}}>Edit</button>
              <button className="mm-item" onClick={()=>{setConfirmDel(tpl.id);setOpenMenu(null);}}>Delete</button>
            </div>}
          </div>
        </div>
        <div className="brow">
          <button className="btn ghost bmd" style={{flex:1}} onClick={()=>setEditingTpl(tpl)}>Preview</button>
          <button className="btn primary bmd" style={{flex:1}} onClick={()=>{const now=new Date();const newId=uid();update(d=>{d.practices.push({id:newId,teamId:d.teams[0]?d.teams[0].id:"",locationId:d.locations[0]?d.locations[0].id:"",date:now.toISOString().slice(0,10),startTime:now.toTimeString().slice(0,5),durMin:tpl.durMin||0,activities:JSON.parse(JSON.stringify(tpl.activities||[]))});return d;});setLiveId(newId);setView("command");}}>Use Now</button>
        </div>
      </div>))}
      {confirmDel&&<div className="movly" onClick={()=>setConfirmDel(null)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="mtitle">Delete template?</div><div style={{fontSize:14,color:"var(--td)",marginBottom:16}}>This cannot be undone.</div><div className="brow"><button className="btn ghost bmd" onClick={()=>setConfirmDel(null)}>Cancel</button><button className="btn primary bmd" onClick={()=>{update(d=>{d.templates=d.templates.filter(t=>t.id!==confirmDel);return d;});setConfirmDel(null);}}>Delete</button></div></div></div>}
    </div>}
    {libTab==="locations"&&<div style={{padding:"0 16px"}} onClick={()=>setOpenMenu(null)}>
      <div className="sechdr mb10"><span className="sectitle">{data.locations.length} Locations</span><button className="btn primary bsm" onClick={()=>openModal("addLocation")}>+ Add</button></div>
      {data.locations.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No locations yet.</div>}
      {data.locations.map(loc=>(<div key={loc.id} className="card" style={{position:"relative",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700}}>{loc.name}</span>
          <div className="row">
            <button className="btn ghost bxs" onClick={()=>openModal("addSublocation",{locationId:loc.id})}>+ Area</button>
            <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===loc.id?null:loc.id);}}><span/><span/><span/></button>
          </div>
        </div>
        {openMenu===loc.id&&<div className="mini-menu" style={{right:8,top:44}}>
          <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editLocation",{location:loc});}}>Edit</button>
          <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);update(d=>{d.locations=d.locations.filter(l=>l.id!==loc.id);return d;});}}>Delete</button>
        </div>}
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {loc.sublocations.map(sl=>(<span key={sl.id} className="bdg bs">{sl.name}</span>))}
          {!loc.sublocations.length&&<span style={{fontSize:12,color:"var(--td)"}}>No areas yet</span>}
        </div>
      </div>))}
    </div>}
    {libTab==="equipment"&&<div style={{padding:"0 16px"}} onClick={()=>setOpenMenu(null)}>
      <EquipmentTab data={data} update={update} openModal={openModal}/>
    </div>}
  </div>);
}
