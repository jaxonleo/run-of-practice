import React, { useState, useEffect, useRef, useCallback } from "react";
import { uid, fmt, actSecs, sumMins, rebalanceKeep, rebalanceEven, assignGroups } from "../constants.js";
import { savePracticeTree, fetchPracticesFull, findActiveLiveSession, createLiveSession, updateLiveSession, takeControl, subscribeToLiveSession, submitOperation, submitAttendanceSnapshot, fetchLatestAttendance, saveSessionGroups, fetchLatestGroups, openActivityLog, closeActivityLog, findOpenActivityLogId, createHelperShareToken, getPreviewByToken, getLiveSessionByToken, linkPreviewToLiveSession } from "../supabase.js";
import { ActConfig, ChecklistConfig, StationConfig } from "./ActivityConfigs.jsx";

// ── Local icon subset ──────────────────────────────────────────────────────────
const Ic={
  Check:()=><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="2 7 6 11 12 3"/></svg>,
  Play:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" stroke="none"><polygon points="7 4 20 12 7 20 7 4"/></svg>,
  Pause:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" stroke="none"><rect x="5" y="3" width="4" height="18" rx="1"/><rect x="15" y="3" width="4" height="18" rx="1"/></svg>,
  Restart:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
  Chev:({up})=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points={up?"4 10 8 6 12 10":"4 6 8 10 12 6"}/></svg>,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function DurStepper({value,min,onChange,step}){
  const s=step||1;const mn=min||1;
  return (<div style={{display:"flex",alignItems:"center",gap:0,border:"1.5px solid var(--b)",borderRadius:"var(--rs)",overflow:"hidden",background:"#fff"}}>
    <button onClick={()=>onChange(Math.max(mn,value-s))} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>-</button>
    <div style={{flex:1,textAlign:"center",fontFamily:"DM Mono,monospace",fontSize:15,fontWeight:600,color:"var(--black)"}}>{value}m</div>
    <button onClick={()=>onChange(value+s)} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
  </div>);
}

function StationPlayerChip({pid,team}){
  const pl=team&&team.players.find(p=>p.id===pid);
  if(!pl)return null;
  return (<span style={{background:"var(--s2)",border:"1px solid var(--b)",borderRadius:8,padding:"3px 8px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:4}}>
    {pl.jersey&&<span style={{fontFamily:"DM Mono,monospace",fontSize:11,color:"var(--green)"}}>#{pl.jersey}</span>}{pl.firstName}
  </span>);
}

function PlayerChipLive({pid,team,onMove,onProfile}){
  const pl=team&&team.players.find(p=>p.id===pid);
  if(!pl)return null;
  const lpt={current:null};
  return (<button
    onClick={()=>onMove()}
    onTouchStart={()=>{lpt.current=setTimeout(()=>onProfile(pl),500);}}
    onTouchEnd={()=>clearTimeout(lpt.current)}
    onMouseDown={()=>{lpt.current=setTimeout(()=>onProfile(pl),500);}}
    onMouseUp={()=>clearTimeout(lpt.current)}
    style={{padding:"6px 12px",borderRadius:20,border:"1.5px solid var(--gb)",background:"var(--gbg)",fontSize:14,fontWeight:600,cursor:"pointer",color:"var(--black)",display:"flex",alignItems:"center",gap:5}}>
    {pl.jersey&&<span style={{fontFamily:"DM Mono,monospace",fontSize:12,color:"var(--green)"}}>#{pl.jersey}</span>}{pl.firstName}
  </button>);
}

function ShareSheet({token,onClose}){
  const url=window.location.origin+"/live/"+token;
  const [copied,setCopied]=useState(false);
  const copy=()=>{try{navigator.clipboard.writeText(url).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});}catch(e){}};
  const share=()=>{if(navigator.share)navigator.share({title:"Run of Practice - Live View",url});else copy();};
  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.72)",zIndex:200,display:"flex",alignItems:"flex-end"}}><div style={{background:"#fff",width:"100%",borderRadius:"20px 20px 0 0",padding:"24px 20px 40px"}}><div style={{width:36,height:4,background:"var(--b)",borderRadius:2,margin:"0 auto 20px"}}/><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,marginBottom:4}}>Share Live View</div><div style={{fontSize:13,color:"var(--td)",marginBottom:20}}>Anyone with this link can follow along in real time.</div><div style={{background:"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:12,wordBreak:"break-all",fontSize:13,color:"var(--black2)",fontFamily:"DM Mono,monospace"}}>{url}</div><div className="brow"><button className="btn outline bmd" style={{flex:1}} onClick={copy}>{copied?"Copied!":"Copy Link"}</button><button className="btn primary bmd" style={{flex:1}} onClick={share}>Share</button></div><button className="btn ghost bmd bfull" style={{marginTop:8}} onClick={onClose}>Done</button></div></div>);
}

function AttendanceScreen({practice,team,isUpdate,initialPresent,initialCoachPresent,onConfirm,onBack}){
  const allIds=team?team.players.map(p=>p.id):[];
  const [present,setPresent]=useState(()=>{
    if(initialPresent&&initialPresent.length>0)return new Set(initialPresent);
    return new Set(allIds);
  });
  const [coachPresent,setCoachPresent]=useState(()=>{
    if(initialCoachPresent&&initialCoachPresent.length>0)return new Set(initialCoachPresent);
    return new Set(team?team.coaches.map(c=>c.id):[]);
  });
  const togP=id=>setPresent(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const togC=id=>setCoachPresent(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const pCount=present.size;
  const total=allIds.length;
  const stBlocks=(practice&&practice.activities||[]).filter(a=>a.type==="station_block");
  const needsBalance=!isUpdate&&stBlocks.some(b=>{
    const assigned=b.stations.reduce((s,st)=>{(st.assignments||[]).forEach(id=>s.add(id));return s;},new Set());
    return [...present].some(id=>!assigned.has(id));
  });
  return (<div style={{padding:"14px",paddingBottom:"calc(var(--tab) + 100px)"}}>
    <div className="row mb10"><button className="btn ghost bxs" onClick={onBack}>Back</button><div className="ptitle" style={{fontSize:22}}>Attendance</div></div>
    <div style={{background:"var(--green)",borderRadius:10,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{color:"#fff",fontFamily:"DM Mono,monospace",fontSize:32,fontWeight:700}}>{pCount}/{total}</div>
      <div style={{color:"rgba(255,255,255,.8)",fontSize:13}}>players present</div>
    </div>
    <div className="clbl mb8">Players</div>
    <div className="att-grid">
      {team&&team.players.map(p=>(<button key={p.id} onClick={()=>togP(p.id)} className={"att-btn "+(present.has(p.id)?"on":"")}>
        <div className={"att-circle "+(present.has(p.id)?"on":"")}>{present.has(p.id)&&<Ic.Check/>}</div>
        <div><div style={{fontSize:14,fontWeight:600,color:present.has(p.id)?"var(--black)":"var(--td)"}}>{p.firstName}</div></div>
      </button>))}
    </div>
    {team&&team.coaches.length>0&&(<div>
      <div className="clbl mb8 mt8">Coaches</div>
      {team.coaches.map(c=>(<button key={c.id} onClick={()=>togC(c.id)} className={"att-btn bfull "+(coachPresent.has(c.id)?"on":"")} style={{marginBottom:8}}>
        <div className={"att-circle "+(coachPresent.has(c.id)?"on":"")}>{coachPresent.has(c.id)&&<Ic.Check/>}</div>
        <div><div style={{fontSize:14,fontWeight:600,color:coachPresent.has(c.id)?"var(--black)":"var(--td)"}}>{c.name}</div><div style={{fontSize:11,color:"var(--td)"}}>{c.role}</div></div>
      </button>))}
    </div>)}
    <div style={{position:"fixed",bottom:"calc(var(--tab))",left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#fff",borderTop:"1px solid var(--b)",padding:"12px 16px",zIndex:50}}>
      {needsBalance&&<div>
        <div style={{fontSize:12,color:"var(--td)",marginBottom:8,textAlign:"center"}}>Groups need rebalancing for {pCount} players</div>
        <div className="brow">
          <button className="btn ghost bmd" onClick={()=>onConfirm({presentIds:present,coachPresentIds:coachPresent,balanceMode:"keep"})}>Keep Groups</button>
          <button className="btn primary bmd" onClick={()=>onConfirm({presentIds:present,coachPresentIds:coachPresent,balanceMode:"rebalance"})}>Rebalance Evenly</button>
        </div>
      </div>}
      {!needsBalance&&<button className="btn primary bfull bmd" onClick={()=>onConfirm({presentIds:present,coachPresentIds:coachPresent,balanceMode:"keep"})}>{isUpdate?"Update Attendance":"Start Practice"}</button>}
    </div>
  </div>);
}

function HistoryViewer({data,update,practice,onRunAgain,onBack}){
  const [tplSaved,setTplSaved]=useState(false);
  const [expandedId,setExpandedId]=useState(null);
  const team=data.teams.find(t=>t.id===practice.teamId)||null;
  const loc=data.locations.find(l=>l.id===practice.locationId)||null;
  const fmtDate=ds=>new Date(ds+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
  const coachName=id=>{const c=team&&team.coaches.find(c=>c.id===id);return c?c.name:null;};
  const subName=id=>{const s=loc&&loc.sublocations.find(s=>s.id===id);return s?s.name:null;};
  const pnames=ids=>(ids||[]).map(id=>{const p=team&&team.players.find(p=>p.id===id);return p?p.firstName:null;}).filter(Boolean).join(", ");
  const equipNames=ids=>(Array.isArray(ids)?ids:[]).map(id=>{const a=data.assets.find(a=>a.id===id);return a?a.name:null;}).filter(Boolean).join(", ");
  const [tplNameInput,setTplNameInput]=useState("");
  const [showTplInput,setShowTplInput]=useState(false);
  // Notes keyed by context string
  const practiceNotes=(data.notes||[]).filter(n=>n.practiceId===practice.id);
  const notesForContext=ctx=>practiceNotes.filter(n=>n.context===ctx);
  const handleSaveAsTpl=()=>{
    if(!tplNameInput.trim())return;
    const sport=(team&&team.sport)||"General";
    update(d=>{
      if(!d.templates)d.templates=[];
      const idx=d.templates.findIndex(t=>t.name===tplNameInput&&t.sport===sport);
      const tpl={id:idx>=0?d.templates[idx].id:uid(),name:tplNameInput,sport,teamId:practice.teamId,activities:JSON.parse(JSON.stringify(practice.activities))};
      if(idx>=0)d.templates[idx]=tpl; else d.templates.push(tpl);
      return d;
    });
    setTplSaved(true);setShowTplInput(false);setTplNameInput("");
    setTimeout(()=>setTplSaved(false),2500);
  };
  const NotesList=({ctx})=>{
    const notes=notesForContext(ctx);
    if(!notes.length)return null;
    return(<div style={{marginTop:8,paddingTop:8,borderTop:"1px dashed var(--b)"}}>
      {notes.map(n=>(<div key={n.id} style={{display:"flex",gap:8,marginBottom:6,alignItems:"flex-start"}}>
        <span style={{fontSize:11,color:"var(--td)",flexShrink:0,marginTop:2}}>{new Date(n.date).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}</span>
        <span style={{fontSize:13,color:"var(--black)",lineHeight:1.4,flex:1}}>{n.text}</span>
      </div>))}
    </div>);
  };
  return (<div style={{paddingBottom:80}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
      <button className="btn ghost bxs" onClick={onBack}>Back</button>
      <div>
        <div className="ptitle" style={{fontSize:20}}>{team?team.name:"Practice"}</div>
        <div className="limt">{fmtDate(practice.date)}{practice.startTime?" at "+practice.startTime:""}{loc?" · "+loc.name:""}</div>
      </div>
    </div>
    <div className="sechdr mb8">
      <span className="sectitle">{practice.activities.length} Activities</span>
      <span className="pill">{sumMins(practice.activities)}m</span>
    </div>
    {practice.activities.map(act=>{
      const isExpanded=expandedId===act.id;
      const actNotes=notesForContext(act.name);
      const hasNotes=actNotes.length>0;
      return(<div key={act.id} className="ablk" style={{marginBottom:8}}>
        {/* Header row */}
        <div style={{display:"flex",alignItems:"center",padding:"11px 12px",background:"var(--s2)",gap:8,cursor:"pointer"}} onClick={()=>setExpandedId(isExpanded?null:act.id)}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{font:"700 14px Barlow Condensed,sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {act.type==="station_block"?"Station Block":act.name}
              {hasNotes&&<span style={{marginLeft:6,fontSize:10,background:"var(--green)",color:"#fff",borderRadius:10,padding:"1px 6px"}}>{actNotes.length} note{actNotes.length>1?"s":""}</span>}
            </div>
            {act.type==="station_block"
              ?<div className="limt">{act.stations.map(s=>s.activityName||s.name).join(" / ")} · {act.stationDuration}m each{act.rotate!==false?" · rotates":""}</div>
              :<div className="limt">{act.duration}min{coachName(act.coachId)?" · "+coachName(act.coachId):""}{act.grouping&&act.grouping!=="whole"?" · "+(act.grouping==="partners"?"Partners":act.numGroups+" groups"):""}</div>}
          </div>
          {act.type!=="station_block"&&<span className="bdg bs">{act.duration}m</span>}
          {act.type==="station_block"&&<span className="bdg bs">{act.stations.length*act.stationDuration+(act.rotate!==false?Math.max(0,act.stations.length-1)*(act.transitionDuration||0):0)}m</span>}
          <span style={{color:"var(--td)",fontSize:12}}>{isExpanded?"▲":"▼"}</span>
        </div>
        {/* Expanded detail */}
        {isExpanded&&<div style={{padding:"10px 12px",borderTop:"1px solid var(--b)"}}>
          {act.type==="activity"&&<div style={{display:"flex",flexDirection:"column",gap:6}}>
            {act.coachingPoints&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:8}}>
              <div style={{fontSize:10,fontWeight:700,color:"#16a34a",letterSpacing:".08em",textTransform:"uppercase",marginBottom:2}}>Coaching Focus</div>
              <div style={{fontSize:13,lineHeight:1.5}}>{act.coachingPoints}</div>
            </div>}
            {subName(act.sublocationId)&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Location: </span>{subName(act.sublocationId)}</div>}
            {equipNames(act.equipment)&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Equipment: </span>{equipNames(act.equipment)}</div>}
            {act.playerGear&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Player Gear: </span>{act.playerGear}</div>}
            {act.grouping&&act.grouping!=="whole"&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Grouping: </span>{act.grouping==="partners"?"Partners":act.numGroups+" Groups"}</div>}
            {act.assignments&&act.assignments.length>0&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Players: </span>{pnames(act.assignments)}</div>}
            <NotesList ctx={act.name}/>
          </div>}
          {act.type==="checklist"&&<div>
            {(act.items||[]).map(it=>(<div key={it.id} style={{fontSize:13,padding:"4px 0",borderBottom:"1px solid var(--b)",color:"var(--black)"}}>{it.text}</div>))}
            <NotesList ctx={act.name}/>
          </div>}
          {act.type==="station_block"&&<div>
            {act.stations.map(st=>{
              const stCtx=st.activityName||st.name;
              const stNotes=notesForContext(stCtx);
              return(<div key={st.id} style={{marginBottom:10,paddingBottom:10,borderBottom:"1px solid var(--b)"}}>
                <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,color:"var(--green)",letterSpacing:".05em",marginBottom:4}}>
                  {st.name}{st.activityName&&st.activityName!==st.name?": "+st.activityName:""}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {coachName(st.coachId)&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Coach: </span>{coachName(st.coachId)}</div>}
                  {subName(st.sublocationId)&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Area: </span>{subName(st.sublocationId)}</div>}
                  {st.coachingPoints&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:8,marginTop:2}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#16a34a",letterSpacing:".08em",textTransform:"uppercase",marginBottom:2}}>Coaching Focus</div>
                    <div style={{fontSize:13,lineHeight:1.5}}>{st.coachingPoints}</div>
                  </div>}
                  {equipNames(st.equipment)&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Equipment: </span>{equipNames(st.equipment)}</div>}
                  {st.playerGear&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Player Gear: </span>{st.playerGear}</div>}
                  {st.assignments&&st.assignments.length>0&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Players: </span>{pnames(st.assignments)}</div>}
                  {stNotes.length>0&&<div style={{marginTop:6,paddingTop:6,borderTop:"1px dashed var(--b)"}}>
                    {stNotes.map(n=>(<div key={n.id} style={{display:"flex",gap:8,marginBottom:4,alignItems:"flex-start"}}>
                      <span style={{fontSize:11,color:"var(--td)",flexShrink:0,marginTop:2}}>{new Date(n.date).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}</span>
                      <span style={{fontSize:13,color:"var(--black)",lineHeight:1.4}}>{n.text}</span>
                    </div>))}
                  </div>}
                </div>
              </div>);
            })}
            {/* Block-level notes not tied to a specific station */}
            <NotesList ctx="Station Block"/>
          </div>}
        </div>}
      </div>);
    })}
    {/* End of practice notes */}
    {notesForContext("End of Practice").length>0&&<div className="card mb10">
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,marginBottom:8}}>End of Practice Notes</div>
      <NotesList ctx="End of Practice"/>
    </div>}
    <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid var(--b)"}}>
      <button className="btn primary bxl bfull" style={{marginBottom:8}} onClick={onRunAgain}>Run Again</button>
      {showTplInput&&<div>
        <div className="fld"><label className="lbl">Template Name</label><input className="inp" autoFocus placeholder={(team?team.name:"Practice")+" Template"} value={tplNameInput} onChange={e=>setTplNameInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSaveAsTpl()}/></div>
        <div className="brow"><button className="btn ghost bsm" onClick={()=>setShowTplInput(false)}>Cancel</button><button className="btn primary bsm" onClick={handleSaveAsTpl} disabled={!tplNameInput.trim()}>Save</button></div>
      </div>}
      {!showTplInput&&<button className="btn ghost bmd bfull" onClick={()=>setShowTplInput(true)}>{tplSaved?"Saved as Template":"Save as Template"}</button>}
    </div>
  </div>);
}

// ── PreviewView — shown at /preview/[token] before practice starts ───────────
export function PreviewView({token}){
  const [preview,setPreview]=useState(null);
  const [loading,setLoading]=useState(true);
  const [now,setNow]=useState(Date.now());

  useEffect(()=>{const iv=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(iv);},[]);

  useEffect(()=>{
    let cancelled=false;
    const poll=async()=>{
      const data=await getPreviewByToken(token);
      if(cancelled)return;
      setPreview(data);setLoading(false);
      if(data&&data.is_live&&data.live_token){window.location.href="/live/"+data.live_token;}
    };
    poll();
    const iv=setInterval(poll,5000);
    return()=>{cancelled=true;clearInterval(iv);};
  },[token]);

  if(loading)return(<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#0d1512"}}><div style={{color:"#52b788",fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700,letterSpacing:".1em"}}>LOADING...</div></div>);
  if(!preview||preview.error)return(<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,background:"#0d1512",padding:24}}><div style={{color:"#fff",fontFamily:"Barlow Condensed,sans-serif",fontSize:24,fontWeight:900,textAlign:"center"}}>Preview not found</div><div style={{color:"#555",fontSize:14,textAlign:"center"}}>This link may be invalid or expired.</div></div>);

  const activities=preview.activities||[];

  const startMs=preview.scheduled_at?new Date(preview.scheduled_at).getTime():null;
  const diffSecs=startMs?Math.floor((startMs-now)/1000):null;
  const isStarted=diffSecs!==null&&diffSecs<=0;
  const absDiff=diffSecs!==null?Math.abs(diffSecs):null;
  const fmtCountdown=secs=>{
    if(secs===null)return"--:--";
    const h=Math.floor(secs/3600);
    const m=Math.floor((secs%3600)/60);
    const s=secs%60;
    if(h>0)return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
    return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
  };

  const allEquip=[...new Set(activities.flatMap(act=>{
    if(act.type==="station_block")return (act.station_block&&act.station_block.stations||[]).flatMap(st=>st.equipment||[]);
    return act.equipment||[];
  }))];

  const totalMins=activities.reduce((s,a)=>{
    if(a.type==="station_block"&&a.station_block){
      const stCount=(a.station_block.stations||[]).length;
      const sd=Math.round((a.station_block.station_duration_seconds||0)/60);
      const td=Math.round((a.station_block.transition_duration_seconds||0)/60);
      return s+stCount*sd+Math.max(0,stCount-1)*(a.station_block.rotate!==false?td:0);
    }
    return s+(a.duration_minutes||0);
  },0);

  return(<div style={{minHeight:"100dvh",background:"#0d1512",color:"#fff",paddingBottom:40}}>
    <div style={{padding:"24px 20px 16px",borderBottom:"1px solid rgba(255,255,255,.1)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <span style={{width:8,height:8,borderRadius:"50%",background:"#52b788",display:"inline-block",flexShrink:0}}/>
        <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#52b788"}}>Practice Setup</span>
        {preview.location_name&&<span style={{fontSize:11,color:"#555",marginLeft:4}}>· {preview.location_name}</span>}
      </div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,lineHeight:1,marginBottom:4}}>{preview.team_name||"Practice"}</div>
      {preview.scheduled_at&&<div style={{fontSize:13,color:"#aaa"}}>{new Date(preview.scheduled_at).toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})} at {new Date(preview.scheduled_at).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}</div>}
    </div>

    <div style={{padding:"24px 20px",textAlign:"center",borderBottom:"1px solid rgba(255,255,255,.1)"}}>
      {diffSecs!==null&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:isStarted?"#f59e0b":"#52b788",marginBottom:8}}>
          {isStarted?"Practice should have started":"Starts in"}
        </div>
        <div style={{fontFamily:"DM Mono,monospace",fontSize:56,fontWeight:700,color:isStarted?"#f59e0b":"#fff",lineHeight:1,marginBottom:4}}>
          {fmtCountdown(absDiff)}
        </div>
        {isStarted&&<div style={{fontSize:12,color:"#555"}}>Waiting for coach to start the live run</div>}
        {!isStarted&&<div style={{fontSize:12,color:"#555"}}>Use this time to set up stations</div>}
      </div>}
      {diffSecs===null&&<div style={{fontSize:14,color:"#555"}}>No start time scheduled</div>}
    </div>

    {allEquip.length>0&&<div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,.1)"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#ca8a04",marginBottom:10}}>Equipment Needed</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {allEquip.map((n,i)=>(<span key={i} style={{background:"rgba(202,138,4,.15)",border:"1px solid rgba(202,138,4,.4)",borderRadius:20,padding:"4px 12px",fontSize:13,color:"#fde047",fontWeight:600}}>{n}</span>))}
      </div>
    </div>}

    <div style={{padding:"16px 20px"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#555",marginBottom:12}}>Run Order · {totalMins}min</div>
      {activities.map((act,i)=>{
        if(act.type==="station_block"){
          const sb=act.station_block||{};
          const stations=sb.stations||[];
          const sd=Math.round((sb.station_duration_seconds||0)/60);
          const td=Math.round((sb.transition_duration_seconds||0)/60);
          const totalBlockMins=stations.length*sd+Math.max(0,stations.length-1)*(sb.rotate!==false?td:0);
          return(<div key={i} style={{marginBottom:12,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"12px 14px",borderBottom:"1px solid rgba(255,255,255,.08)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#52b788"}}>Station Block</div>
                <div style={{fontSize:12,color:"#555",marginTop:2}}>{stations.length} stations · {sd}m each{sb.rotate!==false?" · rotates":""}</div>
              </div>
              <span style={{fontFamily:"DM Mono,monospace",fontSize:13,color:"#555"}}>{totalBlockMins}m</span>
            </div>
            {stations.map((st,si)=>(<div key={si} style={{padding:"10px 14px",borderBottom:si<stations.length-1?"1px solid rgba(255,255,255,.06)":"none"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:(st.equipment&&st.equipment.length)||st.coaching_points?6:0}}>
                <div>
                  <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,color:"#52b788",letterSpacing:".05em",marginBottom:2}}>Station {si+1}</div>
                  <div style={{fontSize:15,fontWeight:700,color:"#fff"}}>{st.name||"Station "+(si+1)}</div>
                  {(st.coach_name||st.sublocation_name)&&<div style={{fontSize:12,color:"#888",marginTop:2}}>
                    {st.sublocation_name&&<span style={{color:"#52b788",fontWeight:600}}>{st.sublocation_name}</span>}
                    {st.sublocation_name&&st.coach_name&&<span style={{color:"#444"}}> · </span>}
                    {st.coach_name&&<span>{st.coach_name}</span>}
                  </div>}
                </div>
              </div>
              {st.coaching_points&&<div style={{fontSize:12,color:"#888",lineHeight:1.4,borderLeft:"2px solid #52b788",paddingLeft:8,marginBottom:6}}>{st.coaching_points}</div>}
              {(st.equipment&&st.equipment.length>0)&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
                {st.equipment.map((n,j)=>(<span key={j} style={{background:"rgba(202,138,4,.12)",border:"1px solid rgba(202,138,4,.3)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#fde047"}}>{n}</span>))}
              </div>}
            </div>))}
          </div>);
        }
        const equip=act.equipment||[];
        return(<div key={i} style={{marginBottom:8,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"12px 14px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:act.coaching_points||equip.length?6:0}}>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:"#fff"}}>{act.name}</div>
              {(act.coach_name||act.sublocation_name)&&<div style={{fontSize:12,color:"#888",marginTop:2}}>
                {act.sublocation_name&&<span style={{color:"#52b788",fontWeight:600}}>{act.sublocation_name}</span>}
                {act.sublocation_name&&act.coach_name&&<span style={{color:"#444"}}> · </span>}
                {act.coach_name&&<span>{act.coach_name}</span>}
              </div>}
            </div>
            <span style={{fontFamily:"DM Mono,monospace",fontSize:13,color:"#555",flexShrink:0,marginLeft:8}}>{act.duration_minutes}m</span>
          </div>
          {act.coaching_points&&<div style={{fontSize:12,color:"#888",lineHeight:1.4,borderLeft:"2px solid #52b788",paddingLeft:8,marginBottom:6}}>{act.coaching_points}</div>}
          {equip.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
            {equip.map((n,j)=>(<span key={j} style={{background:"rgba(202,138,4,.12)",border:"1px solid rgba(202,138,4,.3)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#fde047"}}>{n}</span>))}
          </div>}
        </div>);
      })}
    </div>
  </div>);
}

function computeHelperElapsed(session,nowMs){
  if(!session||!session.current_phase_started_at)return 0;
  const started=new Date(session.current_phase_started_at).getTime();
  const effectiveNow=session.paused_at?new Date(session.paused_at).getTime():nowMs;
  return Math.max(0,Math.floor((effectiveNow-started)/1000)-(session.total_paused_seconds||0));
}

function HelperPlayerChip({p}){
  return (<span style={{background:"var(--s2)",border:"1px solid var(--b)",borderRadius:8,padding:"3px 8px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:4}}>
    {p.jersey_number&&<span style={{fontFamily:"DM Mono,monospace",fontSize:11,color:"var(--green)"}}>#{p.jersey_number}</span>}{p.first_name} {p.last_initial}.
  </span>);
}

function HelperView({token}){
  const [session,setSession]=useState(null);
  const [loading,setLoading]=useState(true);
  const [focusSt,setFocusSt]=useState(null);
  const [audioOn,setAudioOn]=useState(false);
  const [now,setNow]=useState(Date.now());
  const spokenRef=useRef({});
  const buzzedRef=useRef(false);

  useEffect(()=>{const iv=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(iv);},[]);

  useEffect(()=>{
    let cancelled=false;
    const poll=async()=>{
      const data=await getLiveSessionByToken(token);
      if(cancelled)return;
      setSession(data);setLoading(false);
    };
    poll();
    const iv=setInterval(poll,3000);
    return()=>{cancelled=true;clearInterval(iv);};
  },[token]);

  const speak=txt=>{if(!audioOn)return;try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(txt);u.rate=0.9;window.speechSynthesis.speak(u);}catch(e){}};
  const beep=()=>{if(!audioOn)return;try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance("Next up!");u.rate=1.1;u.pitch=1.2;u.volume=1;window.speechSynthesis.speak(u);}catch(e){}};

  const valid=session&&!session.error;
  const cur=valid?session.current_activity:null;
  const isBlock=cur&&cur.type==="station_block";
  const isCl=cur&&cur.type==="checklist";
  const blockRotate=isBlock&&cur.rotate!==false;
  const inTrans=valid?!!session.in_transition:false;
  const inBlockIntro=valid?!!session.in_block_intro:false;
  const stIdx=valid?session.current_rotation_number||0:0;
  const stations=(valid&&session.stations)||[];
  const groups=(valid&&session.groups)||[];
  const n=stations.length||1;
  const phaseSecs=isBlock?(inBlockIntro?(cur.transition_duration_seconds||120):(blockRotate&&inTrans?(cur.transition_duration_seconds||0):(cur.station_duration_seconds||0))):(cur?(cur.duration_minutes||0)*60:0);
  const elapsed=valid?computeHelperElapsed(session,now):0;
  const rem=phaseSecs-elapsed;
  const prog=phaseSecs>0?Math.min(1,elapsed/phaseSecs):0;
  const urg=rem<=30&&rem>0;

  useEffect(()=>{
    if(!audioOn||!valid)return;
    const key=(cur&&cur.name)+"_"+stIdx+"_"+inTrans+"_"+inBlockIntro;
    if(rem<=122&&rem>=118&&!spokenRef.current[key+"_120"]){speak("Two minutes remaining.");spokenRef.current[key+"_120"]=true;}
    if(rem<=0&&rem>-3&&!buzzedRef.current){beep();buzzedRef.current=true;}
    if(rem>5)buzzedRef.current=false;
    // eslint-disable-next-line
  },[elapsed,audioOn]);

  if(loading)return(<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#0d1512"}}><div style={{color:"#52b788",fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700,letterSpacing:".1em"}}>JOINING SESSION...</div></div>);
  if(!valid)return(<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,background:"#0d1512",padding:"24px"}}><div style={{color:"#fff",fontFamily:"Barlow Condensed,sans-serif",fontSize:24,fontWeight:900,textAlign:"center"}}>Session not found</div><div style={{color:"#555",fontSize:14,textAlign:"center"}}>This link may be invalid or the practice has ended.</div></div>);
  if(session.status!=="active")return(<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,background:"#0d1512",padding:"24px"}}><div style={{color:"#52b788",fontFamily:"Barlow Condensed,sans-serif",fontSize:48,fontWeight:900,textAlign:"center"}}>Practice Complete</div><div style={{color:"#555",fontSize:14,textAlign:"center"}}>This session has ended.</div></div>);

  const rotatedStations=isBlock&&stations.length?stations.map((st,i)=>{
    const srcIdx=(i-stIdx%n+n)%n;
    const g=groups.find(g=>g.group_number===srcIdx+1);
    return Object.assign({},st,{players:g?g.players:[]});
  }):null;
  const phaseLabel=isBlock?(inBlockIntro?"INTRODUCING STATIONS":blockRotate?(inTrans?"TRANSITION":"STATION "+(stIdx+1)+" of "+n):"STATION BLOCK"):((cur&&cur.name)||"").toUpperCase();

  return(<div className="ccs">
    <div className="cc-header">
      <div>
        <div className="row"><span className="live"/><span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginLeft:5}}>Live</span><span style={{marginLeft:8,fontSize:11,color:"var(--td)"}}>Helper View</span></div>
        {isBlock&&<div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)"}}>{stations.length} Stations</div>}
        <div className="cc-act-name">{phaseLabel}</div>
      </div>
      <div className="row" style={{gap:6}}>
        <button onClick={()=>{if(!audioOn){try{const u=new SpeechSynthesisUtterance("Audio on");u.rate=1;u.volume=1;window.speechSynthesis.speak(u);}catch(e){}}spokenRef.current={};buzzedRef.current=false;setAudioOn(a=>!a);}} style={{background:audioOn?"var(--gbg)":"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"var(--rs)",padding:"4px 10px",fontSize:13,fontWeight:700,cursor:"pointer",color:audioOn?"var(--green)":"var(--td)"}}>{audioOn?"🔊":"🔇"}</button>
      </div>
    </div>
    <div className="cc-timer-row"><div className={"cc-timer"+(urg?" urg":(elapsed>phaseSecs?" over":""))}>{fmt(rem)}</div></div>
    <div className="cc-prog"><div className={"cc-prog-bar"+(elapsed>phaseSecs?" over":"")} style={{width:(Math.min(1,prog)*100)+"%"}}/></div>
    <div className="cc-body">
      {isCl&&cur&&<div className="cc-focus"><div className="cc-focus-lbl">{cur.name}</div>{(cur.items||[]).map(it=>(<div key={it.id} className="cl-item"><div className="cl-check"/><div className="cl-text">{it.text}</div></div>))}</div>}
      {!isBlock&&!isCl&&cur&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {cur.description&&<div style={{borderLeft:"3px solid var(--b)",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:4}}>Description</div>
          <div style={{fontSize:14,color:"var(--black)",lineHeight:1.5}}>{cur.description}</div>
        </div>}
        {cur.coaching_points&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#16a34a",marginBottom:4}}>💡 Coaching Focus</div>
          <div style={{fontSize:15,color:"var(--black)",lineHeight:1.5}}>{cur.coaching_points}</div>
        </div>}
        {cur.sublocation_name&&<div style={{borderLeft:"3px solid #2563eb",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#2563eb",marginBottom:3}}>📍 Location</div>
          <div style={{fontSize:14,color:"var(--black)",fontWeight:600}}>{cur.sublocation_name}</div>
        </div>}
        {cur.coach_name&&<div style={{borderLeft:"3px solid var(--b)",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:3}}>Coach</div>
          <div style={{fontSize:14,color:"var(--black)"}}>{cur.coach_name}</div>
        </div>}
        {(cur.equipment&&cur.equipment.length>0)&&<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          <span style={{border:"1.5px solid #fde047",borderRadius:20,padding:"3px 10px",fontSize:12,color:"#854d0e",fontWeight:600,background:"#fff"}}>Equipment: {cur.equipment.join(", ")}</span>
        </div>}
        {groups.length>0&&<div style={{borderLeft:"3px solid #7c3aed",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#7c3aed",marginBottom:8}}>👥 Groups</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {groups.map((g,i)=>(<div key={i} style={{display:"inline-flex",alignItems:"center",gap:6,border:"1.5px solid #c4b5fd",borderRadius:20,padding:"5px 12px",background:"#fff"}}>
              <span style={{fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700,color:"#7c3aed",flexShrink:0}}>G{g.group_number}</span>
              <span style={{fontSize:13,fontWeight:600,color:"var(--black)"}}>{(g.players||[]).map(p=>(p.jersey_number?"#"+p.jersey_number+" ":"")+p.first_name+" "+p.last_initial+".").join(" · ")}</span>
            </div>))}
          </div>
        </div>}
        {groups.length===0&&<div style={{borderLeft:"3px solid var(--b)",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:3}}>👥 Players</div>
          <div style={{fontSize:14,color:"var(--black)"}}>Whole Team Together</div>
        </div>}
      </div>}
      {isBlock&&inBlockIntro&&stations.length>0&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"var(--td)",marginBottom:12}}>Get everyone to their station</div>
        {stations.map((st,i)=>{
          const g=groups[i];
          return(<div key={st.id||i} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8}}>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginBottom:4}}>Station {i+1}</div>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"var(--black)",marginBottom:6}}>{st.name||"Station "+(i+1)}</div>
            {st.sublocation_name&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:2}}>{st.sublocation_name}</div>}
            {st.coach_name&&<div style={{fontSize:11,color:"var(--td)",marginBottom:4}}>{st.coach_name}</div>}
            {st.coaching_points&&<div style={{fontSize:12,color:"var(--black2)",marginBottom:4,lineHeight:1.4,borderLeft:"2px solid var(--green)",paddingLeft:8}}>{st.coaching_points}</div>}
            {(st.equipment&&st.equipment.length>0)&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
              <span style={{border:"1.5px solid #fde047",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#854d0e",fontWeight:600,background:"#fff"}}>Equipment: {st.equipment.join(", ")}</span>
            </div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {g&&(g.players||[]).map(p=>(<HelperPlayerChip key={p.id} p={p}/>))}
            </div>
          </div>);
        })}
        <div style={{textAlign:"center",fontSize:12,color:"var(--td)",marginTop:8}}>Waiting for coach to start the block</div>
      </div>}
      {isBlock&&!inBlockIntro&&!inTrans&&rotatedStations&&<div>
        {focusSt!==null&&<div>
          <button className="btn ghost bxs" style={{marginBottom:10}} onClick={()=>setFocusSt(null)}>&#8249; All Stations</button>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginBottom:2}}>Station {focusSt+1}</div>
          {rotatedStations[focusSt].sublocation_name&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:3}}>{rotatedStations[focusSt].sublocation_name}</div>}
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:36,fontWeight:900,color:"var(--black)",lineHeight:1,marginBottom:6}}>{rotatedStations[focusSt].name||"Station "+(focusSt+1)}</div>
          {rotatedStations[focusSt].coach_name&&<div style={{fontSize:13,color:"var(--td)",marginBottom:6}}>{rotatedStations[focusSt].coach_name}</div>}
          {rotatedStations[focusSt].coaching_points&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:10,paddingTop:4,paddingBottom:8,marginBottom:4}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#16a34a",marginBottom:4}}>💡 Coaching Focus</div>
            <div style={{fontSize:15,color:"var(--black)",lineHeight:1.5}}>{rotatedStations[focusSt].coaching_points}</div>
          </div>}
          {(rotatedStations[focusSt].equipment&&rotatedStations[focusSt].equipment.length>0)&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            <span style={{background:"#fefce8",border:"1px solid #fde047",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#854d0e",fontWeight:600}}>Equipment: {rotatedStations[focusSt].equipment.join(", ")}</span>
          </div>}
          <div><div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Players at this station</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{(rotatedStations[focusSt].players||[]).map(p=>(<span key={p.id} style={{padding:"6px 12px",borderRadius:20,border:"1.5px solid var(--gb)",background:"var(--gbg)",fontSize:14,fontWeight:600,color:"var(--black)"}}>{p.jersey_number?"#"+p.jersey_number+" ":""}{p.first_name} {p.last_initial}.</span>))}</div></div>
        </div>}
        {focusSt===null&&<div>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>{blockRotate?"Round "+(stIdx+1)+" of "+n+" — Tap to focus":"All Stations — Tap to focus"}</div>
          {rotatedStations.map((st,i)=>(<div key={st.id||i} onClick={()=>setFocusSt(i)} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8,cursor:"pointer"}}>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginBottom:2}}>Station {i+1}</div>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,color:"var(--black)",lineHeight:1.1,marginBottom:4}}>{st.name||"Station "+(i+1)}</div>
            {st.sublocation_name&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:4}}>{st.sublocation_name}</div>}
            {st.coaching_points&&<div style={{fontSize:12,color:"var(--black2)",marginBottom:6,lineHeight:1.4,borderLeft:"2px solid var(--green)",paddingLeft:8}}>{st.coaching_points}</div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>{(st.players||[]).map(p=>(<HelperPlayerChip key={p.id} p={p}/>))}</div>
            <div style={{fontSize:10,color:"var(--td)",marginTop:5}}>Tap to focus</div>
          </div>))}
        </div>}
      </div>}
      {isBlock&&inTrans&&rotatedStations&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:900,color:"var(--red)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:10}}>Rotate Now</div>
        {rotatedStations.map((st,i)=>{
          const nextSt=stations[(i+1)%n];
          const fromLabel="Station "+(i+1)+(st.name?": "+st.name:"");
          const toLabel="Station "+((i+1)%n+1)+(nextSt.name?": "+nextSt.name:"");
          return(<div key={st.id||i} className="cc-trans-card">
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"var(--black)",lineHeight:1.2,marginBottom:6}}>{(st.players||[]).map(p=>p.first_name).join(", ")||"--"}</div>
            <div style={{fontSize:12,color:"var(--td)",marginBottom:3}}>from {fromLabel}</div>
            <div style={{fontSize:13,fontWeight:700,color:"var(--black)"}}>→ {toLabel}</div>
            {nextSt.sublocation_name&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginTop:2}}>{nextSt.sublocation_name}</div>}
          </div>);
        })}
      </div>}
    </div>
  </div>);
}
// ── CommandScreen ─────────────────────────────────────────────────────────────
export { HelperView, HistoryViewer };

function computeElapsed(session, nowMs) {
  if (!session || !session.current_phase_started_at) return 0;
  const started = new Date(session.current_phase_started_at).getTime();
  const effectiveNow = session.paused_at ? new Date(session.paused_at).getTime() : nowMs;
  return Math.max(0, Math.floor((effectiveNow - started) / 1000) - (session.total_paused_seconds || 0));
}

async function seedAllStationGroups(sessionId, activities, presentIds, mode, createdBy, allPlayers) {
  for (const act of activities) {
    if (act.type !== "station_block") continue;
    const rebalanced = mode === "rebalance" ? rebalanceEven(act.stations, presentIds, allPlayers) : rebalanceKeep(act.stations, presentIds);
    await saveSessionGroups(sessionId, act.id, createdBy, rebalanced.map(st => st.assignments || []));
  }
}

export default function CommandScreen({data,update,liveId,setLiveId,coachId,setView,refreshPlanning}){
  const practice=liveId?data.practices.find(p=>p.id===liveId):null;
  const team=practice?data.teams.find(t=>t.id===practice.teamId):null;
  const loc=practice?data.locations.find(l=>l.id===practice.locationId):null;
  const liveActs=practice?practice.activities:[];

  const [stage,setStage]=useState("pick");
  const [session,setSession]=useState(null);
  const [now,setNow]=useState(Date.now());
  const [presentIds,setPresentIds]=useState(new Set());
  const [coachPresentIds,setCoachPresentIds]=useState(new Set());
  const [showAtt,setShowAtt]=useState(false);
  const [liveGroups,setLiveGroups]=useState(null);
  const [audioOn,setAudioOn]=useState(false);
  const [noteText,setNoteText]=useState("");
  const [showROS,setShowROS]=useState(false);
  const [clState,setClState]=useState({});
  const [movePlayer,setMovePlayer]=useState(null);
  const [showEllipsis,setShowEllipsis]=useState(false);
  const [showEditBuilder,setShowEditBuilder]=useState(false);
  const [focusSt,setFocusSt]=useState(null);
  const [livePlayerProfile,setLivePlayerProfile]=useState(null);
  const [shareToken,setShareToken]=useState(null);
  const [showShare,setShowShare]=useState(false);
  const spoken=useRef({});
  const activityLogIdRef=useRef(null);

  const idx=session?Math.max(0,liveActs.findIndex(a=>a.id===session.current_practice_activity_id)):0;
  const cur=liveActs[idx]||null;
  const isBlock=cur&&cur.type==="station_block";
  const blockRotate=isBlock&&cur.rotate!==false;
  const isCl=cur&&cur.type==="checklist";
  const stIdx=session?session.current_rotation_number||0:0;
  const inTrans=session?!!session.in_transition:false;
  const inBlockIntro=session?!!session.in_block_intro:false;
  const running=session?!session.paused_at:false;
  const elapsed=computeElapsed(session,now);
  const isController=!!(session&&session.controller_user_id===coachId);
  const controllerName=(()=>{if(!session||!team||isController)return null;const c=team.coaches.find(c=>c.userId===session.controller_user_id);return c?c.name:"another coach";})();
  const phaseSecs=isBlock?(inBlockIntro?(cur.transitionDuration||2)*60:blockRotate&&inTrans?cur.transitionDuration*60:cur.stationDuration*60):(cur?actSecs(cur):0);
  const isOver=elapsed>phaseSecs;
  const rem=phaseSecs-elapsed;
  const prog=phaseSecs>0?Math.min(1,elapsed/phaseSecs):0;
  const urg=rem<=30&&rem>0&&running;
  const pCount=presentIds.size;
  const pTotal=team?team.players.length:0;
  const completedMins=liveActs.slice(0,idx).reduce((s,a)=>s+Math.round(actSecs(a)/60),0);
  const practiceStart=session?new Date(session.created_at).getTime():null;
  const schedDelta=(practiceStart&&practice&&practice.startTime&&practice.durMin)?(Math.floor((Date.now()-practiceStart)/60000)-completedMins-Math.floor(elapsed/60)):null;
  const n=isBlock&&cur.stations?cur.stations.length:1;
  const rotatedStations=isBlock&&cur.stations&&liveGroups?cur.stations.map((st,i)=>{const srcIdx=(i-stIdx%n+n)%n;return Object.assign({},st,{assignments:liveGroups[srcIdx]||[]});}):null;

  // ── Timer: derived from timestamps, only ticks locally while running ───────
  useEffect(()=>{
    if(!running)return;
    const iv=setInterval(()=>setNow(Date.now()),500);
    return()=>clearInterval(iv);
  },[running]);

  const beep=useCallback(()=>{
    if(!audioOn)return;
    try{
      window.speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance("Next up!");
      u.rate=1.1;u.pitch=1.2;u.volume=1;
      window.speechSynthesis.speak(u);
    }catch(e){console.error('beep error:',e);}
  },[audioOn]);
  const speak=useCallback(txt=>{if(!audioOn)return;try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(txt);u.rate=0.9;window.speechSynthesis.speak(u);}catch(e){};},[audioOn]);

  const beepRef=useRef(beep);
  useEffect(()=>{beepRef.current=beep;},[beep]);
  const speakRef=useRef(speak);
  useEffect(()=>{speakRef.current=speak;},[speak]);

  const buzzedRef=useRef(false);
  useEffect(()=>{
    if(elapsed>=phaseSecs&&phaseSecs>0&&!buzzedRef.current&&running){
      buzzedRef.current=true;
      beepRef.current();
    }
    if(elapsed<phaseSecs-5){
      buzzedRef.current=false;
    }
  },[elapsed,phaseSecs,running]);

  const warnedRef=useRef(false);
  useEffect(()=>{
    const rem2=phaseSecs-elapsed;
    if(rem2<=122&&rem2>=118&&!warnedRef.current&&running){
      warnedRef.current=true;
      speakRef.current("Two minutes remaining.");
    }
    if(rem2>130){warnedRef.current=false;}
  },[elapsed,phaseSecs,running]);

  // ── Mount / resume: find an existing active session before defaulting to attendance ──
  useEffect(()=>{
    if(!liveId){setStage("pick");setSession(null);return;}
    let cancelled=false;
    (async()=>{
      const existing=await findActiveLiveSession(liveId);
      if(cancelled)return;
      if(existing){
        setSession(existing);
        setStage("live");
        const latest=await fetchLatestAttendance(existing.id);
        if(cancelled)return;
        setPresentIds(new Set(Object.keys(latest).filter(pid=>latest[pid]==="present")));
        activityLogIdRef.current=await findOpenActivityLogId(existing.id);
      }else{
        setStage("attend");
      }
    })();
    return()=>{cancelled=true;};
  },[liveId]);

  // Realtime: pick up control handoffs / phase changes from another device.
  useEffect(()=>{
    if(!session)return;
    const sub=subscribeToLiveSession(session.id,updated=>{
      setSession(updated);
      if(updated.status!=="active")setStage("end");
    });
    return()=>{sub.unsubscribe();};
  },[session?.id]);

  const writeSession=useCallback(async(patch)=>{
    if(!session)return null;
    const updated=await updateLiveSession(session.id,session.version,patch);
    if(updated){setSession(updated);return updated;}
    const fresh=await findActiveLiveSession(practice.id);
    setSession(fresh);
    return null;
  },[session,practice]);

  const closeCurrentLog=useCallback(async()=>{
    if(activityLogIdRef.current){await closeActivityLog(activityLogIdRef.current);activityLogIdRef.current=null;}
  },[]);
  const openLogFor=useCallback(async(sessionId,target,presentPlayerIds)=>{
    activityLogIdRef.current=await openActivityLog(sessionId,coachId,target,presentPlayerIds);
  },[coachId]);
  const openLogForActivityEntry=useCallback(async(sessionRow,act,stationIdx,presentPlayerIds)=>{
    if(!sessionRow||!act)return;
    if(act.type==="station_block"){
      if(act.rotate!==false)await openLogFor(sessionRow.id,{stationId:act.stations[stationIdx||0].id},presentPlayerIds);
      else await openLogFor(sessionRow.id,{practiceActivityId:act.id},presentPlayerIds);
    }else{
      await openLogFor(sessionRow.id,{practiceActivityId:act.id},presentPlayerIds);
    }
  },[openLogFor]);
  const transitionTo=useCallback(async(patch,logAct,logStIdx)=>{
    await closeCurrentLog();
    const updated=await writeSession(Object.assign({current_phase_started_at:new Date().toISOString(),paused_at:null,total_paused_seconds:0},patch));
    if(updated&&logAct)await openLogForActivityEntry(updated,logAct,logStIdx,[...presentIds]);
    spoken.current={};buzzedRef.current=false;warnedRef.current=false;setFocusSt(null);
    return updated;
  },[writeSession,closeCurrentLog,openLogForActivityEntry,presentIds]);

  // ── Live-group sync: current activity's session_groups, fetched or (for
  // regular sub-grouping) freshly reshuffled on every entry/attendance change.
  // Station-block groups are seeded explicitly at attendance time via
  // seedAllStationGroups -- this effect only fetches them, falling back to a
  // one-time bootstrap for a block added mid-session via LiveEditBuilder. ──
  useEffect(()=>{
    if(!session||!cur){setLiveGroups(null);return;}
    let cancelled=false;
    (async()=>{
      if(isBlock){
        const existing=await fetchLatestGroups(session.id,cur.id);
        if(cancelled)return;
        if(existing&&existing.length){setLiveGroups(existing);return;}
        const rebalanced=rebalanceKeep(cur.stations,presentIds);
        const seeded=rebalanced.map(st=>st.assignments||[]);
        setLiveGroups(seeded);
        await saveSessionGroups(session.id,cur.id,coachId,seeded);
      }else{
        const g=cur.grouping||"whole";
        if(g==="whole"){setLiveGroups(null);return;}
        if(presentIds.size===0)return;
        const present=[...presentIds];
        const players=(team?team.players:[]).filter(p=>present.includes(p.id));
        if(players.length===0)return;
        const groups=assignGroups(players,g,cur.numGroups||2).map(g2=>g2.map(p=>p.id));
        if(cancelled)return;
        setLiveGroups(groups);
        await saveSessionGroups(session.id,cur.id,coachId,groups);
      }
    })();
    return()=>{cancelled=true;};
  },[session?.id,cur?.id,presentIds]);

  const handleAttConfirm=useCallback(async({presentIds:pIds,coachPresentIds:cIds,balanceMode})=>{
    setPresentIds(pIds);setCoachPresentIds(cIds);
    setStage("live");setShowAtt(false);
    spoken.current={};buzzedRef.current=false;warnedRef.current=false;
    const firstAct=liveActs[0]||null;
    const firstIsBlock=firstAct&&firstAct.type==="station_block";
    let sessionRow=session&&session.practice_id===practice.id?session:null;
    if(sessionRow){
      sessionRow=await writeSession({current_practice_activity_id:firstAct?firstAct.id:null,current_rotation_number:0,in_transition:false,in_block_intro:!!firstIsBlock,current_phase_started_at:new Date().toISOString(),paused_at:null,total_paused_seconds:0,status:"active"});
    }else{
      sessionRow=await createLiveSession(practice.id,coachId,{practiceActivityId:firstAct?firstAct.id:null,inBlockIntro:!!firstIsBlock});
      if(sessionRow){setSession(sessionRow);await linkPreviewToLiveSession(practice.id,sessionRow.id);}
    }
    if(!sessionRow)return;
    await submitOperation(sessionRow.id,coachId,"start_practice");
    const allPlayerIds=team?team.players.map(p=>p.id):[];
    await submitAttendanceSnapshot(sessionRow.id,coachId,pIds,allPlayerIds);
    await seedAllStationGroups(sessionRow.id,liveActs,pIds,balanceMode,coachId,team?team.players:[]);
    if(firstAct&&!firstIsBlock)await openLogFor(sessionRow.id,{practiceActivityId:firstAct.id},[...pIds]);
  },[practice,liveActs,coachId,team,session,writeSession,openLogFor]);

  const handleAttUpdate=useCallback(async({presentIds:pIds,coachPresentIds:cIds,balanceMode})=>{
    if(!session)return;
    await seedAllStationGroups(session.id,liveActs,pIds,balanceMode||"keep",coachId,team?team.players:[]);
    await submitAttendanceSnapshot(session.id,coachId,pIds,team?team.players.map(p=>p.id):[]);
    setPresentIds(pIds);setCoachPresentIds(cIds);setShowAtt(false);
  },[session,liveActs,coachId,team]);

  const startBlock=useCallback(async()=>{
    if(!session||!cur||!isBlock)return;
    await submitOperation(session.id,coachId,"start_block");
    await transitionTo({current_rotation_number:0,in_transition:false,in_block_intro:false},cur,0);
  },[session,cur,isBlock,coachId,transitionTo]);

  const advance=useCallback(async()=>{
    if(!session||!cur)return;
    await submitOperation(session.id,coachId,"advance");
    if(isBlock){
      if(inBlockIntro){await transitionTo({current_rotation_number:0,in_transition:false,in_block_intro:false},cur,0);return;}
      if(blockRotate&&!inTrans&&cur.transitionDuration>0&&stIdx<cur.stations.length-1){await transitionTo({in_transition:true},null);return;}
      if(blockRotate&&stIdx<cur.stations.length-1){const ns=stIdx+1;await transitionTo({current_rotation_number:ns,in_transition:false},cur,ns);return;}
    }
    if(idx<liveActs.length-1){
      const ni=idx+1;const nextAct=liveActs[ni];const nextIsBlock=nextAct.type==="station_block";
      await transitionTo({current_practice_activity_id:nextAct.id,current_rotation_number:0,in_transition:false,in_block_intro:nextIsBlock},nextIsBlock?null:nextAct,0);
    }else{
      await closeCurrentLog();
      await writeSession({status:"completed",ended_at:new Date().toISOString(),paused_at:null});
      setStage("end");
    }
  },[session,cur,isBlock,inBlockIntro,blockRotate,inTrans,stIdx,idx,liveActs,coachId,transitionTo,writeSession,closeCurrentLog]);

  const goBack=useCallback(async()=>{
    if(!session||!cur)return;
    await submitOperation(session.id,coachId,"go_back");
    if(isBlock&&inTrans){await transitionTo({in_transition:false},cur,stIdx);return;}
    if(isBlock&&stIdx>0){const ns=stIdx-1;await transitionTo({current_rotation_number:ns,in_transition:false},cur,ns);return;}
    if(idx>0){const pi=idx-1;const prevAct=liveActs[pi];await transitionTo({current_practice_activity_id:prevAct.id,current_rotation_number:0,in_transition:false,in_block_intro:false},prevAct,0);}
  },[session,cur,isBlock,inTrans,stIdx,idx,liveActs,coachId,transitionTo]);

  const jumpTo=useCallback(async(i)=>{
    if(!session)return;
    const target=liveActs[i];if(!target)return;
    await submitOperation(session.id,coachId,"jump_to");
    await transitionTo({current_practice_activity_id:target.id,current_rotation_number:0,in_transition:false,in_block_intro:false},target,0);
    setShowROS(false);
  },[session,liveActs,coachId,transitionTo]);

  const togglePlay=useCallback(async()=>{
    if(!session)return;
    await submitOperation(session.id,coachId,"toggle_play");
    if(session.paused_at){
      const pausedDelta=Math.floor((Date.now()-new Date(session.paused_at).getTime())/1000);
      await writeSession({paused_at:null,total_paused_seconds:(session.total_paused_seconds||0)+pausedDelta});
    }else{
      await writeSession({paused_at:new Date().toISOString()});
    }
  },[session,coachId,writeSession]);

  const nudge=useCallback(async(deltaSecs)=>{
    if(!session)return;
    const curElapsed=computeElapsed(session,Date.now());
    const newElapsed=Math.max(0,curElapsed+deltaSecs);
    const appliedDelta=curElapsed-newElapsed;
    buzzedRef.current=false;warnedRef.current=false;
    await writeSession({total_paused_seconds:(session.total_paused_seconds||0)+appliedDelta});
  },[session,writeSession]);

  const endPractice=useCallback(async()=>{
    setShowEllipsis(false);
    if(!session)return;
    await submitOperation(session.id,coachId,"end_practice");
    await closeCurrentLog();
    await writeSession({status:"completed",ended_at:new Date().toISOString(),paused_at:null});
    setStage("end");
  },[session,coachId,writeSession,closeCurrentLog]);

  const restartPractice=useCallback(async()=>{
    setShowEllipsis(false);
    if(!session)return;
    await submitOperation(session.id,coachId,"restart_practice");
    await closeCurrentLog();
    const firstAct=liveActs[0]||null;const firstIsBlock=firstAct&&firstAct.type==="station_block";
    await writeSession({current_practice_activity_id:firstAct?firstAct.id:null,current_rotation_number:0,in_transition:false,in_block_intro:!!firstIsBlock,current_phase_started_at:new Date().toISOString(),paused_at:new Date().toISOString(),total_paused_seconds:0});
    spoken.current={};buzzedRef.current=false;warnedRef.current=false;
    setStage("attend");
  },[session,liveActs,coachId,writeSession,closeCurrentLog]);

  const takeControlNow=useCallback(async()=>{
    if(!session)return;
    const updated=await takeControl(session.id,session.version,coachId);
    if(updated)setSession(updated);
    else{const fresh=await findActiveLiveSession(practice.id);setSession(fresh);}
  },[session,coachId,practice]);

  const coachName=id=>{const c=team&&team.coaches.find(c=>c.id===id);return c?c.name:null;};
  const subName=id=>{const s=loc&&loc.sublocations.find(s=>s.id===id);return s?s.name:null;};
  const pnames=ids=>(ids||[]).map(id=>{const p=team&&team.players.find(p=>p.id===id);return p?p.firstName:null;}).filter(Boolean).join(", ");
  const pname=id=>{const p=team&&team.players.find(p=>p.id===id);return p?p.firstName:id;};
  const addNote=()=>{if(!noteText.trim())return;const ctx=isBlock&&cur.stations[stIdx]?cur.stations[stIdx].activityName||cur.stations[stIdx].name:(cur&&cur.name)||"Practice";update(d=>{d.notes.push({id:uid(),text:noteText,context:ctx,date:new Date().toISOString(),practiceId:liveId});return d;});setNoteText("");};
  const toggleCl=(actId,itemId)=>{setClState(s=>{const cur2=s[actId]||{};return Object.assign({},s,{[actId]:Object.assign({},cur2,{[itemId]:!cur2[itemId]})});});};

  const reshuffleGroups=useCallback(async()=>{
    if(!session||!cur)return;
    const present=[...presentIds];
    const players=(team?team.players:[]).filter(p=>present.includes(p.id));
    const groups=assignGroups(players,cur.grouping,cur.numGroups||2).map(g=>g.map(p=>p.id));
    setLiveGroups(groups);
    await saveSessionGroups(session.id,cur.id,coachId,groups);
  },[session,cur,presentIds,team,coachId]);

  const reshuffleBlockIntro=useCallback(async()=>{
    if(!session||!cur)return;
    const present=[...presentIds];
    const players=(team?team.players:[]).filter(p=>present.includes(p.id));
    const n2=cur.stations.length;
    const shuffled=[...players].sort(()=>Math.random()-.5);
    const groups=Array.from({length:n2},()=>[]);
    shuffled.forEach((p,i2)=>groups[i2%n2].push(p.id));
    setLiveGroups(groups);
    await saveSessionGroups(session.id,cur.id,coachId,groups);
  },[session,cur,presentIds,team,coachId]);

  const movePlayerToStation=useCallback(async(si)=>{
    if(!session||!cur||!liveGroups||movePlayer==null)return;
    const n2=cur.stations.length;
    const fromGroupIdx=liveGroups.findIndex(g=>g.includes(movePlayer));
    const toGroupIdx=((si-stIdx)%n2+n2)%n2;
    if(fromGroupIdx===-1||fromGroupIdx===toGroupIdx){setMovePlayer(null);return;}
    const newGroups=liveGroups.map((g,i)=>{
      if(i===fromGroupIdx)return g.filter(id=>id!==movePlayer);
      if(i===toGroupIdx)return [...g,movePlayer];
      return g;
    });
    setLiveGroups(newGroups);
    await saveSessionGroups(session.id,cur.id,coachId,newGroups);
    setMovePlayer(null);
  },[session,cur,liveGroups,movePlayer,stIdx,coachId]);

  const shareLive=useCallback(async()=>{
    if(!session)return;
    const token=await createHelperShareToken(session.id,coachId);
    if(token){setShareToken(token);setShowShare(true);}
  },[session,coachId]);

  // ── In-session practice editor ─────────────────────────────────────────────
  if(showEditBuilder){
    return(<LiveEditBuilder
      data={data}
      update={update}
      liveActs={liveActs}
      practice={practice}
      team={team}
      loc={loc}
      onSaveResume={async(newActs)=>{
        await savePracticeTree(practice.id,{teamId:practice.teamId,locationId:practice.locationId,date:practice.date,startTime:practice.startTime,activities:newActs});
        await refreshPlanning();
        const freshList=await fetchPracticesFull();
        const freshPractice=freshList.find(p=>p.id===practice.id);
        const freshActs=freshPractice?freshPractice.activities:[];
        const firstAct=freshActs[0]||null;
        const firstIsBlock=firstAct&&firstAct.type==="station_block";
        if(session){
          await closeCurrentLog();
          const updated=await writeSession({current_practice_activity_id:firstAct?firstAct.id:null,current_rotation_number:0,in_transition:false,in_block_intro:!!firstIsBlock,current_phase_started_at:new Date().toISOString(),paused_at:new Date().toISOString(),total_paused_seconds:0});
          if(updated&&firstAct&&!firstIsBlock)await openLogFor(updated.id,{practiceActivityId:firstAct.id},[...presentIds]);
        }
        spoken.current={};buzzedRef.current=false;warnedRef.current=false;
        setShowEditBuilder(false);
      }}
      onBack={()=>{setShowEditBuilder(false);}}
    />);
  }

  if(stage==="attend"||showAtt){const attBack=()=>{if(showAtt){setShowAtt(false);}else{setLiveId(null);setStage("pick");setView("today");}};return (<AttendanceScreen key={showAtt?"upd":"init"} practice={practice} team={team} isUpdate={showAtt} initialPresent={showAtt?[...presentIds]:null} initialCoachPresent={showAtt?[...coachPresentIds]:null} onConfirm={showAtt?handleAttUpdate:handleAttConfirm} onBack={attBack}/>);}
  if(stage==="end")return (<div className="ccs"><div className="cc-end"><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:36,fontWeight:900,color:"var(--green)",marginBottom:4}}>Practice Complete</div><div style={{fontSize:16,color:"var(--tm)",marginBottom:24,lineHeight:1.5}}>{team&&team.name} practice complete.</div><div style={{width:"100%",marginBottom:16}}><label className="lbl">End of Practice Notes</label><textarea className="ta" style={{minHeight:80}} value={noteText} placeholder="Observations for next time..." onChange={e=>setNoteText(e.target.value)}/><button className="btn primary bsm bfull mt6" onClick={()=>{if(noteText.trim()){update(d=>{d.notes.push({id:uid(),text:noteText,context:"End of Practice",date:new Date().toISOString(),practiceId:liveId});return d;});setNoteText("");}}} >Save Note</button></div><button className="btn primary bmd bfull" onClick={()=>{setLiveId(null);setStage("pick");setView("today");}}>Done</button></div></div>);

  if(!cur)return null;

  const phaseLabel=isBlock?(inBlockIntro?"INTRODUCING STATIONS":blockRotate?(inTrans?"TRANSITION":"STATION "+(stIdx+1)+" of "+cur.stations.length):"STATION BLOCK"):((cur&&cur.name)||"").toUpperCase();
  const blockCount=liveActs.slice(0,idx).filter(a=>a.type==="station_block").length;
  const schedBadge=schedDelta===null?null:(Math.abs(schedDelta)<1?<span style={{background:"var(--gbg)",color:"var(--green)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>On time</span>:schedDelta>0?<span style={{background:"var(--ambg)",color:"var(--amber)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>+{schedDelta}m behind</span>:<span style={{background:"var(--gbg)",color:"var(--green)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>{Math.abs(schedDelta)}m ahead</span>);

  return (<div className="ccs">
    {!isController&&<div style={{background:"var(--ambg)",borderBottom:"1px solid var(--ambb)",padding:"8px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
      <span style={{fontSize:12,color:"var(--amber)",fontWeight:600}}>Read-only — {controllerName} has control</span>
      <button className="btn primary bxs" onClick={takeControlNow}>Take Control</button>
    </div>}
    <div className="cc-header">
      <div>
        <div className="row"><span className="live"/><span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginLeft:5}}>Live</span>{schedBadge}</div>
        {isBlock&&<div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)"}}>
          {(()=>{const totalBlocks=liveActs.filter(a=>a.type==="station_block").length;const n2=cur.stations?cur.stations.length:0;const totalMins=n2*(cur.stationDuration||0)+Math.max(0,n2-1)*(blockRotate?(cur.transitionDuration||0):0);return(totalBlocks>1?"Block "+(blockCount+1)+" of "+totalBlocks+" · ":"")+n2+" Stations · "+totalMins+"min total";})()}
        </div>}
        <div className="cc-act-name">{phaseLabel}</div>
      </div>
      <div className="row">
        <button onClick={()=>setShowAtt(true)} style={{background:pCount<pTotal?"var(--ambg)":"var(--gbg)",border:"1.5px solid",borderColor:pCount<pTotal?"var(--ambb)":"var(--gb)",borderRadius:20,padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
          <span style={{fontFamily:"DM Mono,monospace",fontSize:13,fontWeight:700,color:pCount<pTotal?"var(--amber)":"var(--green)"}}>{pCount}/{pTotal}</span>
        </button>
        <button className="btn ghost bxs" onClick={()=>setShowROS(s=>!s)}>{showROS?"Close":"Overview"}</button>
        <button onClick={()=>{
          if(!audioOn){
            try{
              window.speechSynthesis.cancel();
              const u=new SpeechSynthesisUtterance("Audio on");
              u.rate=1;u.volume=1;
              window.speechSynthesis.speak(u);
            }catch(e){}
          }
          spoken.current={};buzzedRef.current=false;warnedRef.current=false;setAudioOn(a=>!a);
        }} style={{background:audioOn?"var(--gbg)":"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"var(--rs)",padding:"4px 10px",fontSize:13,fontWeight:700,cursor:"pointer",color:audioOn?"var(--green)":"var(--td)"}}>{audioOn?"🔊 On":"🔇 Off"}</button>
        <div style={{position:"relative"}}>
          <button className="ell-btn" onClick={()=>setShowEllipsis(s=>!s)}><span/><span/><span/></button>
          {showEllipsis&&<div className="mini-menu" style={{right:0,minWidth:160}}>
            {isController&&<button className="mm-item" onClick={()=>{setShowEllipsis(false);setShowEditBuilder(true);}}>Edit Practice</button>}
            <button className="mm-item" onClick={()=>{setShowEllipsis(false);if(!audioOn){try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance("Audio on");u.rate=1;u.volume=1;window.speechSynthesis.speak(u);}catch(e){}}spoken.current={};buzzedRef.current=false;warnedRef.current=false;setAudioOn(a=>!a);}}>{audioOn?"Mute Audio":"Enable Audio"}</button>
            {session&&<button className="mm-item" onClick={()=>{setShowEllipsis(false);shareLive();}}>Share Live View</button>}
            {isController&&<button className="mm-item" onClick={endPractice}>End Practice</button>}
            {isController&&<button className="mm-item" onClick={restartPractice}>Restart Practice</button>}
          </div>}
        </div>
      </div>
    </div>
    {showROS&&<div style={{background:"var(--s1)",borderBottom:"1px solid var(--b)",maxHeight:200,overflowY:"auto",flexShrink:0}}>
      {liveActs.map((a,i)=>(<div key={a.id} style={{display:"flex",alignItems:"center",padding:"8px 14px",borderBottom:"1px solid var(--b)",background:i===idx?"var(--gbg)":"#fff",cursor:isController?"pointer":"default",opacity:i<idx?0.5:1}} onClick={()=>{if(isController)jumpTo(i);}}>
        <div style={{flex:1,fontSize:14,color:i===idx?"var(--green)":i<idx?"var(--td)":"var(--black)",textDecoration:i<idx?"line-through":"none"}}>{i===idx?">> ":""}{a.type==="station_block"?"Station Block":a.name}</div>
        <span className="bs bdg" style={{fontSize:11}}>{a.type==="station_block"?(a.stations.length*a.stationDuration+(a.stations.length-1)*a.transitionDuration)+"m":a.duration+"m"}</span>
      </div>))}
      <div style={{padding:"8px 14px"}}><button className="btn ghost bxs" onClick={()=>setShowROS(false)}>Close</button></div>
    </div>}
    <div className="cc-timer-row">
      <div className={"cc-timer"+(urg?" urg":"")+(isOver?" over":"")}>{fmt(rem)}</div>
      {isController&&<button onClick={togglePlay} style={{width:52,height:52,borderRadius:"50%",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,background:isOver?"var(--red)":running?"var(--s3)":"var(--green)",color:isOver?"#fff":running?"var(--black2)":"#fff",boxShadow:running?"none":"0 2px 8px rgba(45,106,79,.35)"}}>
        {running?<Ic.Pause/>:<Ic.Play/>}
      </button>}
      <div style={{flex:1}}/>
      {schedBadge}
    </div>
    {isController&&<div style={{padding:"2px 14px 4px",display:"flex",gap:8,flexShrink:0}}>
      <button className="btn ghost bsm" style={{flex:1}} onClick={()=>nudge(-60)}>+1m</button>
      <button className="btn ghost bsm" style={{flex:1}} onClick={()=>nudge(60)}>-1m</button>
    </div>}
    <div className="cc-prog"><div className={"cc-prog-bar"+(isOver?" over":"")} style={{width:(Math.min(1,prog)*100)+"%"}}/></div>
    {isController&&<div className="cc-controls">
      <button className="btn ghost bmd" style={{minWidth:52}} onClick={goBack} disabled={idx===0&&stIdx===0&&!inTrans}>&lt;</button>
      <button className="btn primary blg" style={{flex:1}} onClick={advance}>{isBlock&&!blockRotate?"End Block":"Next >"}</button>
    </div>}
    <div className="cc-body">
      {isCl&&cur&&<div className="cc-focus">
        <div className="cc-focus-lbl">{cur.name} - {Object.values(clState[cur.id]||{}).filter(Boolean).length}/{(cur.items||[]).length} covered</div>
        {(cur.items||[]).map(it=>(<div key={it.id} className="cl-item" onClick={()=>toggleCl(cur.id,it.id)}>
          <div className={"cl-check "+((clState[cur.id]||{})[it.id]?"done":"")}>{(clState[cur.id]||{})[it.id]&&<Ic.Check/>}</div>
          <div className={"cl-text "+((clState[cur.id]||{})[it.id]?"done":"")}>{it.text}</div>
        </div>))}
        {cur.notes&&<div style={{fontSize:13,color:"var(--black2)",marginTop:8,fontStyle:"italic"}}>{cur.notes}</div>}
      </div>}
      {!isBlock&&!isCl&&cur&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {cur.description&&<div style={{borderLeft:"3px solid var(--b)",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:4}}>Description</div>
          <div style={{fontSize:14,color:"var(--black)",lineHeight:1.5}}>{cur.description}</div>
        </div>}
        {cur.coachingPoints&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#16a34a",marginBottom:4}}>💡 Coaching Focus</div>
          <div style={{fontSize:15,color:"var(--black)",lineHeight:1.5}}>{cur.coachingPoints}</div>
        </div>}
        {subName(cur.sublocationId)&&<div style={{borderLeft:"3px solid #2563eb",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#2563eb",marginBottom:3}}>📍 Location</div>
          <div style={{fontSize:14,color:"var(--black)",fontWeight:600}}>{subName(cur.sublocationId)}</div>
        </div>}
        {coachName(cur.coachId)&&<div style={{borderLeft:"3px solid var(--b)",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:3}}>Coach</div>
          <div style={{fontSize:14,color:"var(--black)"}}>{coachName(cur.coachId)}</div>
        </div>}
        {(()=>{const eq=Array.isArray(cur.equipment)?cur.equipment:[];const names=eq.map(id=>{const a=(data.assets||[]).find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);return(names.length>0||cur.playerGear)?(<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {names.length>0&&<span style={{border:"1.5px solid #fde047",borderRadius:20,padding:"3px 10px",fontSize:12,color:"#854d0e",fontWeight:600,background:"#fff"}}>Equipment: {names.join(", ")}</span>}
          {cur.playerGear&&<span style={{border:"1.5px solid #fdba74",borderRadius:20,padding:"3px 10px",fontSize:12,color:"#9a3412",fontWeight:600,background:"#fff"}}>Player Gear: {cur.playerGear}</span>}
        </div>):null;})()}
        {(!cur.grouping||cur.grouping==="whole")&&<div style={{borderLeft:"3px solid var(--b)",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:3}}>👥 Players</div>
          <div style={{fontSize:14,color:"var(--black)"}}>Whole Team Together</div>
        </div>}
        {cur.grouping&&cur.grouping!=="whole"&&!liveGroups&&<div style={{borderLeft:"3px solid #c4b5fd",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#7c3aed",marginBottom:3}}>👥 {cur.grouping==="partners"?"Partners":"Groups"}</div>
          <div style={{fontSize:13,color:"var(--td)"}}>Assigning groups...</div>
        </div>}
        {liveGroups&&liveGroups.length>0&&<div style={{borderLeft:"3px solid #7c3aed",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#7c3aed"}}>👥 {cur.grouping==="partners"?"Partners":"Groups"}</div>
            {isController&&<button className="btn ghost bxs" onClick={reshuffleGroups}>Reshuffle</button>}
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {liveGroups.map((g,i)=>(<div key={i} style={{display:"inline-flex",alignItems:"center",gap:6,border:"1.5px solid #c4b5fd",borderRadius:20,padding:"5px 12px",background:"#fff"}}>
              <span style={{fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700,color:"#7c3aed",flexShrink:0}}>{cur.grouping==="partners"?"P"+(i+1):"G"+(i+1)}</span>
              <span style={{fontSize:13,fontWeight:600,color:"var(--black)"}}>{g.map(pid=>pname(pid)).join(" · ")}</span>
            </div>))}
          </div>
        </div>}
      </div>}
      {isBlock&&inBlockIntro&&cur.stations&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"var(--td)",marginBottom:12}}>Get everyone to their station</div>
        {cur.stations.map((st,i)=>{
          const stEquip=(Array.isArray(st.equipment)?st.equipment:[]).map(id=>{const a=(data.assets||[]).find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);
          const assignments=liveGroups?(liveGroups[i]||[]):[];
          return(<div key={st.id} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)"}}>Station {i+1}</div>
              {subName(st.sublocationId)&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600}}>{subName(st.sublocationId)}</div>}
              {coachName(st.coachId)&&<div style={{fontSize:11,color:"var(--td)"}}>{coachName(st.coachId)}</div>}
            </div>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"var(--black)",marginBottom:6}}>{st.activityName||st.name||"Station "+(i+1)}</div>
            {(stEquip.length>0||st.playerGear)&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
              {stEquip.length>0&&<span style={{border:"1.5px solid #fde047",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#854d0e",fontWeight:600,background:"#fff"}}>Equipment: {stEquip.join(", ")}</span>}
              {st.playerGear&&<span style={{border:"1.5px solid #fdba74",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#9a3412",fontWeight:600,background:"#fff"}}>Player Gear: {st.playerGear}</span>}
            </div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {assignments.map(pid=>(<StationPlayerChip key={pid} pid={pid} team={team}/>))}
            </div>
          </div>);
        })}
        {isController&&<div className="brow mt10">
          <button className="btn outline bmd" style={{flex:1}} onClick={reshuffleBlockIntro}>Reshuffle</button>
          <button className="btn primary bmd" style={{flex:1}} onClick={startBlock}>Start Block ▶</button>
        </div>}
      </div>}
      {isBlock&&!inBlockIntro&&!inTrans&&rotatedStations&&<div>
        {focusSt!==null&&<div>
          <button className="btn ghost bxs" style={{marginBottom:10}} onClick={()=>setFocusSt(null)}>&#8249; All Stations</button>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginBottom:2}}>Station {focusSt+1}</div>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:36,fontWeight:900,color:"var(--black)",lineHeight:1,marginBottom:6}}>{rotatedStations[focusSt].activityName||rotatedStations[focusSt].name||"Station "+(focusSt+1)}</div>
          {(coachName(rotatedStations[focusSt].coachId)||subName(rotatedStations[focusSt].sublocationId))&&<div style={{fontSize:14,fontWeight:600,color:"var(--green2)",marginBottom:10}}>
            {coachName(rotatedStations[focusSt].coachId)&&<span>{coachName(rotatedStations[focusSt].coachId)}</span>}
            {coachName(rotatedStations[focusSt].coachId)&&subName(rotatedStations[focusSt].sublocationId)&&<span> · </span>}
            {subName(rotatedStations[focusSt].sublocationId)&&<span>{subName(rotatedStations[focusSt].sublocationId)}</span>}
          </div>}
          {rotatedStations[focusSt].coachingPoints&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:10,paddingTop:4,paddingBottom:8,marginBottom:4}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#16a34a",marginBottom:4}}>💡 Coaching Focus</div>
            <div style={{fontSize:15,color:"var(--black)",lineHeight:1.5}}>{rotatedStations[focusSt].coachingPoints}</div>
          </div>}
          {(()=>{const stEquip=Array.isArray(rotatedStations[focusSt].equipment)?rotatedStations[focusSt].equipment:[];const names=stEquip.map(id=>{const a=(data&&data.assets||[]).find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);return(names.length>0||rotatedStations[focusSt].playerGear)?(<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {names.length>0&&<span style={{background:"#fefce8",border:"1px solid #fde047",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#854d0e",fontWeight:600}}>Equipment: {names.join(", ")}</span>}
            {rotatedStations[focusSt].playerGear&&<span style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#9a3412",fontWeight:600}}>Player Gear: {rotatedStations[focusSt].playerGear}</span>}
          </div>):null;})()}
          <div>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Players at this station</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {(rotatedStations[focusSt].assignments||[]).map(pid=>(<PlayerChipLive key={pid} pid={pid} team={team} onMove={()=>{if(isController)setMovePlayer(pid);}} onProfile={pl=>setLivePlayerProfile(pl)}/>))}
            </div>
          </div>
        </div>}
        {focusSt===null&&<div>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>{blockRotate?"Round "+(stIdx+1)+" of "+cur.stations.length+" — Tap to focus":"All Stations — Tap to focus"}</div>
          {rotatedStations.map((st,i)=>{
            const stEquip=Array.isArray(st.equipment)?st.equipment:[];
            const equipNames=stEquip.map(id=>{const a=(data&&data.assets||[]).find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);
            return (<div key={st.id} onClick={()=>setFocusSt(i)} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8,cursor:"pointer"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}>
                <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)"}}>Station {i+1}</div>
                {coachName(st.coachId)&&<div style={{fontSize:11,color:"var(--td)"}}>{coachName(st.coachId)}</div>}
              </div>
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,color:"var(--black)",lineHeight:1.1,marginBottom:4}}>{st.activityName||st.name||"Station "+(i+1)}</div>
              {subName(st.sublocationId)&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:4}}>{subName(st.sublocationId)}</div>}
              {st.coachingPoints&&<div style={{fontSize:12,color:"var(--black2)",marginBottom:6,lineHeight:1.4,borderLeft:"2px solid var(--green)",paddingLeft:8}}>{st.coachingPoints}</div>}
              {(equipNames.length>0||st.playerGear)&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
                {equipNames.length>0&&<span style={{background:"#fefce8",border:"1px solid #fde047",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#854d0e",fontWeight:600}}>Equipment: {equipNames.join(", ")}</span>}
                {st.playerGear&&<span style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#9a3412",fontWeight:600}}>Player Gear: {st.playerGear}</span>}
              </div>}
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {(st.assignments||[]).map(pid=>(<StationPlayerChip key={pid} pid={pid} team={team}/>))}
              </div>
              <div style={{fontSize:10,color:"var(--td)",marginTop:6}}>Tap to focus</div>
            </div>);
          })}
        </div>}
        {movePlayer&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setMovePlayer(null);}}>
          <div className="modal">
            <div className="mhandle"/>
            <div className="mtitle">Move {(team&&team.players.find(p=>p.id===movePlayer)&&team.players.find(p=>p.id===movePlayer).firstName)||"Player"}</div>
            <div style={{fontSize:13,color:"var(--td)",marginBottom:12}}>Move to which station?</div>
            {cur.stations.map((st,si)=>{
              const n2=cur.stations.length;
              const toGroupIdx=((si-stIdx)%n2+n2)%n2;
              const fromGroupIdx=liveGroups?liveGroups.findIndex(g=>g.includes(movePlayer)):-1;
              const isCurrent=toGroupIdx===fromGroupIdx;
              return(<button key={st.id} className={"btn bmd bfull "+(isCurrent?"ghost":"outline")} style={{marginBottom:8,opacity:isCurrent?0.5:1}} disabled={isCurrent} onClick={()=>movePlayerToStation(si)}>
                {st.name}{st.activityName?": "+st.activityName:""}{isCurrent?" (current)":""}
              </button>);
            })}
            <button className="btn ghost bmd bfull" style={{marginTop:4}} onClick={()=>setMovePlayer(null)}>Cancel</button>
          </div>
        </div>}
        {livePlayerProfile&&<div className="movly" onClick={()=>setLivePlayerProfile(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="mhandle"/>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div>
                <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900}}>{livePlayerProfile.firstName} {livePlayerProfile.lastName}</div>
                {livePlayerProfile.jersey&&<div style={{fontFamily:"DM Mono,monospace",fontSize:13,color:"var(--green)"}}>#{livePlayerProfile.jersey}</div>}
              </div>
              <button className="btn ghost bxs" onClick={()=>setLivePlayerProfile(null)}>Close</button>
            </div>
            <div>
              {(livePlayerProfile.focusAreas&&livePlayerProfile.focusAreas.length>0)&&<div>
                <div className="clbl mb8">Focus Areas</div>
                {livePlayerProfile.focusAreas.map((a,i)=>(<div key={a.id} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:8,padding:"10px 12px",background:"var(--s2)",borderRadius:"var(--rs)"}}>
                  <div style={{width:20,height:20,borderRadius:"50%",background:"var(--green)",color:"#fff",fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{i+1}</div>
                  <div style={{flex:1,fontSize:14,lineHeight:1.5}}>{a.text}</div>
                </div>))}
              </div>}
              {(!livePlayerProfile.focusAreas||livePlayerProfile.focusAreas.length===0)&&<div style={{fontSize:14,color:"var(--td)",textAlign:"center",padding:"16px 0"}}>No focus areas added yet.</div>}
            </div>
            {isController&&<button className="btn outline bsm bfull mt8" onClick={()=>{setMovePlayer(livePlayerProfile.id);setLivePlayerProfile(null);}}>Move to Another Station</button>}
          </div>
        </div>}
      </div>}
      {isBlock&&inTrans&&rotatedStations&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:900,color:"var(--red)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:10}}>Rotate Now</div>
        {rotatedStations.map((st,i)=>{
          const nextSt=cur.stations[(i+1)%cur.stations.length];
          const fromLabel="Station "+(i+1)+(st.activityName?": "+st.activityName:"")+(coachName(st.coachId)?" · "+coachName(st.coachId):"");
          const toLabel="Station "+((i+1)%cur.stations.length+1)+(nextSt.activityName?": "+nextSt.activityName:"")+(coachName(nextSt.coachId)?" · "+coachName(nextSt.coachId):"");
          return (<div key={st.id} className="cc-trans-card">
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"var(--black)",lineHeight:1.2,marginBottom:6}}>{pnames(st.assignments)||"--"}</div>
            <div style={{fontSize:12,color:"var(--td)",marginBottom:3}}>from {fromLabel}</div>
            <div style={{fontSize:13,fontWeight:700,color:"var(--black)"}}>→ {toLabel}</div>
            {subName(nextSt.sublocationId)&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginTop:2}}>{subName(nextSt.sublocationId)}</div>}
          </div>);
        })}
      </div>}
      {liveActs.slice(idx+1,idx+4).length>0&&<div className="cc-queue">
        <div style={{padding:"6px 12px",fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)"}}>Up Next</div>
        {liveActs.slice(idx+1,idx+4).map(a=>(<div key={a.id} className="cc-queue-item">
          <span style={{fontSize:14,color:"var(--black2)"}}>{a.type==="station_block"?"Station Block":a.name}</span>
          <span className="bdg bs">{a.type==="station_block"?(a.stations.length*a.stationDuration+(a.stations.length-1)*a.transitionDuration)+"m":a.duration+"m"}</span>
        </div>))}
      </div>}
    </div>
    <div className="cc-note-bar">
      <input className="inp" placeholder="Quick note..." value={noteText} onChange={e=>setNoteText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNote()} style={{fontSize:14}}/>
      <button className="btn primary bsm" onClick={addNote}>Save</button>
    </div>
    {showShare&&shareToken&&<ShareSheet token={shareToken} onClose={()=>setShowShare(false)}/>}
  </div>);
}
