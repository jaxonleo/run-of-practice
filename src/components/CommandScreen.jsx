import React, { useState, useEffect, useRef, useCallback } from "react";
import { uid, fmt, actSecs, sumMins, rebalanceKeep, rebalanceEven, assignGroups } from "../constants.js";
import { createSession, updateSession, endSession, getSession, subscribeToSession } from "../supabase.js";

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

function ShareSheet({sessionId,onClose}){
  const url=window.location.origin+"/live/"+sessionId;
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
  const team=data.teams.find(t=>t.id===practice.teamId)||null;
  const loc=data.locations.find(l=>l.id===practice.locationId)||null;
  const fmtDate=ds=>new Date(ds+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
  const coachName=id=>{const c=team&&team.coaches.find(c=>c.id===id);return c?c.name:null;};
  const subName=id=>{const s=loc&&loc.sublocations.find(s=>s.id===id);return s?s.name:null;};
  const pnames=ids=>(ids||[]).map(id=>{const p=team&&team.players.find(p=>p.id===id);return p?p.firstName:null;}).filter(Boolean).join(", ");
  const [tplNameInput,setTplNameInput]=useState("");
  const [showTplInput,setShowTplInput]=useState(false);
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
  return (<div style={{paddingBottom:80}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
      <button className="btn ghost bxs" onClick={onBack}>Back</button>
      <div>
        <div className="ptitle" style={{fontSize:20}}>{team?team.name:"Practice"}</div>
        <div className="limt">{fmtDate(practice.date)}{practice.startTime?" at ":""}{loc?" - "+loc.name:""}</div>
      </div>
    </div>
    <div className="sechdr mb8">
      <span className="sectitle">{practice.activities.length} Activities</span>
      <span className="pill">{sumMins(practice.activities)}m</span>
    </div>
    {practice.activities.map(act=>(<div key={act.id} className="ablk" style={{marginBottom:8}}>
      <div style={{display:"flex",alignItems:"center",padding:"11px 12px",background:"var(--s2)",gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{font:"700 14px Barlow Condensed,sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{act.type==="station_block"?"Station Block":act.name}</div>
          {act.type==="station_block"?(<div className="limt">{act.stations.map(s=>s.activityName||s.name).join(" / ")} - {act.stationDuration}m each</div>
          ):(<div className="limt">{act.duration}min{coachName(act.coachId)?" - "+coachName(act.coachId):""}</div>)}
        </div>
        {act.type!=="station_block"&&<span className="bdg bs">{act.duration}m</span>}
      </div>
      {act.type==="station_block"&&(<div style={{padding:"10px 12px",borderTop:"1px solid var(--b)"}}>
        {act.stations.map(st=>(<div key={st.id} style={{marginBottom:8,paddingBottom:8,borderBottom:"1px solid var(--b)"}}>
          <div style={{font:"700 13px Barlow Condensed,sans-serif"}}>{st.name}{st.activityName?": "+st.activityName:""}</div>
          {(coachName(st.coachId)||subName(st.sublocationId))&&<div className="limt">{coachName(st.coachId)&&"Coach: "+coachName(st.coachId)+"  "}{subName(st.sublocationId)&&subName(st.sublocationId)}</div>}
          {st.coachingPoints&&<div style={{fontSize:12,color:"var(--green2)"}}>{st.coachingPoints}</div>}
          {st.assignments&&st.assignments.length>0&&<div className="limt">{pnames(st.assignments)}</div>}
        </div>))}
      </div>)}
    </div>))}
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

function HelperView({sessionId}){
  const [session,setSession]=useState(null);
  const [loading,setLoading]=useState(true);
  const [focusSt,setFocusSt]=useState(null);
  const [showROS,setShowROS]=useState(false);
  const [showAtt,setShowAtt]=useState(false);
  const [audioOn,setAudioOn]=useState(false);
  const audioCtxRef=useRef(null);
  const subRef=useRef(null);
  const spokenRef=useRef({});
  const [tick,setTick]=useState(0);
  useEffect(()=>{const iv=setInterval(()=>setTick(t=>t+1),1000);return()=>clearInterval(iv);},[]);
  useEffect(()=>{
    getSession(sessionId).then(s=>{setSession(s);setLoading(false);});
    subRef.current=subscribeToSession(sessionId,updated=>{setSession(updated);});
    return()=>{if(subRef.current)subRef.current.unsubscribe();};
  },[sessionId]);
  const beep=async()=>{if(!audioOn)return;try{if(!audioCtxRef.current)audioCtxRef.current=new(window.AudioContext||window.webkitAudioContext)();const ctx=audioCtxRef.current;if(ctx.state!=="running")await ctx.resume();const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.type="sine";o.frequency.value=880;g.gain.setValueAtTime(0.4,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.3);}catch(e){}};
  const speak=txt=>{if(!audioOn)return;try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(txt);u.rate=0.9;window.speechSynthesis.speak(u);}catch(e){}};
  if(loading)return(<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#0d1512"}}><div style={{color:"#52b788",fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700,letterSpacing:".1em"}}>JOINING SESSION...</div></div>);
  if(!session)return(<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,background:"#0d1512",padding:"24px"}}><div style={{color:"#fff",fontFamily:"Barlow Condensed,sans-serif",fontSize:24,fontWeight:900,textAlign:"center"}}>Session not found</div><div style={{color:"#555",fontSize:14,textAlign:"center"}}>This link may be invalid or the practice has ended.</div></div>);
  if(session.ended_at||(session.state&&session.state.ended))return(<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,background:"#0d1512",padding:"24px"}}><div style={{color:"#52b788",fontFamily:"Barlow Condensed,sans-serif",fontSize:48,fontWeight:900,textAlign:"center"}}>Well Done</div><div style={{color:"#555",fontSize:14,textAlign:"center"}}>This practice session has ended.</div></div>);
  const state=session.state||{};
  const liveActs=state.liveActs||[];
  const roster=state.roster||[];
  const locations=state.locations||[];
  const assets=state.assets||[];
  const presentIds=new Set(state.presentIds||[]);
  const liveGroups=state.liveGroups||null;
  const idx=state.idx||0;
  const stIdx=state.stIdx||0;
  const inTrans=state.inTrans||false;
  const running=state.running||false;
  const runningAt=state.runningAt||null;
  const savedElapsed=state.elapsed||0;
  const cur=liveActs[idx]||null;
  const isBlock=cur&&cur.type==="station_block";
  const isCl=cur&&cur.type==="checklist";
  const blockRotate=isBlock&&cur.rotate!==false;
  const phaseSecs=isBlock?(blockRotate&&inTrans?cur.transitionDuration*60:cur.stationDuration*60):(cur?((cur.duration||0)*60):0);
  const elapsed=running&&runningAt?savedElapsed+Math.floor((Date.now()-runningAt)/1000):savedElapsed;
  const rem=phaseSecs-elapsed;
  const prog=phaseSecs>0?Math.min(1,elapsed/phaseSecs):0;
  const urg=rem<=30&&rem>0&&running;
  const n=isBlock&&cur.stations?cur.stations.length:1;
  const rotatedStations=isBlock&&cur.stations?(cur.stations.map((st,i)=>{const srcIdx=(i-stIdx%n+n)%n;return Object.assign({},cur.stations[i],{assignments:cur.stations[srcIdx].assignments});})):null;
  const phaseLabel=isBlock?(blockRotate?(inTrans?"TRANSITION":"STATION "+(stIdx+1)+" of "+n):"STATION BLOCK"):((cur&&cur.name)||"").toUpperCase();
  const pname=id=>{const p=roster.find(p=>p.id===id);return p?(p.jersey?"#"+p.jersey+" "+p.firstName:p.firstName):id;};
  const subName=id=>{const l=locations.find(l=>l.sublocations&&l.sublocations.find(s=>s.id===id));if(!l)return null;const s=l.sublocations.find(s=>s.id===id);return s?s.name:null;};
  const pnames=ids=>(ids||[]).map(id=>pname(id)).join(", ");
  const pCount=presentIds.size;
  useEffect(()=>{if(!audioOn)return;if(rem===120&&!spokenRef.current[idx+"_120"]){speak("Two minutes remaining.");spokenRef.current[idx+"_120"]=true;}if(rem===0&&!spokenRef.current[idx+"_0"]){beep();spokenRef.current[idx+"_0"]=true;}},[elapsed,audioOn]);
  return(<div className="ccs">
    <div className="cc-header">
      <div>
        <div className="row"><span className="live"/><span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginLeft:5}}>Live</span><span style={{marginLeft:8,fontSize:11,color:"var(--td)"}}>Helper View</span></div>
        {isBlock&&<div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)"}}>{(()=>{const n2=cur.stations?cur.stations.length:0;const totalMins=n2*(cur.stationDuration||0)+Math.max(0,n2-1)*(blockRotate?(cur.transitionDuration||0):0);return n2+" Stations · "+totalMins+"min total";})()}</div>}
        <div className="cc-act-name">{phaseLabel}</div>
      </div>
      <div className="row" style={{gap:6}}>
        <button onClick={()=>setShowAtt(s=>!s)} style={{background:pCount<roster.length?"var(--ambg)":"var(--gbg)",border:"1.5px solid",borderColor:pCount<roster.length?"var(--ambb)":"var(--gb)",borderRadius:20,padding:"4px 10px",cursor:"pointer"}}>
          <span style={{fontFamily:"DM Mono,monospace",fontSize:13,fontWeight:700,color:pCount<roster.length?"var(--amber)":"var(--green)"}}>{pCount}/{roster.length}</span>
        </button>
        <button onClick={async()=>{if(!audioOn){try{const ctx=new(window.AudioContext||window.webkitAudioContext)();audioCtxRef.current=ctx;await ctx.resume();const o=ctx.createOscillator();const g=ctx.createGain();o.connect(g);g.connect(ctx.destination);g.gain.setValueAtTime(0.1,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.2);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.2);}catch(e){}}spokenRef.current={};setAudioOn(a=>!a);}} style={{background:audioOn?"var(--gbg)":"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"var(--rs)",padding:"4px 10px",fontSize:13,fontWeight:700,cursor:"pointer",color:audioOn?"var(--green)":"var(--td)"}}>{audioOn?"🔊":"🔇"}</button>
        <button className="btn ghost bxs" onClick={()=>setShowROS(s=>!s)}>{showROS?"Close":"Overview"}</button>
      </div>
    </div>
    {showAtt&&<div style={{background:"var(--s1)",borderBottom:"1px solid var(--b)",padding:"12px 14px",maxHeight:200,overflowY:"auto",flexShrink:0}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Attendance ({pCount}/{roster.length})</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {roster.map(p=>(<span key={p.id} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid",borderColor:presentIds.has(p.id)?"var(--green)":"var(--b)",background:presentIds.has(p.id)?"var(--gbg)":"var(--s2)",color:presentIds.has(p.id)?"var(--green)":"var(--td)",fontSize:13,fontWeight:600}}>{p.jersey?"#"+p.jersey+" ":""}{p.firstName}</span>))}
      </div>
      <button className="btn ghost bxs" style={{marginTop:8}} onClick={()=>setShowAtt(false)}>Close</button>
    </div>}
    {showROS&&<div style={{background:"var(--s1)",borderBottom:"1px solid var(--b)",maxHeight:200,overflowY:"auto",flexShrink:0}}>
      {liveActs.map((a,i)=>(<div key={a.id} style={{display:"flex",alignItems:"center",padding:"8px 14px",borderBottom:"1px solid var(--b)",background:i===idx?"var(--gbg)":"#fff",opacity:i<idx?0.5:1}}>
        <div style={{flex:1,fontSize:14,color:i===idx?"var(--green)":i<idx?"var(--td)":"var(--black)",textDecoration:i<idx?"line-through":"none"}}>{i===idx?"▶ ":""}{a.type==="station_block"?"Station Block":a.name}</div>
        <span className="bdg bs" style={{fontSize:11}}>{a.type==="station_block"?(a.stations.length*a.stationDuration+(a.stations.length-1)*(a.transitionDuration||0))+"m":a.duration+"m"}</span>
      </div>))}
      <div style={{padding:"8px 14px"}}><button className="btn ghost bxs" onClick={()=>setShowROS(false)}>Close</button></div>
    </div>}
    <div className="cc-timer-row"><div className={"cc-timer"+(urg?" urg":(elapsed>phaseSecs?" over":""))}>{fmt(rem)}</div></div>
    <div className="cc-prog"><div className={"cc-prog-bar"+(elapsed>phaseSecs?" over":"")} style={{width:(Math.min(1,prog)*100)+"%"}}/></div>
    <div className="cc-body">
      {isCl&&cur&&<div className="cc-focus"><div className="cc-focus-lbl">{cur.name}</div>{(cur.items||[]).map(it=>(<div key={it.id} className="cl-item"><div className="cl-check"/><div className="cl-text">{it.text}</div></div>))}</div>}
      {!isBlock&&!isCl&&cur&&<div style={{display:"flex",flexDirection:"column",gap:10}}>
        {cur.coachingPoints&&<div style={{background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:"var(--r)",padding:"12px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#16a34a",marginBottom:6}}>💡 Coaching Focus</div>
          <div style={{fontSize:15,color:"var(--black)",lineHeight:1.5}}>{cur.coachingPoints}</div>
        </div>}
        {(cur.coachId||cur.sublocationId)&&<div style={{background:"#eff6ff",border:"1.5px solid #93c5fd",borderRadius:"var(--r)",padding:"10px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#2563eb",marginBottom:4}}>📍 Location</div>
          <div style={{fontSize:14,color:"var(--black)"}}>
            {subName(cur.sublocationId)&&<span style={{fontWeight:600}}>{subName(cur.sublocationId)}</span>}
            {subName(cur.sublocationId)&&cur.coachId&&<span style={{color:"var(--td)"}}> · </span>}
            {cur.coachId&&<span>Coach: {pname(cur.coachId)}</span>}
          </div>
        </div>}
        {(()=>{const eq=Array.isArray(cur.equipment)?cur.equipment:[];const names=eq.map(id=>{const a=assets.find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);return(names.length>0||cur.playerGear)?(<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {names.length>0&&<span style={{background:"#fefce8",border:"1px solid #fde047",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#854d0e",fontWeight:600}}>Equipment: {names.join(", ")}</span>}
          {cur.playerGear&&<span style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#9a3412",fontWeight:600}}>Player Gear: {cur.playerGear}</span>}
        </div>):null;})()}
        {(!cur.grouping||cur.grouping==="whole")&&<div style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"10px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:4}}>👥 Players</div>
          <div style={{fontSize:14,color:"var(--black)"}}>Whole Team Together</div>
        </div>}
        {liveGroups&&liveGroups.length>0&&<div style={{background:"#f5f3ff",border:"1.5px solid #c4b5fd",borderRadius:"var(--r)",padding:"12px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#7c3aed",marginBottom:10}}>👥 {cur.grouping==="partners"?"Partners":"Groups"}</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {liveGroups.map((g,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:8,background:"#fff",border:"1.5px solid #c4b5fd",borderRadius:20,padding:"6px 12px"}}>
              <span style={{fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700,color:"#7c3aed",flexShrink:0}}>{cur.grouping==="partners"?"P"+(i+1):"G"+(i+1)}</span>
              <span style={{fontSize:13,fontWeight:600,color:"var(--black)"}}>{g.map(p=>typeof p==="object"?(p.jersey?"#"+p.jersey+" "+p.firstName:p.firstName):pname(p)).join(" · ")}</span>
            </div>))}
          </div>
        </div>}
        {cur.grouping&&cur.grouping!=="whole"&&!liveGroups&&<div style={{background:"#f5f3ff",border:"1.5px solid #c4b5fd",borderRadius:"var(--r)",padding:"10px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#7c3aed",marginBottom:4}}>👥 {cur.grouping==="partners"?"Partners":"Groups"}</div>
          <div style={{fontSize:13,color:"var(--td)"}}>Waiting for coach to assign groups...</div>
        </div>}
      </div>}
      {isBlock&&!inTrans&&rotatedStations&&<div>
        {focusSt!==null&&<div>
          <button className="btn ghost bxs" style={{marginBottom:10}} onClick={()=>setFocusSt(null)}>&#8249; All Stations</button>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginBottom:2}}>Station {focusSt+1}</div>
          {subName(rotatedStations[focusSt].sublocationId)&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:3}}>{subName(rotatedStations[focusSt].sublocationId)}</div>}
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:36,fontWeight:900,color:"var(--black)",lineHeight:1,marginBottom:6}}>{rotatedStations[focusSt].activityName||rotatedStations[focusSt].name||"Station "+(focusSt+1)}</div>
          {rotatedStations[focusSt].coachingPoints&&<div style={{background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:"var(--r)",padding:"10px 14px",marginBottom:8}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#16a34a",marginBottom:4}}>💡 Coaching Focus</div>
            <div style={{fontSize:15,color:"var(--black)",lineHeight:1.5}}>{rotatedStations[focusSt].coachingPoints}</div>
          </div>}
          {(()=>{const stEquip=Array.isArray(rotatedStations[focusSt].equipment)?rotatedStations[focusSt].equipment:[];const names=stEquip.map(id=>{const a=assets.find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);return(names.length>0||rotatedStations[focusSt].playerGear)?(<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {names.length>0&&<span style={{background:"#fefce8",border:"1px solid #fde047",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#854d0e",fontWeight:600}}>Equipment: {names.join(", ")}</span>}
            {rotatedStations[focusSt].playerGear&&<span style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#9a3412",fontWeight:600}}>Player Gear: {rotatedStations[focusSt].playerGear}</span>}
          </div>):null;})()}
          <div><div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Players at this station</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{(rotatedStations[focusSt].assignments||[]).map(pid=>(<span key={pid} style={{padding:"6px 12px",borderRadius:20,border:"1.5px solid var(--gb)",background:"var(--gbg)",fontSize:14,fontWeight:600,color:"var(--black)"}}>{pname(pid)}</span>))}</div></div>
        </div>}
        {focusSt===null&&<div>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>{blockRotate?"Round "+(stIdx+1)+" of "+n+" — Tap to focus":"All Stations — Tap to focus"}</div>
          {rotatedStations.map((st,i)=>{
            const stEquip=Array.isArray(st.equipment)?st.equipment:[];
            const equipNames=stEquip.map(id=>{const a=assets.find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);
            return(<div key={i} onClick={()=>setFocusSt(i)} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8,cursor:"pointer"}}>
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginBottom:2}}>Station {i+1}</div>
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,color:"var(--black)",lineHeight:1.1,marginBottom:4}}>{st.activityName||st.name||"Station "+(i+1)}</div>
              {subName(st.sublocationId)&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:4}}>{subName(st.sublocationId)}</div>}
              {st.coachingPoints&&<div style={{fontSize:12,color:"var(--black2)",marginBottom:6,lineHeight:1.4,borderLeft:"2px solid var(--green)",paddingLeft:8}}>{st.coachingPoints}</div>}
              {(equipNames.length>0||st.playerGear)&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
                {equipNames.length>0&&<span style={{background:"#fefce8",border:"1px solid #fde047",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#854d0e",fontWeight:600}}>Equipment: {equipNames.join(", ")}</span>}
                {st.playerGear&&<span style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#9a3412",fontWeight:600}}>Player Gear: {st.playerGear}</span>}
              </div>}
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>{(st.assignments||[]).map(pid=>(<span key={pid} style={{background:"var(--s2)",border:"1px solid var(--b)",borderRadius:8,padding:"3px 8px",fontSize:12,fontWeight:600}}>{pname(pid)}</span>))}</div>
              <div style={{fontSize:10,color:"var(--td)",marginTop:5}}>Tap to focus</div>
            </div>);
          })}
        </div>}
      </div>}
      {isBlock&&inTrans&&rotatedStations&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:900,color:"var(--red)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:10}}>Rotate Now</div>
        {rotatedStations.map((st,i)=>{
          const nextSt=cur.stations[(i+1)%n];
          const fromLabel="Station "+(i+1)+(st.activityName?": "+st.activityName:"");
          const toLabel="Station "+((i+1)%n+1)+(nextSt.activityName?": "+nextSt.activityName:"");
          return(<div key={i} className="cc-trans-card">
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"var(--black)",lineHeight:1.2,marginBottom:6}}>{pnames(st.assignments)||"--"}</div>
            <div style={{fontSize:12,color:"var(--td)",marginBottom:3}}>from {fromLabel}</div>
            <div style={{fontSize:13,fontWeight:700,color:"var(--black)"}}>→ {toLabel}</div>
            {subName(nextSt.sublocationId)&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginTop:2}}>{subName(nextSt.sublocationId)}</div>}
          </div>);
        })}
      </div>}
      {liveActs.slice(idx+1,idx+3).length>0&&<div className="cc-queue">
        <div style={{padding:"6px 12px",fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)"}}>Up Next</div>
        {liveActs.slice(idx+1,idx+3).map(a=>(<div key={a.id} className="cc-queue-item">
          <span style={{fontSize:14,color:"var(--black2)"}}>{a.type==="station_block"?"Station Block":a.name}</span>
          <span className="bdg bs">{a.type==="station_block"?(a.stations.length*a.stationDuration+(a.stations.length-1)*(a.transitionDuration||0))+"m":a.duration+"m"}</span>
        </div>))}
      </div>}
    </div>
  </div>);
}

// ── CommandScreen ─────────────────────────────────────────────────────────────
export { HelperView };

export default function CommandScreen({data,update,liveId,setLiveId,coachId,setView}){
  const practice=liveId?data.practices.find(p=>p.id===liveId):null;
  const team=practice?data.teams.find(t=>t.id===practice.teamId):null;
  const loc=practice?data.locations.find(l=>l.id===practice.locationId):null;
  const [stage,setStage]=useState("pick");
  useEffect(()=>{if(liveId&&stage==="pick")setStage("attend");},[liveId]);
  const [presentIds,setPresentIds]=useState(new Set());
  const [coachPresentIds,setCoachPresentIds]=useState(new Set());
  const [liveActs,setLiveActs]=useState([]);
  const [showAtt,setShowAtt]=useState(false);
  const [practiceStart,setPracticeStart]=useState(null);
  const [idx,setIdx]=useState(0);
  const [stIdx,setStIdx]=useState(0);
  const [inTrans,setInTrans]=useState(false);
  const [elapsed,setElapsed]=useState(0);
  const [running,setRunning]=useState(false);
  const [audioOn,setAudioOn]=useState(false);
  const [liveGroups,setLiveGroups]=useState(null);
  const audioCtxRef=useRef(null);
  const unlockAudio=async()=>{try{if(!audioCtxRef.current){audioCtxRef.current=new(window.AudioContext||window.webkitAudioContext)();}const ctx=audioCtxRef.current;if(ctx.state!=="running"){await ctx.resume();}return ctx;}catch(e){return null;}};
  const [noteText,setNoteText]=useState("");
  const [showROS,setShowROS]=useState(false);
  const [clState,setClState]=useState({});
  const [movePlayer,setMovePlayer]=useState(null);
  const [showEllipsis,setShowEllipsis]=useState(false);
  const [focusSt,setFocusSt]=useState(null);
  const [livePlayerProfile,setLivePlayerProfile]=useState(null);
  const [sessionId,setSessionId]=useState(null);
  const [showShare,setShowShare]=useState(false);
  const iref=useRef(null);
  const spoken=useRef({});
  const sessionRef=useRef(null);
  const writeSession=useCallback((newState)=>{
    if(!sessionRef.current)return;
    updateSession(sessionRef.current,newState);
  },[]);
  const cur=liveActs[idx]||null;
  const isBlock=cur&&cur.type==="station_block";
  const blockRotate=isBlock&&cur.rotate!==false;
  const isCl=cur&&cur.type==="checklist";
  const phaseSecs=isBlock?(blockRotate&&inTrans?cur.transitionDuration*60:cur.stationDuration*60):(cur?actSecs(cur):0);
  const isOver=elapsed>phaseSecs;
  const rem=phaseSecs-elapsed;
  const prog=phaseSecs>0?Math.min(1,elapsed/phaseSecs):0;
  const urg=rem<=30&&rem>0&&running;
  const pCount=presentIds.size;
  const pTotal=team?team.players.length:0;
  const completedMins=liveActs.slice(0,idx).reduce((s,a)=>s+Math.round(actSecs(a)/60),0);
  const schedDelta=(practiceStart&&practice&&practice.startTime&&practice.durMin)?(Math.floor((Date.now()-practiceStart)/60000)-completedMins-Math.floor(elapsed/60)):null;
  const rotatedStations=isBlock&&cur.stations?(()=>{const n=cur.stations.length;return cur.stations.map((st,i)=>{const srcIdx=(i-stIdx%n+n)%n;return Object.assign({},cur.stations[i],{assignments:cur.stations[srcIdx].assignments});});})():null;

  useEffect(()=>{
    const act=liveActs[idx];
    if(!act||act.type==="station_block")return;
    const g=act.grouping||"whole";
    if(g==="whole"){setLiveGroups(null);return;}
    if(presentIds.size===0)return; // wait until attendance is confirmed
    const present=[...presentIds];
    const players=(team?team.players:[]).filter(p=>present.includes(p.id));
    if(players.length===0)return;
    const groups=assignGroups(players,g,act.numGroups||2);
    setLiveGroups(groups);
    if(sessionRef.current)updateSession(sessionRef.current,{idx,stIdx,inTrans,elapsed,running,runningAt:running?Date.now():null,presentIds:[...presentIds],liveActs,liveGroups:groups,roster:practice?data.teams.find(t=>t.id===practice.teamId)?data.teams.find(t=>t.id===practice.teamId).players:[]:[],locations:data.locations,assets:data.assets||[]});
  },[idx,liveActs,presentIds]);

  const beep=useCallback(async()=>{if(!audioOn)return;const ctx=await unlockAudio();if(!ctx)return;try{const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.type='sine';o.frequency.value=880;g.gain.setValueAtTime(0.4,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.3);}catch(e){}},[audioOn]);
  const speak=useCallback(txt=>{if(!audioOn)return;try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(txt);u.rate=0.9;window.speechSynthesis.speak(u);}catch(e){};},[audioOn]);

  const applyAtt=useCallback((pIds,cIds,mode,baseActs)=>{const allPlayers=team?team.players:[];return baseActs.map(act=>{if(act.type!=="station_block")return Object.assign({},act,{assignments:(act.assignments||[]).filter(id=>pIds.has(id))});const newSt=mode==="rebalance"?rebalanceEven(act.stations,pIds,allPlayers):rebalanceKeep(act.stations,pIds);return Object.assign({},act,{stations:newSt});});},[team]);

  const handleAttConfirm=useCallback(({presentIds:pIds,coachPresentIds:cIds,balanceMode})=>{
    setPresentIds(pIds);setCoachPresentIds(cIds);
    const newActs=applyAtt(pIds,cIds,balanceMode,practice.activities);
    setLiveActs(newActs);setStage("live");setShowAtt(false);
    setPracticeStart(Date.now());setIdx(0);setStIdx(0);setInTrans(false);setElapsed(0);setRunning(true);spoken.current={};
    createSession(coachId||"anon",liveId,{idx:0,stIdx:0,inTrans:false,elapsed:0,running:true,runningAt:Date.now(),presentIds:[...pIds],liveActs:newActs,roster:practice?data.teams.find(t=>t.id===practice.teamId)?data.teams.find(t=>t.id===practice.teamId).players:[]:[],locations:data.locations,assets:data.assets||[]}).then(sid=>{
      if(sid){sessionRef.current=sid;setSessionId(sid);}
    });
  },[practice,applyAtt,coachId,liveId]);
  const handleAttUpdate=useCallback(({presentIds:pIds,coachPresentIds:cIds})=>{setPresentIds(pIds);setCoachPresentIds(cIds);setLiveActs(prev=>applyAtt(pIds,cIds,"keep",prev));setShowAtt(false);},[applyAtt]);

  const advance=useCallback(()=>{
    if(!cur)return;
    const base={liveActs,presentIds:[...presentIds],running:true,runningAt:Date.now(),elapsed:0,roster:practice?data.teams.find(t=>t.id===practice.teamId)?data.teams.find(t=>t.id===practice.teamId).players:[]:[],locations:data.locations};
    if(isBlock){
      if(blockRotate&&!inTrans&&cur.transitionDuration>0&&stIdx<cur.stations.length-1){
        baseElapsedRef.current=0;startedAtRef.current=Date.now();setInTrans(true);setElapsed(0);spoken.current={};setRunning(true);
        writeSession({...base,idx,stIdx,inTrans:true});
      }else if(blockRotate&&stIdx<cur.stations.length-1){
        const ns=stIdx+1;setStIdx(ns);setInTrans(false);baseElapsedRef.current=0;startedAtRef.current=Date.now();setElapsed(0);spoken.current={};setRunning(true);setFocusSt(null);
        writeSession({...base,idx,stIdx:ns,inTrans:false});
      }else if(idx<liveActs.length-1){
        const ni=idx+1;setIdx(ni);setStIdx(0);setInTrans(false);baseElapsedRef.current=0;startedAtRef.current=Date.now();setElapsed(0);spoken.current={};setRunning(true);setFocusSt(null);
        writeSession({...base,idx:ni,stIdx:0,inTrans:false});
      }else{setStage("end");setRunning(false);writeSession({...base,idx,stIdx,inTrans,running:false,runningAt:null});}
    }else{
      if(idx<liveActs.length-1){
        const ni=idx+1;setIdx(ni);baseElapsedRef.current=0;startedAtRef.current=Date.now();setElapsed(0);spoken.current={};setRunning(true);
        writeSession({...base,idx:ni,stIdx:0,inTrans:false});
      }else{setStage("end");setRunning(false);writeSession({...base,idx,stIdx,inTrans,running:false,runningAt:null});}
    }
  },[cur,isBlock,blockRotate,inTrans,stIdx,idx,liveActs,presentIds,writeSession]);

  const goBack=useCallback(()=>{if(isBlock){if(inTrans){setInTrans(false);baseElapsedRef.current=0;startedAtRef.current=Date.now();setElapsed(0);spoken.current={};setRunning(false);}else if(stIdx>0){setStIdx(i=>i-1);setElapsed(0);spoken.current={};setRunning(false);}else if(idx>0){setIdx(i=>i-1);setStIdx(0);setInTrans(false);setElapsed(0);spoken.current={};setRunning(false);}}else{if(idx>0){setIdx(i=>i-1);setElapsed(0);spoken.current={};setRunning(false);}}},[isBlock,inTrans,stIdx,idx]);

  const startedAtRef=useRef(null);
  const baseElapsedRef=useRef(0);
  useEffect(()=>{
    if(running){
      startedAtRef.current=Date.now();
      baseElapsedRef.current=elapsed;
      iref.current=setInterval(()=>{
        if(!startedAtRef.current)return;
        const wallElapsed=baseElapsedRef.current+Math.floor((Date.now()-startedAtRef.current)/1000);
        setElapsed(wallElapsed);
        const r=phaseSecs-wallElapsed;
        if(r===120&&!spoken.current[120]){speak("Two minutes remaining.");spoken.current[120]=true;}
        if(r===0&&!spoken.current[0]){beep();spoken.current[0]=true;}
        if(r<0&&wallElapsed%30===0){beep();}
      },500);
    }else{
      clearInterval(iref.current);
      startedAtRef.current=null;
    }
    return()=>clearInterval(iref.current);
  },[running,phaseSecs,speak,beep]);

  const coachName=id=>{const c=team&&team.coaches.find(c=>c.id===id);return c?c.name:null;};
  const subName=id=>{const s=loc&&loc.sublocations.find(s=>s.id===id);return s?s.name:null;};
  const pnames=ids=>(ids||[]).map(id=>{const p=team&&team.players.find(p=>p.id===id);return p?p.firstName:null;}).filter(Boolean).join(", ");
  const addNote=()=>{if(!noteText.trim())return;const ctx=isBlock&&cur.stations[stIdx]?cur.stations[stIdx].activityName||cur.stations[stIdx].name:(cur&&cur.name)||"Practice";update(d=>{d.notes.push({id:uid(),text:noteText,context:ctx,date:new Date().toISOString(),practiceId:liveId});return d;});setNoteText("");};
  const toggleCl=(actId,itemId)=>{setClState(s=>{const cur2=s[actId]||{};return Object.assign({},s,{[actId]:Object.assign({},cur2,{[itemId]:!cur2[itemId]})});});};

  const [tplPractice,setTplPractice]=useState(null);
  const [livePracticeOverride,setLivePracticeOverride]=useState(null);
  const [histPractice,setHistPractice]=useState(null);
  const handleTplRun=p=>{update(d=>{d.practices.push(p);return d;});setLivePracticeOverride(p);setLiveId(p.id);setTplPractice(null);setStage("attend");};

  if(histPractice)return (<div className="screen" style={{padding:"14px 14px calc(var(--tab) + 40px)"}}><HistoryViewer data={data} update={update} practice={histPractice} onRunAgain={()=>{const now=new Date();const newP={id:uid(),teamId:histPractice.teamId,locationId:histPractice.locationId,date:now.toISOString().slice(0,10),startTime:now.toTimeString().slice(0,5),durMin:sumMins(histPractice.activities),activities:JSON.parse(JSON.stringify(histPractice.activities)),rerunOf:histPractice.id};update(d=>{d.practices.push(newP);return d;});setLivePracticeOverride(newP);setLiveId(newP.id);setHistPractice(null);setStage("attend");}} onBack={()=>setHistPractice(null)}/></div>);

  if(stage==="attend"||showAtt){const attendPractice=livePracticeOverride||(liveId?data.practices.find(p=>p.id===liveId):null);const attendTeam=attendPractice?data.teams.find(t=>t.id===attendPractice.teamId):null;const attBack=()=>{if(showAtt)setShowAtt(false);else{setLiveId(null);setLivePracticeOverride(null);setStage("pick");}};return (<AttendanceScreen key={showAtt?"upd":"init"} practice={attendPractice} team={attendTeam} isUpdate={showAtt} initialPresent={showAtt?[...presentIds]:null} initialCoachPresent={showAtt?[...coachPresentIds]:null} onConfirm={showAtt?handleAttUpdate:handleAttConfirm} onBack={attBack}/>);}
  if(stage==="end")return (<div className="ccs"><div className="cc-end"><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:36,fontWeight:900,color:"var(--green)",marginBottom:4}}>Practice Complete</div><div style={{fontSize:16,color:"var(--tm)",marginBottom:24,lineHeight:1.5}}>{team&&team.name} practice complete.</div><div style={{width:"100%",marginBottom:16}}><label className="lbl">End of Practice Notes</label><textarea className="ta" style={{minHeight:80}} value={noteText} placeholder="Observations for next time..." onChange={e=>setNoteText(e.target.value)}/><button className="btn primary bsm bfull mt6" onClick={()=>{if(noteText.trim()){update(d=>{d.notes.push({id:uid(),text:noteText,context:"End of Practice",date:new Date().toISOString(),practiceId:liveId});return d;});setNoteText("");}}} >Save Note</button></div><button className="btn primary bmd bfull" onClick={()=>{setLiveId(null);setStage("pick");setView("today");}}>Done</button></div></div>);

  const phaseLabel=isBlock?(blockRotate?(inTrans?"TRANSITION":"STATION "+(stIdx+1)+" of "+cur.stations.length):"STATION BLOCK"):((cur&&cur.name)||"").toUpperCase();
  const blockCount=liveActs.slice(0,idx).filter(a=>a.type==="station_block").length;
  const schedBadge=schedDelta===null?null:(Math.abs(schedDelta)<1?<span style={{background:"var(--gbg)",color:"var(--green)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>On time</span>:schedDelta>0?<span style={{background:"var(--ambg)",color:"var(--amber)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>+{schedDelta}m behind</span>:<span style={{background:"var(--gbg)",color:"var(--green)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>{Math.abs(schedDelta)}m ahead</span>);

  return (<div className="ccs">
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
        <button onClick={async()=>{if(!audioOn){try{const ctx=new(window.AudioContext||window.webkitAudioContext)();audioCtxRef.current=ctx;await ctx.resume();const o=ctx.createOscillator();const g=ctx.createGain();o.connect(g);g.connect(ctx.destination);g.gain.setValueAtTime(0.1,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.2);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.2);}catch(e){}}spoken.current={};setAudioOn(a=>!a);}} style={{background:audioOn?"var(--gbg)":"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"var(--rs)",padding:"4px 10px",fontSize:13,fontWeight:700,cursor:"pointer",color:audioOn?"var(--green)":"var(--td)"}}>{audioOn?"🔊 On":"🔇 Off"}</button>
        <div style={{position:"relative"}}>
          <button className="ell-btn" onClick={()=>setShowEllipsis(s=>!s)}><span/><span/><span/></button>
          {showEllipsis&&<div className="mini-menu" style={{right:0,minWidth:160}}>
            <button className="mm-item" onClick={()=>{setShowEllipsis(false);setAudioOn(a=>!a);}}>{audioOn?"Mute Audio":"Enable Audio"}</button>
            {sessionId&&<button className="mm-item" onClick={()=>{setShowEllipsis(false);setShowShare(true);}}>Share Live View</button>}
            <button className="mm-item" onClick={()=>{setShowEllipsis(false);setStage("end");setRunning(false);if(sessionRef.current){writeSession({idx,stIdx,inTrans,elapsed,running:false,runningAt:null,presentIds:[...presentIds],liveActs,ended:true,roster:practice?data.teams.find(t=>t.id===practice.teamId)?data.teams.find(t=>t.id===practice.teamId).players:[]:[],locations:data.locations});setTimeout(()=>{endSession(sessionRef.current);sessionRef.current=null;setSessionId(null);},500);}}}>End Practice</button>
            <button className="mm-item" onClick={()=>{setShowEllipsis(false);setIdx(0);setStIdx(0);setInTrans(false);setElapsed(0);setRunning(false);spoken.current={};setStage("attend");}}>Restart Practice</button>
          </div>}
        </div>
      </div>
    </div>
    {showROS&&<div style={{background:"var(--s1)",borderBottom:"1px solid var(--b)",maxHeight:200,overflowY:"auto",flexShrink:0}}>
      {liveActs.map((a,i)=>(<div key={a.id} style={{display:"flex",alignItems:"center",padding:"8px 14px",borderBottom:"1px solid var(--b)",background:i===idx?"var(--gbg)":"#fff",cursor:"pointer",opacity:i<idx?0.5:1}} onClick={()=>{const ni=i;baseElapsedRef.current=0;startedAtRef.current=Date.now();setIdx(ni);setStIdx(0);setInTrans(false);setElapsed(0);spoken.current={};setRunning(true);setShowROS(false);const base2={liveActs,presentIds:[...presentIds],running:true,runningAt:Date.now(),elapsed:0,roster:practice?data.teams.find(t=>t.id===practice.teamId)?data.teams.find(t=>t.id===practice.teamId).players:[]:[],locations:data.locations};writeSession({...base2,idx:ni,stIdx:0,inTrans:false});}}>
        <div style={{flex:1,fontSize:14,color:i===idx?"var(--green)":i<idx?"var(--td)":"var(--black)",textDecoration:i<idx?"line-through":"none"}}>{i===idx?">> ":""}{a.type==="station_block"?"Station Block":a.name}</div>
        <span className="bs bdg" style={{fontSize:11}}>{a.type==="station_block"?(a.stations.length*a.stationDuration+(a.stations.length-1)*a.transitionDuration)+"m":a.duration+"m"}</span>
      </div>))}
      <div style={{padding:"8px 14px"}}><button className="btn ghost bxs" onClick={()=>setShowROS(false)}>Close</button></div>
    </div>}
    <div className="cc-timer-row">
      <div className={"cc-timer"+(urg?" urg":"")+(isOver?" over":"")}>{fmt(rem)}</div>
      <button onClick={()=>{const nr=!running;setRunning(nr);writeSession({idx,stIdx,inTrans,elapsed,running:nr,runningAt:nr?Date.now():null,presentIds:[...presentIds],liveActs});}} style={{width:52,height:52,borderRadius:"50%",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,background:isOver?"var(--red)":running?"var(--s3)":"var(--green)",color:isOver?"#fff":running?"var(--black2)":"#fff",boxShadow:running?"none":"0 2px 8px rgba(45,106,79,.35)"}}>
        {isOver?<Ic.Restart/>:running?<Ic.Pause/>:<Ic.Play/>}
      </button>
      <div style={{flex:1}}/>
      {schedBadge}
    </div>
    <div style={{padding:"2px 14px 4px",display:"flex",gap:8,flexShrink:0}}>
      <button className="btn ghost bsm" style={{flex:1}} onClick={()=>{const ne=Math.max(0,elapsed-60);baseElapsedRef.current=ne;startedAtRef.current=running?Date.now():null;setElapsed(ne);writeSession({idx,stIdx,inTrans,elapsed:ne,running,runningAt:running?Date.now():null,presentIds:[...presentIds],liveActs,roster:practice?data.teams.find(t=>t.id===practice.teamId)?data.teams.find(t=>t.id===practice.teamId).players:[]:[],locations:data.locations});}}>+1m</button>
      <button className="btn ghost bsm" style={{flex:1}} onClick={()=>{const ne=elapsed+60;baseElapsedRef.current=ne;startedAtRef.current=running?Date.now():null;setElapsed(ne);writeSession({idx,stIdx,inTrans,elapsed:ne,running,runningAt:running?Date.now():null,presentIds:[...presentIds],liveActs,roster:practice?data.teams.find(t=>t.id===practice.teamId)?data.teams.find(t=>t.id===practice.teamId).players:[]:[],locations:data.locations});}}>-1m</button>
    </div>
    <div className="cc-prog"><div className={"cc-prog-bar"+(isOver?" over":"")} style={{width:(Math.min(1,prog)*100)+"%"}}/></div>
    <div className="cc-controls">
      <button className="btn ghost bmd" style={{minWidth:52}} onClick={goBack} disabled={idx===0&&stIdx===0&&!inTrans}>&lt;</button>
      <button className="btn primary blg" style={{flex:1}} onClick={advance}>{isBlock&&!blockRotate?"End Block":"Next >"}</button>
    </div>
    <div className="cc-body">
      {isCl&&cur&&<div className="cc-focus">
        <div className="cc-focus-lbl">{cur.name} - {Object.values(clState[cur.id]||{}).filter(Boolean).length}/{(cur.items||[]).length} covered</div>
        {(cur.items||[]).map(it=>(<div key={it.id} className="cl-item" onClick={()=>toggleCl(cur.id,it.id)}>
          <div className={"cl-check "+((clState[cur.id]||{})[it.id]?"done":"")}>{(clState[cur.id]||{})[it.id]&&<Ic.Check/>}</div>
          <div className={"cl-text "+((clState[cur.id]||{})[it.id]?"done":"")}>{it.text}</div>
        </div>))}
        {cur.notes&&<div style={{fontSize:13,color:"var(--black2)",marginTop:8,fontStyle:"italic"}}>{cur.notes}</div>}
      </div>}
      {!isBlock&&!isCl&&cur&&<div style={{display:"flex",flexDirection:"column",gap:10}}>
        {/* Coaching Focus card */}
        {cur.coachingPoints&&<div style={{background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:"var(--r)",padding:"12px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#16a34a",marginBottom:6}}>💡 Coaching Focus</div>
          <div style={{fontSize:15,color:"var(--black)",lineHeight:1.5}}>{cur.coachingPoints}</div>
        </div>}
        {/* Location + Coach row */}
        {(coachName(cur.coachId)||subName(cur.sublocationId))&&<div style={{background:"#eff6ff",border:"1.5px solid #93c5fd",borderRadius:"var(--r)",padding:"10px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#2563eb",marginBottom:4}}>📍 Location</div>
          <div style={{fontSize:14,color:"var(--black)"}}>
            {subName(cur.sublocationId)&&<span style={{fontWeight:600}}>{subName(cur.sublocationId)}</span>}
            {subName(cur.sublocationId)&&coachName(cur.coachId)&&<span style={{color:"var(--td)"}}> · </span>}
            {coachName(cur.coachId)&&<span>Coach: {coachName(cur.coachId)}</span>}
          </div>
        </div>}
        {/* Equipment card */}
        {(()=>{const eq=Array.isArray(cur.equipment)?cur.equipment:[];const names=eq.map(id=>{const a=(data.assets||[]).find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);return names.length>0?(<div style={{background:"#fefce8",border:"1.5px solid #fde047",borderRadius:"var(--r)",padding:"10px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#ca8a04",marginBottom:4}}>Equipment Needed</div>
          <div style={{fontSize:14,color:"var(--black)",fontWeight:600}}>{names.join(", ")}</div>
        </div>):null;})()}
        {/* Player Gear card */}
        {cur.playerGear&&<div style={{background:"#fff7ed",border:"1.5px solid #fdba74",borderRadius:"var(--r)",padding:"10px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#ea580c",marginBottom:4}}>Player Gear</div>
          <div style={{fontSize:14,color:"var(--black)",fontWeight:600}}>{cur.playerGear}</div>
        </div>}
        {/* Groups card */}
        {(!cur.grouping||cur.grouping==="whole")&&<div style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"10px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:4}}>👥 Players</div>
          <div style={{fontSize:14,color:"var(--black)"}}>Whole Team Together</div>
        </div>}
        {cur.grouping&&cur.grouping!=="whole"&&!liveGroups&&<div style={{background:"#f5f3ff",border:"1.5px solid #c4b5fd",borderRadius:"var(--r)",padding:"10px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#7c3aed",marginBottom:4}}>👥 {cur.grouping==="partners"?"Partners":"Groups"}</div>
          <div style={{fontSize:13,color:"var(--td)"}}>Assigning groups...</div>
        </div>}
        {liveGroups&&liveGroups.length>0&&<div style={{background:"#f5f3ff",border:"1.5px solid #c4b5fd",borderRadius:"var(--r)",padding:"12px 14px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#7c3aed"}}>👥 {cur.grouping==="partners"?"Partners":"Groups"}</div>
            <button className="btn ghost bxs" onClick={()=>{const present=[...presentIds];const players=(team?team.players:[]).filter(p=>present.includes(p.id));const groups=assignGroups(players,cur.grouping,cur.numGroups||2);setLiveGroups(groups);if(sessionRef.current)updateSession(sessionRef.current,{idx,stIdx,inTrans,elapsed,running,runningAt:running?Date.now():null,presentIds:[...presentIds],liveActs,liveGroups:groups,roster:practice?data.teams.find(t=>t.id===practice.teamId)?data.teams.find(t=>t.id===practice.teamId).players:[]:[],locations:data.locations,assets:data.assets||[]});}}>Reshuffle</button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {liveGroups.map((g,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:8,background:"#fff",border:"1.5px solid #c4b5fd",borderRadius:20,padding:"6px 12px"}}>
              <span style={{fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700,color:"#7c3aed",flexShrink:0}}>{cur.grouping==="partners"?"P"+(i+1):"G"+(i+1)}</span>
              <span style={{fontSize:13,fontWeight:600,color:"var(--black)"}}>{g.map(p=>(p.jersey?"#"+p.jersey+" "+p.firstName:p.firstName)).join(" · ")}</span>
            </div>))}
          </div>
        </div>}
      </div>}
      {isBlock&&!inTrans&&rotatedStations&&<div>
        {focusSt!==null&&<div>
          <button className="btn ghost bxs" style={{marginBottom:10}} onClick={()=>setFocusSt(null)}>&#8249; All Stations</button>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginBottom:2}}>Station {focusSt+1}</div>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:36,fontWeight:900,color:"var(--black)",lineHeight:1,marginBottom:6}}>{rotatedStations[focusSt].activityName||rotatedStations[focusSt].name||"Station "+(focusSt+1)}</div>
          {(coachName(rotatedStations[focusSt].coachId)||subName(rotatedStations[focusSt].sublocationId))&&<div style={{fontSize:14,fontWeight:600,color:"var(--green2)",marginBottom:10}}>
            {coachName(rotatedStations[focusSt].coachId)&&<span>{coachName(rotatedStations[focusSt].coachId)}</span>}
            {coachName(rotatedStations[focusSt].coachId)&&subName(rotatedStations[focusSt].sublocationId)&&<span> · </span>}
            {subName(rotatedStations[focusSt].sublocationId)&&<span>{subName(rotatedStations[focusSt].sublocationId)}</span>}
          </div>}
          {rotatedStations[focusSt].coachingPoints&&<div style={{background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:"var(--r)",padding:"10px 14px",marginBottom:8}}>
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
              {(rotatedStations[focusSt].assignments||[]).map(pid=>(<PlayerChipLive key={pid} pid={pid} team={team} onMove={()=>setMovePlayer(pid)} onProfile={pl=>setLivePlayerProfile(pl)}/>))}
            </div>
          </div>
        </div>}
        {focusSt===null&&<div>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>{blockRotate?"Round "+(stIdx+1)+" of "+cur.stations.length+" — Tap to focus":"All Stations — Tap to focus"}</div>
          {rotatedStations.map((st,i)=>{
            const stEquip=Array.isArray(st.equipment)?st.equipment:[];
            const equipNames=stEquip.map(id=>{const a=(data&&data.assets||[]).find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);
            return (<div key={st.id} onClick={()=>setFocusSt(i)} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8,cursor:"pointer"}}>
              {/* Row 1: Station label + coach */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}>
                <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)"}}>Station {i+1}</div>
                {coachName(st.coachId)&&<div style={{fontSize:11,color:"var(--td)"}}>{coachName(st.coachId)}</div>}
              </div>
              {/* Row 2: Drill name */}
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,color:"var(--black)",lineHeight:1.1,marginBottom:4}}>{st.activityName||st.name||"Station "+(i+1)}</div>
              {/* Row 3: Area */}
              {subName(st.sublocationId)&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:4}}>{subName(st.sublocationId)}</div>}
              {/* Row 4: Coaching points */}
              {st.coachingPoints&&<div style={{fontSize:12,color:"var(--black2)",marginBottom:6,lineHeight:1.4,borderLeft:"2px solid var(--green)",paddingLeft:8}}>{st.coachingPoints}</div>}
              {/* Row 5: Equipment + Player gear pills */}
              {(equipNames.length>0||st.playerGear)&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
                {equipNames.length>0&&<span style={{background:"#fefce8",border:"1px solid #fde047",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#854d0e",fontWeight:600}}>Equipment: {equipNames.join(", ")}</span>}
                {st.playerGear&&<span style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#9a3412",fontWeight:600}}>Player Gear: {st.playerGear}</span>}
              </div>}
              {/* Row 6: Players */}
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
            {cur.stations.map((st,si)=>(<button key={st.id} className={"btn bmd bfull "+(si===stIdx?"ghost":"outline")} style={{marginBottom:8,opacity:si===stIdx?0.5:1}} disabled={si===stIdx} onClick={()=>{setLiveActs(prev=>prev.map(a=>{if(a.id!==cur.id)return a;const newSts=a.stations.map((s,i)=>{if(i===stIdx)return Object.assign({},s,{assignments:(s.assignments||[]).filter(id=>id!==movePlayer)});if(i===si)return Object.assign({},s,{assignments:[...(s.assignments||[]),movePlayer]});return s;});return Object.assign({},a,{stations:newSts});}));setMovePlayer(null);}}>
              {st.name}{st.activityName?": "+st.activityName:""}{si===stIdx?" (current)":""}
            </button>))}
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
            <button className="btn outline bsm bfull mt8" onClick={()=>{setMovePlayer(livePlayerProfile.id);setLivePlayerProfile(null);}}>Move to Another Station</button>
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
            {/* Player names — bold and prominent */}
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"var(--black)",lineHeight:1.2,marginBottom:6}}>{pnames(st.assignments)||"--"}</div>
            {/* From line — grayed */}
            <div style={{fontSize:12,color:"var(--td)",marginBottom:3}}>from {fromLabel}</div>
            {/* To line — bold and green */}
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
    {showShare&&sessionId&&<ShareSheet sessionId={sessionId} onClose={()=>setShowShare(false)}/>}
  </div>);
}
