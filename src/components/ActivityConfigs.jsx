import React, { useState } from "react";
import { uid } from "../constants.js";

function DurStepper({value,min,onChange,step}){
  const s=step||1;const mn=min||1;
  return (<div style={{display:"flex",alignItems:"center",gap:0,border:"1.5px solid var(--b)",borderRadius:"var(--rs)",overflow:"hidden",background:"#fff"}}>
    <button onClick={()=>onChange(Math.max(mn,value-s))} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>-</button>
    <div style={{flex:1,textAlign:"center",fontFamily:"DM Mono,monospace",fontSize:15,fontWeight:600,color:"var(--black)"}}>{value}m</div>
    <button onClick={()=>onChange(value+s)} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
  </div>);
}

export function ActConfig({act,team,loc,onChange,onDone,assets,update}){
  const teamEquip=(assets||[]).filter(a=>!a.type||a.type==="team");
  const sport=act.sport||"General";
  const playerGearAssets=(assets||[]).filter(a=>a.type==="player"&&(a.sport===sport||a.sport==="General"||sport==="General"));
  return (<div>
    <div className="fld"><label className="lbl">Name</label><input className="inp" value={act.name} onChange={e=>onChange({name:e.target.value})}/></div>
    <div className="fld"><label className="lbl">Duration (min)</label><DurStepper value={act.duration||10} min={1} onChange={v=>onChange({duration:v})}/></div>
    <div className="fld"><label className="lbl">Coaching Points</label><textarea className="ta" value={act.coachingPoints||""} onChange={e=>onChange({coachingPoints:e.target.value})}/></div>
    {team&&<div className="fld"><label className="lbl">Coach</label><select className="sel" value={act.coachId||""} onChange={e=>onChange({coachId:e.target.value,coachName:(team.coaches.find(c=>c.id===e.target.value)||{}).name||""})}><option value="">Unassigned</option>{team.coaches.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
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
        {teamEquip.map(a=>(<button key={a.id} type="button" onClick={()=>{const cur=Array.isArray(act.equipment)?act.equipment:[];const has=cur.includes(a.id);onChange({equipment:has?cur.filter(x=>x!==a.id):[...cur,a.id]});}} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:(Array.isArray(act.equipment)&&act.equipment.includes(a.id))?"var(--green)":"var(--s1)",color:(Array.isArray(act.equipment)&&act.equipment.includes(a.id))?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>))}
        {teamEquip.length===0&&<span style={{fontSize:12,color:"var(--td)"}}>No team equipment in library yet</span>}
      </div>
      <div style={{display:"flex",gap:6}}>
        <input className="inp" placeholder="Add new equipment..." id="actcfg-equip-inp" style={{flex:1}}/>
        <button type="button" className="btn ghost bxs" onClick={()=>{const el=document.getElementById("actcfg-equip-inp");if(!el||!el.value.trim())return;const nm=el.value.trim();const newId=uid();if(update)update(d=>{d.assets.push({id:newId,name:nm,type:"team",sport:"General",locationTags:[]});return d;});const cur=Array.isArray(act.equipment)?act.equipment:[];onChange({equipment:[...cur,newId]});el.value="";}}>Add</button>
      </div>
    </div>
    {/* Player Gear */}
    {playerGearAssets.length>0&&<div className="fld"><label className="lbl">Player Gear Needed</label>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
        {playerGearAssets.map(a=>{const sel=(act.playerGear||"").split(",").map(s=>s.trim()).includes(a.name);return(<button key={a.id} type="button" onClick={()=>{const cur=(act.playerGear||"").split(",").map(s=>s.trim()).filter(Boolean);const next=sel?cur.filter(x=>x!==a.name):[...cur,a.name];onChange({playerGear:next.join(", ")});}} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:sel?"var(--green)":"var(--s1)",color:sel?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>);})}
      </div>
    </div>}
    {playerGearAssets.length===0&&<div className="fld"><label className="lbl">Player Gear Needed</label>
      <div style={{fontSize:12,color:"var(--td)",marginBottom:4}}>No player gear set up for {sport} yet. Add from Library → Equipment → Player Gear.</div>
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

export function StationConfig({act,team,loc,onChange,onSt,onDone,assets,update,teamSport}){
  const rotate=act.rotate!==false;
  const [newEquipIdx,setNewEquipIdx]=useState(null);
  const [newGearIdx,setNewGearIdx]=useState(null);
  const sport=teamSport||"General";
  const players=team?team.players:[];
  const teamEquipAssets=(assets||[]).filter(a=>!a.type||a.type==="team");
  const playerGearAssets=(assets||[]).filter(a=>a.type==="player"&&(a.sport===sport||a.sport==="General"||sport==="General"));

  const genRandom=()=>{
    const n=act.stations.length;
    const shuffled=[...players].sort(()=>Math.random()-.5);
    const groups=Array.from({length:n},()=>[]);
    shuffled.forEach((p,i)=>groups[i%n].push(p.id));
    onChange({stations:act.stations.map((st,i)=>Object.assign({},st,{assignments:groups[i]||[]}))});
  };
  const clearGroups=()=>onChange({stations:act.stations.map(st=>Object.assign({},st,{assignments:[]}))});
  const addStation=()=>{
    const n=act.stations.length+1;
    onChange({stations:[...act.stations,{id:uid(),name:"Station "+n,activityName:"",coachId:"",coachName:"",sublocationId:"",equipment:[],playerGear:"",coachingPoints:"",assignments:[]}]});
  };
  const removeStation=si=>{if(act.stations.length<=1)return;onChange({stations:act.stations.filter((_,i)=>i!==si)});};
  const handleChip=(si,p)=>{
    const st=act.stations[si];
    const assigned=(st.assignments||[]).includes(p.id);
    if(assigned){onSt(st.id,{assignments:(st.assignments||[]).filter(x=>x!==p.id)});}
    else{const newSts=act.stations.map((s2,i2)=>{if(i2===si)return Object.assign({},s2,{assignments:[...(s2.assignments||[]),p.id]});return Object.assign({},s2,{assignments:(s2.assignments||[]).filter(x=>x!==p.id)});});onChange({stations:newSts});}
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
    {players.length>0&&<div className="brow mb10">
      <button className="btn outline bmd" style={{flex:1}} onClick={genRandom}>Generate Random Groups</button>
      <button className="btn ghost bmd" style={{flex:1}} onClick={clearGroups}>Clear Groups</button>
    </div>}
    {act.stations.map((st,si)=>{
      const stEquip=Array.isArray(st.equipment)?st.equipment:[];
      return(<div key={st.id} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 12px 10px",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:900,color:"var(--green)",letterSpacing:".05em"}}>STATION {si+1}</div>
          {act.stations.length>1&&<button type="button" onClick={()=>removeStation(si)} style={{background:"none",border:"none",color:"var(--td)",fontSize:12,cursor:"pointer",padding:"2px 6px"}}>Remove</button>}
        </div>
        <div className="fld"><label className="lbl">Name</label><input className="inp" value={st.activityName||st.name||""} onChange={e=>onSt(st.id,{activityName:e.target.value,name:e.target.value})}/></div>
        {team&&team.coaches.length>0&&<div className="fld"><label className="lbl">Coach</label>
          <select className="sel" value={st.coachId||""} onChange={e=>{const c=team.coaches.find(c=>c.id===e.target.value);onSt(st.id,{coachId:e.target.value,coachName:c?c.name:""});}}>
            <option value="">Unassigned</option>{team.coaches.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>}
        {loc&&loc.sublocations&&loc.sublocations.length>0&&<div className="fld"><label className="lbl">Area</label>
          <select className="sel" value={st.sublocationId||""} onChange={e=>onSt(st.id,{sublocationId:e.target.value})}>
            <option value="">Any</option>{loc.sublocations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>}
        <div className="fld"><label className="lbl">Coaching Points</label><textarea className="ta" style={{minHeight:40}} value={st.coachingPoints||""} onChange={e=>onSt(st.id,{coachingPoints:e.target.value})}/></div>
        <div className="fld"><label className="lbl">Equipment</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
            {teamEquipAssets.map(a=>(<button key={a.id} type="button" onClick={()=>{const has=stEquip.includes(a.id);onSt(st.id,{equipment:has?stEquip.filter(x=>x!==a.id):[...stEquip,a.id]});}} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:stEquip.includes(a.id)?"var(--green)":"#fff",color:stEquip.includes(a.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>))}
            {teamEquipAssets.length===0&&<span style={{fontSize:12,color:"var(--td)"}}>No team equipment in library</span>}
          </div>
          {newEquipIdx===si?<div style={{display:"flex",gap:6}}>
            <input className="inp" style={{flex:1}} placeholder="Equipment name..." id={"new-st-equip-"+si} autoFocus/>
            <button type="button" className="btn ghost bxs" onClick={()=>{const el=document.getElementById("new-st-equip-"+si);if(!el||!el.value.trim())return;const nm=el.value.trim();const newId=uid();if(update)update(d=>{d.assets.push({id:newId,name:nm,type:"team",sport:"General",locationTags:[]});return d;});onSt(st.id,{equipment:[...stEquip,newId]});setNewEquipIdx(null);}}>Add</button>
            <button type="button" className="btn ghost bxs" onClick={()=>setNewEquipIdx(null)}>✕</button>
          </div>:<button type="button" className="btn ghost bxs" onClick={()=>setNewEquipIdx(si)}>+ New</button>}
        </div>
        {(playerGearAssets.length>0||newGearIdx===si)&&<div className="fld"><label className="lbl">Player Gear Needed</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
            {playerGearAssets.map(a=>{const gearList=(st.playerGear||"").split(",").map(s=>s.trim()).filter(Boolean);const sel=gearList.includes(a.name);return(<button key={a.id} type="button" onClick={()=>{const cur=gearList;const next=sel?cur.filter(x=>x!==a.name):[...cur,a.name];onSt(st.id,{playerGear:next.join(", ")});}} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:sel?"var(--green)":"#fff",color:sel?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>);})}
          </div>
          {newGearIdx===si?<div style={{display:"flex",gap:6}}>
            <input className="inp" style={{flex:1}} placeholder="Gear name..." id={"new-st-gear-"+si} autoFocus/>
            <button type="button" className="btn ghost bxs" onClick={()=>{const el=document.getElementById("new-st-gear-"+si);if(!el||!el.value.trim())return;const nm=el.value.trim();const newId=uid();if(update)update(d=>{d.assets.push({id:newId,name:nm,type:"player",sport,locationTags:[]});return d;});const cur=(st.playerGear||"").split(",").map(s=>s.trim()).filter(Boolean);onSt(st.id,{playerGear:[...cur,nm].join(", ")});setNewGearIdx(null);}}>Add</button>
            <button type="button" className="btn ghost bxs" onClick={()=>setNewGearIdx(null)}>✕</button>
          </div>:<button type="button" className="btn ghost bxs" onClick={()=>setNewGearIdx(si)}>+ New Gear</button>}
        </div>}
        {playerGearAssets.length===0&&newGearIdx!==si&&<div className="fld">
          <label className="lbl">Player Gear Needed</label>
          <div style={{fontSize:12,color:"var(--td)",marginBottom:4}}>No player gear for {sport} yet.</div>
          <button type="button" className="btn ghost bxs" onClick={()=>setNewGearIdx(si)}>+ Add Gear</button>
        </div>}
        {players.length>0&&<div className="fld"><label className="lbl">Players</label>
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
