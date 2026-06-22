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

export function StationConfig({act,team,loc,onChange,onSt,onDone,assets,update}){
  const rotate=act.rotate!==false;
  const [randGroups,setRandGroups]=useState(null);
  const players=team?team.players:[];
  const genRand=()=>{
    const n=act.stations.length;
    const shuffled=[...players].sort(()=>Math.random()-.5);
    const groups=Array.from({length:n},()=>[]);
    shuffled.forEach((p,i)=>groups[i%n].push(p.id));
    setRandGroups(groups);
  };
  const applyRand=()=>{
    if(!randGroups)return;
    const newSts=act.stations.map((st,i)=>Object.assign({},st,{assignments:randGroups[i]||[]}));
    onChange({stations:newSts});
    setRandGroups(null);
  };
  return (<div>
    <div className="g2">
      <div className="fld"><label className="lbl">Station (min)</label><DurStepper value={act.stationDuration} min={1} onChange={v=>onChange({stationDuration:v})}/></div>
      {rotate&&<div className="fld"><label className="lbl">Transition (min)</label><DurStepper value={act.transitionDuration} min={0} onChange={v=>onChange({transitionDuration:v})}/></div>}
    </div>
    <div className="fld"><label className="lbl"><input type="checkbox" checked={rotate} onChange={e=>onChange({rotate:e.target.checked})} style={{marginRight:6}}/>Players rotate between stations</label></div>
    {act.stations.map((st,si)=>(<div key={st.id} className="card mb8" style={{background:"var(--s1)"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,marginBottom:8}}>Station {si+1}</div>
      <div className="fld"><label className="lbl">Drill</label>
        <select className="sel" value={st.activityId||""} onChange={e=>{const found=e.target.value;const match=(assets||[]).find(a=>a.id===found);onSt(st.id,{activityId:found,activityName:found&&match?match.name:""});}}>
          <option value="">Custom</option>
        </select>
      </div>
      <div className="fld"><label className="lbl">Name</label><input className="inp" value={st.activityName||""} onChange={e=>onSt(st.id,{activityName:e.target.value})}/></div>
      {team&&<div className="fld"><label className="lbl">Coach</label><select className="sel" value={st.coachId||""} onChange={e=>onSt(st.id,{coachId:e.target.value,coachName:(team.coaches.find(c=>c.id===e.target.value)||{}).name||""})}><option value="">Unassigned</option>{team.coaches.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
      {loc&&loc.sublocations&&loc.sublocations.length>0&&<div className="fld"><label className="lbl">Area</label><select className="sel" value={st.sublocationId||""} onChange={e=>onSt(st.id,{sublocationId:e.target.value})}><option value="">Any</option>{loc.sublocations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
      <div className="fld"><label className="lbl">Coaching Points</label><textarea className="ta" style={{minHeight:40}} value={st.coachingPoints||""} onChange={e=>onSt(st.id,{coachingPoints:e.target.value})}/></div>
      {players.length>0&&(<div className="fld"><label className="lbl">Players</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {players.map(p=>{
            const assigned=(st.assignments||[]).includes(p.id);
            const inOther=!assigned&&act.stations.some((s2,i2)=>i2!==si&&(s2.assignments||[]).includes(p.id));
            return (<button key={p.id} type="button" onClick={()=>{
              if(assigned){onSt(st.id,{assignments:(st.assignments||[]).filter(x=>x!==p.id)});}
              else if(inOther){const newSts=act.stations.map(s2=>Object.assign({},s2,{assignments:(s2.assignments||[]).filter(x=>x!==p.id)}));newSts[si]=Object.assign({},newSts[si],{assignments:[...(newSts[si].assignments||[]),p.id]});onChange({stations:newSts});}
              else{onSt(st.id,{assignments:[...(st.assignments||[]),p.id]});}
            }} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid",borderColor:assigned?"var(--green)":inOther?"var(--b)":"var(--b)",background:assigned?"var(--green)":inOther?"var(--s2)":"var(--s1)",color:assigned?"#fff":inOther?"var(--td)":"var(--black)",fontSize:13,cursor:"pointer",opacity:inOther?0.6:1}}>
              {p.jersey&&<span style={{fontFamily:"DM Mono,monospace",fontSize:11,marginRight:3}}>#{p.jersey}</span>}{p.firstName}
            </button>);
          })}
        </div>
      </div>)}
    </div>))}
    {players.length>0&&(
      <div className="card mb8" style={{background:"var(--s1)"}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,marginBottom:8}}>Random Groups</div>
        {!randGroups&&<button className="btn ghost bsm bfull" onClick={genRand}>Generate Random Groups</button>}
        {randGroups&&(<div>
          <div className="gpreview">
            {randGroups.map((g,i)=>(<div key={i} className="gcard">
              <div className="gcardtitle">Station {i+1}</div>
              {g.map(pid=>{const p=players.find(x=>x.id===pid);return p?<div key={pid} className="gplayer">{p.firstName}</div>:null;})}
            </div>))}
          </div>
          <div className="brow mt8"><button className="btn ghost bsm" onClick={genRand}>Reshuffle</button><button className="btn primary bsm" onClick={applyRand}>Apply</button></div>
          <button className="btn ghost bsm bfull mt6" onClick={()=>setRandGroups(null)}>Cancel</button>
        </div>)}
      </div>
    )}
    <button className="btn ghost bsm bfull mt8" onClick={onDone}>Done</button>
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
          <span className="dh"><Ic_Dots/></span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{font:"700 14px Barlow Condensed,sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{act.type==="station_block"?"Station Block":act.name}</div>
            <div className="limt">{act.type==="station_block"?act.stations.map(s=>s.activityName||s.name).join(" / ")+" - "+act.stationDuration+"m each":act.duration+"min"}</div>
          </div>
          <div className="row">
            {act.type!=="station_block"&&<span className="bdg bp">{act.duration}m</span>}
            <button className="btn danger bxs" onClick={e=>{e.stopPropagation();remAct(act.id);}}>x</button>
          </div>
        </div>
        {expandedId===act.id&&(<div className="abbody">
          {act.type==="activity"&&<ActConfig assets={data.assets} update={update} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
          {act.type==="checklist"&&<ChecklistConfig act={act} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
          {act.type==="station_block"&&<StationConfig assets={data.assets} update={update} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)}/>}
        </div>)}
      </div>
    </div>))}
    <div style={{marginTop:12}}>
      {isEdit&&<div className="brow">
        <button className="btn ghost bmd" onClick={onBack}>Cancel</button>
        <button className="btn primary bmd" onClick={handleSave}>{saved?"Saved":"Save Template"}</button>
      </div>}
      {!isEdit&&<button className="btn primary bxl bfull" onClick={handleRun}>Run Now</button>}
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
      <div className="sechdr mb10"><span className="sectitle">{data.assets.length} Items</span><button className="btn primary bsm" onClick={()=>openModal("addAsset")}>+ Add</button></div>
      {data.assets.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No equipment yet.</div>}
      {data.assets.map(a=>(<div key={a.id} className="li" style={{position:"relative",marginBottom:6}}>
        <div className="lim">
          <div className="lin">{a.name}</div>
          {a.locationTags&&a.locationTags.length>0&&<div className="limt">{a.locationTags.map(lid=>{const l=data.locations.find(l=>l.id===lid);return l?l.name:null;}).filter(Boolean).join(", ")}</div>}
        </div>
        <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===a.id?null:a.id);}}><span/><span/><span/></button>
        {openMenu===a.id&&<div className="mini-menu">
          <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editAsset",{asset:a});}}>Edit</button>
          <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);update(d=>{d.assets=d.assets.filter(x=>x.id!==a.id);return d;});}}>Delete</button>
        </div>}
      </div>))}
    </div>}
  </div>);
}
