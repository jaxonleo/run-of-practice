import React, { useState, useEffect, useRef } from "react";
import { uid, sumMins } from "../constants.js";
import { ActConfig, ChecklistConfig, StationConfig } from "./ActivityConfigs.jsx";
import { createAsset, updateAsset, archiveAsset, archiveDrill, setDrillShare, copyDrillToMyLibrary, archiveLocation, savePracticeTree, saveTemplateTree, archiveTemplate } from "../supabase.js";

// ── Local icon subset needed by this screen ───────────────────────────────────
const Ic_Dots=()=><svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="4" cy="3.5" r="1.4"/><circle cx="10" cy="3.5" r="1.4"/><circle cx="4" cy="7" r="1.4"/><circle cx="10" cy="7" r="1.4"/><circle cx="4" cy="10.5" r="1.4"/><circle cx="10" cy="10.5" r="1.4"/></svg>;
const Ic_Chev=({up})=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points={up?"4 10 8 6 12 10":"4 6 8 10 12 6"}/></svg>;

// ── ActConfig, ChecklistConfig, StationConfig ─────────────────────────────────
// (kept here since they are only used inside Library/Builder/TemplateWorkspace)

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
function EquipmentTab({data,coachId,refreshLibrary,openModal}){
  const [equipTab,setEquipTab]=useState("team");
  const [openMenu,setOpenMenu]=useState(null);
  const [newName,setNewName]=useState("");
  const [newSport,setNewSport]=useState("General");
  const [showAdd,setShowAdd]=useState(false);
  const [collapsed,setCollapsed]=useState({});
  const teamAssets=(data.assets||[]).filter(a=>!a.type||a.type==="team");
  const playerAssets=(data.assets||[]).filter(a=>a.type==="player");
  const addNew=async()=>{
    if(!newName.trim())return;
    await createAsset(coachId,{name:newName.trim(),type:equipTab,sport:equipTab==="player"?newSport:"General"});
    await refreshLibrary();
    setNewName("");setShowAdd(false);
  };
  const del=async id=>{await archiveAsset(id);await refreshLibrary();};
  return(<div onClick={()=>setOpenMenu(null)}>
    {/* Toggle */}
    <div style={{display:"flex",gap:0,background:"var(--s2)",borderRadius:"var(--r)",padding:3,marginBottom:16}}>
      {["team","player"].map(t=>(<button key={t} onClick={()=>{setEquipTab(t);setShowAdd(false);}} style={{flex:1,padding:"8px 0",border:"none",cursor:"pointer",borderRadius:"calc(var(--r) - 2px)",background:equipTab===t?"#fff":"transparent",fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".03em",textTransform:"uppercase",color:equipTab===t?"var(--black)":"var(--td)"}}>{t==="team"?"Team Equipment":"Player Gear"}</button>))}
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

// ── TemplateWorkspace ─────────────────────────────────────────────────────────
// team/players/coach assignment is deliberately NOT shown while editing a
// template (team={null} passed to ActConfig/StationConfig below) -- templates
// aren't team-scoped in the new schema (reusable across every team a coach
// coaches), so there's nowhere to persist a specific coach or player
// assignment at the template level, only sublocation (coach/org-owned, not
// team-owned). teamId here is pure local UI state: which team's roster to
// preview against and which team a practice defaults to when run/scheduled
// from this template.
function TemplateWorkspace({data,template,onRun,onBack,openModal,coachId,refreshLibrary,refreshPlanning}){
  const [name,setName]=useState(template.name);
  const [sport,setSport]=useState(template.sport||"General");
  const [teamId,setTeamId]=useState(()=>{
    const match=data.teams.find(t=>(t.sport||"General")===template.sport);
    return match?match.id:(data.teams[0]?data.teams[0].id:"");
  });
  const [locId,setLocId]=useState(()=>template.locationId||(data.locations[0]?data.locations[0].id:""));
  const [acts,setActs]=useState(()=>JSON.parse(JSON.stringify(template.activities||[])));
  const [existingId,setExistingId]=useState(template.id);
  const [expandedId,setExpandedId]=useState(null);
  const [savedMsg,setSavedMsg]=useState(null);
  const [newTplName,setNewTplName]=useState("");
  const [showNewTpl,setShowNewTpl]=useState(false);
  const [schedMode,setSchedMode]=useState(false);
  const [schedDate,setSchedDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [schedTime,setSchedTime]=useState("16:00");
  const team=data.teams.find(t=>t.id===teamId)||null;
  const loc=data.locations.find(l=>l.id===locId)||null;
  const updAct=(id,ch)=>setActs(p=>p.map(a=>a.id===id?Object.assign({},a,ch):a));
  const updSt=(aid,sid,ch)=>setActs(p=>p.map(a=>a.id===aid?Object.assign({},a,{stations:a.stations.map(s=>s.id===sid?Object.assign({},s,ch):s)}):a));
  const remAct=id=>setActs(p=>p.filter(a=>a.id!==id));
  const equipNames=ids=>(Array.isArray(ids)?ids:[]).map(id=>{const a=data.assets.find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);

  const handleRun=async()=>{
    const now=new Date();
    const dateStr=now.toISOString().slice(0,10);
    const timeStr=now.toTimeString().slice(0,5);
    const {data:saved}=await savePracticeTree(null,{teamId,locationId:locId,date:dateStr,startTime:timeStr,activities:acts});
    await refreshPlanning();
    if(saved&&onRun)onRun(saved.id);
  };

  const handleSave=async()=>{
    const {data:saved}=await saveTemplateTree(coachId,existingId,{name,sport,locationId:locId,activities:acts});
    if(saved)setExistingId(saved.id);
    await refreshPlanning();
    setSavedMsg("Template saved!");
    setTimeout(()=>setSavedMsg(null),2000);
  };

  const handleSaveAsNew=async()=>{
    if(!newTplName.trim())return;
    await saveTemplateTree(coachId,null,{name:newTplName.trim(),sport,locationId:locId,activities:acts});
    await refreshPlanning();
    setSavedMsg("Saved as \""+newTplName.trim()+"\"!");
    setShowNewTpl(false);setNewTplName("");
    setTimeout(()=>setSavedMsg(null),2000);
  };

  const handleSchedule=async()=>{
    if(!schedDate)return;
    const {data:saved}=await savePracticeTree(null,{teamId,locationId:locId,date:schedDate,startTime:schedTime,activities:acts});
    await refreshPlanning();
    const [mo,da,yr]=[schedDate.slice(5,7),schedDate.slice(8,10),schedDate.slice(0,4)];
    const st=schedTime.split(":");const sh=parseInt(st[0]);const sm=st[1];const sampm=sh>=12?"PM":"AM";const s12=(sh%12||12)+":"+sm+" "+sampm;
    setSavedMsg(saved?("Scheduled for "+mo+"-"+da+"-"+yr+" at "+s12+"!"):"Something went wrong.");
    setSchedMode(false);
    setTimeout(()=>{setSavedMsg(null);onBack();},1500);
  };

  return (<div style={{paddingBottom:100}}>
    {/* Header */}
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
      <button className="btn ghost bxs" onClick={onBack}>Back</button>
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
          <select className="sel" value={teamId} onChange={e=>setTeamId(e.target.value)}>
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

    {acts.map((act,i)=>(<div key={act.id}>
      <div className="ablk">
        <div className="abhdr" onClick={()=>setExpandedId(expandedId===act.id?null:act.id)}>
          <div style={{display:"flex",flexDirection:"column",gap:2,marginRight:6,flexShrink:0}}>
            <button onClick={e=>{e.stopPropagation();if(i>0)setActs(p=>{const a=[...p];[a[i-1],a[i]]=[a[i],a[i-1]];return a;});}} disabled={i===0} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",color:i===0?"var(--s3)":"var(--td)",fontSize:14,lineHeight:1}}>&#8593;</button>
            <button onClick={e=>{e.stopPropagation();if(i<acts.length-1)setActs(p=>{const a=[...p];[a[i],a[i+1]]=[a[i+1],a[i]];return a;});}} disabled={i===acts.length-1} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",color:i===acts.length-1?"var(--s3)":"var(--td)",fontSize:14,lineHeight:1}}>&#8595;</button>
          </div>
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
          {act.type==="activity"&&<ActConfig assets={data.assets} coachId={coachId} refreshLibrary={refreshLibrary} act={act} team={null} loc={loc} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
          {act.type==="checklist"&&<ChecklistConfig act={act} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
          {act.type==="station_block"&&<StationConfig assets={data.assets} coachId={coachId} refreshLibrary={refreshLibrary} act={act} team={null} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)} teamSport={sport} libraryDrills={data.activityLibrary}/>}
        </div>)}
      </div>
    </div>))}

    {/* Add drills panel — same as builder */}
    <div style={{borderTop:"1px solid var(--b)",paddingTop:14,marginTop:8}}>
      <div className="sechdr mb8">
        <span className="sectitle">Add to Template</span>
        <button className="btn ghost bxs" onClick={()=>openModal&&openModal("addActivity")}>+ New Drill</button>
      </div>
      <div className="g2" style={{marginBottom:6}}>
        <div className="li tap" style={{marginBottom:0}} onClick={()=>{const id=uid();setActs(p=>[...p,{id,type:"checklist",name:"Intro",items:[],notes:"",duration:5}]);}}>
          <div className="lim"><div className="lin">Intro</div><div className="limt">Checklist</div></div>
          <span style={{color:"var(--green)",fontSize:18,fontWeight:700}}>+</span>
        </div>
        <div className="li tap" style={{marginBottom:0}} onClick={()=>{const id=uid();setActs(p=>[...p,{id,type:"checklist",name:"Closer",items:[],notes:"",duration:5}]);}}>
          <div className="lim"><div className="lin">Closer</div><div className="limt">Checklist</div></div>
          <span style={{color:"var(--green)",fontSize:18,fontWeight:700}}>+</span>
        </div>
      </div>
      <div className="li tap" style={{marginBottom:6,background:"var(--gbg)",borderColor:"var(--gb)"}} onClick={()=>{
        const b={id:uid(),type:"station_block",rotate:true,stationDuration:10,transitionDuration:2,stations:[
          {id:uid(),name:"Station 1",activityName:"",coachId:"",sublocationId:"",assignments:[],coachingPoints:"",equipment:[],playerGear:""},
          {id:uid(),name:"Station 2",activityName:"",coachId:"",sublocationId:"",assignments:[],coachingPoints:"",equipment:[],playerGear:""},
        ]};
        setActs(p=>[...p,b]);setExpandedId(b.id);
      }}>
        <div className="lim"><div className="lin" style={{color:"var(--green)"}}>Station Block</div><div className="limt">2 stations, add or remove as needed</div></div>
        <span style={{color:"var(--green)",fontSize:22,fontWeight:700,flexShrink:0}}>+</span>
      </div>
      {(()=>{
        const tplSport=sport||"General";
        const filtered=(data.activityLibrary||[]).filter(a=>(a.sport||"General")===tplSport||(a.sport||"General")==="General");
        if(filtered.length===0)return(<div style={{padding:"16px 0",textAlign:"center",color:"var(--td)",fontSize:13}}>No drills in library for {tplSport} yet.</div>);
        return(<div>
          <div className="clbl" style={{marginBottom:8}}>{tplSport} + General</div>
          {filtered.map(lib=>(<div key={lib.id} className="li tap" onClick={()=>{setActs(p=>[...p,{id:uid(),type:"activity",libraryId:lib.id,name:lib.name,duration:lib.duration,assignments:[],coachId:"",sublocationId:"",notes:"",description:lib.description||"",coachingPoints:lib.coachingPoints||"",grouping:lib.grouping||"whole",numGroups:lib.numGroups||2,playerGear:lib.playerGear||"",equipment:Array.isArray(lib.equipment)?lib.equipment:[]}]);}}>
            <div className="lim">
              <div className="lin">{lib.name}</div>
              <div className="limt">{lib.duration}min{lib.description?" - "+lib.description:""}</div>
              {lib.coachingPoints&&<div style={{fontSize:11,color:"var(--green2)",marginTop:2}}>{lib.coachingPoints}</div>}
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

    {/* Schedule overlay - fixed so it's always visible */}
    {schedMode&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:100,display:"flex",alignItems:"flex-end"}} onClick={()=>setSchedMode(false)}>
      <div style={{background:"#fff",width:"100%",maxWidth:480,margin:"0 auto",borderRadius:"20px 20px 0 0",padding:"24px 20px 40px"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:36,height:4,background:"var(--b)",borderRadius:2,margin:"0 auto 20px"}}/>
        <div className="clbl mb10">Schedule Practice</div>
        <div className="g2">
          <div className="fld"><label className="lbl">Date</label><input className="inp" type="date" value={schedDate} onChange={e=>setSchedDate(e.target.value)}/></div>
          <div className="fld"><label className="lbl">Start Time</label><input className="inp" type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)}/></div>
        </div>
        <div style={{fontSize:12,color:"var(--td)",marginBottom:16}}>Saves to your calendar. Share a setup link from the practice detail.</div>
        <div className="brow">
          <button className="btn ghost bmd" style={{flex:1}} onClick={()=>setSchedMode(false)}>Cancel</button>
          <button className="btn primary bmd" style={{flex:1}} onClick={handleSchedule} disabled={!schedDate}>Schedule</button>
        </div>
      </div>
    </div>}

    {/* Bottom action bar */}
    {!showNewTpl&&<div style={{position:"fixed",bottom:"calc(var(--tab))",left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#fff",borderTop:"1px solid var(--b)",padding:"10px 14px",zIndex:50}}>
      <button className="btn primary bxl bfull" style={{marginBottom:8,height:52,fontSize:17}} onClick={handleRun}>Run Now</button>
      <div className="brow">
        <button className="btn ghost bmd" style={{flex:1}} onClick={()=>setSchedMode(true)}>Schedule</button>
        <button className="btn ghost bmd" style={{flex:1}} onClick={handleSave}>Save Template</button>
        <button className="btn outline bmd" style={{flex:1}} onClick={()=>setShowNewTpl(true)}>Save as New</button>
      </div>
    </div>}
  </div>);
}

// ── NewLibraryScreen ──────────────────────────────────────────────────────────
export default function NewLibraryScreen({data,openModal,setView,setLiveId,launchRun,setEditPracticeId,refreshLibrary,coachId,refreshPlanning}){
  const [libTab,setLibTab]=useState("drills");
  useEffect(()=>{window.__ropLibTab=setLibTab;return()=>{delete window.__ropLibTab;};},[]);
  const [openMenu,setOpenMenu]=useState(null);
  const [editingTpl,setEditingTpl]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const [collapsed,setCollapsed]=useState({});
  const [drillMenu,setDrillMenu]=useState(null);
  const [shelf,setShelf]=useState("mine");
  const [shareMenuId,setShareMenuId]=useState(null);
  const [copyingId,setCopyingId]=useState(null);
  const toggle=sport=>setCollapsed(c=>Object.assign({},c,{[sport]:!c[sport]}));
  const myOrgs=data.myOrgs||[];
  const shelves=[{key:"mine",label:"My Library"},...myOrgs.flatMap(org=>[{key:"orgLib:"+org.id,label:org.name+" Library",org},{key:"shared:"+org.id,label:"From "+org.name,org}])];
  const shelfDrills=(()=>{
    if(shelf==="mine")return (data.activityLibrary||[]).filter(a=>a.ownerUserId===coachId);
    if(shelf.startsWith("orgLib:")){const orgId=shelf.slice(7);return (data.activityLibrary||[]).filter(a=>a.organizationId===orgId);}
    if(shelf.startsWith("shared:")){const orgId=shelf.slice(7);return (data.activityLibrary||[]).filter(a=>a.sharedWithOrganizationId===orgId&&a.ownerUserId!==coachId);}
    return [];
  })();
  const isMine=shelf==="mine";
  const sports=[...new Set(shelfDrills.map(a=>a.sport||"General").filter(Boolean))].sort();
  const assetsById=Object.fromEntries((data.assets||[]).map(a=>[a.id,a]));
  const equipNames=ids=>(ids||[]).map(id=>assetsById[id]?assetsById[id].name:null).filter(Boolean);
  const doShare=async(drillId,orgId)=>{await setDrillShare(drillId,orgId);setShareMenuId(null);await refreshLibrary();};
  const doCopy=async(drill)=>{setCopyingId(drill.id);await copyDrillToMyLibrary(coachId,drill,assetsById);await refreshLibrary();setCopyingId(null);};
  const templates=data.templates||[];
  const LTABS=["drills","templates","locations","equipment"];
  if(editingTpl)return (<div style={{paddingBottom:80}}><TemplateWorkspace data={data} template={editingTpl} openModal={openModal} coachId={coachId} refreshLibrary={refreshLibrary} refreshPlanning={refreshPlanning} onRun={practiceId=>{setLiveId(practiceId);setView("command");}} onBack={()=>setEditingTpl(null)}/></div>);
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
    {libTab==="drills"&&<div style={{padding:"0 16px"}} onClick={()=>{setDrillMenu(null);setShareMenuId(null);}}>
      {shelves.length>1&&<div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:12,paddingBottom:2}}>
        {shelves.map(s=>(<button key={s.key} onClick={()=>setShelf(s.key)} style={{flexShrink:0,padding:"6px 12px",borderRadius:20,border:"1.5px solid var(--b)",background:shelf===s.key?"var(--green)":"var(--s1)",color:shelf===s.key?"#fff":"var(--black)",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{s.label}</button>))}
      </div>}
      {isMine&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}><button className="btn primary bsm" onClick={()=>openModal("addActivity")}>+ Add Drill</button></div>}
      {shelfDrills.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>{isMine?"No drills yet. Tap + Add Drill.":"Nothing here yet."}</div>}
      {sports.map(sport=>(<div key={sport} style={{marginBottom:8}}>
        <button onClick={()=>toggle(sport)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"var(--s1)",border:"none",borderRadius:"var(--r)",cursor:"pointer"}}>
          <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700}}>{sport}</span>
          <span style={{fontSize:12,color:"var(--td)"}}>{shelfDrills.filter(a=>(a.sport||"General")===sport).length} drills {collapsed[sport]?"":"v"}</span>
        </button>
        {!collapsed[sport]&&(()=>{
          const sportDrills=shelfDrills.filter(a=>(a.sport||"General")===sport).slice().sort((a,b)=>a.name.localeCompare(b.name));
          return sportDrills.map(act=>(<div key={act.id} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 12px",borderBottom:"1px solid var(--b)",background:"#fff"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                <span style={{fontWeight:700,fontSize:14}}>{act.name}</span>
                {isMine&&act.sharedWithOrganizationId&&<span className="bdg bp" style={{fontSize:10}}>Shared</span>}
              </div>
              {act.description&&<div style={{fontSize:12,color:"var(--td)",marginBottom:2,lineHeight:1.4}}>{act.description}</div>}
              {act.coachingPoints&&<div style={{fontSize:12,color:"var(--td)",marginBottom:2}}>{act.coachingPoints}</div>}
              {act.equipment&&act.equipment.length>0&&<div style={{fontSize:11,color:"var(--td)",marginTop:2}}>Needs: {equipNames(act.equipment).join(", ")}</div>}
              {act.grouping&&act.grouping!=="whole"&&<div style={{fontSize:11,color:"var(--td)",marginTop:2}}>{act.grouping==="partners"?"Partners":act.numGroups+" groups"}</div>}
              {!isMine&&<div style={{fontSize:11,color:"var(--green2)",marginTop:4}}>Shared by {(data.profilesById&&data.profilesById[act.ownerUserId]&&data.profilesById[act.ownerUserId].name)||"a coach"}</div>}
              {!isMine&&shelf.startsWith("shared:")&&<button className="btn outline bxs" style={{marginTop:6}} onClick={()=>doCopy(act)} disabled={copyingId===act.id}>{copyingId===act.id?"Copying...":"Copy to My Library"}</button>}
            </div>
            {isMine&&<div style={{position:"relative",flexShrink:0}}>
              <button className="ell-btn" onClick={e=>{e.stopPropagation();setDrillMenu(drillMenu===act.id?null:act.id);setShareMenuId(null);}}><span/><span/><span/></button>
              {drillMenu===act.id&&<div className="mini-menu" style={{right:0,minWidth:140}}>
                <button className="mm-item" onClick={()=>{setDrillMenu(null);openModal("editActivity",{activity:act});}}>Edit</button>
                {myOrgs.length>0&&<button className="mm-item" onClick={e=>{e.stopPropagation();setDrillMenu(null);setShareMenuId(shareMenuId===act.id?null:act.id);}}>{act.sharedWithOrganizationId?"Change Sharing":"Share..."}</button>}
                {act.sharedWithOrganizationId&&<button className="mm-item" onClick={()=>doShare(act.id,null)}>Make Private</button>}
                <button className="mm-item mm-danger" onClick={async()=>{setDrillMenu(null);await archiveDrill(act.id);await refreshLibrary();}}>Delete</button>
              </div>}
              {shareMenuId===act.id&&<div className="mini-menu" style={{right:0,top:"100%",minWidth:160}} onClick={e=>e.stopPropagation()}>
                {myOrgs.map(org=>(<button key={org.id} className="mm-item" onClick={()=>doShare(act.id,org.id)}>{act.sharedWithOrganizationId===org.id?"✓ ":""}{org.name}</button>))}
              </div>}
            </div>}
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
          <button className="btn primary bmd bfull" onClick={()=>setEditingTpl(tpl)}>View / Edit</button>
        </div>
      </div>))}
      {confirmDel&&<div className="movly" onClick={()=>setConfirmDel(null)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="mtitle">Delete template?</div><div style={{fontSize:14,color:"var(--td)",marginBottom:16}}>This cannot be undone.</div><div className="brow"><button className="btn ghost bmd" onClick={()=>setConfirmDel(null)}>Cancel</button><button className="btn primary bmd" onClick={async()=>{await archiveTemplate(confirmDel);await refreshPlanning();setConfirmDel(null);}}>Delete</button></div></div></div>}
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
          <button className="mm-item mm-danger" onClick={async e=>{e.stopPropagation();setOpenMenu(null);await archiveLocation(loc.id);await refreshPlanning();}}>Delete</button>
        </div>}
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {loc.sublocations.map(sl=>(<span key={sl.id} className="bdg bs">{sl.name}</span>))}
          {!loc.sublocations.length&&<span style={{fontSize:12,color:"var(--td)"}}>No areas yet</span>}
        </div>
      </div>))}
    </div>}
    {libTab==="equipment"&&<div style={{padding:"0 16px"}} onClick={()=>setOpenMenu(null)}>
      <EquipmentTab data={data} coachId={coachId} refreshLibrary={refreshLibrary} openModal={openModal}/>
    </div>}
  </div>);
}
