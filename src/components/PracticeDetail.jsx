import React, { useState, useEffect, useRef } from "react";
import { findOrCreatePreviewToken, cancelPractice, restorePractice, fetchPlannedAbsences, findActiveLiveSession, savePracticeTree } from "../supabase.js";
import { canManageTeamInMode, planningState, localDateStr, stripIdsForCopy, isMoreThanTwoHoursAway } from "../constants.js";
import AbsencePicker from "./AbsencePicker.jsx";
import PracticePlanPrint from "./PracticePlanPrint.jsx";
import FuturePracticeGuardModal from "./FuturePracticeGuardModal.jsx";

// §1: same "35/60 min" pill as HomeScreen/ScheduleScreen -- duplicated per
// this codebase's existing convention rather than factored into a shared
// component.
function PlanPill({ practice, total }) {
  const st = planningState(practice);
  if (!st) return null;
  const onTrack = st === "onTrack";
  return <span style={{ color: onTrack ? "var(--green)" : "var(--red)", fontWeight: 600 }}>{onTrack ? "✓ " : ""}{total}/{practice.scheduledDurationMinutes} min</span>;
}

export default function PracticeDetail({practice,data,goToBuilder,goToRun,onBack,coachId,refreshPlanning,setSubViewBack,mode}){
  // Nav restructure round 3: reached from a team-scoped Schedule tab
  // registers with Layout's colored bar instead of rendering its own
  // inline Back button; reached from Home (no colored bar there) keeps
  // the inline button, since setSubViewBack is only passed in the former case.
  const onBackRef=useRef(onBack);
  useEffect(()=>{onBackRef.current=onBack;});
  useEffect(()=>{
    if(!setSubViewBack)return;
    setSubViewBack({onBack:()=>onBackRef.current()});
    return ()=>setSubViewBack(null);
  },[setSubViewBack]);
  const team=data.teams.find(t=>t.id===practice.teamId);
  // canManageTeamInMode, not bare isHeadCoach -- a director overseeing an
  // org team can edit/cancel/plan its practices without a personal
  // team_staff row on that specific team.
  const canManage=canManageTeamInMode(team,coachId,mode);
  const loc=data.locations.find(l=>l.id===practice.locationId);
  const now=new Date();
  const todayStr=localDateStr(now);
  const isPast=practice.date&&practice.date<todayStr;
  const isMissed=practice.status==="scheduled"&&isPast;
  const isCancelled=practice.status==="cancelled";
  const isPlanned=(practice.activities||[]).length>0;
  const [sharing,setSharing]=useState(false);
  const [previewUrl,setPreviewUrl]=useState(null);
  const [expandedId,setExpandedId]=useState(null);
  const [showAbsencePicker,setShowAbsencePicker]=useState(false);
  const [showPrint,setShowPrint]=useState(false);
  const [confirmCancel,setConfirmCancel]=useState(false);
  const [absentPlayers,setAbsentPlayers]=useState([]);
  const timeLbl=p=>{if(!p.startTime)return "";const pts=p.startTime.split(":");const h=parseInt(pts[0]);const m=parseInt(pts[1]);return (h%12||12)+":"+(m<10?"0"+m:m)+(h>=12?" PM":" AM");};
  const actMins=a=>{if(a.type==="station_block")return a.stations.length*(a.stationDuration||0)+Math.max(0,a.stations.length-1)*(a.transitionDuration||0);return a.duration||0;};
  const totalMins=(practice.activities||[]).reduce((s,a)=>s+actMins(a),0);
  // resolveEquip returns {id,name,acquired} objects, not bare names --
  // "Add Drill Anyway" on the equipment-mismatch dialog keeps a missing
  // item on the drill flagged acquired:false instead of dropping it, and
  // that flag needs to survive here so the coach sees it called out
  // rather than looking like equipment they already have.
  const resolveEquip=ids=>(Array.isArray(ids)?ids:[]).map(id=>{const a=data.assets.find(a=>a.id===id);return a?{id:a.id,name:a.name,acquired:a.acquired!==false}:null;}).filter(Boolean);
  const EquipList=({items,sep})=>items.map((e,i)=>(<span key={e.id} style={{color:e.acquired?"inherit":"var(--red)",fontWeight:e.acquired?"inherit":700}}>{e.name}{!e.acquired&&" (not acquired)"}{i<items.length-1?(sep||", "):""}</span>));
  const allEquip=[...new Map((practice.activities||[]).flatMap(a=>{if(a.type==="station_block")return(a.stations||[]).flatMap(st=>resolveEquip(st.equipment));return resolveEquip(a.equipment);}).map(e=>[e.id,e])).values()];
  const subName=id=>{const l=loc&&loc.sublocations.find(s=>s.id===id);return l?l.name:null;};
  const coachName=id=>{const c=team&&team.coaches.find(c=>c.id===id);return c?c.name:null;};
  const refreshAbsences=()=>{
    fetchPlannedAbsences([practice.id]).then(rows=>{
      const ids=new Set(rows.map(r=>r.player_id));
      setAbsentPlayers(team?team.players.filter(p=>ids.has(p.id)):[]);
    });
  };
  useEffect(()=>{refreshAbsences();},[practice.id]);
  // Direct feedback: an assistant coach who tapped "Run Now" on a practice
  // the head coach had already started live had no way to know that --
  // the button just looked like it was about to start a fresh run. Relabel
  // to "Join Practice" the moment any active session already exists;
  // goToRun's own /run/:practiceId join-not-recreate logic already handles
  // routing them into the same session correctly either way.
  const [isSessionLive,setIsSessionLive]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    findActiveLiveSession(practice.id).then(s=>{if(!cancelled)setIsSessionLive(!!s);});
    return()=>{cancelled=true;};
  },[practice.id]);
  const shareSetup=async()=>{
    setSharing(true);
    try{
      const token=await findOrCreatePreviewToken(practice.id,coachId);
      if(token){const url=window.location.origin+"/preview/"+token;setPreviewUrl(url);if(navigator.share){navigator.share({title:"Practice Setup - "+(team?team.name:"Practice"),url});}else{navigator.clipboard.writeText(url).catch(()=>{});}}
    }catch(e){console.error(e);}
    setSharing(false);
  };
  const copyUrl=()=>{if(previewUrl){navigator.clipboard.writeText(previewUrl).catch(()=>{});if(navigator.share)navigator.share({title:"Practice Setup",url:previewUrl});}};
  const doCancel=async(scope)=>{
    await cancelPractice(practice.id,{scope});
    setConfirmCancel(false);
    if(refreshPlanning)await refreshPlanning();
    onBack();
  };
  const doRestore=async()=>{
    await restorePractice(practice.id);
    if(refreshPlanning)await refreshPlanning();
    onBack();
  };
  // Direct feedback: this screen's own "Run Now"/"Run Again" had no time
  // gate at all -- tapping it silently ran whichever practice you were
  // looking at, however far in the future it was scheduled, which is
  // exactly how a practice scheduled for the next day got started a day
  // early and its own scheduled slot silently read as already completed.
  // Now shares the same 2-hour guard Home's hero uses: a missed (already
  // past) or soon/live practice still runs directly, unchanged; anything
  // genuinely more than 2 hours out opens the 3-choice guard instead of
  // just going.
  const [showFutureGuard,setShowFutureGuard]=useState(false);
  const canRunDirectly=isSessionLive||isMissed||!isMoreThanTwoHoursAway(practice,team);
  const runAsNewFromGuard=async()=>{
    const runNow=new Date();
    const {data:saved}=await savePracticeTree(null,{
      teamId:practice.teamId,locationId:practice.locationId,sublocationId:practice.sublocationId,
      date:localDateStr(runNow),startTime:runNow.toTimeString().slice(0,5),
      prePracticeNotes:practice.prePracticeNotes,
      activities:stripIdsForCopy(practice.activities),coachId,
    });
    if(refreshPlanning)await refreshPlanning();
    setShowFutureGuard(false);
    if(saved)goToRun(saved.id);
  };
  return (<div style={{paddingBottom:80}}>
    {!setSubViewBack&&<div style={{padding:"12px 14px 0",display:"flex",alignItems:"center",gap:8}}><button className="btn ghost bxs" onClick={onBack}>Back</button></div>}
    <div style={{padding:"12px 16px 0"}}>
      {isCancelled&&<div className="card" style={{marginBottom:12,background:"var(--s2)",textAlign:"center"}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:14,fontWeight:700,color:"var(--td)",marginBottom:8}}>This practice was cancelled</div>
        <button className="btn outline bsm" onClick={doRestore}>Restore</button>
      </div>}
      {isMissed&&!isCancelled&&<div style={{background:"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"8px 12px",marginBottom:12,fontSize:12,color:"var(--td)"}}>This practice's time has passed and it was never run.</div>}
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:2}}>{practice.date===todayStr?"TODAY":"RUN OF PRACTICE"} {practice.date&&new Date(practice.date+"T12:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,lineHeight:1,marginBottom:2,textDecoration:isCancelled?"line-through":"none",color:isCancelled?"var(--td)":"inherit"}}>{team?team.name:"Practice"}</div>
      <div style={{fontSize:13,color:"var(--td)",marginBottom:12}}>{timeLbl(practice)}{loc?" · "+loc.name:""} · {planningState(practice)?<PlanPill practice={practice} total={totalMins}/>:totalMins+"min"}</div>
      {/* Direct feedback: a plan had no record of who built it -- a coach
          reviewing it (or a teammate) couldn't tell who to ask about it.
          Only shown once both names are known; a plan from before this
          feature shipped has neither and shows nothing here. */}
      {(()=>{
        const byUserId=id=>{const c=team&&team.coaches.find(c=>c.userId===id);return c?c.name:null;};
        const createdName=byUserId(practice.createdBy);
        const editedName=byUserId(practice.lastEditedBy);
        if(!createdName&&!editedName)return null;
        const sameAuthor=createdName&&editedName&&practice.createdBy===practice.lastEditedBy;
        return (<div style={{fontSize:12,color:"var(--td)",marginBottom:12}}>
          {createdName&&<span>Planned by {createdName}</span>}
          {!sameAuthor&&editedName&&<span>{createdName?" · ":""}Last edited by {editedName}</span>}
        </div>);
      })()}
      {absentPlayers.length>0&&<div style={{fontSize:13,color:"var(--red)",marginBottom:12}}>Out: {absentPlayers.map(p=>p.firstName+" "+(p.lastName||"").slice(0,1)).join(", ")}</div>}
      {!isCancelled&&!isPlanned&&canManage&&<div className="brow" style={{marginBottom:8}}>
        <button className="btn primary bmd bfull" onClick={()=>goToBuilder(practice.id)}>Plan Practice</button>
      </div>}
      {!isCancelled&&isPlanned&&<div className="brow" style={{marginBottom:8}}>
        <button className="btn primary bmd bfull" onClick={()=>{
          if(canRunDirectly)goToRun(practice.id);
          else setShowFutureGuard(true);
        }}>{isSessionLive?"Join Practice":isMissed?"Run Again":"Run Now"}</button>
      </div>}
      {showFutureGuard&&<FuturePracticeGuardModal practice={practice} team={team} onCancel={()=>setShowFutureGuard(false)} onRunAsNew={runAsNewFromGuard} onRunNow={()=>{setShowFutureGuard(false);goToRun(practice.id);}}/>}
      {!isCancelled&&<div style={{display:"flex",gap:8,marginBottom:12}}>
        <button className="btn outline bmd" style={{flex:1}} onClick={()=>setShowAbsencePicker(true)}>Who's Out?</button>
        {isPlanned&&canManage&&<button className="btn outline bmd" style={{flex:1}} onClick={()=>goToBuilder(practice.id)}>Edit</button>}
      </div>}
      {/* Print/PDF export: a clean, standalone document a coach can follow
          without the app (old-school coaches, or a remote player doing
          this same practice with another coach) -- start/end clock times
          alongside duration, since a printed sheet can't run a live timer
          the way the app's own view can. */}
      {!isCancelled&&isPlanned&&<button className="btn outline bmd bfull" style={{marginBottom:12}} onClick={()=>setShowPrint(true)}>Print / Export PDF</button>}
      {!isCancelled&&!confirmCancel&&canManage&&<button className="btn ghost bsm bfull" style={{marginBottom:12,color:"var(--red)"}} onClick={()=>setConfirmCancel(true)}>Cancel Practice</button>}
      {/* Direct feedback: the body copy's "--" and the old "This Only"/
          "This & Future" pairing read as an em dash plus unclear action
          verbs. The plan itself is never touched by cancelling (only the
          scheduled slot's status changes), so the body says that plainly
          without a dash; buttons are always a real verb, never a bare
          scope label. */}
      {confirmCancel&&<div className="confirm-box" style={{marginBottom:12}}>
        <div className="confirm-title">Cancel this practice?</div>
        <div className="confirm-body">This marks the slot as cancelled. The plan stays saved.</div>
        <div className="brow" style={{flexWrap:"wrap"}}>
          <button className="btn ghost bsm" onClick={()=>setConfirmCancel(false)}>Never Mind</button>
          <button className="btn danger bsm" onClick={()=>doCancel("this")}>{practice.seriesId?"Cancel This Practice":"Cancel Practice"}</button>
          {practice.seriesId&&<button className="btn danger bsm" onClick={()=>doCancel("future")}>Cancel This &amp; Future</button>}
        </div>
      </div>}
      {!previewUrl&&!isCancelled&&<button className="btn outline bmd bfull" style={{marginBottom:12}} onClick={shareSetup} disabled={sharing}>{sharing?"Creating link...":"Share Setup Link"}</button>}
      {previewUrl&&<div style={{background:"var(--gbg)",border:"1.5px solid var(--gb)",borderRadius:"var(--r)",padding:"10px 12px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:10,fontWeight:700,color:"var(--green)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:2}}>Setup Link Active</div>
          <div style={{fontSize:12,color:"var(--td)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{previewUrl}</div>
        </div>
        <button className="btn primary bxs" onClick={copyUrl}>Share</button>
      </div>}
      {allEquip.length>0&&<div className="card" style={{marginBottom:12,background:"var(--ambg)",border:"1.5px solid var(--ambb)"}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--amber)",marginBottom:6}}>Equipment Needed</div>
        {allEquip.map(e=>(<div key={e.id} style={{fontSize:14,color:e.acquired?"var(--black)":"var(--red)",fontWeight:e.acquired?400:700,marginBottom:2}}>· {e.name}{!e.acquired&&<span style={{fontSize:11,marginLeft:6}}>NOT ACQUIRED</span>}</div>))}
      </div>}
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Run Order</div>
      {(practice.activities||[]).map((a,i)=>{
        const isExp=expandedId===a.id;
        const mins=actMins(a);
        return(<div key={a.id} style={{border:"1.5px solid var(--b)",borderRadius:"var(--r)",marginBottom:6,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",padding:"10px 12px",background:isExp?"var(--gbg)":"var(--s1)",cursor:"pointer"}} onClick={()=>setExpandedId(isExp?null:a.id)}>
            <div style={{width:24,height:24,borderRadius:"50%",background:"var(--s2)",border:"1px solid var(--b)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"var(--td)",flexShrink:0,marginRight:10}}>{i+1}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:14,fontWeight:600,color:"var(--black)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {a.type==="station_block"?"Station Block · "+a.stations.length+" stations":a.type==="checklist"?a.name:a.name}
              </div>
              {a.type==="activity"&&a.coachingPoints&&!isExp&&<div style={{fontSize:11,color:"var(--td)",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.coachingPoints}</div>}
              {a.type==="station_block"&&<div style={{fontSize:11,color:"var(--td)",marginTop:1}}>{a.stations.map(s=>s.activityName||s.name).join(" / ")}</div>}
            </div>
            <span style={{fontFamily:"DM Mono,monospace",fontSize:12,fontWeight:600,color:"var(--td)",flexShrink:0,marginLeft:8}}>{mins}m</span>
            <span style={{color:"var(--td)",fontSize:11,marginLeft:6}}>{isExp?"▲":"▼"}</span>
          </div>
          {isExp&&<div style={{padding:"10px 12px",borderTop:"1px solid var(--b)",background:"#fff"}}>
            {a.type==="activity"&&<div style={{display:"flex",flexDirection:"column",gap:6}}>
              {(subName(a.sublocationId)||coachName(a.coachId))&&<div style={{fontSize:13}}>
                {subName(a.sublocationId)&&<span style={{fontWeight:600,color:"var(--green2)"}}>{subName(a.sublocationId)}</span>}
                {subName(a.sublocationId)&&coachName(a.coachId)&&<span style={{color:"var(--td)"}}> · </span>}
                {coachName(a.coachId)&&<span style={{color:"var(--td)"}}>Coach: {coachName(a.coachId)}</span>}
              </div>}
              {a.description&&<div style={{fontSize:13,color:"var(--black)",lineHeight:1.5}}>{a.description}</div>}
              {a.coachingPoints&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:8}}>
                <div style={{fontSize:10,fontWeight:700,color:"#16a34a",letterSpacing:".08em",textTransform:"uppercase",marginBottom:2}}>Coaching Focus</div>
                <div style={{fontSize:13,lineHeight:1.5}}>{a.coachingPoints}</div>
              </div>}
              {resolveEquip(a.equipment).length>0&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Equipment: </span><EquipList items={resolveEquip(a.equipment)}/></div>}
              {a.playerGear&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Player Gear: </span>{a.playerGear}</div>}
              {a.grouping&&a.grouping!=="whole"&&<div style={{fontSize:13}}><span style={{color:"var(--td)"}}>Grouping: </span>{a.grouping==="partners"?"Partners":a.numGroups+" Groups"}</div>}
            </div>}
            {a.type==="checklist"&&<div>
              {(a.items||[]).map(it=>(<div key={it.id} style={{fontSize:13,padding:"3px 0",borderBottom:"1px solid var(--s2)"}}>{it.text}</div>))}
              {a.notes&&<div style={{fontSize:12,color:"var(--td)",marginTop:6,fontStyle:"italic"}}>{a.notes}</div>}
            </div>}
            {a.type==="station_block"&&<div>
              {a.stations.map((st,si)=>{
                const stEquip=resolveEquip(st.equipment);
                return(<div key={st.id} style={{marginBottom:10,paddingBottom:10,borderBottom:"1px solid var(--s2)"}}>
                  <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,color:"var(--green)",marginBottom:4}}>Station {si+1}{st.activityName?" · "+st.activityName:""}</div>
                  {(coachName(st.coachId)||subName(st.sublocationId))&&<div style={{fontSize:12,marginBottom:3}}>
                    {subName(st.sublocationId)&&<span style={{fontWeight:600,color:"var(--green2)"}}>{subName(st.sublocationId)}</span>}
                    {subName(st.sublocationId)&&coachName(st.coachId)&&<span style={{color:"var(--td)"}}> · </span>}
                    {coachName(st.coachId)&&<span style={{color:"var(--td)"}}>Coach: {coachName(st.coachId)}</span>}
                  </div>}
                  {st.coachingPoints&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:8,marginBottom:4}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#16a34a",letterSpacing:".08em",textTransform:"uppercase",marginBottom:2}}>Coaching Focus</div>
                    <div style={{fontSize:12,lineHeight:1.4}}>{st.coachingPoints}</div>
                  </div>}
                  {stEquip.length>0&&<div style={{fontSize:12,color:"var(--td)"}}>Equipment: <EquipList items={stEquip}/></div>}
                  {st.playerGear&&<div style={{fontSize:12,color:"var(--td)"}}>Player Gear: {st.playerGear}</div>}
                </div>);
              })}
            </div>}
          </div>}
        </div>);
      })}
    </div>
    {showAbsencePicker&&<AbsencePicker data={data} coachId={coachId} mode="pickPlayersForPractice" practice={practice} team={team} onClose={()=>{setShowAbsencePicker(false);refreshAbsences();}}/>}
    {showPrint&&<PracticePlanPrint practice={practice} team={team} loc={loc} data={data} onClose={()=>setShowPrint(false)}/>}
  </div>);
}
