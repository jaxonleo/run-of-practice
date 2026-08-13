import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { uid, fmt, actSecs, sumMins, rebalanceKeep, rebalanceEven, reconcileGroups, assignGroups, groupByAttribute, stripIdsForCopy, HAND_FIELDS_BY_SPORT, HAND_LABELS, isHeadCoach, AUDIO_CUES, getAudioCuePref, getVoiceURIPref, resolveVoiceByURI, resolveDefaultVoice, groupEquipmentByArea } from "../constants.js";
import { savePracticeTree, saveTemplateTree, fetchPracticesFull, findActiveLiveSession, startOrJoinLiveSession, updateLiveSession, takeControl, subscribeToLiveSession, submitOperation, submitAttendanceSnapshot, fetchLatestAttendance, saveSessionGroups, fetchLatestGroups, openActivityLog, closeActivityLog, deleteActivityLog, findOpenActivityLogId, createHelperShareToken, getPreviewByToken, getLiveSessionByToken, linkPreviewToLiveSession, submitHelperAttendanceByToken, fetchPlannedAbsences, fetchNotesForPractice, fetchNotesForPlayer, fetchPracticeActualStart, createNote, updateStationLead, updateActivityLead, submitPracticeNoteByToken, archiveNote, subscribeToPracticePresence, teamLocalToScheduledAt, findOrCreatePreviewToken, updateDrill, findMissingEquipment, resolveDrillEquipmentForCoach, toggleSetupPresence } from "../supabase.js";
import { ActConfig, ChecklistConfig, StationConfig, useActivityDnd, ActivityDndContext, SortableActivityRow } from "./ActivityConfigs.jsx";
import EquipmentMismatchDialog from "./EquipmentMismatchDialog.jsx";
import PracticePlanPrint from "./PracticePlanPrint.jsx";

// ── Local icon subset ──────────────────────────────────────────────────────────
const Ic={
  Check:()=><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="2 7 6 11 12 3"/></svg>,
  Play:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" stroke="none"><polygon points="7 4 20 12 7 20 7 4"/></svg>,
  Pause:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" stroke="none"><rect x="5" y="3" width="4" height="18" rx="1"/><rect x="15" y="3" width="4" height="18" rx="1"/></svg>,
  Restart:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
  Chev:({up})=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points={up?"4 10 8 6 12 10":"4 6 8 10 12 6"}/></svg>,
  // Direct feedback: the x/y pill at the top of the live view read as
  // ambiguous ("x/y" of what?) -- a hand-raise makes "player attendance"
  // legible at a glance without adding a text label that wouldn't fit
  // the pill's compact width.
  Hand:()=><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M9 2a1.5 1.5 0 0 1 1.5 1.5V11h1V1.5a1.5 1.5 0 0 1 3 0V11h1V3.5a1.5 1.5 0 0 1 3 0V13h1a1.5 1.5 0 0 1 1.5 1.5V17a7 7 0 0 1-7 7H11a7 7 0 0 1-6.32-4L2.3 15.2a1.5 1.5 0 0 1 2.62-1.46L7.5 17V3.5A1.5 1.5 0 0 1 9 2Z"/></svg>,
  // Direct feedback: the hand-raise read as an odd icon for a plain
  // attendance count -- a solo person silhouette reads unambiguously as
  // "player attendance" without implying anyone is raising a hand.
  Person:()=><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="7" r="4"/><path d="M4 21v-1.5C4 15.9 7.6 13 12 13s8 2.9 8 6.5V21H4Z"/></svg>,
};

// "Who has this practice open" -- shared by PreviewView, the staff
// CommandScreen, and HelperView, all three of which key onto the same
// practice_id so a coach in Practice Setup and a helper who already
// opened the live link show up together. `me` is `null` until the
// caller actually knows who they are (or that they're anonymous); the
// effect no-ops until both practiceId and me are ready.
function usePracticePresence(practiceId, me) {
  const [presence, setPresence] = useState({ coachNames: [], anonCount: 0 });
  useEffect(() => {
    if (!practiceId || !me) return;
    setPresence({ coachNames: [], anonCount: 0 });
    return subscribeToPracticePresence(practiceId, me, setPresence);
  }, [practiceId, me && me.kind, me && me.label]);
  return presence;
}
// Peace-of-mind sync-confidence indicator, doubling as a manual refresh
// (direct feedback: not meant to be needed in normal use, but there if a
// coach notices the screen looks wrong). Same "Live" label/dot the header
// already showed unconditionally -- now it degrades honestly instead of
// always claiming to be live, and is always tappable. A real page reload
// (not a soft in-app resync) deliberately: this app already re-derives
// the entire live session -- timer, stage, controller -- from the server
// on every fresh mount (see "A coach can leave a live session without
// ending it" in the Feature Inventory), so a reload is already a fully
// correct resync for free, and it's the one thing that still works if the
// tab's own JS is what's actually stuck -- which no in-app retry logic
// can fix from inside itself.
function SyncBadge({health}){
  const color=health==="stale"?"var(--red)":health==="warn"?"var(--amber)":"var(--green)";
  const label=health==="stale"?"Refresh":health==="warn"?"Reconnecting…":"Live";
  return (<button type="button" onClick={()=>window.location.reload()} title="Tap to refresh" style={{display:"flex",alignItems:"center",gap:5,background:"none",border:"none",padding:0,cursor:"pointer"}}>
    <span className="live" style={{background:color}}/>
    <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color}}>{label}</span>
  </button>);
}

function PresenceBadge({ coachNames, anonCount, dark }) {
  if (!coachNames.length && !anonCount) return null;
  const parts = [];
  if (coachNames.length) parts.push(coachNames.join(", "));
  if (anonCount) parts.push(anonCount + (anonCount === 1 ? " person watching" : " people watching"));
  return (<div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: dark ? "#8fa89b" : "var(--td)", flexWrap: "wrap" }}>
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#52b788", display: "inline-block", flexShrink: 0 }} />
    {parts.join(" · ")}
  </div>);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DurStepper({value,min,onChange,step}){
  const s=step||1;const mn=min||1;
  return (<div style={{display:"flex",alignItems:"center",gap:0,border:"1.5px solid var(--b)",borderRadius:"var(--rs)",overflow:"hidden",background:"#fff"}}>
    <button onClick={()=>onChange(Math.max(mn,value-s))} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>-</button>
    <div style={{flex:1,textAlign:"center",fontFamily:"DM Mono,monospace",fontSize:15,fontWeight:600,color:"var(--black)"}}>{value}m</div>
    <button onClick={()=>onChange(value+s)} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
  </div>);
}

function StationPlayerChip({pid,team,note}){
  const pl=team&&team.players.find(p=>p.id===pid);
  if(!pl)return null;
  return (<span style={{display:"inline-flex",flexDirection:"column",alignItems:"flex-start",gap:1,maxWidth:note?150:undefined}}>
    <span style={{background:"var(--s2)",border:"1px solid var(--b)",borderRadius:8,padding:"3px 8px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:4}}>
      {pl.jersey&&<span style={{fontFamily:"DM Mono,monospace",fontSize:11,color:"var(--green)"}}>#{pl.jersey}</span>}{pl.firstName}
    </span>
    {note&&<span style={{fontSize:10,color:"var(--green2)",lineHeight:1.3,whiteSpace:"normal"}}>{note}</span>}
  </span>);
}

// `note` is this player's freeform text for whichever skill tag(s) the
// active drill has selected -- surfaced right on the chip so a coach
// glances at the station and sees what to watch for on this rep, no tap
// required. Direct feedback: player movement between stations now happens
// exclusively on the "Introduce Stations" screen (dotted pick-up-and-drop,
// same as Practice Setup's own groupings dialog) -- tapping a player once
// practice is actually running at a station just opens their player card
// (focus areas/notes) instead, and the old long-press-for-profile gesture
// is gone since a single tap does that job now.
function PlayerChipLive({pid,team,note,onProfile}){
  const pl=team&&team.players.find(p=>p.id===pid);
  if(!pl)return null;
  const handFields=HAND_FIELDS_BY_SPORT[team&&team.sport]||[];
  const handText=handFields.map(hf=>pl[hf.key]?hf.label+" "+(HAND_LABELS[pl[hf.key]]||pl[hf.key]):null).filter(Boolean).join(" · ");
  return (<button
    type="button"
    onClick={()=>onProfile(pl)}
    style={{padding:"6px 12px",borderRadius:20,border:"1.5px solid var(--gb)",background:"var(--gbg)",fontSize:14,fontWeight:600,cursor:"pointer",color:"var(--black)",display:"flex",flexDirection:"column",alignItems:"flex-start",gap:2,maxWidth:(note||handText)?200:undefined}}>
    <span style={{display:"flex",alignItems:"center",gap:5}}>{pl.jersey&&<span style={{fontFamily:"DM Mono,monospace",fontSize:12,color:"var(--green)"}}>#{pl.jersey}</span>}{pl.firstName}</span>
    {handText&&<span style={{fontSize:11,color:"var(--td)",whiteSpace:"normal",textAlign:"left"}}>{handText}</span>}
    {note&&<span style={{fontSize:11,fontWeight:500,color:"var(--green2)",whiteSpace:"normal",textAlign:"left",lineHeight:1.3}}>{note}</span>}
  </button>);
}

// Direct feedback: "Up Next" items only ever showed a name and a duration
// -- any viewer (coach or anonymous helper) should be able to peek at
// what's coming (equipment, location, who's rotating where) without
// advancing the practice. Shared between CommandScreen's own queue and
// HelperView's Overview list -- each builds this same normalized shape
// from its own data source (local plan objects vs. get_live_session_view's
// upcoming_activities) rather than duplicating the modal itself.
function UpcomingPreview({item,onClose}){
  return (<div className="movly" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" style={{background:"#0d1512",color:"#fff"}}>
      <div className="mhandle" style={{background:"rgba(255,255,255,.2)"}}/>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#8fa89b",marginBottom:4}}>Coming Up · Preview Only</div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:24,fontWeight:900,marginBottom:2}}>{item.name}</div>
      <div style={{fontSize:12,color:"#8fa89b",marginBottom:12}}>{item.durationMins}min{item.locationName?" · "+item.locationName:""}</div>
      {item.equipmentNames.length>0&&<div style={{marginBottom:10}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#8fa89b",marginBottom:4}}>Equipment</div>
        <div style={{fontSize:13,color:"#fff"}}>{item.equipmentNames.join(", ")}</div>
      </div>}
      {item.stations.length>0&&<div>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#8fa89b",marginBottom:6}}>Stations</div>
        {item.stations.map((st,i)=>(<div key={i} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",borderRadius:"var(--r)",padding:"10px 12px",marginBottom:6}}>
          <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:2}}>{st.name}{st.locationName?" · "+st.locationName:""}{" · "+(st.coachName||"Unassigned")}</div>
          {st.equipmentNames.length>0&&<div style={{fontSize:12,color:"#8fa89b",marginBottom:2}}>Equipment: {st.equipmentNames.join(", ")}</div>}
          {st.playerNames.length>0&&<div style={{fontSize:12,color:"#fff"}}>{st.playerNames.join(", ")}</div>}
        </div>))}
      </div>}
      <button className="btn ghost bmd bfull mt10" style={{borderColor:"rgba(255,255,255,.25)",color:"#fff",background:"transparent"}} onClick={onClose}>Close</button>
    </div>
  </div>);
}

function ShareSheet({token,scope,onClose,title}){
  const url=window.location.origin+"/live/"+token;
  const isAttendance=scope==="helper_attendance";
  const [copied,setCopied]=useState(false);
  const copy=()=>{try{navigator.clipboard.writeText(url).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});}catch(e){}};
  // Direct feedback: every shared link used the same generic title
  // ("Run of Practice - Live View") no matter which practice it was for --
  // a recipient juggling links from multiple teams/dates had no way to
  // tell them apart. `title` is built by the caller from the real
  // practice/team, falling back to the old generic text if unavailable.
  const share=()=>{if(navigator.share)navigator.share({title:title||"Run of Practice - Live View",url});else copy();};
  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.72)",zIndex:200,display:"flex",alignItems:"flex-end"}}><div style={{background:"#fff",width:"100%",borderRadius:"20px 20px 0 0",padding:"24px 20px 40px"}}><div style={{width:36,height:4,background:"var(--b)",borderRadius:2,margin:"0 auto 20px"}}/><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,marginBottom:4}}>{isAttendance?"Share for Attendance":"Share Live View"}</div><div style={{fontSize:13,color:"var(--td)",marginBottom:20}}>{isAttendance?"Anyone with this link can follow along AND mark players present/absent.":"Anyone with this link can follow along in real time."}</div><div style={{background:"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:12,wordBreak:"break-all",fontSize:13,color:"var(--black2)",fontFamily:"DM Mono,monospace"}}>{url}</div><div className="brow"><button className="btn outline bmd" style={{flex:1}} onClick={copy}>{copied?"Copied!":"Copy Link"}</button><button className="btn primary bmd" style={{flex:1}} onClick={share}>Share</button></div><button className="btn ghost bmd bfull" style={{marginTop:8}} onClick={onClose}>Done</button></div></div>);
}

// Direct feedback, a real bug: tapping anywhere on a player's row toggled
// their attendance, so a coach trying to just glance at someone's card
// could accidentally mark them absent. Restructured so only the check
// circle itself toggles attendance; the rest of the row (including a new
// ellipsis) is for viewing the player, not marking them.
function PlayerCardModal({player,team,data,amHeadCoach,onClose}){
  const [notes,setNotes]=useState(null);
  const [deletingId,setDeletingId]=useState(null);
  useEffect(()=>{let cancelled=false;fetchNotesForPlayer(player.id).then(n=>{if(!cancelled)setNotes(n);});return()=>{cancelled=true;};},[player.id]);
  const noteAuthor=n=>{
    if(n.authorKind==="anonymous")return (n.authorLabel||"A helper")+" · Helper";
    const c=team&&team.coaches.find(c=>c.userId===n.createdBy);
    return (c?c.name:"A coach")+(c?" · "+c.role:"");
  };
  const deleteNote=async id=>{
    setDeletingId(id);
    await archiveNote(id);
    setNotes(ns=>ns.filter(n=>n.id!==id));
    setDeletingId(null);
  };
  const areas=(player.focusAreas||[]).filter(a=>a.note);
  return (<div className="movly" onClick={onClose}>
    <div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mhandle"/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900}}>{player.firstName} {player.lastName}</div>
          {player.jersey&&<div style={{fontFamily:"DM Mono,monospace",fontSize:13,color:"var(--green)"}}>#{player.jersey}</div>}
        </div>
        <button className="btn ghost bxs" onClick={onClose}>Close</button>
      </div>
      <div className="clbl mb8">Player Focus</div>
      {areas.length===0&&<div style={{fontSize:13,color:"var(--td)",marginBottom:14}}>No focus areas added yet.</div>}
      {areas.length>0&&areas.map(a=>{
        const cat=(data&&data.skillCategories||[]).find(c=>c.id===a.categoryId);
        return(<div key={a.id} style={{marginBottom:8,padding:"10px 12px",background:"var(--s2)",borderRadius:"var(--rs)"}}>
          <div style={{fontSize:12,fontWeight:700,color:"var(--td)"}}>{cat?cat.name:""}</div>
          <div style={{fontSize:14,lineHeight:1.5,marginTop:2}}>{a.note}</div>
        </div>);
      })}
      <div className="clbl mb8" style={{marginTop:14}}>Practice Notes</div>
      {notes===null&&<div style={{fontSize:13,color:"var(--td)"}}>Loading...</div>}
      {notes&&notes.length===0&&<div style={{fontSize:13,color:"var(--td)"}}>No notes tagging this player yet.</div>}
      {notes&&notes.map(n=>(<div key={n.id} style={{marginBottom:8,padding:"10px 12px",background:"var(--s2)",borderRadius:"var(--rs)"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
          <div style={{fontSize:11,color:"var(--td)",marginBottom:2}}>{noteAuthor(n)} · {new Date(n.createdAt).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</div>
          {amHeadCoach&&<button type="button" disabled={deletingId===n.id} onClick={()=>deleteNote(n.id)} style={{background:"none",border:"none",padding:0,fontSize:11,color:"var(--red)",cursor:"pointer",flexShrink:0}}>{deletingId===n.id?"Deleting...":"Delete"}</button>}
        </div>
        <div style={{fontSize:14}}>{n.text}</div>
      </div>))}
    </div>
  </div>);
}
function AttendanceScreen({practice,team,data,amHeadCoach,isUpdate,initialPresent,initialCoachPresent,onConfirm,onBack}){
  const allIds=team?team.players.map(p=>p.id):[];
  const [present,setPresent]=useState(()=>{
    if(initialPresent!==null&&initialPresent!==undefined)return new Set(initialPresent);
    return new Set(allIds);
  });
  const [coachPresent,setCoachPresent]=useState(()=>{
    if(initialCoachPresent&&initialCoachPresent.length>0)return new Set(initialCoachPresent);
    return new Set(team?team.coaches.map(c=>c.id):[]);
  });
  const [playerCardId,setPlayerCardId]=useState(null);
  const togP=id=>setPresent(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const togC=id=>setCoachPresent(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const pCount=present.size;
  const total=allIds.length;
  const stBlocks=(practice&&practice.activities||[]).filter(a=>a.type==="station_block");
  const needsBalance=!isUpdate&&stBlocks.some(b=>{
    const assigned=b.stations.reduce((s,st)=>{(st.assignments||[]).forEach(id=>s.add(id));return s;},new Set());
    return [...present].some(id=>!assigned.has(id));
  });
  const playerCard=playerCardId&&team?team.players.find(p=>p.id===playerCardId):null;
  return (<div style={{padding:"14px",paddingBottom:"calc(var(--tab) + 100px)"}}>
    <div className="row mb10"><button className="btn ghost bxs" onClick={onBack}>Back</button><div className="ptitle" style={{fontSize:22}}>{isUpdate?"Attendance":"Practice Setup"}</div></div>
    <div style={{background:"var(--green)",borderRadius:10,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{color:"#fff",fontFamily:"DM Mono,monospace",fontSize:32,fontWeight:700}}>{pCount}/{total}</div>
      <div style={{color:"rgba(255,255,255,.8)",fontSize:13}}>players present</div>
    </div>
    <div className="clbl mb8">Players</div>
    <div className="att-grid">
      {team&&team.players.map(p=>(<div key={p.id} className={"att-btn "+(present.has(p.id)?"on":"")}>
        <button type="button" onClick={()=>togP(p.id)} style={{background:"none",border:"none",padding:0,cursor:"pointer",display:"flex",flexShrink:0}} aria-label={present.has(p.id)?"Mark absent":"Mark present"}>
          <div className={"att-circle "+(present.has(p.id)?"on":"")}>{present.has(p.id)&&<Ic.Check/>}</div>
        </button>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,fontWeight:600,color:present.has(p.id)?"var(--black)":"var(--td)"}}>{p.firstName}</div></div>
        <button type="button" className="ell-btn" style={{flexShrink:0}} onClick={()=>setPlayerCardId(p.id)}><span/><span/><span/></button>
      </div>))}
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
    {playerCard&&<PlayerCardModal player={playerCard} team={team} data={data} amHeadCoach={amHeadCoach} onClose={()=>setPlayerCardId(null)}/>}
  </div>);
}

// Reads as an unambiguous "who's leading this" label for both a plain
// activity and a station -- shared so the two rows below never phrase it
// differently.
function leaderLabel(act,team){
  const c=act.coachId&&team&&team.coaches.find(c=>c.id===act.coachId);
  return (c&&c.name)||act.helperName||null;
}
// Same clock-time formatting the PDF export already uses (PracticePlanPrint.jsx)
// -- shared here so Practice Setup's own per-row start/end times read
// identically to what a coach would see on a printed sheet.
function fmtClock(d){return d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});}
function equipNamesFor(ids,data){
  return (Array.isArray(ids)?ids:[]).map(id=>{const a=(data&&data.assets||[]).find(a=>a.id===id);return a?{name:a.name,acquired:a.acquired!==false}:null;}).filter(Boolean);
}
function EquipPill({e}){
  return <span style={e.acquired===false?{background:"rgba(220,38,38,.22)",border:"1px solid rgba(248,113,113,.7)",borderRadius:20,padding:"2px 9px",fontSize:11,color:"#fecaca",fontWeight:700}:{background:"rgba(202,138,4,.22)",border:"1px solid rgba(253,224,71,.5)",borderRadius:20,padding:"2px 9px",fontSize:11,color:"#fde047",fontWeight:700}}>{e.name}{e.acquired===false&&" · not acquired"}</span>;
}
// Equipment Needed, grouped by Area (no coach name -- direct feedback that
// listing who's bringing each item was noise, and grouping by where it's
// needed is what actually helps a coach get the gym/field set up before
// anyone arrives). Two columns whenever there's more than one area, so the
// space doesn't go to waste on a wide screen or a practice with several
// station areas -- collapses to one column naturally with only one group.
function EquipmentByArea({equipByArea}){
  if(!equipByArea.length)return null;
  return (<div style={{display:"grid",gridTemplateColumns:equipByArea.length>1?"1fr 1fr":"1fr",gap:"16px 14px"}}>
    {equipByArea.map((grp,gi)=>(<div key={gi}>
      <div style={{fontSize:12,fontWeight:700,color:"#52b788",marginBottom:6}}>{grp.area}</div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {grp.items.map((e,i)=>(<EquipPill key={i} e={e}/>))}
      </div>
    </div>))}
  </div>);
}
// Solo-person pill, readable against the dark backdrop (direct feedback:
// the old translucent-green player chips were hard to read) -- used for
// both the coach-leader tap target and the groupings-dialog player list.
function LeaderTapTarget({label,onTap,disabled}){
  return (<button type="button" disabled={disabled} onClick={onTap} style={{background:label?"rgba(82,183,136,.22)":"rgba(245,158,11,.18)",border:"1.5px solid "+(label?"#52b788":"#f59e0b"),borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:700,color:label?"#fff":"#fde68a",cursor:disabled?"default":"pointer"}}>Coach: {label||"Unassigned"}</button>);
}

// Reads the real, already-seeded-and-persisted groupings for a drill's own
// Partners/Groups split or a station block's rotation -- direct feedback,
// two rounds: the dialog used to compute a fresh assignGroups() (a random
// shuffle) inline during render, which re-ran and reshuffled on every
// parent re-render (the countdown ticks setNow every second), looking
// exactly like someone was hammering a shuffle button the whole time it
// was open. Fixed at the source: CommandScreen's own setupGroups-seeding
// effect now generates a drill's split *once*, saves it via
// saveSessionGroups the same way a station block's rotation already was,
// and this function only ever reads that stable, editable state -- never
// computes its own randomness.
function computeGroupingsPreview({kind,act,presentPlayers,setupGroups}){
  const saved=setupGroups[act.id];
  if(!saved)return null;
  const presentIds=new Set(presentPlayers.map(p=>p.id));
  const assignedAnywhere=new Set();
  const labelFor=i=>kind==="drill"
    ?(act.grouping==="partners"?"Pair ":"Group ")+(i+1)
    :((act.stations[i]&&(act.stations[i].name||act.stations[i].activityName))||"Station "+(i+1));
  const groups=saved.map((ids,i)=>{
    const here=(ids||[]).filter(id=>presentIds.has(id));
    here.forEach(id=>assignedAnywhere.add(id));
    return {label:labelFor(i),players:here.map(id=>presentPlayers.find(p=>p.id===id)).filter(Boolean)};
  });
  const unassigned=presentPlayers.filter(p=>!assignedAnywhere.has(p.id));
  const sizes=groups.map(g=>g.players.length);
  const uneven=(presentPlayers.length>0&&sizes.length>0&&(Math.max(...sizes)-Math.min(...sizes)>1))||unassigned.length>0;
  const notes=[];
  const noun=kind==="drill"?"group":"station";
  if(unassigned.length)notes.push(unassigned.length+" present player"+(unassigned.length===1?"":"s")+" not yet assigned to a "+noun+".");
  if(!unassigned.length&&uneven)notes.push((kind==="drill"?"Groups aren't":"Stations aren't")+" evenly split for "+presentPlayers.length+" present players.");
  return {groups,uneven,unevenNote:notes.join(" "),activityId:act.id,unitLabel:kind==="drill"?"group":"station"};
}
// Direct feedback (second round): the first version's "tap a player, then
// pick a destination from a bare list of labels" was a strange way to move
// someone without any idea who's already in "Pairing 4." Redesigned as a
// pick-up-and-drop flow instead: tapping a player picks them up (a visible
// highlight, not a separate screen); every *other* group then grows a
// dashed "landing zone" slot right alongside its real players, so the
// coach can actually see who they'd be joining before committing. Tapping
// a landing zone drops the player there. Evening a pairing back out after
// a move is just the same gesture again, in reverse -- tap someone in the
// now-larger group, drop them into the now-short group's own landing zone
// -- no separate "swap mode" needed, since picking up any player from any
// group and any landing zone in any other group is always available.
function GroupingsDialog({title,data,onClose,onMovePlayer,team,onReshuffle,onGroupByAttribute}){
  const [selected,setSelected]=useState(null); // {playerId,fromIdx}
  const [groupByOpen,setGroupByOpen]=useState(false);
  if(!data)return null;
  const pick=(playerId,fromIdx)=>{
    if(selected&&selected.playerId===playerId){setSelected(null);return;}
    setSelected({playerId,fromIdx});
  };
  const drop=toIdx=>{
    if(!selected)return;
    onMovePlayer(selected.playerId,toIdx);
    setSelected(null);
  };
  const handFields=HAND_FIELDS_BY_SPORT[team&&team.sport]||[];
  return (
    <div className="movly" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modal" style={{background:"#0d1512",color:"#fff",border:"1px solid rgba(255,255,255,.12)"}}>
        <div className="mhandle" style={{background:"rgba(255,255,255,.2)"}}/>
        <div className="mtitle" style={{color:"#fff"}}>{title}</div>
        {onMovePlayer&&<div style={{fontSize:11,color:"#8fa89b",marginBottom:10}}>{selected?"Tap the dashed spot in another "+data.unitLabel+" to move them there.":"Tap a player to move them."}</div>}
        {(onReshuffle||onGroupByAttribute)&&<div style={{display:"flex",gap:8,marginBottom:12,position:"relative"}}>
          {onReshuffle&&<button type="button" className="btn ghost bxs" style={{background:"transparent",color:"#fff",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>{setSelected(null);setGroupByOpen(false);onReshuffle();}}>Reshuffle</button>}
          {onGroupByAttribute&&<button type="button" className="btn ghost bxs" style={{background:"transparent",color:"#fff",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>setGroupByOpen(o=>!o)}>Group By ▾</button>}
          {groupByOpen&&<div style={{position:"absolute",top:"100%",left:0,marginTop:4,background:"#152420",border:"1px solid rgba(255,255,255,.15)",borderRadius:10,padding:4,zIndex:5,minWidth:160}}>
            <button type="button" style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",color:"#fff",fontSize:13,padding:"8px 10px",cursor:"pointer"}} onClick={()=>{setGroupByOpen(false);setSelected(null);onGroupByAttribute(null);}}>Position</button>
            {handFields.map(hf=><button key={hf.key} type="button" style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",color:"#fff",fontSize:13,padding:"8px 10px",cursor:"pointer"}} onClick={()=>{setGroupByOpen(false);setSelected(null);onGroupByAttribute(hf.key);}}>{hf.label}</button>)}
          </div>}
        </div>}
        {data.uneven&&<div style={{fontSize:12,color:"#fca5a5",fontWeight:600,marginBottom:12,background:"rgba(220,38,38,.15)",border:"1px solid rgba(248,113,113,.4)",borderRadius:8,padding:"8px 10px"}}>{data.unevenNote}</div>}
        {data.groups.map((g,i)=>{
          const isSourceOfSelection=selected&&selected.fromIdx===i;
          return (<div key={i} style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#8fa89b",marginBottom:6}}>{g.label}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {g.players.map(p=>{
                const isPicked=selected&&selected.playerId===p.id;
                return (<button key={p.id} type="button" disabled={!onMovePlayer} onClick={()=>pick(p.id,i)} style={{padding:"6px 12px",borderRadius:20,background:isPicked?"rgba(245,158,11,.25)":"rgba(255,255,255,.1)",border:"1.5px solid "+(isPicked?"#f59e0b":"rgba(255,255,255,.25)"),fontSize:13,fontWeight:600,color:isPicked?"#fde68a":"#fff",cursor:onMovePlayer?"pointer":"default"}}>{p.jersey&&<span style={{fontFamily:"DM Mono,monospace",color:isPicked?"#fde68a":"#52b788",marginRight:4}}>#{p.jersey}</span>}{p.firstName}{isPicked?" · picked up":""}</button>);
              })}
              {g.players.length===0&&!selected&&<span style={{fontSize:12,color:"#8fa89b"}}>No players</span>}
              {/* The landing zone: only in a group other than wherever the
                  picked-up player already is (moving them "into" their own
                  group is a no-op) -- dashed border reads as an empty slot
                  waiting to be filled, distinct from a real player pill. */}
              {selected&&!isSourceOfSelection&&<button type="button" onClick={()=>drop(i)} style={{padding:"6px 14px",borderRadius:20,background:"transparent",border:"1.5px dashed #52b788",fontSize:13,fontWeight:600,color:"#52b788",cursor:"pointer"}}>+ Drop here</button>}
            </div>
          </div>);
        })}
        <button className="btn ghost bmd bfull" style={{background:"transparent",marginTop:4,color:"#fff",borderColor:"rgba(255,255,255,.3)"}} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// A single non-station Run of Practice row -- direct feedback: needs a
// clickable coach-leader tap target (Unassigned/name, same picker stations
// already use, extended to plain activities via onReassignActivityLead), an
// expand-on-title-tap for description/coaching focus (collapsed by
// default -- this is a review screen, not a wall of text), and an optional
// "View Groupings" button whenever the drill actually has a Partners/Groups
// split configured.
function SetupActivityRow({act,loc,data,team,isController,onReassignActivityLead,onViewGroupings,timeRange}){
  const [expanded,setExpanded]=useState(false);
  const subName=id=>{const s=loc&&loc.sublocations.find(s=>s.id===id);return s?s.name:null;};
  const equip=equipNamesFor(act.equipment,data);
  const locName=subName(act.sublocationId);
  const label=leaderLabel(act,team);
  const hasGrouping=(act.grouping||"whole")!=="whole";
  return (<div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"12px 14px",marginBottom:8}}>
    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
      <button type="button" onClick={()=>setExpanded(e=>!e)} style={{background:"none",border:"none",padding:0,textAlign:"left",cursor:"pointer",flex:1,minWidth:0,display:"flex",alignItems:"center",gap:6,color:"#52b788"}}>
        <span style={{fontSize:15,fontWeight:700,color:"#fff"}}>{act.name}</span>
        <Ic.Chev up={expanded}/>
      </button>
      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",flexShrink:0}}>
        <span style={{fontFamily:"DM Mono,monospace",fontSize:13,color:"#8fa89b"}}>{act.duration}m</span>
        {timeRange&&<span style={{fontSize:10,color:"#666",fontFamily:"DM Mono,monospace"}}>{fmtClock(timeRange.start)}–{fmtClock(timeRange.end)}</span>}
      </div>
    </div>
    <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:6,marginTop:8}}>
      <span style={{fontSize:11,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#8fa89b"}}>Coach</span>
      <LeaderTapTarget label={label} onTap={()=>onReassignActivityLead(act.id)} disabled={!isController}/>
      {locName&&<span style={{fontSize:12,color:"#52b788",fontWeight:600,marginLeft:2}}>{locName}</span>}
      {hasGrouping&&<button type="button" className="btn ghost bxs" style={{background:"transparent",color:"#fff",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>onViewGroupings({kind:"drill",act,title:act.name+" -- Groupings"})}>View Groupings</button>}
    </div>
    {equip.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:8}}>{equip.map((e,j)=>(<EquipPill key={j} e={e}/>))}</div>}
    {/* Direct feedback: expanding a practice component here used to show
        nothing at all for a checklist (Intro/Closer/most components) --
        this row only ever rendered a plain drill's description/coaching
        points, and a checklist has neither field. Shows its line items
        instead now, or its freeform notes for a component with no items
        (an "Other" type component). */}
    {expanded&&act.type==="checklist"&&<div style={{marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,.08)"}}>
      {act.items&&act.items.length>0?act.items.map(it=>(<div key={it.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#ccc",marginBottom:6}}>
        <span style={{width:14,height:14,border:"1.5px solid #52b788",borderRadius:4,flexShrink:0}}/>{it.text}
      </div>)):act.notes?<div style={{fontSize:13,color:"#ccc",lineHeight:1.5}}>{act.notes}</div>:<div style={{fontSize:12,color:"#666"}}>Nothing added yet.</div>}
    </div>}
    {expanded&&act.type!=="checklist"&&(act.description||act.coachingPoints)&&<div style={{marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,.08)"}}>
      {act.description&&<div style={{fontSize:13,color:"#ccc",lineHeight:1.5,marginBottom:act.coachingPoints?8:0}}>{act.description}</div>}
      {act.coachingPoints&&<div style={{fontSize:12,color:"#888",lineHeight:1.4,borderLeft:"2px solid #52b788",paddingLeft:8}}>{act.coachingPoints}</div>}
    </div>}
  </div>);
}

// A station block's own Run of Practice row, in its real running order
// (direct feedback: used to be dumped into a separate "Stations" section
// after everything else -- now just another row in the same ordered list).
// Deliberately never shows which players are at which station here -- this
// screen is for coaches to see where *they're* going and what to bring,
// not a player-rotation view (that's what the groupings dialog is for, on
// request). Each station's own leader is independently assignable, same
// picker as a plain drill's.
function SetupStationBlockRow({act,loc,data,team,isController,onReassignLead,onViewGroupings,timeRange}){
  const subName=id=>{const s=loc&&loc.sublocations.find(s=>s.id===id);return s?s.name:null;};
  const totalMins=act.stations.length*(act.stationDuration||0)+Math.max(0,act.stations.length-1)*(act.rotate!==false?(act.transitionDuration||0):0);
  // Direct feedback: a station's description/coaching points showed
  // unconditionally here (unlike a plain drill's own row, which already
  // gated the same content behind expanded) -- one tap-to-expand toggle
  // per station, matching that same pattern.
  const [expandedStations,setExpandedStations]=useState(new Set());
  const toggleExpand=id=>setExpandedStations(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  return (<div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"12px 14px",marginBottom:8}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
      <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".03em"}}>{act.name||"Station Block"}</span>
      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
        <span style={{fontFamily:"DM Mono,monospace",fontSize:13,color:"#8fa89b"}}>{totalMins}m</span>
        {timeRange&&<span style={{fontSize:10,color:"#666",fontFamily:"DM Mono,monospace"}}>{fmtClock(timeRange.start)}–{fmtClock(timeRange.end)}</span>}
      </div>
    </div>
    <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:10}}>
      <span style={{fontSize:11,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#52b788"}}>{act.rotate!==false?"Rotates":"Static"}</span>
      <span style={{fontSize:12,color:"#8fa89b"}}>{act.stationDuration}m per station{act.rotate!==false?" · "+act.transitionDuration+"m transition":""}</span>
      <button type="button" className="btn ghost bxs" style={{background:"transparent",color:"#fff",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>onViewGroupings({kind:"station_block",act,title:"Station Groupings"})}>View Groupings</button>
    </div>
    {act.stations.map((st,si)=>{
      const stEquip=equipNamesFor(st.equipment,data);
      const stLoc=subName(st.sublocationId);
      const label=leaderLabel(st,team);
      const expanded=expandedStations.has(st.id);
      return (<div key={st.id} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"10px 12px",marginBottom:si<act.stations.length-1?8:0}}>
        <button type="button" onClick={()=>toggleExpand(st.id)} style={{background:"none",border:"none",padding:0,textAlign:"left",cursor:"pointer",display:"flex",alignItems:"center",gap:6,width:"100%",marginBottom:6,color:"#52b788"}}>
          <span style={{fontSize:13,fontWeight:700,color:"#fff",flex:1,minWidth:0}}>{st.name||"Station "+(si+1)}{st.activityName?" · "+st.activityName:""}</span>
          {(st.description||st.coachingPoints)&&<Ic.Chev up={expanded}/>}
        </button>
        <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:6,marginBottom:(stLoc||stEquip.length)?8:0}}>
          <span style={{fontSize:11,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#8fa89b"}}>Coach</span>
          <LeaderTapTarget label={label} onTap={()=>onReassignLead(st.id)} disabled={!isController}/>
          {stLoc&&<span style={{fontSize:12,color:"#52b788",fontWeight:600,marginLeft:2}}>{stLoc}</span>}
        </div>
        {expanded&&(st.description||st.coachingPoints)&&<div style={{marginBottom:stEquip.length?8:0}}>
          {st.description&&<div style={{fontSize:12,color:"#ccc",lineHeight:1.4,marginBottom:st.coachingPoints?6:0}}>{st.description}</div>}
          {st.coachingPoints&&<div style={{fontSize:12,color:"#888",lineHeight:1.4,borderLeft:"2px solid #52b788",paddingLeft:8}}>{st.coachingPoints}</div>}
        </div>}
        {stEquip.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4}}>{stEquip.map((e,j)=>(<EquipPill key={j} e={e}/>))}</div>}
      </div>);
    })}
  </div>);
}

// The fresh, pre-live "Practice Setup" stage (not the mid-practice
// "Attendance" quick-update, which stays the plain light AttendanceScreen
// below) -- direct feedback: this should be a black screen a coach can
// review before practice to confirm the whole plan (equipment, locations,
// station leads, rotations), matching the dark palette the old anonymous
// /preview/:token link already used, not a bare attendance form. A live
// countdown to the scheduled start replaces that same need for a coach
// who's signed in rather than viewing an anonymous share link.
function PracticeSetupScreen({practice,team,data,coachId,isController,amHeadCoach,stationBlockActs,setupGroups,onMoveGroupPlayer,onRegenerateGroups,initialPresent,plannedAbsentIds,onConfirm,onBack,onReassignLead,onReassignActivityLead,onEditPractice,onAbort,session,onSetPresentPlayerIds,onSetPresentCoachIds,onTogglePlayerPresent,onToggleCoachPresent}){
  plannedAbsentIds=plannedAbsentIds||new Set();
  const allIds=team?team.players.map(p=>p.id):[];
  const myCoach=team&&team.coaches.find(c=>c.userId===coachId);
  // Real bug found live testing with two real coaches: this used to be
  // plain local useState, seeded once from a locally-computed default and
  // never written anywhere -- a second coach's own screen never saw
  // anything the first one toggled, and "I'm here" (the signed-in coach
  // marked present by default) was itself just local state nobody else
  // ever saw either. Both present sets now live on the session row itself
  // (setup_present_player_ids/setup_present_coach_ids, defaulted server-side
  // by start_or_join_live_session -- see that migration), so every toggle
  // rides the same sync machinery (writeSession's queue, realtime, the
  // reconcile poll) every other live-session field already uses. Derived
  // straight from session, with the old locally-computed values as a
  // fallback only for the impossible-in-practice case this screen renders
  // before session has loaded at all.
  const present=new Set((session&&session.setup_present_player_ids)||initialPresent||[]);
  const coachPresent=new Set((session&&session.setup_present_coach_ids)||(myCoach?[myCoach.id]:[]));
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const iv=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(iv);},[]);
  const togP=id=>onTogglePlayerPresent(id);
  const togC=id=>onToggleCoachPresent(id);
  const pCount=present.size;
  const total=allIds.length;
  // Direct feedback: the Rebalance/Keep Groups choice at the bottom is gone
  // -- grouping review now lives per-drill/per-block above (View
  // Groupings), so starting the practice is just one button. Existing
  // assignments are always kept as-is; any player left unassigned anywhere
  // gets swept up automatically once the live run actually starts (see
  // handleAttConfirm).
  const [attCollapsed,setAttCollapsed]=useState(false);
  const [groupingsFor,setGroupingsFor]=useState(null); // {kind,act,title}
  const [shareUrl,setShareUrl]=useState(null);
  const [sharing,setSharing]=useState(false);
  const [showEllipsis,setShowEllipsis]=useState(false);
  const loc=practice?data.locations.find(l=>l.id===practice.locationId):null;
  const scheduledMs=(()=>{
    if(!practice||!practice.date)return null;
    const iso=teamLocalToScheduledAt(practice.date,practice.startTime||"00:00",team&&team.timezone);
    return iso?new Date(iso).getTime():null;
  })();
  const diffSecs=scheduledMs!==null?Math.floor((scheduledMs-now)/1000):null;
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
  const acts=(practice&&practice.activities)||[];
  const actMinsFor=a=>a.type==="station_block"?(a.stations.length*(a.stationDuration||0)+Math.max(0,a.stations.length-1)*(a.rotate!==false?(a.transitionDuration||0):0)):(a.duration||0);
  const totalMins=acts.reduce((s,a)=>s+actMinsFor(a),0);
  // Direct feedback: same clock-anchored start/end logic the PDF export
  // already computes (timeRangeFor there) -- only meaningful with a real
  // scheduled start time to anchor to, same caveat as the PDF.
  const timeRanges=(()=>{
    if(scheduledMs===null)return acts.map(()=>null);
    let cursor=scheduledMs;
    return acts.map(a=>{
      const mins=actMinsFor(a);
      const start=new Date(cursor);
      const end=new Date(cursor+mins*60000);
      cursor=end.getTime();
      return {start,end};
    });
  })();
  // Equipment Needed: aggregated across every drill/station in the whole
  // practice, deduped by name -- direct feedback this was the first section
  // of the original design and should come back as its own thing, ahead of
  // the full per-drill Run of Practice breakdown below. Direct feedback,
  // this round: grouped by Area (where it's needed) instead of listing a
  // coach name next to each item -- a coach getting the gym ready cares
  // what to grab for each spot, not who's nominally assigned to it.
  const equipItemsForNeeded=acts.flatMap(a=>a.type==="station_block"
    ?(a.stations||[]).map(st=>({equipment:equipNamesFor(st.equipment,data),locationName:(loc&&loc.sublocations.find(s=>s.id===st.sublocationId)||{}).name}))
    :[{equipment:equipNamesFor(a.equipment,data),locationName:(loc&&loc.sublocations.find(s=>s.id===a.sublocationId)||{}).name}]
  );
  const equipByArea=groupEquipmentByArea(equipItemsForNeeded);
  const presentPlayers=team?team.players.filter(p=>present.has(p.id)):[];
  const shareSetupLink=async()=>{
    if(sharing||!practice)return;
    setSharing(true);
    try{
      const token=await findOrCreatePreviewToken(practice.id,coachId);
      // Real bug: a live session already exists by the time a coach can
      // even reach this screen (startOrJoinLiveSession creates/joins one on
      // mount, before attendance is even taken) -- but linkPreviewToLiveSession
      // used to only ever run once, at the moment that session row was first
      // created. Sharing a link from here (the normal, expected way to share
      // it) always happens *after* that point, so the freshly-minted preview
      // token's own session row was left permanently unlinked -- the helper's
      // link would never detect the practice going live, no matter how long
      // they waited. Linking again here, every share, fixes it: the RPC only
      // touches a still-unlinked preview row, so it's a safe no-op if this
      // token (or an earlier one) is already linked.
      if(token&&session)await linkPreviewToLiveSession(practice.id,session.id);
      if(token){
        const url=window.location.origin+"/preview/"+token;
        setShareUrl(url);
        if(navigator.share)navigator.share({title:"Practice Setup - "+(team?team.name:"Practice"),url});
        else navigator.clipboard.writeText(url).catch(()=>{});
      }
    }catch(e){console.error(e);}
    setSharing(false);
  };
  return (<div style={{minHeight:"100dvh",background:"#0d1512",color:"#fff",paddingBottom:120}}>
    <div style={{padding:"14px 20px 0",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <button className="btn ghost bxs" style={{color:"#aaa",background:"transparent"}} onClick={onBack}>&#8249; Back</button>
      <div style={{position:"relative"}}>
        <button className="ell-btn" onClick={()=>setShowEllipsis(s=>!s)}><span/><span/><span/></button>
        {showEllipsis&&<div className="mini-menu" style={{right:0,minWidth:160}}>
          <button className="mm-item" onClick={()=>{setShowEllipsis(false);onBack();}}>Leave</button>
          {isController&&amHeadCoach&&<button className="mm-item" onClick={()=>{setShowEllipsis(false);onEditPractice();}}>Edit Practice</button>}
          {/* Direct feedback: no way to back out of a practice from Setup at
              all, even a mistaken "Run as New" -- the live stage already has
              this exact action (Abort Practice, session status='abandoned'),
              just never surfaced here. Same isController gate as there. */}
          {isController&&onAbort&&<button className="mm-item mm-danger" onClick={()=>{setShowEllipsis(false);onAbort();}}>Abort Practice</button>}
        </div>}
      </div>
    </div>
    <div style={{padding:"16px 20px 16px",borderBottom:"1px solid rgba(255,255,255,.1)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <span style={{width:8,height:8,borderRadius:"50%",background:"#52b788",display:"inline-block",flexShrink:0}}/>
        <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#52b788"}}>Practice Setup</span>
        {loc&&<span style={{fontSize:11,color:"#555",marginLeft:4}}>· {loc.name}</span>}
      </div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,lineHeight:1,marginBottom:10}}>{team&&team.name}</div>
      <button className="btn outline bxs" style={{background:"transparent",color:"#fff",borderColor:"rgba(255,255,255,.3)"}} disabled={sharing} onClick={shareSetupLink}>{shareUrl?"Setup Link Copied/Shared":"Share Setup Link"}</button>
    </div>
    <div style={{padding:"24px 20px",textAlign:"center",borderBottom:"1px solid rgba(255,255,255,.1)"}}>
      {diffSecs!==null?<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:isStarted?"#f59e0b":"#52b788",marginBottom:8}}>
          {isStarted?"Practice should have started":"Starts in"}
        </div>
        <div style={{fontFamily:"DM Mono,monospace",fontSize:56,fontWeight:700,color:isStarted?"#f59e0b":"#fff",lineHeight:1,marginBottom:4}}>{fmtCountdown(absDiff)}</div>
      </div>:<div style={{fontSize:14,color:"#555",marginBottom:4}}>No start time scheduled</div>}
      <div style={{fontSize:13,color:"#ccc",marginTop:8}}>Use this time to get everything set up before you start.</div>
    </div>
    {/* Pre-Practice Warmup, if the coach wrote one -- deliberately above
        Attendance (direct feedback: this is the first thing a coach or an
        early-arriving parent should see, before anyone's even been marked
        present). Not an activity -- see the pre_practice_notes migration
        comment -- so this section has no duration/timer of its own, just
        the coach's free text. */}
    {practice&&practice.prePracticeNotes&&<div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,.1)"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#52b788",marginBottom:8}}>Pre-Practice Warmup</div>
      <div style={{fontSize:14,color:"#fff",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{practice.prePracticeNotes}</div>
    </div>}
    <div style={{padding:"20px 20px 0"}}>
      <button type="button" onClick={()=>setAttCollapsed(c=>!c)} style={{width:"100%",background:"rgba(82,183,136,.15)",border:"1px solid rgba(82,183,136,.4)",borderRadius:10,padding:"12px 16px",marginBottom:attCollapsed?16:12,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",color:"#52b788"}}>
        <span style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span style={{color:"#fff",fontFamily:"DM Mono,monospace",fontSize:24,fontWeight:700}}>{pCount}/{total}</span>
          <span style={{color:"#8fa89b",fontSize:13}}>players present</span>
        </span>
        <Ic.Chev up={!attCollapsed}/>
      </button>
      {!attCollapsed&&<>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#8fa89b"}}>Players</div>
          <div style={{display:"flex",gap:6}}>
            <button type="button" className="btn ghost bxs" style={{background:"transparent",color:"#fff",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>onSetPresentPlayerIds(allIds.filter(id=>!plannedAbsentIds.has(id)))}>Mark All Present</button>
            <button type="button" className="btn ghost bxs" style={{background:"transparent",color:"#fff",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>onSetPresentPlayerIds([])}>Clear All</button>
          </div>
        </div>
        <div className="att-grid att-grid-dark">
          {team&&team.players.map(p=>(<button key={p.id} onClick={()=>togP(p.id)} className={"att-btn att-btn-dark att-btn-compact "+(present.has(p.id)?"on":"")}>
            <div className={"att-circle att-circle-dark att-circle-sm "+(present.has(p.id)?"on":"")}>{present.has(p.id)&&<Ic.Check/>}</div>
            <div><div style={{fontSize:13,fontWeight:600,color:present.has(p.id)?"#fff":"#8fa89b"}}>{p.firstName}</div></div>
          </button>))}
        </div>
        {team&&team.coaches.length>0&&(<div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:16,marginBottom:8}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#8fa89b"}}>Coaches</div>
            <div style={{display:"flex",gap:6}}>
              <button type="button" className="btn ghost bxs" style={{background:"transparent",color:"#fff",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>onSetPresentCoachIds(team.coaches.map(c=>c.id))}>Mark All Present</button>
              <button type="button" className="btn ghost bxs" style={{background:"transparent",color:"#fff",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>onSetPresentCoachIds([])}>Clear All</button>
            </div>
          </div>
          {team.coaches.map(c=>(<button key={c.id} onClick={()=>togC(c.id)} className={"att-btn att-btn-dark att-btn-compact bfull "+(coachPresent.has(c.id)?"on":"")} style={{marginBottom:6}}>
            <div className={"att-circle att-circle-dark att-circle-sm "+(coachPresent.has(c.id)?"on":"")}>{coachPresent.has(c.id)&&<Ic.Check/>}</div>
            <div><div style={{fontSize:13,fontWeight:600,color:coachPresent.has(c.id)?"#fff":"#8fa89b"}}>{c.name}</div><div style={{fontSize:10,color:"#666"}}>{c.role}</div></div>
          </button>))}
        </div>)}
      </>}
      {equipByArea.length>0&&<div style={{marginTop:24}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#555",marginBottom:10}}>Equipment Needed</div>
        <EquipmentByArea equipByArea={equipByArea}/>
      </div>}
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#555",marginTop:24,marginBottom:12}}>Run of Practice · {totalMins}min</div>
      {acts.map((act,i)=>act.type==="station_block"
        ?<SetupStationBlockRow key={act.id} act={act} loc={loc} data={data} team={team} isController={isController} onReassignLead={onReassignLead} onViewGroupings={setGroupingsFor} timeRange={timeRanges[i]}/>
        :<SetupActivityRow key={act.id} act={act} loc={loc} data={data} team={team} isController={isController} onReassignActivityLead={onReassignActivityLead} onViewGroupings={setGroupingsFor} timeRange={timeRanges[i]}/>
      )}
    </div>
    <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#0d1512",borderTop:"1px solid rgba(255,255,255,.1)",padding:"12px 20px calc(12px + env(safe-area-inset-bottom))",zIndex:50}}>
      <button className="btn primary bfull bmd" onClick={()=>onConfirm({presentIds:present,coachPresentIds:coachPresent,balanceMode:"keep"})}>Run Practice</button>
    </div>
    {groupingsFor&&<GroupingsDialog title={groupingsFor.title} data={computeGroupingsPreview({kind:groupingsFor.kind==="station_block"?"station_block":"drill",act:groupingsFor.act,presentPlayers,setupGroups})} onClose={()=>setGroupingsFor(null)} team={team} onMovePlayer={isController&&onMoveGroupPlayer?(playerId,toIdx)=>onMoveGroupPlayer(groupingsFor.act.id,playerId,toIdx):null} onReshuffle={isController&&onRegenerateGroups?()=>onRegenerateGroups(groupingsFor.act,groupingsFor.kind,presentPlayers.map(p=>p.id),"random",null):null} onGroupByAttribute={isController&&onRegenerateGroups?handKey=>onRegenerateGroups(groupingsFor.act,groupingsFor.kind,presentPlayers.map(p=>p.id),"attribute",handKey):null}/>}
  </div>);
}

function HistoryViewer({data,practice,onRunAgain,onBack,coachId,refreshPlanning,setSubViewBack}){
  // Nav restructure round 3: same pattern as PracticeDetail -- registers
  // with Layout's colored bar when reached from a team-scoped Schedule tab
  // (setSubViewBack passed in), otherwise keeps its own inline Back button
  // (reached from Home, which has no colored bar).
  const onBackRef=useRef(onBack);
  useEffect(()=>{onBackRef.current=onBack;});
  useEffect(()=>{
    if(!setSubViewBack)return;
    setSubViewBack({onBack:()=>onBackRef.current()});
    return ()=>setSubViewBack(null);
  },[setSubViewBack]);
  const [tplSaved,setTplSaved]=useState(false);
  const [tplError,setTplError]=useState("");
  const [savingTpl,setSavingTpl]=useState(false);
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
  const [showPrint,setShowPrint]=useState(false);
  // Fetched from the notes table on demand (not bulk-loaded with the rest
  // of the app's data) -- keyed by real practice_activity_id/station_id,
  // not the old blob's fragile context-name match.
  const [practiceNotes,setPracticeNotes]=useState([]);
  useEffect(()=>{fetchNotesForPractice(practice.id).then(setPracticeNotes);},[practice.id]);
  // Direct feedback: show when this actually happened, not the originally
  // scheduled time, for a practice run early/late relative to its plan.
  const [actualStart,setActualStart]=useState(null);
  useEffect(()=>{fetchPracticeActualStart(practice.id).then(setActualStart);},[practice.id]);
  const notesForActivity=activityId=>practiceNotes.filter(n=>n.practiceActivityId===activityId&&!n.stationId);
  const notesForStation=stationId=>practiceNotes.filter(n=>n.stationId===stationId);
  const generalNotes=practiceNotes.filter(n=>!n.practiceActivityId);
  // Used to only mutate the local `data` blob (a plain uid(), never a real
  // template row) -- looked like it worked (button flips to "Saved as
  // Template") but nothing ever reached the templates table, so it vanished
  // on refresh and never showed up in Library. stripIdsForCopy matches
  // runAgainFrom's pattern just below (App.jsx/HomeScreen.jsx/
  // ScheduleScreen.jsx): a completed practice's activity ids are real
  // practice_activities rows, not template_activities ones, so they need
  // fresh ids or saveActivityTree would try to update rows that don't exist
  // in the destination table.
  const handleSaveAsTpl=async()=>{
    if(!tplNameInput.trim()||savingTpl)return;
    setSavingTpl(true);setTplError("");
    const sport=(team&&team.sport)||"General";
    const {error}=await saveTemplateTree(coachId,null,{
      name:tplNameInput,sport,teamId:practice.teamId,
      activities:stripIdsForCopy(practice.activities),
    });
    setSavingTpl(false);
    // Real, specific errors (RLS rejection, etc.) were being masked behind
    // a generic message -- see GoalsScreen.jsx's own Save as Template for
    // the same fix and its full reasoning.
    if(error){setTplError(error.message?"Couldn't save: "+error.message:"Something went wrong saving. Try again.");return;}
    if(refreshPlanning)await refreshPlanning();
    setTplSaved(true);setShowTplInput(false);setTplNameInput("");
    setTimeout(()=>setTplSaved(false),2500);
  };
  const NotesList=({notes})=>{
    if(!notes||!notes.length)return null;
    return(<div style={{marginTop:8,paddingTop:8,borderTop:"1px dashed var(--b)"}}>
      {notes.map(n=>(<div key={n.id} style={{display:"flex",gap:8,marginBottom:6,alignItems:"flex-start"}}>
        <span style={{fontSize:11,color:"var(--td)",flexShrink:0,marginTop:2}}>{new Date(n.createdAt).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}</span>
        <span style={{fontSize:13,color:"var(--black)",lineHeight:1.4,flex:1}}>{n.text}</span>
      </div>))}
    </div>);
  };
  return (<div style={{paddingBottom:80}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
      {!setSubViewBack&&<button className="btn ghost bxs" onClick={onBack}>Back</button>}
      <div>
        <div className="ptitle" style={{fontSize:20}}>{team?team.name:"Practice"}</div>
        <div className="limt">{actualStart?new Date(actualStart).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"})+" at "+new Date(actualStart).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}):fmtDate(practice.date)+(practice.startTime?" at "+practice.startTime:"")}{loc?" · "+loc.name:""}</div>
      </div>
    </div>
    {/* Print/PDF export used to only exist on PracticeDetail, which a
        past/run practice never routes to (ScheduleScreen sends those here
        instead) -- so a coach who forgot to print beforehand had no way
        to get the plan afterward. Same component, same data this screen
        already has. */}
    <button className="btn outline bsm bfull" style={{marginBottom:12}} onClick={()=>setShowPrint(true)}>Print / Export PDF</button>
    <div className="sechdr mb8">
      <span className="sectitle">{practice.activities.length} Activities</span>
      <span className="pill">{sumMins(practice.activities)}m</span>
    </div>
    {practice.activities.map(act=>{
      const isExpanded=expandedId===act.id;
      const actNotes=practiceNotes.filter(n=>n.practiceActivityId===act.id);
      const hasNotes=actNotes.length>0;
      return(<div key={act.id} className="ablk" style={{marginBottom:8}}>
        {/* Header row */}
        <div style={{display:"flex",alignItems:"center",padding:"11px 12px",background:"var(--s2)",gap:8,cursor:"pointer"}} onClick={()=>setExpandedId(isExpanded?null:act.id)}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{font:"700 14px Barlow Condensed,sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {act.type==="station_block"?(act.name||"Station Block"):act.name}
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
            <NotesList notes={notesForActivity(act.id)}/>
          </div>}
          {act.type==="checklist"&&<div>
            {(act.items||[]).map(it=>(<div key={it.id} style={{fontSize:13,padding:"4px 0",borderBottom:"1px solid var(--b)",color:"var(--black)"}}>{it.text}</div>))}
            <NotesList notes={notesForActivity(act.id)}/>
          </div>}
          {act.type==="station_block"&&<div>
            {act.stations.map(st=>{
              const stNotes=notesForStation(st.id);
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
                  <NotesList notes={stNotes}/>
                </div>
              </div>);
            })}
            {/* Block-level notes not tied to a specific station */}
            <NotesList notes={notesForActivity(act.id)}/>
          </div>}
        </div>}
      </div>);
    })}
    {/* End of practice notes */}
    {generalNotes.length>0&&<div className="card mb10">
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,marginBottom:8}}>End of Practice Notes</div>
      <NotesList notes={generalNotes}/>
    </div>}
    <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid var(--b)"}}>
      <button className="btn primary bxl bfull" style={{marginBottom:8}} onClick={onRunAgain}>Run Again</button>
      {showTplInput&&<div>
        <div className="fld"><label className="lbl">Template Name</label><input className="inp" autoFocus placeholder={(team?team.name:"Practice")+" Template"} value={tplNameInput} onChange={e=>{setTplNameInput(e.target.value);if(tplError)setTplError("");}} onKeyDown={e=>e.key==="Enter"&&handleSaveAsTpl()}/></div>
        {tplError&&<div style={{fontSize:12,color:"var(--red)",marginBottom:6}}>{tplError}</div>}
        <div className="brow"><button className="btn ghost bsm" onClick={()=>setShowTplInput(false)}>Cancel</button><button className="btn primary bsm" onClick={handleSaveAsTpl} disabled={!tplNameInput.trim()||savingTpl}>{savingTpl?"Saving...":"Save"}</button></div>
      </div>}
      {!showTplInput&&<button className="btn ghost bmd bfull" onClick={()=>setShowTplInput(true)}>{tplSaved?"Saved as Template":"Save as Template"}</button>}
    </div>
    {showPrint&&<PracticePlanPrint practice={practice} team={team} loc={loc} data={data} onClose={()=>setShowPrint(false)}/>}
  </div>);
}

// -- PreviewView, shown at /preview/[token] before practice starts --
export function PreviewView({token}){
  const navigate=useNavigate();
  const [preview,setPreview]=useState(null);
  const [loading,setLoading]=useState(true);
  const [now,setNow]=useState(Date.now());
  // Assign/share only ever renders for preview.can_manage===true, which the
  // get_preview_view RPC computes server-side off auth.uid() (2026-07-29) --
  // an anonymous parent hitting the exact same /preview/:token route never
  // gets a team_staff list or these controls, no client-side auth check
  // needed here.
  const [reassignStationId,setReassignStationId]=useState(null);
  const [helperDraft,setHelperDraft]=useState("");
  const [busy,setBusy]=useState(false);
  const [copied,setCopied]=useState(false);
  const [expandedRows,setExpandedRows]=useState(new Set());
  const toggleExpand=key=>setExpandedRows(s=>{const n=new Set(s);n.has(key)?n.delete(key):n.add(key);return n;});
  const presenceMe=preview&&!preview.error?(preview.can_manage?{kind:"coach",label:preview.my_coach_name||"A coach"}:{kind:"anon"}):null;
  const presence=usePracticePresence(preview&&preview.practice_id,presenceMe);

  useEffect(()=>{const iv=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(iv);},[]);

  // A coach reaching this token screen (their own "Practice Setup" link, or
  // a shared link they happen to also be a rostered coach on) gets routed
  // into the real live session the moment one exists, setup-confirmed or
  // not -- that's the actual coach experience (attendance, station
  // assignment, full controls) this token-based screen was never able to
  // provide. An anonymous viewer only redirects once the practice is
  // truly running (is_live requires setup_confirmed_at server-side, see
  // 20260805050000), never mid-setup, since there's no "current drill"
  // for HelperView to show yet at that point.
  const redirectIfLive=useCallback(data=>{
    if(!data)return;
    if(data.can_manage&&data.has_live_session){navigate("/run/"+data.practice_id);return;}
    if(data.is_live&&data.live_token)window.location.href="/live/"+data.live_token;
  },[navigate]);

  const refetch=useCallback(async()=>{
    const data=await getPreviewByToken(token);
    setPreview(data);setLoading(false);
    redirectIfLive(data);
  },[token,redirectIfLive]);

  useEffect(()=>{
    let cancelled=false;
    const poll=async()=>{
      const data=await getPreviewByToken(token);
      if(cancelled)return;
      setPreview(data);setLoading(false);
      redirectIfLive(data);
    };
    poll();
    // Direct feedback: a helper's shared setup link should follow along
    // "at the same time" the coach actually starts the practice -- a 5s
    // poll made that feel laggy even once the real linking bug above was
    // fixed. 2s is a reasonable floor for a plain poll (no realtime channel
    // exists for an anonymous pre-live viewer to subscribe to, since the
    // live session's real id is deliberately never exposed pre-link).
    const iv=setInterval(poll,2000);
    return()=>{cancelled=true;clearInterval(iv);};
  },[token,redirectIfLive]);

  const doSetLead=async(stationId,{coachId,helperName})=>{
    setBusy(true);
    await updateStationLead(stationId,{coachId,helperName});
    await refetch();
    setBusy(false);setReassignStationId(null);setHelperDraft("");
  };
  const shareUrl=window.location.origin+"/preview/"+token;
  const copyShareUrl=()=>{try{navigator.clipboard.writeText(shareUrl).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});}catch(e){}};
  const shareSetup=()=>{if(navigator.share)navigator.share({title:"Run of Practice - Practice Setup",url:shareUrl});else copyShareUrl();};

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

  // get_preview_view (20260805030000) sends equipment as {name,acquired}
  // objects so "Add Drill Anyway" gear a coach doesn't own yet can still be
  // called out here, not just inside the app. Grouped by Area (same
  // groupEquipmentByArea helper Practice Setup uses) so a helper sees what's
  // needed where, not who's nominally assigned to bring it.
  const equipItemsForNeeded=activities.flatMap(act=>{
    if(act.type==="station_block")return (act.station_block&&act.station_block.stations||[]).map(st=>({equipment:st.equipment||[],locationName:st.sublocation_name||null}));
    return [{equipment:act.equipment||[],locationName:act.sublocation_name||null}];
  });
  const equipByArea=groupEquipmentByArea(equipItemsForNeeded);

  const actMinsFor=a=>{
    if(a.type==="station_block"&&a.station_block){
      const stCount=(a.station_block.stations||[]).length;
      const sd=Math.round((a.station_block.station_duration_seconds||0)/60);
      const td=Math.round((a.station_block.transition_duration_seconds||0)/60);
      return stCount*sd+Math.max(0,stCount-1)*(a.station_block.rotate!==false?td:0);
    }
    return a.duration_minutes||0;
  };
  const totalMins=activities.reduce((s,a)=>s+actMinsFor(a),0);
  // Same clock-anchored start/end logic Practice Setup and the PDF export
  // both use -- only meaningful once there's a real scheduled start time.
  const timeRanges=(()=>{
    if(startMs===null)return activities.map(()=>null);
    let cursor=startMs;
    return activities.map(a=>{
      const mins=actMinsFor(a);
      const start=new Date(cursor);
      const end=new Date(cursor+mins*60000);
      cursor=end.getTime();
      return {start,end};
    });
  })();

  return(<div style={{minHeight:"100dvh",background:"#0d1512",color:"#fff",paddingBottom:preview.can_manage?100:40}}>
    {/* Back-to-Home + a persistent Start Practice bar -- neither existed
        before, so a coach who reached this via Home's "Practice Setup"
        button had no way back except the browser's own Back button, and
        no way to actually start the run from here at all. Anonymous
        helpers get neither (no can_manage, no "home" to go back to, and
        starting the practice isn't theirs to do). */}
    {preview.can_manage&&<div style={{padding:"14px 20px 0"}}>
      <button className="btn ghost bxs" style={{color:"#aaa",background:"transparent"}} onClick={()=>navigate("/")}>&#8249; Back to Home</button>
    </div>}
    <div style={{padding:"24px 20px 16px",borderBottom:"1px solid rgba(255,255,255,.1)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <span style={{width:8,height:8,borderRadius:"50%",background:"#52b788",display:"inline-block",flexShrink:0}}/>
        <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#52b788"}}>Practice Setup</span>
        {preview.location_name&&<span style={{fontSize:11,color:"#555",marginLeft:4}}>· {preview.location_name}</span>}
      </div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,lineHeight:1,marginBottom:4}}>{preview.team_name||"Practice"}</div>
      {preview.scheduled_at&&<div style={{fontSize:13,color:"#aaa"}}>{new Date(preview.scheduled_at).toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})} at {new Date(preview.scheduled_at).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}</div>}
      <div style={{marginTop:10}}><PresenceBadge coachNames={presence.coachNames} anonCount={presence.anonCount} dark/></div>
      {preview.can_manage&&<button className="btn outline bxs" style={{marginTop:10,background:"transparent",borderColor:"rgba(255,255,255,.25)",color:"#fff"}} onClick={shareSetup}>{copied?"Link Copied!":"Share Setup Link"}</button>}
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
        {!isStarted&&<div style={{fontSize:12,color:"#555"}}>Use this time to get everything set up before you start.</div>}
      </div>}
      {diffSecs===null&&<div style={{fontSize:14,color:"#555"}}>No start time scheduled</div>}
    </div>

    {preview.pre_practice_notes&&<div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,.1)"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#52b788",marginBottom:8}}>Pre-Practice Warmup</div>
      <div style={{fontSize:14,color:"#fff",lineHeight:1.5,whiteSpace:"pre-wrap"}}>{preview.pre_practice_notes}</div>
    </div>}

    {equipByArea.length>0&&<div style={{padding:"16px 20px",borderBottom:"1px solid rgba(255,255,255,.1)"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#ca8a04",marginBottom:10}}>Equipment Needed</div>
      <EquipmentByArea equipByArea={equipByArea}/>
    </div>}

    <div style={{padding:"16px 20px"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#555",marginBottom:12}}>Run of Practice · {totalMins}min</div>
      {activities.map((act,i)=>{
        // Direct feedback: description/coaching points used to show
        // unconditionally here -- same collapse-until-expanded behavior
        // the coach's own Practice Setup screen just got, so this list
        // reads as a scannable overview by default, not a wall of text.
        const expanded=expandedRows.has(act.id||"act-"+i);
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
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
                <span style={{fontFamily:"DM Mono,monospace",fontSize:13,color:"#555"}}>{totalBlockMins}m</span>
                {timeRanges[i]&&<span style={{fontSize:10,color:"#555",fontFamily:"DM Mono,monospace"}}>{fmtClock(timeRanges[i].start)}–{fmtClock(timeRanges[i].end)}</span>}
              </div>
            </div>
            {stations.map((st,si)=>{
              const stExpanded=expandedRows.has(st.id||(i+"-"+si));
              return(<div key={si} style={{padding:"10px 14px",borderBottom:si<stations.length-1?"1px solid rgba(255,255,255,.06)":"none"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:(st.equipment&&st.equipment.length)||st.description||st.coaching_points?6:0}}>
                <button type="button" onClick={()=>toggleExpand(st.id||(i+"-"+si))} style={{background:"none",border:"none",padding:0,textAlign:"left",cursor:"pointer",display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0,color:"#52b788"}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,color:"#52b788",letterSpacing:".05em",marginBottom:2}}>Station {si+1}</div>
                    <div style={{fontSize:15,fontWeight:700,color:"#fff"}}>{st.name||"Station "+(si+1)}</div>
                  </div>
                  {(st.description||st.coaching_points)&&<Ic.Chev up={stExpanded}/>}
                </button>
              </div>
              {(st.coach_name||st.sublocation_name||preview.can_manage)&&<div style={{fontSize:12,color:"#888",marginBottom:6}}>
                {st.sublocation_name&&<span style={{color:"#52b788",fontWeight:600}}>{st.sublocation_name}</span>}
                {st.sublocation_name&&(st.coach_name||preview.can_manage)&&<span style={{color:"#444"}}> · </span>}
                {!preview.can_manage&&st.coach_name&&<span>{st.coach_name}</span>}
                {preview.can_manage&&<button type="button" onClick={()=>setReassignStationId(st.id)} style={{background:"none",border:"none",padding:0,font:"inherit",color:st.coach_name?"#fff":"#f59e0b",cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:2}}>{st.coach_name||"No leader assigned -- tap to assign"}</button>}
              </div>}
              {stExpanded&&(st.description||st.coaching_points)&&<div style={{marginBottom:6}}>
                {st.description&&<div style={{fontSize:12,color:"#ccc",lineHeight:1.4,marginBottom:st.coaching_points?6:0}}>{st.description}</div>}
                {st.coaching_points&&<div style={{fontSize:12,color:"#888",lineHeight:1.4,borderLeft:"2px solid #52b788",paddingLeft:8}}>{st.coaching_points}</div>}
              </div>}
              {(st.equipment&&st.equipment.length>0)&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
                {st.equipment.map((e,j)=>(<span key={j} style={e.acquired===false?{background:"rgba(220,38,38,.18)",border:"1px solid rgba(248,113,113,.6)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#fca5a5",fontWeight:700}:{background:"rgba(202,138,4,.12)",border:"1px solid rgba(202,138,4,.3)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#fde047"}}>{e.name}{e.acquired===false&&" · not acquired"}</span>))}
              </div>}
            </div>);
            })}
          </div>);
        }
        const equip=act.equipment||[];
        return(<div key={i} style={{marginBottom:8,background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"12px 14px"}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
            <button type="button" onClick={()=>toggleExpand("act-"+i)} style={{background:"none",border:"none",padding:0,textAlign:"left",cursor:"pointer",display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0,color:"#52b788"}}>
              <span style={{fontSize:15,fontWeight:700,color:"#fff"}}>{act.name}</span>
              {(act.description||act.coaching_points)&&<Ic.Chev up={expanded}/>}
            </button>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",flexShrink:0,marginLeft:8}}>
              <span style={{fontFamily:"DM Mono,monospace",fontSize:13,color:"#555"}}>{act.duration_minutes}m</span>
              {timeRanges[i]&&<span style={{fontSize:10,color:"#555",fontFamily:"DM Mono,monospace"}}>{fmtClock(timeRanges[i].start)}–{fmtClock(timeRanges[i].end)}</span>}
            </div>
          </div>
          {(act.coach_name||act.sublocation_name)&&<div style={{fontSize:12,color:"#888",marginTop:2,marginBottom:6}}>
            {act.sublocation_name&&<span style={{color:"#52b788",fontWeight:600}}>{act.sublocation_name}</span>}
            {act.sublocation_name&&act.coach_name&&<span style={{color:"#444"}}> · </span>}
            {act.coach_name&&<span>{act.coach_name}</span>}
          </div>}
          {expanded&&(act.description||act.coaching_points)&&<div style={{marginBottom:6}}>
            {act.description&&<div style={{fontSize:13,color:"#ccc",lineHeight:1.5,marginBottom:act.coaching_points?6:0}}>{act.description}</div>}
            {act.coaching_points&&<div style={{fontSize:12,color:"#888",lineHeight:1.4,borderLeft:"2px solid #52b788",paddingLeft:8}}>{act.coaching_points}</div>}
          </div>}
          {equip.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
            {equip.map((e,j)=>(<span key={j} style={e.acquired===false?{background:"rgba(220,38,38,.18)",border:"1px solid rgba(248,113,113,.6)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#fca5a5",fontWeight:700}:{background:"rgba(202,138,4,.12)",border:"1px solid rgba(202,138,4,.3)",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#fde047"}}>{e.name}{e.acquired===false&&" · not acquired"}</span>))}
          </div>}
        </div>);
      })}
    </div>
    {preview.can_manage&&<div style={{position:"fixed",bottom:0,left:0,right:0,padding:"12px 20px calc(12px + env(safe-area-inset-bottom))",background:"#0d1512",borderTop:"1px solid rgba(255,255,255,.1)",zIndex:100}}>
      <button className="btn primary bxl bfull" onClick={()=>navigate("/run/"+preview.practice_id)}>Start Practice &#8594;</button>
    </div>}
    {reassignStationId&&<div className="movly" style={{zIndex:200}} onClick={e=>{if(e.target===e.currentTarget){setReassignStationId(null);setHelperDraft("");}}}>
      <div className="modal" style={{background:"#151f1a",color:"#fff"}}>
        <div className="mhandle"/>
        <div className="mtitle" style={{color:"#fff"}}>Who's Leading This Station?</div>
        <button className="btn ghost bmd bfull" style={{marginBottom:8}} disabled={busy} onClick={()=>doSetLead(reassignStationId,{coachId:"",helperName:""})}>Unassign</button>
        {(preview.team_staff||[]).map(c=>(<button key={c.id} className="btn outline bmd bfull" style={{marginBottom:8}} disabled={busy} onClick={()=>doSetLead(reassignStationId,{coachId:c.id,helperName:""})}>{c.name}</button>))}
        <div className="fld" style={{marginTop:4}}>
          <label className="lbl" style={{color:"#aaa"}}>Or a helper not on the roster</label>
          <div style={{display:"flex",gap:6}}>
            <input className="inp" style={{flex:1}} placeholder="Helper's name" autoFocus value={helperDraft} onChange={e=>setHelperDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&helperDraft.trim())doSetLead(reassignStationId,{coachId:"",helperName:helperDraft.trim()});}}/>
            <button className="btn primary bxs" disabled={!helperDraft.trim()||busy} onClick={()=>doSetLead(reassignStationId,{coachId:"",helperName:helperDraft.trim()})}>Set</button>
          </div>
        </div>
        <div style={{fontSize:12,color:"#888",marginTop:10,lineHeight:1.4}}>Once they're assigned, share this setup link with them from the button up top -- it'll take them straight into the live view once you start the practice.</div>
        <button className="btn ghost bmd bfull" style={{marginTop:8}} onClick={()=>{setReassignStationId(null);setHelperDraft("");}}>Cancel</button>
      </div>
    </div>}
  </div>);
}

function computeHelperElapsed(session,nowMs){
  if(!session||!session.current_phase_started_at)return 0;
  const started=new Date(session.current_phase_started_at).getTime();
  const effectiveNow=session.paused_at?new Date(session.paused_at).getTime():nowMs;
  return Math.max(0,Math.floor((effectiveNow-started)/1000)-(session.total_paused_seconds||0));
}

// Direct feedback: focus notes used to be hidden behind a tap-to-reveal
// toggle here ("● focus" / "▲"), different from how the coach's own view
// shows the exact same thing -- StationPlayerChip already shows a
// player's focus note as a second line right inside the same chip,
// always visible, no tap needed. Matched here so a helper/assistant sees
// player focus the identical way a head coach does. No `focus` passed
// (the pre-tap-to-focus views) renders a plain name-only chip.
function HelperPlayerChip({p,focus}){
  return (<span style={{display:"inline-flex",flexDirection:"column",alignItems:"flex-start",gap:1,maxWidth:focus?150:undefined}}>
    <span style={{background:"var(--s2)",border:"1px solid var(--b)",borderRadius:8,padding:"3px 8px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:4}}>
      {p.jersey_number&&<span style={{fontFamily:"DM Mono,monospace",fontSize:11,color:"var(--green)"}}>#{p.jersey_number}</span>}{p.first_name} {p.last_initial}.
    </span>
    {focus&&<span style={{fontSize:10,color:"var(--green2)",lineHeight:1.3,whiteSpace:"normal"}}>{focus}</span>}
  </span>);
}


// ── Notes system (Assistant Coach handoff §2) ────────────────────────────────
// Only HelperView uses this composer -- the staff live view already had a
// real note-capture UI (createNote/notes table, below in the main
// CommandScreen component) before this handoff; that one got @mention
// support added directly rather than being replaced with a second
// composer. HelperView had no note UI at all, so this is genuinely new
// there, submitting via the token-validated submitPracticeNoteByToken
// RPC instead of a direct authenticated insert. "roster" is always
// [{id, displayName}] regardless of which caller supplies it.
function NoteComposer({roster,currentActivityLabel,onSubmit,showAuthorLabel}){
  const [body,setBody]=useState("");
  const [authorLabel,setAuthorLabel]=useState("");
  const [taggedIds,setTaggedIds]=useState([]);
  const [endOfPractice,setEndOfPractice]=useState(!currentActivityLabel);
  const [mentionQuery,setMentionQuery]=useState(null);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState(null);
  const [justSaved,setJustSaved]=useState(false);
  const taRef=useRef(null);
  useEffect(()=>{if(!justSaved)return;const t=setTimeout(()=>setJustSaved(false),2500);return()=>clearTimeout(t);},[justSaved]);

  const handleChange=e=>{
    const val=e.target.value;
    setBody(val);
    const caret=e.target.selectionStart;
    const m=val.slice(0,caret).match(/@([a-zA-Z]*)$/);
    setMentionQuery(m?m[1]:null);
  };
  const filtered=mentionQuery===null?[]:roster.filter(p=>p.displayName.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0,8);
  const pickPlayer=p=>{
    const caret=taRef.current?taRef.current.selectionStart:body.length;
    const before=body.slice(0,caret).replace(/@([a-zA-Z]*)$/,"@"+p.displayName+" ");
    setBody(before+body.slice(caret));
    setTaggedIds(ids=>ids.includes(p.id)?ids:[...ids,p.id]);
    setMentionQuery(null);
    setTimeout(()=>{if(taRef.current)taRef.current.focus();},0);
  };
  const errorText=e=>e==="body_too_long"?"Note is too long (500 char max).":e==="rate_limited"?"Too many notes submitted from this link.":e==="empty_body"?"Note can't be empty.":"Something went wrong. Try again.";
  const submit=async()=>{
    if(!body.trim()||submitting)return;
    setSubmitting(true);setError(null);
    const res=await onSubmit(body.trim(),taggedIds,endOfPractice,authorLabel.trim());
    setSubmitting(false);
    if(res&&res.error){setError(errorText(res.error));return;}
    setBody("");setTaggedIds([]);setAuthorLabel("");setEndOfPractice(!currentActivityLabel);setJustSaved(true);
  };
  return (<div className="card mb10">
    {showAuthorLabel&&<input className="inp mb8" placeholder="Your name (optional)" value={authorLabel} onChange={e=>setAuthorLabel(e.target.value)} maxLength={100}/>}
    {currentActivityLabel&&<div style={{display:"flex",gap:6,marginBottom:8}}>
      <button type="button" onClick={()=>setEndOfPractice(false)} style={{flex:1,padding:"8px 6px",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:!endOfPractice?"var(--green)":"var(--s1)",color:!endOfPractice?"#fff":"var(--black)",fontSize:12,fontWeight:700,cursor:"pointer"}}>{currentActivityLabel}</button>
      <button type="button" onClick={()=>setEndOfPractice(true)} style={{flex:1,padding:"8px 6px",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:endOfPractice?"var(--green)":"var(--s1)",color:endOfPractice?"#fff":"var(--black)",fontSize:12,fontWeight:700,cursor:"pointer"}}>General</button>
    </div>}
    <div style={{position:"relative"}}>
      <textarea ref={taRef} className="ta" placeholder="Add a note... type @ to tag a player" value={body} onChange={handleChange} maxLength={500}/>
      {mentionQuery!==null&&filtered.length>0&&<div className="mini-menu" style={{position:"absolute",top:"100%",left:0,right:0,zIndex:5,maxHeight:160,overflowY:"auto"}}>
        {filtered.map(p=>(<button key={p.id} type="button" className="mm-item" onClick={()=>pickPlayer(p)}>{p.displayName}</button>))}
      </div>}
    </div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
      <span style={{fontSize:11,color:"var(--td)"}}>{body.length}/500</span>
      <button className="btn primary bsm" disabled={submitting||!body.trim()} onClick={submit}>{submitting?"Saving...":"Add Note"}</button>
    </div>
    {error&&<div style={{fontSize:12,color:"var(--red)",marginTop:4}}>{error}</div>}
    {justSaved&&<div style={{fontSize:12,color:"var(--green)",marginTop:4}}>Note added.</div>}
  </div>);
}
// Author-role labeling (handoff §2.3): resolve a staff note's real name +
// role from the already-loaded team roster (same source myTeamRole/
// isHeadCoach already read elsewhere), never a raw stored name; anonymous
// notes show their freeform author_label as "Helper" instead.
function noteAuthorDisplay(note,team){
  if(note.authorKind==="anonymous")return (note.authorLabel||"A helper")+" (Helper)";
  const c=team&&(team.coaches||[]).find(c=>c.userId===note.authorId);
  return (c?c.name:"A coach")+(c?" ("+c.role+")":"");
}
function HelperView({token}){
  const [session,setSession]=useState(null);
  const [loading,setLoading]=useState(true);
  const [focusSt,setFocusSt]=useState(null);
  const [audioOn,setAudioOn]=useState(false);
  const [now,setNow]=useState(Date.now());
  const [showAtt,setShowAtt]=useState(false);
  const [showROS,setShowROS]=useState(false);
  const [showNotes,setShowNotes]=useState(false);
  const [markingId,setMarkingId]=useState(null);
  const [showAudioPrompt,setShowAudioPrompt]=useState(true);
  const [previewUpcoming,setPreviewUpcoming]=useState(null);
  const [showPlayerFocus,setShowPlayerFocus]=useState(false);
  // Same shape as CommandScreen's own transitionFocus -- {label,skillTags,
  // playerFocus,playerIds} for a tapped transition card's Player Focus
  // button, sourced from the server-computed per-station skill_tags/
  // player_focus (get_live_session_view) instead of a client-side lookup.
  const [transitionFocus,setTransitionFocus]=useState(null);
  const spokenRef=useRef({});
  const buzzedRef=useRef(false);

  // Real bug: this whole block (silent background-audio loop, Wake Lock,
  // Media Session registration) only ever existed on the coach's own
  // CommandScreen. A helper's link is opened in a plain browser tab, not
  // installed as a PWA -- exactly the case mobile browsers are most
  // aggressive about suspending once it's backgrounded or the phone
  // locks, since there's no registered "now playing" session telling the
  // OS this tab is doing something worth keeping alive. Mirrors the
  // coach's own implementation.
  const bgAudioRef=useRef(null);
  const wakeLockRef=useRef(null);
  useEffect(()=>{
    const bg=new Audio('/audio/silence-loop.wav');
    bg.loop=true;bg.volume=0.02;
    bgAudioRef.current=bg;
    return()=>{
      try{bg.pause();}catch(e){}
      bgAudioRef.current=null;
      if(wakeLockRef.current){try{wakeLockRef.current.release();}catch(e){}wakeLockRef.current=null;}
    };
  },[]);
  const requestWakeLock=useCallback(async()=>{
    try{if('wakeLock' in navigator)wakeLockRef.current=await navigator.wakeLock.request('screen');}catch(e){}
  },[]);
  const sessionActive=session&&!session.error&&session.status==="active";
  useEffect(()=>{
    if(sessionActive)requestWakeLock();
  },[sessionActive,requestWakeLock]);
  useEffect(()=>{
    const onVis=()=>{if(document.visibilityState==='visible'&&sessionActive)requestWakeLock();};
    document.addEventListener('visibilitychange',onVis);
    return()=>document.removeEventListener('visibilitychange',onVis);
  },[sessionActive,requestWakeLock]);
  const startBgAudioSession=useCallback(()=>{
    try{if(bgAudioRef.current){bgAudioRef.current.currentTime=0;bgAudioRef.current.play().catch(()=>{});}}catch(e){}
    try{
      if('mediaSession' in navigator){
        navigator.mediaSession.metadata=new window.MediaMetadata({title:'Live Practice',artist:'Run of Practice'});
        navigator.mediaSession.playbackState='playing';
      }
    }catch(e){}
    requestWakeLock();
  },[requestWakeLock]);
  const stopBgAudioSession=useCallback(()=>{
    try{if(bgAudioRef.current)bgAudioRef.current.pause();}catch(e){}
    try{if('mediaSession' in navigator)navigator.mediaSession.playbackState='none';}catch(e){}
    try{if(wakeLockRef.current){wakeLockRef.current.release();wakeLockRef.current=null;}}catch(e){}
  },[]);

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

  const markAttendance=async(playerId,status)=>{
    setMarkingId(playerId);
    await submitHelperAttendanceByToken(token,playerId,status);
    const fresh=await getLiveSessionByToken(token);
    setSession(fresh);
    setMarkingId(null);
  };

  // HelperView has no Settings screen or saved per-coach preference of its
  // own -- always defaults to the same male voice (Daniel) coaches default
  // to, instead of whatever the browser happens to pick.
  const speak=txt=>{if(!audioOn)return;try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(txt);u.rate=0.9;const v=resolveDefaultVoice();if(v)u.voice=v;window.speechSynthesis.speak(u);}catch(e){}};
  const beep=()=>{if(!audioOn)return;try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance("Next up!");u.rate=1.1;u.pitch=1.2;u.volume=1;window.speechSynthesis.speak(u);}catch(e){}};

  const valid=session&&!session.error;
  const presence=usePracticePresence(valid?session.practice_id:null,valid?{kind:"anon"}:null);
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
    // Same fix the coach's own live view already got: a phase that's 2
    // minutes or shorter lands inside the [118,122]s warning window almost
    // the instant it starts, so the cue played right at the top of the
    // phase instead of near its end. HelperView had its own separate copy
    // of this timing logic that never got the same guard -- applied here
    // too so both views actually agree on when this fires.
    if(phaseSecs<=120)return;
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
    return Object.assign({},st,{players:g?g.players:[],group_label:(stations[srcIdx]&&stations[srcIdx].group_label)||""});
  }):null;
  // Direct feedback: this always read "Station X of Y" even while
  // rotating, which reads as "there are X stations" rather than "this is
  // round X" -- the number changing is the rotation, not the station
  // count. Static blocks (no rotation at all) get their own label too,
  // instead of the generic "Station Block".
  const phaseLabel=isBlock?(inBlockIntro?"INTRODUCE STATIONS":blockRotate?(inTrans?"TRANSITION":"ROTATION "+(stIdx+1)+" of "+n):"STATION BREAKOUTS"):((cur&&cur.name)||"").toUpperCase();
  const roster=session.roster||[];
  const mentionRoster=roster.map(p=>({id:p.id,displayName:(p.jersey_number?"#"+p.jersey_number+" ":"")+p.first_name+" "+p.last_initial+"."}));
  const submitHelperNote=async(body,taggedIds,endOfPractice,authorLabel)=>{
    return submitPracticeNoteByToken(token,body,endOfPractice?null:session.current_practice_activity_id,null,authorLabel,taggedIds);
  };
  const upcoming=session.upcoming_activities||[];
  // Direct feedback: the coach's own Overview crosses out anything already
  // run (computed locally there, since the coach has the full plan client-
  // side) -- HelperView never had the full list to do the same, only ever
  // getting "what's left." all_activities (new RPC field) is every
  // activity in order; comparing each one's own position against the
  // current activity's gives the same completed/current/upcoming split.
  const allActivities=session.all_activities||[];
  const curPosition=(()=>{const a=allActivities.find(a=>a.id===session.current_practice_activity_id);return a?a.position:-1;})();
  const pCount=roster.filter(p=>p.status==="present").length;
  const pTotal=roster.length;
  const canMark=!!session.can_mark_attendance;
  const upcomingMins=a=>a.type==="station_block"?(a.station_count||0)*Math.round((a.station_duration_seconds||0)/60)+Math.max(0,(a.station_count||0)-1)*(a.rotate!==false?Math.round((a.transition_duration_seconds||0)/60):0):(a.duration_minutes||0);
  const playerName=pid=>{const p=roster.find(p=>p.id===pid);return p?(p.jersey_number?"#"+p.jersey_number+" ":"")+p.first_name:null;};
  const toPreviewItem=a=>({
    name:a.type==="station_block"?(a.name||"Station Block"):a.name,
    durationMins:upcomingMins(a),
    locationName:a.sublocation_name||"",
    equipmentNames:a.equipment||[],
    stations:(a.stations||[]).map(st=>({name:st.name,locationName:st.sublocation_name||"",coachName:st.coach_name||null,equipmentNames:st.equipment||[],playerNames:(st.player_ids||[]).map(playerName).filter(Boolean)})),
  });

  return(<div className="ccs">
    {showAudioPrompt&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setShowAudioPrompt(false);}}>
      <div className="modal">
        <div className="mhandle"/>
        <div className="mtitle">Turn On Audio?</div>
        <div style={{fontSize:13,color:"var(--td)",marginBottom:10}}>Run of Practice can call out the two-minute warning and time's up, so you don't need to keep watching the screen.</div>
        {/* Direct feedback: also remind the coach to turn their device's
            volume up. Browsers don't expose the device's actual output
            volume level to a web page (no Web Audio/media API reads system
            or hardware volume, only in-page gain) -- there's no way to tell
            whether it's already loud enough, so this always shows rather
            than only below some volume threshold. */}
        <div style={{fontSize:13,fontWeight:700,color:"var(--amber)",background:"var(--ambg)",border:"1.5px solid var(--ambb)",borderRadius:8,padding:"8px 10px",marginBottom:14}}>🔉 Reminder: Turn up your device's volume.</div>
        <button className="btn primary bmd bfull mb8" onClick={()=>{
          if(!audioOn){try{const u=new SpeechSynthesisUtterance("Audio on");u.rate=1;u.volume=1;window.speechSynthesis.speak(u);}catch(e){}startBgAudioSession();}
          spokenRef.current={};buzzedRef.current=false;setAudioOn(true);setShowAudioPrompt(false);
        }}>🔊 Turn On Audio</button>
        <button className="btn ghost bmd bfull" onClick={()=>{setAudioOn(false);setShowAudioPrompt(false);}}>🔇 Keep Audio Off</button>
      </div>
    </div>}
    <div className="cc-header">
      <div className="cc-header-top" style={{justifyContent:"flex-end"}}>
        <div className="row" style={{gap:6,flexShrink:0}}>
          {pTotal>0&&<button onClick={()=>setShowAtt(s=>!s)} style={{display:"flex",alignItems:"center",gap:5,background:pCount<pTotal?"var(--ambg)":"var(--gbg)",border:"1.5px solid",borderColor:pCount<pTotal?"var(--ambb)":"var(--gb)",borderRadius:20,padding:"4px 10px",cursor:"pointer"}}>
            <span style={{color:pCount<pTotal?"var(--amber)":"var(--green)",display:"flex"}}><Ic.Person/></span>
            <span style={{fontFamily:"DM Mono,monospace",fontSize:13,fontWeight:700,color:pCount<pTotal?"var(--amber)":"var(--green)"}}>{pCount}/{pTotal}</span>
          </button>}
          <button className="btn ghost bxs" style={{display:"flex",alignItems:"center",gap:4}} onClick={()=>setShowNotes(s=>!s)}>Notes<Ic.Chev up={showNotes}/></button>
          <button className="btn ghost bxs" style={{display:"flex",alignItems:"center",gap:4}} onClick={()=>setShowROS(s=>!s)}>Overview<Ic.Chev up={showROS}/></button>
          <button onClick={()=>{if(!audioOn){try{const u=new SpeechSynthesisUtterance("Audio on");u.rate=1;u.volume=1;window.speechSynthesis.speak(u);}catch(e){}startBgAudioSession();}else{stopBgAudioSession();}spokenRef.current={};buzzedRef.current=false;setAudioOn(a=>!a);}} style={{background:audioOn?"var(--gbg)":"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"var(--rs)",padding:"4px 8px",fontSize:13,fontWeight:700,cursor:"pointer",color:audioOn?"var(--green)":"var(--td)",display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:13,lineHeight:1}}>{audioOn?"🔊":"🔇"}</span><span>{audioOn?"On":"Off"}</span></button>
        </div>
      </div>
      <div className="row" style={{gap:6,flexWrap:"wrap",marginTop:6}}>
        <span className="live"/><span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)"}}>Live</span><span style={{fontSize:11,color:"var(--td)"}}>Helper View</span>
        <PresenceBadge coachNames={presence.coachNames} anonCount={presence.anonCount}/>
      </div>
      <div className="cc-act-name">{phaseLabel}</div>
      {!isBlock&&cur&&(cur.coach_name||cur.sublocation_name)&&<div style={{fontSize:13,fontWeight:600,color:"var(--td)",marginTop:2,display:"flex",alignItems:"center",flexWrap:"wrap",gap:4}}>
        {cur.coach_name&&<span className="bdg bp">Coach: {cur.coach_name}</span>}
        {cur.coach_name&&cur.sublocation_name&&<span>·</span>}
        {cur.sublocation_name&&<span>{cur.sublocation_name}</span>}
      </div>}
      {isBlock&&<div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)"}}>{(cur.name?cur.name+" · ":"")+stations.length+" Stations"}</div>}
    </div>
    {showNotes&&<div style={{background:"var(--s1)",borderBottom:"1px solid var(--b)",padding:"12px 14px",flexShrink:0}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Add a Note</div>
      <NoteComposer roster={mentionRoster} currentActivityLabel={cur?cur.name:null} onSubmit={submitHelperNote} showAuthorLabel/>
      <button className="btn ghost bxs" onClick={()=>setShowNotes(false)}>Close</button>
    </div>}
    {showAtt&&<div style={{background:"var(--s1)",borderBottom:"1px solid var(--b)",padding:"12px 14px",maxHeight:280,overflowY:"auto",flexShrink:0}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Attendance ({pCount}/{pTotal}){canMark?"":" · view only"}</div>
      {!canMark&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
        {roster.map(p=>(<span key={p.id} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid",borderColor:p.status==="present"?"var(--green)":"var(--b)",background:p.status==="present"?"var(--gbg)":"var(--s2)",color:p.status==="present"?"var(--green)":"var(--td)",fontSize:13,fontWeight:600}}>{p.jersey_number?"#"+p.jersey_number+" ":""}{p.first_name} {p.last_initial}.</span>))}
      </div>}
      {canMark&&roster.map(p=>(<div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--b)"}}>
        <span style={{fontSize:14,fontWeight:600,color:"var(--black)"}}>{p.jersey_number?"#"+p.jersey_number+" ":""}{p.first_name} {p.last_initial}.</span>
        <div className="row" style={{gap:4}}>
          <button disabled={markingId===p.id} onClick={()=>markAttendance(p.id,"present")} className={"btn bxs "+(p.status==="present"?"primary":"ghost")}>Present</button>
          <button disabled={markingId===p.id} onClick={()=>markAttendance(p.id,"absent")} className={"btn bxs "+(p.status==="absent"?"danger":"ghost")}>Absent</button>
          <button disabled={markingId===p.id} onClick={()=>markAttendance(p.id,"left_early")} className={"btn bxs "+(p.status==="left_early"?"danger":"ghost")}>Left</button>
        </div>
      </div>))}
      <button className="btn ghost bxs" style={{marginTop:8}} onClick={()=>setShowAtt(false)}>Close</button>
    </div>}
    {showROS&&<div style={{background:"var(--s1)",borderBottom:"1px solid var(--b)",maxHeight:200,overflowY:"auto",flexShrink:0}}>
      {!allActivities.length&&<div style={{padding:"12px 14px",fontSize:13,color:"var(--td)"}}>Nothing in this practice yet.</div>}
      {allActivities.map((a,i)=>{
        const isCur=a.id===session.current_practice_activity_id;
        const isPast=curPosition>=0&&a.position<curPosition;
        return(<button key={a.id||i} type="button" onClick={()=>setPreviewUpcoming(toPreviewItem(a))} style={{display:"flex",alignItems:"center",width:"100%",border:"none",background:isCur?"var(--gbg)":"none",cursor:"pointer",textAlign:"left",padding:"8px 14px",borderBottom:"1px solid var(--b)",opacity:isPast?0.5:1}}>
          <div style={{flex:1,fontSize:14,color:isCur?"var(--green)":isPast?"var(--td)":"var(--black)",textDecoration:isPast?"line-through":"none"}}>{isCur?">> ":""}{a.type==="station_block"?(a.name||"Station Block"):a.name}</div>
          <span className="bdg bs">{upcomingMins(a)}m</span>
        </button>);
      })}
      <div style={{padding:"8px 14px"}}><button className="btn ghost bxs" onClick={()=>setShowROS(false)}>Close</button></div>
    </div>}
    {previewUpcoming&&<UpcomingPreview item={previewUpcoming} onClose={()=>setPreviewUpcoming(null)}/>}
    <div className="cc-timer-row"><div className={"cc-timer"+(urg?" urg":(elapsed>phaseSecs?" over":""))}>{fmt(rem)}</div></div>
    <div className="cc-prog"><div className={"cc-prog-bar"+(elapsed>phaseSecs?" over":"")} style={{width:(Math.min(1,prog)*100)+"%"}}/></div>
    <div className="cc-body">
      {isCl&&cur&&<div className="cc-focus"><div className="cc-focus-lbl">{cur.name}</div>{(cur.items||[]).map(it=>(<div key={it.id} className="cl-item"><div className="cl-check"/><div className="cl-text">{it.text}</div></div>))}</div>}
      {!isBlock&&!isCl&&cur&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {cur.description&&<div style={{borderLeft:"3px solid var(--black)",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--black)",marginBottom:4}}>Description</div>
          <div style={{fontSize:14,color:"var(--black)",lineHeight:1.5}}>{cur.description}</div>
        </div>}
        {cur.coaching_points&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#16a34a",marginBottom:4}}>💡 Coaching Focus</div>
          <div style={{fontSize:15,color:"var(--black)",lineHeight:1.5}}>{cur.coaching_points}</div>
        </div>}
        {cur.skill_tags&&cur.skill_tags.length>0&&<button type="button" className="btn ghost bsm" style={{alignSelf:"flex-start"}} onClick={()=>setShowPlayerFocus(true)}>Player Focus</button>}
        {(cur.equipment&&cur.equipment.length>0)&&<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          <span style={{border:"1.5px solid #fde047",borderRadius:20,padding:"3px 10px",fontSize:12,color:"#854d0e",fontWeight:600,background:"#fff"}}>Equipment: {cur.equipment.join(", ")}</span>
        </div>}
        {groups.length>0&&<div style={{borderLeft:"3px solid #7c3aed",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#7c3aed",marginBottom:8}}>👥 Groups</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {groups.map((g,i)=>(<div key={i} style={{display:"inline-flex",alignItems:"center",gap:6,border:"1.5px solid #c4b5fd",borderRadius:20,padding:"5px 12px",background:"#fff"}}>
              <span style={{fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700,color:"#7c3aed",flexShrink:0}}>G{g.group_number}</span>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>{(g.players||[]).map(p=>(<HelperPlayerChip key={p.id} p={p} focus={cur.player_focus&&cur.player_focus[p.id]}/>))}</div>
            </div>))}
          </div>
        </div>}
        {groups.length===0&&<div style={{borderLeft:"3px solid var(--b)",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:3}}>👥 Players</div>
          <div style={{fontSize:14,color:"var(--black)"}}>Whole Team Together</div>
        </div>}
      </div>}
      {/* Direct feedback: this screen still looked like a plain light card,
          not the coach's own dark #0d1512 Introduce Stations treatment,
          and its field order/content (skill tags and coaching points shown
          up front) didn't match the coach's minimal pre-block-start view
          either. Matched exactly now: same background/card styling, same
          header-row layout (station # / area / coach), same fields, same
          order, coaching points and skill tags dropped since the coach's
          own version never shows them here either. */}
      {isBlock&&inBlockIntro&&stations.length>0&&<div style={{background:"#0d1512",borderRadius:"var(--r)",padding:"14px 12px",marginBottom:4}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#8fa89b",marginBottom:12}}>Get everyone to their station</div>
        {stations.map((st,i)=>{
          const g=groups[i];
          return(<div key={st.id||i} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#52b788"}}>Station {i+1}</div>
              {st.sublocation_name&&<div style={{fontSize:11,color:"#52b788",fontWeight:600}}>{st.sublocation_name}</div>}
              {st.coach_name&&<div style={{fontSize:11,color:"#8fa89b"}}>{st.coach_name}</div>}
            </div>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"#fff",marginBottom:6}}>{st.name||"Station "+(i+1)}</div>
            {st.group_label&&<div style={{marginBottom:6}}><span className="bdg bp">Group: {st.group_label}</span></div>}
            {(st.equipment&&st.equipment.length>0)&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
              <span style={{background:"rgba(202,138,4,.22)",border:"1px solid rgba(253,224,71,.5)",borderRadius:20,padding:"2px 9px",fontSize:11,color:"#fde047",fontWeight:700}}>Equipment: {st.equipment.join(", ")}</span>
            </div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {g&&(g.players||[]).map(p=>(<HelperPlayerChip key={p.id} p={p} focus={st.player_focus&&st.player_focus[p.id]}/>))}
            </div>
          </div>);
        })}
        <div style={{textAlign:"center",fontSize:12,color:"#8fa89b",marginTop:8}}>Waiting for coach to start the block</div>
      </div>}
      {isBlock&&!inBlockIntro&&!inTrans&&rotatedStations&&<div>
        {focusSt!==null&&<div>
          {/* Direct feedback: this used to show area before the drill name,
              coach as a separate pill after the group label, no
              description field at all (present in the data, just never
              rendered), and skill tags that the coach's own view never
              shows here either. Reordered and pruned to match the coach's
              exact field order: title, group, coach+area combined on one
              line, description, coaching focus, equipment, players. */}
          <button className="btn ghost bxs" style={{marginBottom:10}} onClick={()=>setFocusSt(null)}>&#8249; All Stations</button>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginBottom:2}}>Station {focusSt+1}</div>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:36,fontWeight:900,color:"var(--black)",lineHeight:1,marginBottom:6}}>{rotatedStations[focusSt].name||"Station "+(focusSt+1)}</div>
          {rotatedStations[focusSt].group_label&&<div style={{marginBottom:6}}><span className="bdg bp">Group: {rotatedStations[focusSt].group_label}</span></div>}
          {(rotatedStations[focusSt].coach_name||rotatedStations[focusSt].sublocation_name)&&<div style={{fontSize:14,fontWeight:600,color:"var(--green2)",marginBottom:10,display:"flex",alignItems:"center",flexWrap:"wrap",gap:4}}>
            {rotatedStations[focusSt].coach_name&&<span>{rotatedStations[focusSt].coach_name}</span>}
            {rotatedStations[focusSt].coach_name&&rotatedStations[focusSt].sublocation_name&&<span>·</span>}
            {rotatedStations[focusSt].sublocation_name&&<span>{rotatedStations[focusSt].sublocation_name}</span>}
          </div>}
          {rotatedStations[focusSt].description&&<div style={{borderLeft:"3px solid var(--black)",paddingLeft:10,paddingTop:4,paddingBottom:8,marginBottom:4}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--black)",marginBottom:4}}>Description</div>
            <div style={{fontSize:14,color:"var(--black)",lineHeight:1.5}}>{rotatedStations[focusSt].description}</div>
          </div>}
          {rotatedStations[focusSt].coaching_points&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:10,paddingTop:4,paddingBottom:8,marginBottom:4}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#16a34a",marginBottom:4}}>💡 Coaching Focus</div>
            <div style={{fontSize:15,color:"var(--black)",lineHeight:1.5}}>{rotatedStations[focusSt].coaching_points}</div>
          </div>}
          {(rotatedStations[focusSt].equipment&&rotatedStations[focusSt].equipment.length>0)&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            <span style={{background:"#fefce8",border:"1px solid #fde047",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#854d0e",fontWeight:600}}>Equipment: {rotatedStations[focusSt].equipment.join(", ")}</span>
          </div>}
          <div><div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Players at this station</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{(rotatedStations[focusSt].players||[]).map(p=>(<HelperPlayerChip key={p.id} p={p} focus={rotatedStations[focusSt].player_focus&&rotatedStations[focusSt].player_focus[p.id]}/>))}</div></div>
        </div>}
        {focusSt===null&&<div>
          {/* Direct feedback: helper/assistant pre-tap info should match the
              coach's own pre-tap view exactly -- station #, drill, area,
              coach, equipment, player names only. Coaching points, skill
              tags, and per-player focus notes are what tapping in reveals,
              not something to show at a glance across every station. Also:
              one clear hint here (sized up, not repeated at the bottom of
              every card) instead of two. */}
          <div style={{fontSize:13,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>{blockRotate?"Round "+(stIdx+1)+" of "+n+" · Tap a station to focus":"Tap a station to focus"}</div>
          {rotatedStations.map((st,i)=>(<div key={st.id||i} onClick={()=>setFocusSt(i)} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8,cursor:"pointer"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}>
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)"}}>Station {i+1}</div>
              {st.coach_name&&<div style={{fontSize:11,color:"var(--td)"}}>{st.coach_name}</div>}
            </div>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,color:"var(--black)",lineHeight:1.1,marginBottom:4}}>{st.name||"Station "+(i+1)}</div>
            {st.group_label&&<div style={{marginBottom:4}}><span className="bdg bp">Group: {st.group_label}</span></div>}
            {st.sublocation_name&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:4}}>{st.sublocation_name}</div>}
            {(st.equipment&&st.equipment.length>0)&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
              <span style={{background:"rgba(202,138,4,.22)",border:"1px solid rgba(253,224,71,.5)",borderRadius:20,padding:"2px 9px",fontSize:11,color:"#fde047",fontWeight:700}}>Equipment: {st.equipment.join(", ")}</span>
            </div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:5}} onClick={e=>e.stopPropagation()}>{(st.players||[]).map(p=>(<HelperPlayerChip key={p.id} p={p}/>))}</div>
          </div>))}
        </div>}
      </div>}
      {/* Direct feedback: the coach's own transition screen is deliberately
          dark (#0d1512) to read as "getting organized," distinct from the
          light background used while actually coaching -- HelperView never
          got the same treatment, so a helper had no visual cue a rotation
          was happening. Same background/card styling and the same
          from/to labels (station + area + coach) as the coach's view now. */}
      {isBlock&&inTrans&&rotatedStations&&<div style={{background:"#0d1512",borderRadius:"var(--r)",padding:"14px 12px",marginBottom:4}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:900,color:"#f87171",letterSpacing:".08em",textTransform:"uppercase",marginBottom:10}}>Rotate Now</div>
        {/* Same fixed area-sequence summary the coach's own live view shows
            -- the station order (and so this sequence) never changes across
            a rotation, only who's occupying each slot does. */}
        {n>1&&<div style={{fontSize:17,fontWeight:800,color:"#fff",lineHeight:1.4,marginBottom:12,paddingBottom:12,borderBottom:"1px solid rgba(255,255,255,.1)"}}>
          {stations.map((st,i)=>{
            const nextSt=stations[(i+1)%n];
            const fromLoc=st.sublocation_name||"Station "+(i+1);
            const toLoc=nextSt.sublocation_name||"Station "+((i+1)%n+1);
            return fromLoc+" to "+toLoc;
          }).join(", ")}
        </div>}
        {rotatedStations.map((st,i)=>{
          const nextSt=stations[(i+1)%n];
          const fromLabel="Station "+(i+1)+(st.sublocation_name?": "+st.sublocation_name:"")+(st.coach_name?" · "+st.coach_name:"")+(st.name?" · "+st.name:"");
          const toLabel="Station "+((i+1)%n+1)+(nextSt.sublocation_name?": "+nextSt.sublocation_name:"")+(nextSt.coach_name?" · "+nextSt.coach_name:"")+(nextSt.name?" · "+nextSt.name:"");
          return(<div key={st.id||i} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",borderRadius:"var(--r)",padding:"14px",marginBottom:8}}>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"#fff",lineHeight:1.2,marginBottom:6}}>{(st.players||[]).map(p=>p.first_name).join(", ")||"--"}</div>
            {st.group_label&&<div style={{marginBottom:4}}><span className="bdg bp">Group: {st.group_label}</span></div>}
            <div style={{fontSize:13,fontWeight:700,color:"#52b788",marginBottom:3}}>TO: <span style={{fontWeight:400}}>{toLabel}</span></div>
            <div style={{fontSize:12,fontWeight:700,color:"#8fa89b"}}>FROM: <span style={{fontWeight:400}}>{fromLabel}</span></div>
            {nextSt.skill_tags&&nextSt.skill_tags.length>0&&<button type="button" className="btn ghost bxs" style={{marginTop:8,background:"transparent",color:"#fff",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>setTransitionFocus({label:toLabel,skillTags:nextSt.skill_tags,playerFocus:nextSt.player_focus||{},playerIds:(st.players||[]).map(p=>p.id)})}>Player Focus</button>}
          </div>);
        })}
      </div>}
      {/* Direct feedback: helper view should look like the coach's live view
          (read only) -- the coach's own screen has a persistent "Up Next"
          preview row here (not just the Overview toggle above), so this
          adds the same thing, same spoiler-avoidance during a mid-block
          rotation (showing the *real* next rotation before it happens would
          give away who's about to move where). */}
      {isBlock&&blockRotate&&!inBlockIntro&&!inTrans&&stIdx<n-1?(
        <>
          <div className="cc-queue-hdr"><span className="cc-queue-hdr-label">Up Next</span><span className="cc-queue-hdr-line"/></div>
          <div className="cc-queue">
            <div className="cc-queue-item" style={{width:"100%"}}><span style={{fontSize:14,color:"var(--black2)"}}>Station rotation coming up</span></div>
          </div>
        </>
      ):(upcoming.length>0&&<>
        <div className="cc-queue-hdr"><span className="cc-queue-hdr-label">Up Next</span><span className="cc-queue-hdr-line"/></div>
        <div className="cc-queue" style={{maxHeight:220,overflowY:"auto"}}>
          {upcoming.map((a,i)=>(<button key={i} type="button" className="cc-queue-item" style={{width:"100%",border:"none",background:"none",cursor:"pointer",textAlign:"left"}} onClick={()=>setPreviewUpcoming(toPreviewItem(a))}>
            <span style={{fontSize:14,color:"var(--black2)"}}>{a.type==="station_block"?(a.name||"Station Block"):a.name}</span>
            <span className="bdg bs">{upcomingMins(a)}m</span>
          </button>))}
        </div>
      </>)}
    </div>
    {showPlayerFocus&&cur&&<div className="movly" onClick={()=>setShowPlayerFocus(false)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="mhandle"/>
        <div className="mtitle">Player Focus</div>
        <div style={{fontSize:13,color:"var(--td)",marginBottom:12}}>What each present player is working on for {(cur.skill_tags||[]).join(", ")||"this drill"}.</div>
        {(()=>{
          const focus=cur.player_focus||{};
          const withNotes=roster.filter(p=>p.status==="present"&&focus[p.id]);
          if(!withNotes.length)return <div style={{fontSize:14,color:"var(--td)",textAlign:"center",padding:"16px 0"}}>No player notes set for this yet.</div>;
          return withNotes.map(p=>(<div key={p.id} style={{marginBottom:8,padding:"10px 12px",background:"var(--s2)",borderRadius:"var(--rs)"}}>
            <div style={{fontSize:14,fontWeight:700,color:"var(--black)"}}>{p.jersey_number?"#"+p.jersey_number+" ":""}{p.first_name}</div>
            <div style={{fontSize:13,color:"var(--black2)",marginTop:2}}>{focus[p.id]}</div>
          </div>));
        })()}
        <button className="btn ghost bmd bfull" style={{marginTop:8}} onClick={()=>setShowPlayerFocus(false)}>Close</button>
      </div>
    </div>}
    {transitionFocus&&<div className="movly" onClick={()=>setTransitionFocus(null)}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="mhandle"/>
        <div className="mtitle">Player Focus -- {transitionFocus.label}</div>
        <div style={{fontSize:13,color:"var(--td)",marginBottom:12}}>What this group is working on for {(transitionFocus.skillTags||[]).join(", ")||"this drill"}.</div>
        {(()=>{
          const focus=transitionFocus.playerFocus||{};
          const withNotes=roster.filter(p=>(transitionFocus.playerIds||[]).includes(p.id)&&focus[p.id]);
          if(!withNotes.length)return <div style={{fontSize:14,color:"var(--td)",textAlign:"center",padding:"16px 0"}}>No player notes set for this yet.</div>;
          return withNotes.map(p=>(<div key={p.id} style={{marginBottom:8,padding:"10px 12px",background:"var(--s2)",borderRadius:"var(--rs)"}}>
            <div style={{fontSize:14,fontWeight:700,color:"var(--black)"}}>{p.jersey_number?"#"+p.jersey_number+" ":""}{p.first_name}</div>
            <div style={{fontSize:13,color:"var(--black2)",marginTop:2}}>{focus[p.id]}</div>
          </div>));
        })()}
        <button className="btn ghost bmd bfull" style={{marginTop:8}} onClick={()=>setTransitionFocus(null)}>Close</button>
      </div>
    </div>}
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

// Direct feedback: station blocks now start with no player assignments at
// all until a coach explicitly generates/assigns them (Builder no longer
// auto-fills every station the moment one's added) -- "if the coach
// doesn't select players for the grouping, the app should be smart enough
// to randomly assign once the practice begins and attendance has been
// taken." mode="rebalance" (an explicit choice, still available to
// mid-practice attendance updates) always does a fresh even split; the
// default "keep" path used to just filter the plan's existing assignments
// down to present players -- extended here so a block that was *never*
// touched (every one of its stations still has zero assignments) gets that
// same even split automatically instead of silently starting empty.
async function seedAllStationGroups(sessionId, activities, presentIds, mode, createdBy, allPlayers) {
  for (const act of activities) {
    if (act.type !== "station_block") continue;
    const neverAssigned = act.stations.every(st => !(st.assignments || []).length);
    const rebalanced = (mode === "rebalance" || neverAssigned) ? rebalanceEven(act.stations, presentIds, allPlayers) : rebalanceKeep(act.stations, presentIds);
    await saveSessionGroups(sessionId, act.id, createdBy, rebalanced.map(st => st.assignments || []));
  }
}

// ── In-session practice editor ──────────────────────────────────────────────
// A cut-down BuilderScreen scoped to just the activity list (team/location/
// schedule stay fixed for a practice already live) -- reorders, adds, edits
// and removes activities, then hands the new list back to the caller, which
// is responsible for re-pointing the live session at whatever now sits at
// index 0 (see onSaveResume in CommandScreen below).
// Direct feedback: mid-live "Edit Practice" opened a bare-bones builder that
// looked and behaved nothing like the real (modern) Builder screen -- no
// drag reordering, no library source picker (mine/org/peer/public), no
// equipment-mismatch check, old row header/subtext. Rebuilt in place (not a
// real navigation to /builder/:id -- that would unmount CommandScreen and
// lose the live-session refs/closures onSaveResume relies on to safely
// resume the run) using the exact same reusable pieces the real Builder
// screen (App.jsx) already uses, so a coach editing mid-live gets the same
// experience as editing anywhere else, just without Save-as-Template/
// Run Now/schedule fields, which don't apply here.
function LiveEditBuilder({data,coachId,refreshLibrary,liveActs,team,loc,onSaveResume,onBack}){
  const [acts,setActs]=useState(()=>JSON.parse(JSON.stringify(liveActs||[])));
  const [expandedId,setExpandedId]=useState(null);
  const [saving,setSaving]=useState(false);
  const teamSport=(team&&team.sport)||"General";
  const filteredLib=(data.activityLibrary||[]).filter(a=>(a.sport||"General")===teamSport||(a.sport||"General")==="General");
  const defaultAssignIds=team?team.players.map(p=>p.id):[];
  const totalMins=sumMins(acts);

  const [lastAddedId,setLastAddedId]=useState(null);
  const assetsById=Object.fromEntries((data.assets||[]).map(a=>[a.id,a]));
  const ownAssetPool=(data.assets||[]).filter(a=>a.ownerUserId===coachId);
  const [equipmentDialogLib,setEquipmentDialogLib]=useState(null);
  const addAct=(lib,equipmentOverride)=>{
    const id=uid();
    setActs(p=>[...p,{id,type:"activity",libraryId:lib.id,name:lib.name,duration:lib.duration,assignments:defaultAssignIds,coachId:"",sublocationId:"",notes:"",description:lib.description||"",coachingPoints:lib.coachingPoints||"",grouping:lib.grouping||"whole",numGroups:lib.numGroups||2,playerGear:lib.playerGear||"",equipment:equipmentOverride!==undefined?equipmentOverride:(Array.isArray(lib.equipment)?lib.equipment:[])}]);
    setExpandedId(id);setLastAddedId(id);
  };
  const addActChecked=lib=>{
    const missing=findMissingEquipment(lib.equipment,assetsById,ownAssetPool);
    if(missing.length===0){addAct(lib);return;}
    setEquipmentDialogLib(lib);
  };
  const resolveAndAdd=async(lib,createMissingEquipment)=>{
    const resolvedIds=await resolveDrillEquipmentForCoach(coachId,lib.equipment,assetsById,ownAssetPool,createMissingEquipment);
    addAct(lib,resolvedIds);
    setEquipmentDialogLib(null);
    if(createMissingEquipment)await refreshLibrary();
  };
  const addChecklist=isClose=>{
    const a={id:uid(),type:"checklist",name:isClose?"Closer":"Intro",duration:5,assignments:defaultAssignIds,coachId:"",items:[],notes:""};
    setActs(p=>[...p,a]);setExpandedId(a.id);setLastAddedId(a.id);
  };
  const addBlock=()=>{
    const b={id:uid(),type:"station_block",rotate:true,stationDuration:10,transitionDuration:2,stations:[
      {id:uid(),name:"Station 1",activityName:"",coachId:"",sublocationId:"",assignments:[],coachingPoints:"",equipment:[],playerGear:""},
      {id:uid(),name:"Station 2",activityName:"",coachId:"",sublocationId:"",assignments:[],coachingPoints:"",equipment:[],playerGear:""},
    ]};
    setActs(p=>[...p,b]);setExpandedId(b.id);setLastAddedId(b.id);
  };
  const remAct=id=>{setActs(p=>p.filter(a=>a.id!==id));if(lastAddedId===id)setLastAddedId(null);};
  const updAct=(id,ch)=>setActs(p=>p.map(a=>a.id===id?Object.assign({},a,ch):a));
  const updSt=(aid,sid,ch)=>setActs(p=>p.map(a=>a.id===aid?Object.assign({},a,{stations:a.stations.map(s=>s.id===sid?Object.assign({},s,ch):s)}):a));
  const {sensors:dndSensors,onDragEnd:onActDragEnd}=useActivityDnd(setActs);

  // Same library-source switcher (My/Org/Peer/Public Library) the real
  // Builder screen has -- resolved from this same `data`/`team`/`coachId`
  // shape, since CommandScreen receives the identical app data object.
  const coachNameByUserId=useMemo(()=>{
    const m={};
    (data.teams||[]).forEach(t=>(t.coaches||[]).forEach(c=>{if(c.userId&&!m[c.userId])m[c.userId]=c.name;}));
    return m;
  },[data.teams]);
  const coachDisplayName=userId=>(data.profilesById&&data.profilesById[userId]&&data.profilesById[userId].name)||coachNameByUserId[userId]||"A coach";
  const librarySources=useMemo(()=>{
    const sources=[{key:"mine",label:"My Library"}];
    if(team&&team.organizationId){
      const org=(data.myOrgs||[]).find(o=>o.id===team.organizationId);
      sources.push({key:"org",label:(org?org.name:"Org")+" Library"});
    }
    const peerIds=[...new Set(data.activityLibrary.filter(a=>a.ownerUserId&&a.ownerUserId!==coachId&&!a.organizationId&&!a.sourceCatalogId).map(a=>a.ownerUserId))];
    peerIds.forEach(pid=>{sources.push({key:"peer:"+pid,label:coachDisplayName(pid)+"'s Library"});});
    if(data.activityLibrary.some(a=>a.sourceCatalogId&&(a.sport||"General")===teamSport))sources.push({key:"public",label:"Public Library"});
    return sources;
  },[team,data.activityLibrary,data.myOrgs,coachId,teamSport,coachNameByUserId,data.profilesById]);
  const [libSource,setLibSource]=useState("mine");
  const sourceFilteredLib=filteredLib.filter(a=>{
    if(libSource==="mine")return a.ownerUserId===coachId&&!a.sourceCatalogId;
    if(libSource==="org")return a.organizationId===(team&&team.organizationId)&&!a.sourceCatalogId;
    if(libSource==="public")return !!a.sourceCatalogId;
    if(libSource.startsWith("peer:"))return a.ownerUserId===libSource.slice(5)&&!a.sourceCatalogId;
    return !a.sourceCatalogId;
  });

  const stickyHeaderRef=useRef(null);
  const [stickyHeaderH,setStickyHeaderH]=useState(0);
  useEffect(()=>{
    const el=stickyHeaderRef.current;
    if(!el)return;
    const ro=new ResizeObserver(()=>setStickyHeaderH(el.offsetHeight));
    ro.observe(el);
    return()=>ro.disconnect();
  },[]);

  const leaderName=act=>{
    const c=act.coachId&&team&&team.coaches.find(c=>c.id===act.coachId);
    return (c&&c.name)||"Unassigned";
  };

  return (<div style={{padding:"0 0 calc(var(--tab) + 20px)"}}>
    <div ref={stickyHeaderRef} style={{padding:"10px 14px",display:"flex",gap:6,position:"sticky",top:0,zIndex:10,background:"#fff",borderBottom:"1px solid var(--b)"}}>
      <button className="btn ghost bsm" style={{flex:1}} onClick={onBack} disabled={saving}>Cancel</button>
      <button className="btn primary bsm" style={{flex:2}} disabled={saving} onClick={async()=>{setSaving(true);await onSaveResume(acts);}}>{saving?"Saving...":"Save & Resume"}</button>
    </div>
    <div style={{padding:"14px 14px 0"}}>
      {acts.length===0&&(<div style={{textAlign:"center",padding:"20px 16px",background:"var(--s2)",borderRadius:"var(--r)",marginBottom:10,border:"1.5px dashed var(--b)"}}>
        <div style={{fontSize:13,color:"var(--td)",lineHeight:1.7}}>Nothing left in this practice.<br/>Select activities below to add more.</div>
      </div>)}
      {acts.length>0&&(<div className="sechdr mb8">
        <span className="sectitle">{acts.length} Activities</span>
        <span className="pill">{totalMins}m</span>
      </div>)}
      {acts.length>0&&(<ActivityDndContext sensors={dndSensors} onDragEnd={onActDragEnd} items={acts.map(a=>a.id)}>
      {acts.map((act)=>(<SortableActivityRow key={act.id} id={act.id} sticky={act.id===lastAddedId} stickyTop={stickyHeaderH}>{dragHandle=>(<div>
        <div className="ablk">
          <div className="abhdr" onClick={()=>{const willExpand=expandedId!==act.id;setExpandedId(willExpand?act.id:null);if(act.id===lastAddedId)setLastAddedId(null);}}>
            {dragHandle}
            <div style={{flex:1,minWidth:0}}>
              <div style={{font:"700 14px Barlow Condensed,sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {act.type==="station_block"?(act.name||"Station Block"):act.name}
                {act.type==="activity"&&<span style={{fontWeight:400,color:"var(--td)"}}> · {leaderName(act)}</span>}
              </div>
              {act.type==="station_block"?<div className="limt">{act.stations.map(s=>s.activityName||s.name).join(" / ")} - {act.stationDuration}m x{act.stations.length} + {act.transitionDuration}m trans = {act.stations.length*act.stationDuration+Math.max(0,act.stations.length-1)*act.transitionDuration}m</div>:
              <div className="limt">{(()=>{
                const g=act.grouping||"whole";
                const groupingText=g==="whole"?"Whole Team":g==="partners"?"Partners":(act.numGroups||2)+" Groups";
                const areaText=loc&&act.sublocationId?(loc.sublocations.find(s=>s.id===act.sublocationId)||{}).name:null;
                const equipText=(Array.isArray(act.equipment)?act.equipment:[]).map(id=>{const a=(data.assets||[]).find(a=>a.id===id);return a?a.name:null;}).filter(Boolean).join(", ");
                return [groupingText,areaText,equipText].filter(Boolean).join(" · ");
              })()}</div>}
            </div>
            <div className="row">
              {act.type!=="station_block"&&<span className="bdg bp">{act.duration}m</span>}
              {act.type==="station_block"&&<span className="bdg bp">{act.stations.length*act.stationDuration+(act.rotate!==false?Math.max(0,act.stations.length-1)*act.transitionDuration:0)}m</span>}
              <button className="btn danger bxs" onClick={e=>{e.stopPropagation();remAct(act.id);}}>x</button>
            </div>
          </div>
          {expandedId===act.id&&(<div className="abbody">
            {act.type==="activity"&&<ActConfig assets={data.assets} coachId={coachId} refreshLibrary={refreshLibrary} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)} libraryDrills={data.activityLibrary} skillTags={data.skillTags}/>}
            {act.type==="checklist"&&<ChecklistConfig act={act} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
            {act.type==="station_block"&&<StationConfig assets={data.assets} coachId={coachId} refreshLibrary={refreshLibrary} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)} teamSport={teamSport} libraryDrills={sourceFilteredLib} librarySources={librarySources} libSource={libSource} setLibSource={setLibSource} skillTags={data.skillTags}/>}
          </div>)}
        </div>
      </div>)}</SortableActivityRow>
      ))}
      </ActivityDndContext>)}
      <div style={{borderTop:"1px solid var(--b)",paddingTop:14}}>
        <div className="sechdr mb8"><span className="sectitle">Add Drills</span></div>
        <div className="g2" style={{marginBottom:6}}>
          <div className="li tap" style={{marginBottom:0}} onClick={()=>addChecklist(false)}><div className="lim"><div className="lin">Intro</div><div className="limt">Checklist</div></div><span style={{color:"var(--green)",fontSize:18,fontWeight:700}}>+</span></div>
          <div className="li tap" style={{marginBottom:0}} onClick={()=>addChecklist(true)}><div className="lim"><div className="lin">Closer</div><div className="limt">Checklist</div></div><span style={{color:"var(--green)",fontSize:18,fontWeight:700}}>+</span></div>
        </div>
        <div className="li tap" style={{marginBottom:6,background:"var(--gbg)",borderColor:"var(--gb)"}} onClick={addBlock}>
          <div className="lim"><div className="lin" style={{color:"var(--green)"}}>Station Block</div><div className="limt">2 stations, add or remove as needed</div></div>
          <span style={{color:"var(--green)",fontSize:22,fontWeight:700,flexShrink:0}}>+</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,background:"var(--black)",color:"#fff",padding:"9px 12px",borderRadius:"var(--r)",marginBottom:8,minHeight:40}}>
          {librarySources.length>1?(
            <select value={libSource} onChange={e=>setLibSource(e.target.value)} style={{flex:1,background:"rgba(255,255,255,.12)",color:"#fff",border:"1px solid rgba(255,255,255,.3)",borderRadius:6,padding:"5px 6px",fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:900,letterSpacing:".04em",textTransform:"uppercase"}}>
              {librarySources.map(s=>(<option key={s.key} value={s.key} style={{color:"#000"}}>{s.label}</option>))}
            </select>
          ):(<span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:900,letterSpacing:".08em",textTransform:"uppercase",flex:1}}>My Library</span>)}
        </div>
        {team&&<div className="clbl" style={{marginBottom:8}}>{teamSport} + General</div>}
        {sourceFilteredLib.length===0&&<div style={{fontSize:12,color:"var(--td)",marginBottom:8}}>No drills here yet.</div>}
        {sourceFilteredLib.map(lib=>(<div key={lib.id} className="li tap" onClick={()=>addActChecked(lib)}>
          <div className="lim"><div className="lin">{lib.name}</div><div className="limt">{lib.description||""}</div></div>
          <div className="lir"><span className="bdg bp">{lib.duration}m</span><span style={{color:"var(--green)",fontSize:20,fontWeight:700,marginLeft:4}}>+</span></div>
        </div>))}
      </div>
    </div>
    {equipmentDialogLib&&<EquipmentMismatchDialog drillName={equipmentDialogLib.name} missing={findMissingEquipment(equipmentDialogLib.equipment,assetsById,ownAssetPool)} context="practice" onAddWithEquipment={()=>resolveAndAdd(equipmentDialogLib,true)} onAddAnyway={()=>resolveAndAdd(equipmentDialogLib,false)} onCancel={()=>setEquipmentDialogLib(null)}/>}
  </div>);
}

export default function CommandScreen({data,liveId,setLiveId,coachId,goHome,refreshPlanning,refreshLibrary}){
  const practice=liveId?data.practices.find(p=>p.id===liveId):null;
  const team=practice?data.teams.find(t=>t.id===practice.teamId):null;
  const loc=practice?data.locations.find(l=>l.id===practice.locationId):null;
  const liveActs=practice?practice.activities:[];
  const myCoachRecord=team&&team.coaches.find(c=>c.userId===coachId);
  const presence=usePracticePresence(liveId,liveId?{kind:"coach",label:myCoachRecord?myCoachRecord.name:"A coach"}:null);

  const [stage,setStage]=useState("pick");
  // Distinguishes the shared "stage==='end'" screen's copy between a real
  // finish and an abort -- same screen, same end-of-practice-notes flow,
  // just different framing (see endPractice/abortPractice below).
  const [endReason,setEndReason]=useState("completed");
  const [session,setSession]=useState(null);
  const [now,setNow]=useState(Date.now());
  // Peace-of-mind sync-confidence indicator (direct feedback: "if I notice
  // my screen isn't loading, it would be nice to have a refresh option").
  // Stamped on every real confirmation that this client is actually
  // current with the server -- a realtime message received, a background
  // reconcile poll succeeding, or a write succeeding -- so "seconds since
  // lastSyncedAt" is a single honest answer to "how stale could this
  // screen possibly be right now," regardless of which of the three sync
  // paths is the one actually working at any given moment. A ref, not
  // state -- it doesn't need its own render, the already-ticking `now`
  // clock re-derives the badge every second on its own.
  const lastSyncedAtRef=useRef(null);
  const [plannedAbsentIds,setPlannedAbsentIds]=useState(new Set());
  useEffect(()=>{
    if(!practice){setPlannedAbsentIds(new Set());return;}
    fetchPlannedAbsences([practice.id]).then(rows=>setPlannedAbsentIds(new Set(rows.map(r=>r.player_id))));
  },[practice&&practice.id]);
  const [presentIds,setPresentIds]=useState(new Set());
  const [coachPresentIds,setCoachPresentIds]=useState(new Set());
  const [showAtt,setShowAtt]=useState(false);
  const [liveGroups,setLiveGroups]=useState(null);
  // Parallel to liveGroups, index-for-index -- which "Group By..." label (if
  // any) applies to that group. Seeded from the station's saved groupLabel
  // whenever groups load from the plan, but wiped to blank the moment a
  // reshuffle actually happens: a random reshuffle breaks the one clean
  // attribute the label promised, so keeping a stale "Lefties" around would
  // be actively misleading rather than just missing.
  const [liveGroupLabels,setLiveGroupLabels]=useState(null);
  // Per-station partners/groups split (independent of, and layered on top
  // of, which players are AT each station) -- keyed by station id, each
  // value an array of player-id arrays for that station's current round.
  // Recomputed by the controller every time the rotation round changes
  // (players at a station change every round, so a stale split would pair
  // people who've since rotated away); everyone else just fetches whatever
  // the controller wrote.
  const [stationSubGroups,setStationSubGroups]=useState({});
  const [audioOn,setAudioOn]=useState(false);
  const [noteText,setNoteText]=useState("");
  const [noteError,setNoteError]=useState("");
  const [savingNote,setSavingNote]=useState(false);
  // Assistant-coach handoff §2.4: @mention tagging added onto the existing
  // quick-note/end-of-practice inputs (shared state -- only one of the two
  // is ever visible at a time) rather than a new composer.
  const [noteTaggedIds,setNoteTaggedIds]=useState([]);
  const [noteMentionQuery,setNoteMentionQuery]=useState(null);
  const noteTaRef=useRef(null);
  const onNoteTextChange=e=>{
    const val=e.target.value;
    setNoteText(val);
    if(noteError)setNoteError("");
    const m=val.slice(0,e.target.selectionStart).match(/@([a-zA-Z]*)$/);
    setNoteMentionQuery(m?m[1]:null);
  };
  const noteMentionMatches=noteMentionQuery===null?[]:(team&&team.players||[]).filter(p=>(p.firstName+" "+(p.lastName||"")).toLowerCase().includes(noteMentionQuery.toLowerCase())).slice(0,8);
  const pickNoteMention=p=>{
    const name=p.firstName+(p.lastName?" "+p.lastName:"");
    const caret=noteTaRef.current?noteTaRef.current.selectionStart:noteText.length;
    const before=noteText.slice(0,caret).replace(/@([a-zA-Z]*)$/,"@"+name+" ");
    setNoteText(before+noteText.slice(caret));
    setNoteTaggedIds(ids=>ids.includes(p.id)?ids:[...ids,p.id]);
    setNoteMentionQuery(null);
    setTimeout(()=>{if(noteTaRef.current)noteTaRef.current.focus();},0);
  };
  const [showROS,setShowROS]=useState(false);
  const [previewUpcoming,setPreviewUpcoming]=useState(null);
  const [clState,setClState]=useState({});
  const [movePlayer,setMovePlayer]=useState(null);
  const [tagPickerLibraryId,setTagPickerLibraryId]=useState(null);
  const [tagPickerSel,setTagPickerSel]=useState([]);
  const [tagPickerSaving,setTagPickerSaving]=useState(false);
  const [reassignStationId,setReassignStationId]=useState(null);
  const [helperDraft,setHelperDraft]=useState("");
  const [reassignBusy,setReassignBusy]=useState(false);
  // Practice Setup's own per-drill (non-station) leader assignment -- kept
  // fully separate from reassignStationId above rather than generalizing
  // its shape, since that state is already shared by several other live-view
  // call sites (stations-overview, the no-leader warning modal) that expect
  // it to always be a bare station id.
  const [reassignActivityId,setReassignActivityId]=useState(null);
  const [helperDraftAct,setHelperDraftAct]=useState("");
  const [reassignActBusy,setReassignActBusy]=useState(false);
  const [showPlayerFocus,setShowPlayerFocus]=useState(false);
  // {libraryId,playerIds,label} for a tapped transition-screen card's
  // Player Focus button, or null. Separate from showPlayerFocus (that one's
  // always the *current* activity's whole present roster) since this is a
  // specific incoming group and a specific upcoming station's drill.
  const [transitionFocus,setTransitionFocus]=useState(null);
  // Local-only peek at the upcoming rotation -- doesn't touch session state,
  // so it's invisible to every other viewer on this live session.
  const [previewTrans,setPreviewTrans]=useState(false);
  const [showEllipsis,setShowEllipsis]=useState(false);
  const [showEditBuilder,setShowEditBuilder]=useState(false);
  const [focusSt,setFocusSt]=useState(null);
  const [livePlayerProfile,setLivePlayerProfile]=useState(null);
  const [shareToken,setShareToken]=useState(null);
  const [shareScope,setShareScope]=useState("helper_read");
  const [showShare,setShowShare]=useState(false);
  const [showStationWarning,setShowStationWarning]=useState(false);
  const [showAudioPrompt,setShowAudioPrompt]=useState(false);
  const spoken=useRef({});
  const activityLogIdRef=useRef(null);
  // Rapidly tapping through the Overview jump list (browsing for the right
  // activity before landing on one) used to leave a real, permanent
  // zero-duration log row behind for every activity passed through --
  // closeCurrentLog below discards a log instead of closing it when it was
  // open for under MIN_LOG_MS, so only genuinely-worked-on activities show
  // up in Planned vs. Actual.
  const activityLogOpenedAtRef=useRef(null);
  const MIN_LOG_MS=3000;

  // ── Background audio session: a real <audio> element (not a bare
  // AudioContext oscillator, which Safari silently dropped -- see
  // dcbf238) kept looping at near-silent volume once the coach enables
  // audio. This is what earns the tab the OS's "actively playing media"
  // exemption so the actual cue sounds below still fire once the phone
  // locks or the coach switches apps -- a bare setTimeout/speechSynthesis
  // call does not survive that. Wake Lock (screen-stays-on) is a separate,
  // complementary layer for the common case where the phone just times out
  // in the coach's hand rather than being switched away from entirely.
  const bgAudioRef=useRef(null);
  const beepAudioRef=useRef(null);
  const cueAudioRefs=useRef({});
  const wakeLockRef=useRef(null);
  useEffect(()=>{
    beepAudioRef.current=new Audio('/audio/tennis-beep.wav');
    // Time's-up cue is now coach-selectable (Settings -> Live Practice
    // Audio: whistle/buzzer/ding/beep, getAudioCuePref()) -- all four are
    // preloaded here so switching the setting mid-session never needs a
    // fresh Audio() at play time.
    AUDIO_CUES.forEach(c=>{cueAudioRefs.current[c.id]=new Audio(c.file);});
    const bg=new Audio('/audio/silence-loop.wav');
    bg.loop=true;bg.volume=0.02;
    bgAudioRef.current=bg;
    return()=>{
      try{bg.pause();}catch(e){}
      bgAudioRef.current=null;beepAudioRef.current=null;cueAudioRefs.current={};
      if(wakeLockRef.current){try{wakeLockRef.current.release();}catch(e){}wakeLockRef.current=null;}
    };
  },[]);
  const requestWakeLock=useCallback(async()=>{
    try{
      if('wakeLock' in navigator)wakeLockRef.current=await navigator.wakeLock.request('screen');
    }catch(e){}
  },[]);
  // Direct feedback: the screen was going to sleep mid-practice even with
  // audio cues off, and the first tap after that only wakes the device --
  // by design, a phone's OS consumes that first touch to unlock the
  // screen and never delivers it to the page as a real click, which is
  // exactly the "tap once for audio, tap again for the real button" symptom
  // described. Nothing in JS can change that OS behavior, but keeping the
  // screen from sleeping in the first place avoids hitting it at all --
  // Wake Lock used to only ever get requested when audio cues were on;
  // broadened to hold for the entire live/setup session regardless, since
  // a coach glancing at the timer with audio off still needs the screen
  // to stay awake just as much.
  useEffect(()=>{
    if(stage==="live"||stage==="attend")requestWakeLock();
  },[stage,requestWakeLock]);
  // Wake Lock is auto-released by the browser whenever the tab is hidden --
  // re-request it when the coach comes back so a quick app-switch doesn't
  // permanently drop it for the rest of the session. Also force an
  // immediate clock tick: the setInterval driving `now` (below) gets
  // throttled or fully suspended while the tab is hidden, so without this,
  // elapsed/rem sit frozen until the next scheduled tick happens to land --
  // snapping it forward the instant the tab is visible again means any
  // audio cue that was due while backgrounded fires right away instead of
  // waiting out however long is left on a throttled interval.
  useEffect(()=>{
    const onVis=()=>{
      if(document.visibilityState==='visible'&&(stage==="live"||stage==="attend")){
        requestWakeLock();
        setNow(Date.now());
      }
    };
    document.addEventListener('visibilitychange',onVis);
    return()=>document.removeEventListener('visibilitychange',onVis);
  },[stage,requestWakeLock]);
  const startBgAudioSession=useCallback(()=>{
    try{
      if(bgAudioRef.current){bgAudioRef.current.currentTime=0;bgAudioRef.current.play().catch(()=>{});}
    }catch(e){}
    try{
      if('mediaSession' in navigator){
        navigator.mediaSession.metadata=new window.MediaMetadata({title:(team?team.name:'Practice')+' · Live',artist:'Run of Practice'});
        navigator.mediaSession.playbackState='playing';
      }
    }catch(e){}
    requestWakeLock();
  },[team,requestWakeLock]);
  const stopBgAudioSession=useCallback(()=>{
    try{if(bgAudioRef.current)bgAudioRef.current.pause();}catch(e){}
    try{if('mediaSession' in navigator)navigator.mediaSession.playbackState='none';}catch(e){}
    try{if(wakeLockRef.current){wakeLockRef.current.release();wakeLockRef.current=null;}}catch(e){}
  },[]);

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
  // Peace-of-mind sync-confidence badge (direct feedback, see lastSyncedAtRef
  // above): the background reconcile poll runs every 7s and stamps this on
  // success regardless of whether anything actually changed, so under
  // normal conditions secsSinceSync should never climb much past that --
  // "warn" gives room for one missed poll cycle before saying anything,
  // "stale" is a real multi-cycle gap worth actually flagging. Purely
  // time-based, not tied to the realtime channel's own reported status,
  // since a channel can cycle through a brief reconnect harmlessly and
  // this should only speak up once staleness is actually likely.
  const secsSinceSync=session&&lastSyncedAtRef.current?Math.floor((now-lastSyncedAtRef.current)/1000):0;
  const syncHealth=!session?"live":secsSinceSync>25?"stale":secsSinceSync>12?"warn":"live";
  // Assistant-coach handoff §1.3, confirmed decision: mid-run plan editing
  // stays gated on role, not on control -- an assistant who takes control
  // still can't open LiveEditBuilder, unlike every other controller action.
  const amHeadCoach=isHeadCoach(team,coachId);
  // Direct feedback: a rostered coach assigned to lead a station spent the
  // first moments of every rotation on the zoomed-out "All Stations"
  // overview, having to tap their own station every single time before
  // they could actually see their own drill's details. A station's leader
  // is fixed to that physical station for the whole block (players rotate
  // through, the coach doesn't), so this only needs to fire once, right
  // as the block-intro screen hands off to the real first rotation --
  // introJustEndedRef tracks "was I just in block-intro" so a later
  // rotation change (or a coach who deliberately backs out to the
  // overview themselves) never gets silently overridden again. Anonymous/
  // shared-link viewers (HelperView, a separate component) already
  // default to the overview with no such override -- unaffected by this.
  const introJustEndedRef=useRef(false);
  useEffect(()=>{
    if(isBlock&&inBlockIntro){introJustEndedRef.current=true;return;}
    if(isBlock&&!inBlockIntro&&introJustEndedRef.current){
      introJustEndedRef.current=false;
      const myStationIdx=myCoachRecord&&cur.stations?cur.stations.findIndex(st=>st.coachId===myCoachRecord.id):-1;
      if(myStationIdx>=0)setFocusSt(myStationIdx);
    }
  },[isBlock,inBlockIntro]);
  // Station-leader safety net (spec: "warn a coach if they have a station
  // without an assigned coach" right after attendance). Computed off
  // practice.activities, same source AttendanceScreen already reads for
  // needsBalance -- a station counts as unassigned only when it has
  // neither a rostered coach nor a freeform helper name (the same
  // mutual-exclusion fields updateStationLead/the builder already use).
  const unassignedStations=(practice?practice.activities:[]).filter(a=>a.type==="station_block").flatMap(a=>(a.stations||[]).filter(st=>!st.coachId&&!st.helperName));
  const stationWarnSessionRef=useRef(null);
  useEffect(()=>{
    if(stage==="live"&&isController&&session&&stationWarnSessionRef.current!==session.id){
      stationWarnSessionRef.current=session.id;
      if(unassignedStations.length>0)setShowStationWarning(true);
    }
    // eslint-disable-next-line
  },[stage,isController,session&&session.id,unassignedStations.length]);
  // Fires once per session for every viewer (not just the controller) the
  // moment they land in the live view -- audio is off by default (see
  // audioOn above), so without this a coach/helper who never taps the tiny
  // header speaker icon simply never hears the two-minute/time's-up cues.
  const audioPromptSessionRef=useRef(null);
  useEffect(()=>{
    if(stage==="live"&&session&&audioPromptSessionRef.current!==session.id){
      audioPromptSessionRef.current=session.id;
      setShowAudioPrompt(true);
    }
  },[stage,session&&session.id]);
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
  const rotatedStations=isBlock&&cur.stations&&liveGroups?cur.stations.map((st,i)=>{const srcIdx=(i-stIdx%n+n)%n;return Object.assign({},st,{assignments:liveGroups[srcIdx]||[],groupLabel:(liveGroupLabels&&liveGroupLabels[srcIdx])||""});}):null;

  // ── Timer: derived from timestamps, only ticks locally while running ───────
  useEffect(()=>{
    if(!running)return;
    const iv=setInterval(()=>setNow(Date.now()),500);
    return()=>clearInterval(iv);
  },[running]);

  // Voice is coach-selectable (Settings -> Live Practice Audio) -- the
  // coach previews and picks a specific installed voice there, remembered
  // by voiceURI. If no preference is saved yet, or the saved one only
  // existed on a different device, this defaults to the male option
  // (Daniel, resolveDefaultVoice) rather than whatever the browser's own
  // default happens to be.
  const speak=useCallback(txt=>{
    if(!audioOn)return;
    try{
      window.speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(txt);
      u.rate=0.9;
      const v=resolveVoiceByURI(getVoiceURIPref())||resolveDefaultVoice();
      if(v)u.voice=v;
      window.speechSynthesis.speak(u);
    }catch(e){};
  },[audioOn]);
  // Time's-up cue: the coach's chosen sound (whistle/buzzer/ding/beep),
  // then a spoken "Time" once it finishes -- onended (not a fixed
  // setTimeout) so the two stay in sync with the file's actual length
  // regardless of playback hiccups. This is the most consequential cue in
  // the app (it's the one marking a drill actually over) and it used to go
  // completely silent, with nothing to show for it, on a real-world class
  // of failure: a rejected play() (an interrupted audio session -- a call,
  // a Bluetooth handoff, autoplay policy re-engaging after the tab was
  // backgrounded) meant onended simply never fired, so the chained "Time"
  // never spoke either. speechSynthesis is a separate playback pathway
  // from <audio> and, in practice, often still works when the audio
  // element doesn't -- every failure path here now falls back to speaking
  // "Time" directly instead of going silent.
  const beep=useCallback(()=>{
    if(!audioOn)return;
    try{
      const audio=cueAudioRefs.current[getAudioCuePref()]||cueAudioRefs.current.whistle;
      if(audio){
        audio.currentTime=0;
        audio.onended=()=>speak("Time");
        audio.onerror=()=>speak("Time");
        audio.play().catch(()=>speak("Time"));
      }else{
        speak("Time");
      }
    }catch(e){console.error('time cue error:',e);speak("Time");}
  },[audioOn,speak]);
  const playWarningTone=useCallback(()=>{
    if(!audioOn)return;
    try{if(beepAudioRef.current){beepAudioRef.current.currentTime=0;beepAudioRef.current.play().catch(()=>{});}}catch(e){console.error('beep tone error:',e);}
  },[audioOn]);

  const beepRef=useRef(beep);
  useEffect(()=>{beepRef.current=beep;},[beep]);
  const speakRef=useRef(speak);
  useEffect(()=>{speakRef.current=speak;},[speak]);
  const warnToneRef=useRef(playWarningTone);
  useEffect(()=>{warnToneRef.current=playWarningTone;},[playWarningTone]);

  const buzzedRef=useRef(false);
  useEffect(()=>{
    // Direct feedback: the transition ("Rotate Now") screen shouldn't buzz
    // at zero -- it auto-advances to the next station/timer on its own (see
    // the auto-advance effect below, once advance() is declared), so a
    // buzzer here would just be noise announcing something that's already
    // happening automatically. Every other phase (a station round, a plain
    // drill, block-intro) keeps the normal buzz-and-wait-for-Next behavior.
    if(elapsed>=phaseSecs&&phaseSecs>0&&!buzzedRef.current&&running&&!inTrans){
      buzzedRef.current=true;
      beepRef.current();
    }
    if(elapsed<phaseSecs-5){
      buzzedRef.current=false;
    }
  },[elapsed,phaseSecs,running,inTrans]);
  // Guards the transition auto-advance below the same way buzzedRef guards
  // the beep -- fires once per phase, resets everywhere a real phase change
  // happens (transitionTo, practice start, a timer nudge, mid-live Edit
  // Practice's resume) so a later transition can auto-advance again fresh.
  const transitionAdvancedRef=useRef(false);

  const warnedRef=useRef(false);
  useEffect(()=>{
    // Direct feedback: a ~2-minute segment (a short transition, a quick
    // water break) landed inside the [118,122]s warning window almost the
    // instant it started, so "Two minutes remaining" played right at the
    // top of the phase instead of near its end -- skip the cue entirely
    // for any phase that's 2 minutes or shorter; there's no meaningful
    // "still 2 minutes left" moment to warn about on a phase that short.
    if(phaseSecs<=120)return;
    const rem2=phaseSecs-elapsed;
    // At-or-past a threshold, not a narrow window -- elapsed only advances
    // while a setInterval ticks (see the Timer effect above), and mobile
    // browsers throttle/suspend that interval when the tab is briefly
    // backgrounded (an app switch, a notification). A throttled tick can
    // jump elapsed forward enough to step clean over a 4-second window in
    // one go, silently skipping this cue for the rest of the phase with no
    // trace it happened -- exactly the reported "audio wasn't consistent."
    // Same shape as the time's-up buzzer effect above, which already used
    // >= for this reason; rem2>0 keeps it from firing retroactively deep
    // into an overrun phase after a long background gap.
    if(rem2<=120&&rem2>0&&!warnedRef.current&&running){
      warnedRef.current=true;
      warnToneRef.current();
      speakRef.current("Two minutes remaining.");
    }
    if(rem2>130){warnedRef.current=false;}
  },[elapsed,phaseSecs,running]);

  // ── Mount / resume: atomically create-or-join, then branch on whether ──
  // Practice Setup has already been confirmed (real "live" running practice)
  // or is still in progress (attendance/station assignment, shared by
  // whoever else has this practice open -- see start_or_join_live_session,
  // 20260805040000). This is what actually fixes "assistant clicks Run
  // Practice while head coach is mid-setup and displaces them": both land
  // on the exact same session row instead of the assistant silently
  // spinning up a second one.
  useEffect(()=>{
    if(!liveId){setStage("pick");setSession(null);return;}
    let cancelled=false;
    (async()=>{
      const result=await startOrJoinLiveSession(liveId);
      if(cancelled||!result||!result.session)return;
      const {session:sessionRow,created}=result;
      setSession(sessionRow);
      lastSyncedAtRef.current=Date.now();
      if(sessionRow.setup_confirmed_at){
        setStage("live");
        const latest=await fetchLatestAttendance(sessionRow.id);
        if(cancelled)return;
        setPresentIds(new Set(Object.keys(latest).filter(pid=>latest[pid]==="present")));
        activityLogIdRef.current=await findOpenActivityLogId(sessionRow.id);
        // Reconstructed after a reload -- the real open time is unknown, so
        // treat it as already past MIN_LOG_MS rather than risk deleting a
        // genuine in-progress segment on the next transition.
        activityLogOpenedAtRef.current=activityLogIdRef.current?0:null;
      }else{
        setStage("attend");
        if(created){
          // First coach to reach Practice Setup for this practice -- link
          // any already-shared preview token and seed every station block
          // from the plan's own defaults (everyone assumed present) so the
          // Setup screen's Stations section has something to show/edit
          // immediately, before attendance is even taken.
          await linkPreviewToLiveSession(liveId,sessionRow.id);
          const allPlayerIds=team?team.players.map(p=>p.id):[];
          await seedAllStationGroups(sessionRow.id,liveActs,new Set(allPlayerIds),"keep",coachId,team?team.players:[]);
        }
        // Joining a setup already in progress -- pick up whatever
        // attendance another coach has already marked, if any.
        const latest=await fetchLatestAttendance(sessionRow.id);
        if(cancelled)return;
        if(Object.keys(latest).length)setPresentIds(new Set(Object.keys(latest).filter(pid=>latest[pid]==="present")));
      }
    })();
    return()=>{cancelled=true;};
  },[liveId]);

  // Direct feedback, real bug: an assistant tapping "Run Practice" while
  // the head coach was still looking at their own Practice Setup screen
  // didn't move the head coach's screen into the live view at all -- they
  // had to notice and tap Run Practice themselves too. The mount effect
  // above only ever sets `stage` once, at mount, from whatever
  // setup_confirmed_at looked like at that moment -- session state itself
  // already syncs live across every viewer (realtime + the reconcile poll,
  // see below), but nothing was watching for setup_confirmed_at flipping
  // true *after* mount and catching this tab's own `stage` up to it. Same
  // shape (a synced signal on the server, nothing locally reactive to it)
  // as the "start/stop" style flags a session polls elsewhere -- fixed by
  // reacting to the session's already-synced fields directly. Only ever
  // moves stage forward (attend->live, ->end) -- never regresses a tab
  // that's already further along, and does nothing for the tab whose own
  // click already advanced its own `stage` synchronously (that tab is no
  // longer "attend" by the time this runs, so the guard below is a no-op
  // for it).
  useEffect(()=>{
    if(!session)return;
    if(session.status!=="active"){
      if(stage!=="end")setStage("end");
      return;
    }
    if(session.setup_confirmed_at&&stage==="attend"){
      setStage("live");
      (async()=>{
        const latest=await fetchLatestAttendance(session.id);
        setPresentIds(new Set(Object.keys(latest).filter(pid=>latest[pid]==="present")));
        activityLogIdRef.current=await findOpenActivityLogId(session.id);
        activityLogOpenedAtRef.current=activityLogIdRef.current?0:null;
      })();
    }
  },[session,stage]);

  // Reconciles local session state against the server row, but only ever
  // moves forward -- never lets a passive resync (reconnect, background
  // poll) stomp a newer local write that just hasn't round-tripped yet, and
  // never treats a transient fetch failure (findActiveLiveSession also
  // returns null on error) as "the session ended." A real end/abort is
  // already an explicit transition via writeSession elsewhere.
  const reconcileSession=useCallback(async()=>{
    if(!practice)return;
    const fresh=await findActiveLiveSession(practice.id);
    if(!fresh)return;
    lastSyncedAtRef.current=Date.now();
    setSession(prev=>(prev&&fresh.version<prev.version)?prev:fresh);
  },[practice]);

  // Realtime: pick up control handoffs / phase changes from another device.
  // postgres_changes has no catch-up/replay -- on the "not great" service a
  // real field can have, the websocket drops and silently reconnects fairly
  // often, and any update that happened during that gap is gone for good
  // once it's back, not queued. Two backstops against that: force a
  // reconcile on every reconnect (not just the first SUBSCRIBED), and a
  // slow background poll so no client can drift for more than a few
  // seconds even if the socket looks connected the whole time. This is
  // exactly why two coaches' screens could show different drills/timers/
  // station rotations until something else happened to nudge a fresh
  // update through, and why a "Take Control" tap on stale state silently
  // no-op'd into a resync instead of an actual handoff (the version check
  // failed on a version this client didn't know had already moved).
  useEffect(()=>{
    if(!session)return;
    let sawFirstConnect=false;
    const sub=subscribeToLiveSession(session.id,updated=>{
      lastSyncedAtRef.current=Date.now();
      setSession(prev=>(prev&&updated.version<prev.version)?prev:updated);
      if(updated.status!=="active")setStage("end");
    },status=>{
      if(status==='SUBSCRIBED'){
        if(sawFirstConnect)reconcileSession();
        sawFirstConnect=true;
      }
    });
    return()=>{sub.unsubscribe();};
  },[session?.id,reconcileSession]);

  useEffect(()=>{
    if(!session||session.status!=='active')return;
    const iv=setInterval(reconcileSession,7000);
    return()=>clearInterval(iv);
  },[session?.id,session?.status,reconcileSession]);

  // Assistant-coach handoff §1.3: a non-blocking toast for whoever just lost
  // control, so a habitual tap on Next/+-1m a beat after someone else took
  // over is explained rather than silently doing nothing.
  const [controlToast,setControlToast]=useState(null);
  const prevControllerRef=useRef(null);
  useEffect(()=>{
    if(!session){prevControllerRef.current=null;return;}
    const prev=prevControllerRef.current;
    if(prev&&prev===coachId&&session.controller_user_id&&session.controller_user_id!==coachId){
      const newCoach=team&&team.coaches.find(c=>c.userId===session.controller_user_id);
      setControlToast((newCoach?newCoach.name:"Another coach")+" took control");
    }
    prevControllerRef.current=session.controller_user_id;
  },[session?.controller_user_id]);
  useEffect(()=>{
    if(!controlToast)return;
    const t=setTimeout(()=>setControlToast(null),4000);
    return()=>clearTimeout(t);
  },[controlToast]);

  // A network hiccup mid-practice must never blank the coach's screen --
  // only a genuine version conflict (someone else moved the session
  // forward) should trigger a refetch. Offline failures keep showing the
  // last-known local state and retry the same write in the background.
  const [syncOffline,setSyncOffline]=useState(false);
  const pendingWriteRef=useRef(null);
  const sessionRef=useRef(session);
  useEffect(()=>{sessionRef.current=session;},[session]);
  const retryTimerRef=useRef(null);
  const retryDelayRef=useRef(3000);

  // Rapid taps on the same live control (±1 min tapped twice quickly, a
  // nudge right after a pause) used to race each other: each call read
  // `session.version` from whichever render happened to be current when it
  // fired, so a second write could reach the server carrying a version the
  // first write had already superseded, get rejected as a stale-version
  // conflict, and have its own optimistic update silently discarded by the
  // resync that follows -- visible as the timer jumping forward, then
  // snapping back a beat later. Every write now funnels through
  // writeQueueRef so a queued write only actually executes once every
  // write ahead of it has resolved, and reads sessionRef.current (kept
  // authoritative here the instant a write resolves, not just via the
  // passive mirror effect above, which lags a render cycle behind) so it
  // always carries the truly-current version instead of a stale one.
  const writeQueueRef=useRef(Promise.resolve());
  const writeSessionNow=useCallback(async(patch)=>{
    const cur=sessionRef.current;
    if(!cur)return null;
    const {data:updated,offline}=await updateLiveSession(cur.id,cur.version,patch);
    if(updated){
      lastSyncedAtRef.current=Date.now();
      sessionRef.current=updated;
      setSession(updated);setSyncOffline(false);pendingWriteRef.current=null;
      clearTimeout(retryTimerRef.current);retryDelayRef.current=3000;
      return updated;
    }
    if(offline){
      pendingWriteRef.current={patch};
      setSyncOffline(true);
      return null;
    }
    const fresh=await findActiveLiveSession(practice.id);
    if(fresh){lastSyncedAtRef.current=Date.now();sessionRef.current=fresh;}
    setSession(fresh);setSyncOffline(false);
    return null;
  },[practice]);
  const writeSession=useCallback(patch=>{
    const queued=writeQueueRef.current.then(()=>writeSessionNow(patch),()=>writeSessionNow(patch));
    writeQueueRef.current=queued.catch(()=>null);
    return queued;
  },[writeSessionNow]);

  const attemptPendingRetry=useCallback(async()=>{
    const pending=pendingWriteRef.current;
    const cur=sessionRef.current;
    if(!pending||!cur)return;
    const {data:updated,offline}=await updateLiveSession(cur.id,cur.version,pending.patch);
    if(updated){
      sessionRef.current=updated;
      setSession(updated);setSyncOffline(false);pendingWriteRef.current=null;
      clearTimeout(retryTimerRef.current);retryDelayRef.current=3000;
    }else if(!offline){
      // The world moved on without us (conflict, not a network issue) --
      // stop retrying this stale patch and reconcile to real state.
      pendingWriteRef.current=null;
      const fresh=await findActiveLiveSession(practice.id);
      if(fresh)sessionRef.current=fresh;
      setSession(fresh);setSyncOffline(false);
    }
    // else: still offline, the scheduling effect below will try again.
  },[practice]);

  useEffect(()=>{
    if(!syncOffline)return;
    const onOnline=()=>{retryDelayRef.current=3000;attemptPendingRetry();};
    window.addEventListener('online',onOnline);
    retryTimerRef.current=setTimeout(function tick(){
      attemptPendingRetry();
      retryDelayRef.current=Math.min(retryDelayRef.current*2,30000);
      retryTimerRef.current=setTimeout(tick,retryDelayRef.current);
    },retryDelayRef.current);
    return()=>{window.removeEventListener('online',onOnline);clearTimeout(retryTimerRef.current);};
    // eslint-disable-next-line
  },[syncOffline]);

  const closeCurrentLog=useCallback(async()=>{
    if(!activityLogIdRef.current)return;
    const openedAt=activityLogOpenedAtRef.current;
    const barelyOpen=openedAt!==null&&(Date.now()-openedAt)<MIN_LOG_MS;
    if(barelyOpen)await deleteActivityLog(activityLogIdRef.current);
    else await closeActivityLog(activityLogIdRef.current);
    activityLogIdRef.current=null;activityLogOpenedAtRef.current=null;
  },[]);
  const openLogFor=useCallback(async(sessionId,target,presentPlayerIds)=>{
    activityLogIdRef.current=await openActivityLog(sessionId,coachId,target,presentPlayerIds);
    activityLogOpenedAtRef.current=Date.now();
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
  // Direct feedback: Next/Back/advance felt laggy -- closeCurrentLog and
  // writeSession are both real network round trips, and nothing on screen
  // changed until both had finished (openLogForActivityEntry too, when it
  // applies). Applying the same patch to local state immediately makes the
  // title/timer/phase flip the instant the button is tapped; the actual
  // DB writes (closing the old activity log, persisting the session row,
  // opening the new log) still happen in the same order right after, in
  // the background -- if the write genuinely fails, writeSession's own
  // existing fallback (re-fetching the real session) corrects local state
  // back, same safety net optimistic pause/resume above already relies on.
  const transitionTo=useCallback(async(patch,logAct,logStIdx)=>{
    const fullPatch=Object.assign({current_phase_started_at:new Date().toISOString(),paused_at:null,total_paused_seconds:0},patch);
    setSession(s=>s?Object.assign({},s,fullPatch):s);
    spoken.current={};buzzedRef.current=false;warnedRef.current=false;transitionAdvancedRef.current=false;
    // Direct feedback: a station's leader who'd tapped into their own
    // station's detail view got bounced back to the zoomed-out "All
    // Stations" overview on every single rotation/transition, not just
    // when actually leaving the block -- this cleared focusSt unconditionally
    // regardless of what kind of transition it was. rotatedStations keeps
    // every station object at its original, fixed index (only .assignments
    // -- who's currently there -- gets remapped per round; see its own
    // definition), so a station's leader's focusSt index is already
    // correct for every round of the same block without re-deriving it --
    // the only real bug was clearing it out from under them. Only clear it
    // when actually moving to a different activity (a fresh block's own
    // intro re-derives focus itself, see introJustEndedRef's effect); a
    // same-activity transition (entering/exiting a rotation's transition
    // period, advancing/reversing rotation number) leaves it alone.
    if('current_practice_activity_id' in patch)setFocusSt(null);
    await closeCurrentLog();
    const updated=await writeSession(fullPatch);
    if(updated&&logAct)await openLogForActivityEntry(updated,logAct,logStIdx,[...presentIds]);
    return updated;
  },[writeSession,closeCurrentLog,openLogForActivityEntry,presentIds]);

  // ── Live-group sync: current activity's session_groups, fetched or (for
  // regular sub-grouping) freshly reshuffled on every entry/attendance change.
  // Station-block groups are seeded explicitly at attendance time via
  // seedAllStationGroups -- this effect only fetches them, falling back to a
  // one-time bootstrap for a block added mid-session via LiveEditBuilder. ──
  useEffect(()=>{
    if(!session||!cur){setLiveGroups(null);setLiveGroupLabels(null);return;}
    let cancelled=false;
    // fetchLatestGroups is now hardened against throwing, but a flaky
    // connection can still mean this whole IIFE never resolves cleanly on
    // the first try. Without a retry, that leaves liveGroups null for the
    // rest of this mount -- nothing else re-triggers this effect -- which
    // is exactly what made a station block's Up Next/rotation view go
    // blank on a bad connection. Three quick retries covers a momentary
    // drop; a real outage still gives up rather than retrying forever.
    const run=async(attempt)=>{
      try{await body();}
      catch(e){
        console.error('live-group sync failed:',e);
        if(!cancelled&&attempt<3)setTimeout(()=>{if(!cancelled)run(attempt+1);},1500*(attempt+1));
      }
    };
    const body=async()=>{
      if(isBlock){
        const existing=await fetchLatestGroups(session.id,cur.id);
        if(cancelled)return;
        if(existing&&existing.length){setLiveGroups(existing);setLiveGroupLabels(cur.stations.map(st=>st.groupLabel||""));return;}
        const rebalanced=rebalanceKeep(cur.stations,presentIds);
        const seeded=rebalanced.map(st=>st.assignments||[]);
        setLiveGroups(seeded);
        setLiveGroupLabels(cur.stations.map(st=>st.groupLabel||""));
        await saveSessionGroups(session.id,cur.id,coachId,seeded);
      }else{
        const g=cur.grouping||"whole";
        if(g==="whole"){setLiveGroups(null);return;}
        // Real bug fix: this used to skip straight to a fresh random
        // shuffle every time, on both first entry and any later attendance
        // edit -- silently discarding the coach's manual Builder
        // assignment or anything tweaked live in Practice Setup's own
        // groupings dialog (both already persisted via saveSessionGroups,
        // same as a station block's own plan-time assignments). Fetches
        // first now, same as the station-block branch above; when
        // something's already there, reconciles it against current
        // attendance (drop absentees, place newly-present players into
        // the smallest group) instead of throwing it all away.
        const existing=await fetchLatestGroups(session.id,cur.id);
        if(cancelled)return;
        if(existing&&existing.length){
          const reconciled=reconcileGroups(existing,presentIds);
          setLiveGroups(reconciled);
          if(JSON.stringify(reconciled)!==JSON.stringify(existing))await saveSessionGroups(session.id,cur.id,coachId,reconciled);
          return;
        }
        if(presentIds.size===0)return;
        const present=[...presentIds];
        const players=(team?team.players:[]).filter(p=>present.includes(p.id));
        if(players.length===0)return;
        const groups=assignGroups(players,g,cur.numGroups||2).map(g2=>g2.map(p=>p.id));
        if(cancelled)return;
        setLiveGroups(groups);
        await saveSessionGroups(session.id,cur.id,coachId,groups);
      }
    };
    run(0);
    return()=>{cancelled=true;};
  },[session?.id,cur?.id,presentIds]);

  // ── Per-station sub-grouping: each station's own partners/groups split,
  // independent of which players rotated into it. Scoped to stIdx (the
  // round) because the occupants change every round -- same fetch-or-seed
  // pattern as the block/whole-team effect above, just keyed one level
  // deeper per station. Whichever viewer's client gets there first seeds it;
  // everyone else (including a later remount of the same client) just reads
  // what's already there for that round.
  useEffect(()=>{
    if(!session||!isBlock||!cur||!cur.stations||!liveGroups){setStationSubGroups({});return;}
    let cancelled=false;
    // Same flaky-connection retry as the live-group sync effect above --
    // a throw partway through the loop below used to abort the whole
    // fetch with nothing to retry it, leaving some/all stations' own
    // sub-groups blank for the rest of this mount.
    const run=async(attempt)=>{
      try{await body();}
      catch(e){
        console.error('station sub-group sync failed:',e);
        if(!cancelled&&attempt<3)setTimeout(()=>{if(!cancelled)run(attempt+1);},1500*(attempt+1));
      }
    };
    const body=async()=>{
      const results={};
      for(let i=0;i<cur.stations.length;i++){
        const st=cur.stations[i];
        const g=st.grouping||"whole";
        if(g==="whole")continue;
        const srcIdx=(i-stIdx%n+n)%n;
        const occupantIds=liveGroups[srcIdx]||[];
        if(occupantIds.length===0)continue;
        const existing=await fetchLatestGroups(session.id,cur.id,st.id,stIdx);
        if(cancelled)return;
        if(existing&&existing.length){results[st.id]=existing;continue;}
        const occupantPlayers=(team?team.players:[]).filter(p=>occupantIds.includes(p.id));
        if(occupantPlayers.length===0)continue;
        const groups=assignGroups(occupantPlayers,g,st.numGroups||2).map(g2=>g2.map(p=>p.id));
        results[st.id]=groups;
        await saveSessionGroups(session.id,cur.id,coachId,groups,st.id,stIdx);
      }
      if(!cancelled)setStationSubGroups(results);
    };
    run(0);
    return()=>{cancelled=true;};
  },[session?.id,cur?.id,stIdx,liveGroups]);

  const reshuffleStationGroup=useCallback(async(station)=>{
    if(!session||!cur||!station)return;
    const g=station.grouping||"whole";
    if(g==="whole")return;
    const occupantIds=(station.assignments||[]);
    const occupantPlayers=(team?team.players:[]).filter(p=>occupantIds.includes(p.id));
    const groups=assignGroups(occupantPlayers,g,station.numGroups||2).map(g2=>g2.map(p=>p.id));
    setStationSubGroups(p=>Object.assign({},p,{[station.id]:groups}));
    await saveSessionGroups(session.id,cur.id,coachId,groups,station.id,stIdx);
  },[session,cur,team,coachId,stIdx]);

  // ── Practice Setup's Stations section: every station block in the whole
  // practice (not just whichever one is "current" -- there is no current
  // one yet, nothing's live), fetched/edited independently of the
  // rotation machinery above. A move here writes straight to
  // session_groups (today-only, same table/pattern as mid-live
  // reassignment -- never touches the saved plan), so it's naturally
  // already there once Start Practice hands off to the real live view. ──
  const stationBlockActs=liveActs.filter(a=>a.type==="station_block");
  // Direct feedback: the groupings dialog "constantly cycled" -- computing
  // a fresh assignGroups() (internally a random shuffle) inline during
  // render meant every render (the countdown ticks setNow every second)
  // reshuffled it again, indistinguishable from someone repeatedly hitting
  // Generate Random. Extended this exact same fetch-or-seed-once pattern
  // (already used for a plain activity's own partners/groups split once
  // it's actually live, see the effect above) to *also* run during
  // Practice Setup for any non-station activity with grouping!=="whole" --
  // not just station blocks -- so its split is generated once, saved, and
  // stable across re-renders and dialog reopens, and (direct feedback)
  // editable via the same tap-to-move picker stations already use.
  const groupableActs=liveActs.filter(a=>a.type==="station_block"||(a.grouping&&a.grouping!=="whole"));
  const groupableActsKey=groupableActs.map(a=>a.id).join(",");
  const [setupGroups,setSetupGroups]=useState({});
  useEffect(()=>{
    if(!session||stage!=="attend"||showAtt||!groupableActsKey){setSetupGroups({});return;}
    let cancelled=false;
    (async()=>{
      const results={};
      for(const act of groupableActs){
        const existing=await fetchLatestGroups(session.id,act.id);
        if(existing&&existing.length){results[act.id]=existing;continue;}
        if(act.type==="station_block"){
          results[act.id]=(act.stations||[]).map(st=>st.assignments||[]);
          continue;
        }
        // Plain drill (partners/groups): if the coach manually assigned
        // groups back in Builder (act.groupAssignments), that's the seed --
        // filtered down to whoever's actually present-by-default, same as a
        // station block's own plan-time assignments. Otherwise fall back to
        // a fresh random split, from every present-by-default player
        // (mirrors freshPresent's own planned-absence exclusion), and save
        // it immediately so it's the same stable split every viewer/reopen
        // sees from here on, not a fresh random guess each time.
        const presentDefault=team?team.players.map(p=>p.id).filter(id=>!plannedAbsentIds.has(id)):[];
        const manual=act.groupAssignments;
        const hasManual=Array.isArray(manual)&&manual.some(g=>g&&g.length);
        let groups;
        if(hasManual){
          groups=manual.map(g=>(g||[]).filter(id=>presentDefault.includes(id)));
        }else{
          const players=(team?team.players:[]).filter(p=>presentDefault.includes(p.id));
          groups=assignGroups(players,act.grouping,act.numGroups||2).map(g=>g.map(p=>p.id));
        }
        results[act.id]=groups;
        if(!cancelled)await saveSessionGroups(session.id,act.id,coachId,groups);
      }
      if(!cancelled)setSetupGroups(results);
    })();
    return()=>{cancelled=true;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[session?.id,stage,showAtt,groupableActsKey]);
  // Generalizes the old per-station-block moveSetupPlayer (removed when
  // Practice Setup stopped showing players inline) to any groupable
  // activity -- a station block's "which station" split and a plain
  // drill's "which partner/group" split are both just an array of id
  // arrays under the hood, so one handler covers the groupings dialog's
  // tap-to-move for either kind.
  const moveSetupGroupPlayer=useCallback(async(activityId,playerId,toIdx)=>{
    if(!session)return;
    const groups=setupGroups[activityId];
    if(!groups)return;
    const fromIdx=groups.findIndex(g=>g.includes(playerId));
    if(fromIdx===-1||fromIdx===toIdx)return;
    const newGroups=groups.map((g,i)=>{
      if(i===fromIdx)return g.filter(id=>id!==playerId);
      if(i===toIdx)return [...g,playerId];
      return g;
    });
    setSetupGroups(p=>Object.assign({},p,{[activityId]:newGroups}));
    await saveSessionGroups(session.id,activityId,coachId,newGroups);
  },[session,setupGroups,coachId]);
  // Direct feedback: the groupings dialog's manual move/drop is great, but
  // still needs the same Reshuffle and Group By (position/handedness)
  // shortcuts Builder's own station config already has for the initial
  // split -- reuses the exact same groupByAttribute helper rather than a
  // second implementation, applied here to *today's actual present
  // players* instead of the whole roster.
  const regenerateSetupGroups=useCallback(async(act,kind,presentPlayerIds,mode,handKey)=>{
    if(!session)return;
    const presentPlayerObjs=(team?team.players:[]).filter(p=>presentPlayerIds.includes(p.id));
    const groupCount=kind==="drill"?(act.grouping==="partners"?Math.max(1,Math.ceil(presentPlayerObjs.length/2)):(act.numGroups||2)):act.stations.length;
    let groups;
    if(mode==="attribute"){
      const getter=handKey?(p=>p[handKey]||""):(p=>(p.positions&&p.positions[0])||"");
      const g=groupByAttribute(presentPlayerObjs,groupCount,getter,v=>v);
      groups=g.map(x=>(x&&x.ids)||[]);
    }else if(kind==="drill"){
      groups=assignGroups(presentPlayerObjs,act.grouping,act.numGroups).map(g=>g.map(p=>p.id));
    }else{
      const shuffled=[...presentPlayerObjs].sort(()=>Math.random()-.5);
      groups=Array.from({length:groupCount},()=>[]);
      shuffled.forEach((p,i)=>groups[i%groupCount].push(p.id));
    }
    setSetupGroups(p=>Object.assign({},p,{[act.id]:groups}));
    await saveSessionGroups(session.id,act.id,coachId,groups);
  },[session,team,coachId]);

  const handleAttConfirm=useCallback(async({presentIds:pIds,coachPresentIds:cIds,balanceMode})=>{
    setPresentIds(pIds);setCoachPresentIds(cIds);
    setStage("live");setShowAtt(false);
    spoken.current={};buzzedRef.current=false;warnedRef.current=false;transitionAdvancedRef.current=false;
    const firstAct=liveActs[0]||null;
    const firstIsBlock=firstAct&&firstAct.type==="station_block";
    // The session already exists by the time Practice Setup's confirm
    // button is reachable (created the moment anyone landed here -- see
    // the mount effect above), so this is always an update, never a create.
    const sessionRow=await writeSession({current_practice_activity_id:firstAct?firstAct.id:null,current_rotation_number:0,in_transition:false,in_block_intro:!!firstIsBlock,current_phase_started_at:new Date().toISOString(),paused_at:null,total_paused_seconds:0,status:"active",setup_confirmed_at:new Date().toISOString()});
    if(!sessionRow)return;
    submitOperation(sessionRow.id,coachId,"start_practice");
    const allPlayerIds=team?team.players.map(p=>p.id):[];
    await submitAttendanceSnapshot(sessionRow.id,coachId,pIds,allPlayerIds);
    // Always runs now (not gated on an explicit "rebalance" choice -- that
    // whole choice is gone from Practice Setup's single Run Practice
    // button): seedAllStationGroups itself only actually rewrites a block
    // that was either explicitly asked to rebalance or was never touched
    // at all, so a block the coach genuinely set up by hand is left alone.
    await seedAllStationGroups(sessionRow.id,liveActs,pIds,balanceMode,coachId,team?team.players:[]);
    if(firstAct&&!firstIsBlock)await openLogFor(sessionRow.id,{practiceActivityId:firstAct.id},[...pIds]);
  },[liveActs,coachId,team,writeSession,openLogFor]);

  const handleAttUpdate=useCallback(async({presentIds:pIds,coachPresentIds:cIds,balanceMode})=>{
    if(!session)return;
    await seedAllStationGroups(session.id,liveActs,pIds,balanceMode||"keep",coachId,team?team.players:[]);
    await submitAttendanceSnapshot(session.id,coachId,pIds,team?team.players.map(p=>p.id):[]);
    setPresentIds(pIds);setCoachPresentIds(cIds);setShowAtt(false);
  },[session,liveActs,coachId,team]);

  const startBlock=useCallback(async()=>{
    if(!session||!cur||!isBlock)return;
    submitOperation(session.id,coachId,"start_block");
    await transitionTo({current_rotation_number:0,in_transition:false,in_block_intro:false},cur,0);
  },[session,cur,isBlock,coachId,transitionTo]);

  const advance=useCallback(async()=>{
    if(!session||!cur)return;
    submitOperation(session.id,coachId,"advance");
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
      setEndReason("completed");
      setStage("end");
    }
  },[session,cur,isBlock,inBlockIntro,blockRotate,inTrans,stIdx,idx,liveActs,coachId,transitionTo,writeSession,closeCurrentLog]);

  // Direct feedback: a coach calling "rotate" shouldn't also have to tap
  // Next to actually start the next station's timer -- the transition
  // screen should hold until its own timer hits zero, then move itself
  // (and the next group's timer) forward with no action needed. Only the
  // controller ever writes session state (matching every other advance/
  // rotate/jump path -- "Next >" itself is only rendered isController&&...,
  // above) so a non-controlling coach's tab and every HelperView/anonymous
  // helper just observe the resulting session update through their existing
  // realtime subscription / 7s reconcile poll / 3s HelperView poll, exactly
  // like every other phase change already does -- no client computes this
  // independently off its own local elapsed/phaseSecs, which is exactly the
  // kind of drift this file's own sync-reliability work (see Gotchas,
  // forty-fifth session) was built to prevent. advance() itself already
  // guarantees the right branch fires here: entering a transition
  // (in_transition:true) only ever happens when stIdx<stations.length-1, so
  // its "move to the next rotation" branch is always the one that runs --
  // it can never fall through to "move to the next top-level activity."
  useEffect(()=>{
    if(!isController)return;
    if(!(isBlock&&blockRotate&&inTrans))return;
    if(!(elapsed>=phaseSecs&&phaseSecs>0&&running))return;
    if(transitionAdvancedRef.current)return;
    transitionAdvancedRef.current=true;
    advance();
  },[isController,isBlock,blockRotate,inTrans,elapsed,phaseSecs,running,advance]);

  const goBack=useCallback(async()=>{
    if(!session||!cur)return;
    submitOperation(session.id,coachId,"go_back");
    if(isBlock&&inTrans){await transitionTo({in_transition:false},cur,stIdx);return;}
    if(isBlock&&stIdx>0){const ns=stIdx-1;await transitionTo({current_rotation_number:ns,in_transition:false},cur,ns);return;}
    if(idx>0){const pi=idx-1;const prevAct=liveActs[pi];await transitionTo({current_practice_activity_id:prevAct.id,current_rotation_number:0,in_transition:false,in_block_intro:false},prevAct,0);}
  },[session,cur,isBlock,inTrans,stIdx,idx,liveActs,coachId,transitionTo]);

  const jumpTo=useCallback(async(i)=>{
    if(!session)return;
    const target=liveActs[i];if(!target)return;
    submitOperation(session.id,coachId,"jump_to");
    await transitionTo({current_practice_activity_id:target.id,current_rotation_number:0,in_transition:false,in_block_intro:false},target,0);
    setShowROS(false);
  },[session,liveActs,coachId,transitionTo]);

  // Direct feedback, a real bug: resuming used to show the timer jump to a
  // different value before settling back near where it was. Root cause --
  // total_paused_seconds only ever updated once the write round-tripped to
  // Supabase and back (writeSession's own setSession call), so the elapsed
  // real time spent waiting on that round trip got silently "charged" to
  // the running timer instead of the pause, surfacing as a one-time jump
  // forward the instant the response landed. Fixed by applying the exact
  // same patch to local state immediately (synchronously, before the
  // network call), so the display transitions the instant the button is
  // tapped -- the network write still happens right after to persist it,
  // and writeSession's own setSession(updated) simply confirms the same
  // values once the server responds, a no-op visually.
  const togglePlay=useCallback(async()=>{
    if(!session)return;
    submitOperation(session.id,coachId,"toggle_play");
    let patch;
    if(session.paused_at){
      const pausedDelta=Math.floor((Date.now()-new Date(session.paused_at).getTime())/1000);
      patch={paused_at:null,total_paused_seconds:(session.total_paused_seconds||0)+pausedDelta};
    }else{
      patch={paused_at:new Date().toISOString()};
    }
    setSession(s=>s?Object.assign({},s,patch):s);
    await writeSession(patch);
  },[session,coachId,writeSession]);

  const nudge=useCallback(async(deltaSecs)=>{
    if(!session)return;
    const curElapsed=computeElapsed(session,Date.now());
    const newElapsed=Math.max(0,curElapsed+deltaSecs);
    const appliedDelta=curElapsed-newElapsed;
    buzzedRef.current=false;warnedRef.current=false;transitionAdvancedRef.current=false;
    const patch={total_paused_seconds:(session.total_paused_seconds||0)+appliedDelta};
    setSession(s=>s?Object.assign({},s,patch):s);
    await writeSession(patch);
  },[session,writeSession]);

  const endPractice=useCallback(async()=>{
    setShowEllipsis(false);
    if(!session)return;
    submitOperation(session.id,coachId,"end_practice");
    await closeCurrentLog();
    await writeSession({status:"completed",ended_at:new Date().toISOString(),paused_at:null});
    setEndReason("completed");
    setStage("end");
  },[session,coachId,writeSession,closeCurrentLog]);

  // Abort: for a mistaken/test run (e.g. testing new features on tonight's
  // real practice hours early) -- ends the session without it counting as a
  // real completed run (status='abandoned', not 'completed', matching the
  // schema's original design -- see 20260704004000_practice_live_sessions.sql
  // and the is_session_active() immutability guard, both already built for
  // this exact status, just never wired to a UI action until now). Since
  // findActiveLiveSession only ever looks for status='active', a fresh
  // "Run Now" on this same practice afterward just starts a brand-new
  // session cleanly -- no restart-specific plumbing needed beyond this.
  const abortPractice=useCallback(async()=>{
    setShowEllipsis(false);
    if(!session)return;
    if(!window.confirm("Abort this practice? It won't count as completed, and you can start a fresh run any time."))return;
    submitOperation(session.id,coachId,"abort_practice");
    await closeCurrentLog();
    await writeSession({status:"abandoned",ended_at:new Date().toISOString(),paused_at:null});
    setEndReason("abandoned");
    setStage("end");
  },[session,coachId,writeSession,closeCurrentLog]);

  const takeControlNow=useCallback(async()=>{
    if(!session)return;
    const {data:updated,offline}=await takeControl(session.id,session.version,coachId);
    if(updated){setSession(updated);return;}
    if(offline){setSyncOffline(true);pendingWriteRef.current={patch:{controller_user_id:coachId}};return;}
    const fresh=await findActiveLiveSession(practice.id);
    if(fresh)setSession(fresh);
  },[session,coachId,practice]);

  // Practice Setup's per-tap present/absent toggles -- see
  // toggle_setup_presence (20260813163000) for why this bypasses the usual
  // version-checked writeSession path. Version-gated on the way in anyway
  // (same as reconcileSession) purely so a slow response can't clobber a
  // newer state some other update already delivered in the meantime.
  const togglePlayerPresent=useCallback(async(playerId)=>{
    if(!session)return;
    const updated=await toggleSetupPresence(session.id,"player",playerId);
    if(!updated)return;
    lastSyncedAtRef.current=Date.now();
    setSession(prev=>(prev&&updated.version<prev.version)?prev:updated);
  },[session]);
  const toggleCoachPresent=useCallback(async(staffId)=>{
    if(!session)return;
    const updated=await toggleSetupPresence(session.id,"coach",staffId);
    if(!updated)return;
    lastSyncedAtRef.current=Date.now();
    setSession(prev=>(prev&&updated.version<prev.version)?prev:updated);
  },[session]);

  // Assistant-coach handoff §2.4: @mention roster for the existing
  // quick-note/end-of-practice inputs below -- the notes themselves already
  // had a real capture UI before this handoff (createNote/notes table),
  // this just adds player tagging to it rather than building a second one.
  const mentionRoster=(team&&team.players||[]).map(p=>({id:p.id,displayName:p.firstName+(p.lastName?" "+p.lastName:"")}));

  const coachName=id=>{const c=team&&team.coaches.find(c=>c.id===id);return c?c.name:null;};
  const subName=id=>{const s=loc&&loc.sublocations.find(s=>s.id===id);return s?s.name:null;};
  const pnames=ids=>(ids||[]).map(id=>{const p=team&&team.players.find(p=>p.id===id);return p?p.firstName:null;}).filter(Boolean).join(", ");
  const pname=id=>{const p=team&&team.players.find(p=>p.id===id);return p?p.firstName:id;};
  // A station's lead can be a roster coach OR a freeform helper name (a
  // parent running a station who was never added as staff) -- coachId
  // always wins if somehow both are set, matching updateStationLead's
  // mutual-exclusion write.
  const leadName=st=>coachName(st.coachId)||st.helperName||null;
  const doSetLead=useCallback(async(stationId,{coachId:leadCoachId,helperName})=>{
    setReassignBusy(true);
    await updateStationLead(stationId,{coachId:leadCoachId,helperName});
    await refreshPlanning();
    setReassignBusy(false);setReassignStationId(null);setHelperDraft("");
  },[refreshPlanning]);
  const doSetActivityLead=useCallback(async(practiceActivityId,{coachId:leadCoachId,helperName})=>{
    setReassignActBusy(true);
    await updateActivityLead(practiceActivityId,{coachId:leadCoachId,helperName});
    await refreshPlanning();
    setReassignActBusy(false);setReassignActivityId(null);setHelperDraftAct("");
  },[refreshPlanning]);
  // Practice/station rows don't carry their own skillTagIds (they're a
  // snapshot copy of the drill at add-time) -- look the tags up on the
  // source library drill instead, same as the Library screen does.
  const tagIdsForLibraryId=libraryId=>{
    if(!libraryId)return [];
    const drill=(data.activityLibrary||[]).find(a=>a.id===libraryId);
    return (drill&&drill.skillTagIds)||[];
  };
  const tagNamesForLibraryId=libraryId=>tagIdsForLibraryId(libraryId).map(id=>{const t=(data.skillTags||[]).find(t=>t.id===id);return t?t.name:null;}).filter(Boolean);
  // Direct feedback: a drill with no skill tag silently loses the "Player
  // Focus" callout above (categoryIdsForLibraryId comes up empty), which a
  // coach mid-practice has no way to notice or fix without leaving the live
  // view for Library. Only offered for a drill the coach actually owns --
  // editing someone else's (org/peer/public-catalog) drill from here isn't
  // safe, so the reminder itself doesn't show for those, per feedback.
  const untaggedOwnLibraryId=libraryId=>{
    if(!libraryId)return null;
    const drill=(data.activityLibrary||[]).find(a=>a.id===libraryId);
    if(!drill||drill.ownerUserId!==coachId||drill.sourceCatalogId)return null;
    return (drill.skillTagIds&&drill.skillTagIds.length)?null:drill;
  };
  const availableSkillTags=(data.skillTags||[]).filter(t=>t.scope==="global"||(t.scope==="coach"&&t.ownerUserId===coachId)||(t.scope==="org"&&team&&t.organizationId===team.organizationId));
  const openTagPicker=libraryId=>{setTagPickerLibraryId(libraryId);setTagPickerSel([]);};
  const saveTagPicker=async()=>{
    if(!tagPickerLibraryId||!tagPickerSel.length)return;
    const drill=(data.activityLibrary||[]).find(a=>a.id===tagPickerLibraryId);
    if(!drill)return;
    setTagPickerSaving(true);
    await updateDrill(tagPickerLibraryId,{name:drill.name,sport:drill.sport,duration:drill.duration,description:drill.description,coachingPoints:drill.coachingPoints,grouping:drill.grouping,numGroups:drill.numGroups,equipment:drill.equipment,skillTagIds:tagPickerSel});
    await refreshLibrary();
    setTagPickerSaving(false);setTagPickerLibraryId(null);setTagPickerSel([]);
  };
  // Player notes are per skill category, not per tag -- a drill tagged
  // Catch-and-Shoot still matches a player's Shooting note. Map the
  // drill's tags to their categories first, then match on those.
  const categoryIdsForLibraryId=libraryId=>{
    const tagIds=tagIdsForLibraryId(libraryId);
    const catIds=new Set();
    tagIds.forEach(id=>{const t=(data.skillTags||[]).find(t=>t.id===id);if(t&&t.categoryId)catIds.add(t.categoryId);});
    return [...catIds];
  };
  // What this player is working on for one of the drill's selected skill
  // categories -- shown right on their chip at the station, not just
  // behind a tap, per the "visible at a glance" ask.
  const noteForPlayerAtDrill=(pid,libraryId)=>{
    const catIds=categoryIdsForLibraryId(libraryId);
    if(!catIds.length)return "";
    const pl=team&&team.players.find(p=>p.id===pid);
    if(!pl||!pl.focusAreas)return "";
    return pl.focusAreas.filter(a=>catIds.includes(a.categoryId)&&a.note).map(a=>a.note).join(" · ");
  };
  // Not cleared until the write actually succeeds -- a network hiccup
  // during a live practice silently losing a typed note is exactly the
  // kind of thing that's easy to not notice until it's too late to redo.
  const addNote=async()=>{
    if(!noteText.trim()||savingNote)return;
    setSavingNote(true);setNoteError("");
    const focusedStation=isBlock&&cur.stations?cur.stations[stIdx]:null;
    const {error}=await createNote({practiceId:liveId,practiceActivityId:cur?cur.id:null,stationId:focusedStation?focusedStation.id:null,text:noteText.trim(),createdBy:coachId,playerIds:noteTaggedIds});
    setSavingNote(false);
    if(error){setNoteError("Couldn't save note. Try again.");return;}
    setNoteText("");setNoteTaggedIds([]);
  };
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
    setLiveGroupLabels(Array.from({length:n2},()=>""));
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

  const shareLive=useCallback(async(scope)=>{
    if(!session)return;
    const token=await createHelperShareToken(session.id,coachId,scope);
    if(token){setShareToken(token);setShareScope(scope||"helper_read");setShowShare(true);}
  },[session,coachId]);

  // ── In-session practice editor ─────────────────────────────────────────────
  if(showEditBuilder){
    return(<LiveEditBuilder
      data={data}
      coachId={coachId}
      refreshLibrary={refreshLibrary}
      liveActs={liveActs}
      team={team}
      loc={loc}
      onSaveResume={async(newActs)=>{
        await savePracticeTree(practice.id,{teamId:practice.teamId,locationId:practice.locationId,date:practice.date,startTime:practice.startTime,prePracticeNotes:practice.prePracticeNotes,activities:newActs,coachId});
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
        spoken.current={};buzzedRef.current=false;warnedRef.current=false;transitionAdvancedRef.current=false;
        setShowEditBuilder(false);
      }}
      onBack={()=>{setShowEditBuilder(false);}}
    />);
  }

  if(stage==="attend"||showAtt){const attBack=()=>{if(showAtt){setShowAtt(false);}else{setLiveId(null);setStage("pick");goHome();}};
    // Direct feedback, reverted: an earlier round defaulted attendance to
    // nobody present, on the reasoning that a coach shouldn't have to tap
    // 15 kids out one by one. Given the planned-absence ("who's out?")
    // feature already exists specifically to flag who won't show, Jax
    // decided that default no longer makes sense -- back to everyone
    // present *except* whoever's actually marked out in advance (§7), so
    // Timmy stays unchecked even though the default is "present," and the
    // coach only has to tap out real day-of surprises.
    const freshPresent=team?team.players.map(p=>p.id).filter(id=>!plannedAbsentIds.has(id)):[];
    return (<>
      {showAtt
        ?<AttendanceScreen key="upd" practice={practice} team={team} data={data} amHeadCoach={amHeadCoach} isUpdate initialPresent={[...presentIds]} initialCoachPresent={[...coachPresentIds]} onConfirm={handleAttUpdate} onBack={attBack}/>
        :<PracticeSetupScreen practice={practice} team={team} data={data} coachId={coachId} isController={isController} amHeadCoach={amHeadCoach} stationBlockActs={stationBlockActs} setupGroups={setupGroups} onMoveGroupPlayer={moveSetupGroupPlayer} onRegenerateGroups={regenerateSetupGroups} initialPresent={freshPresent} plannedAbsentIds={plannedAbsentIds} onConfirm={handleAttConfirm} onBack={attBack} onReassignLead={setReassignStationId} onReassignActivityLead={setReassignActivityId} onEditPractice={()=>setShowEditBuilder(true)} onAbort={abortPractice} session={session} onSetPresentPlayerIds={ids=>writeSession({setup_present_player_ids:ids})} onSetPresentCoachIds={ids=>writeSession({setup_present_coach_ids:ids})} onTogglePlayerPresent={togglePlayerPresent} onToggleCoachPresent={toggleCoachPresent}/>}
      {!showAtt&&reassignStationId&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget){setReassignStationId(null);setHelperDraft("");}}}>
        <div className="modal" style={{background:"#0d1512",color:"#fff"}}><div className="mhandle" style={{background:"rgba(255,255,255,.2)"}}/>
          <div className="mtitle" style={{color:"#fff"}}>Assign Station Leader</div>
          <button className="btn ghost bmd bfull" style={{background:"transparent",marginBottom:8,color:"#fff",borderColor:"rgba(255,255,255,.25)"}} disabled={reassignBusy} onClick={()=>doSetLead(reassignStationId,{coachId:"",helperName:""})}>Unassign</button>
          {team&&team.coaches.map(c=>(<button key={c.id} className="btn outline bmd bfull" style={{background:"transparent",marginBottom:8,color:"#fff",borderColor:"#52b788"}} disabled={reassignBusy} onClick={()=>doSetLead(reassignStationId,{coachId:c.id,helperName:""})}>{c.name}</button>))}
          <div style={{display:"flex",gap:6,marginTop:4}}>
            <input className="inp" style={{flex:1}} placeholder="Helper's name" autoFocus value={helperDraft} onChange={e=>setHelperDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&helperDraft.trim())doSetLead(reassignStationId,{coachId:"",helperName:helperDraft.trim()});}}/>
            <button className="btn primary bxs" disabled={!helperDraft.trim()||reassignBusy} onClick={()=>doSetLead(reassignStationId,{coachId:"",helperName:helperDraft.trim()})}>Set</button>
          </div>
          <button className="btn ghost bmd bfull" style={{background:"transparent",marginTop:8,color:"#fff",borderColor:"rgba(255,255,255,.25)"}} onClick={()=>{setReassignStationId(null);setHelperDraft("");}}>Cancel</button>
        </div>
      </div>}
      {!showAtt&&reassignActivityId&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget){setReassignActivityId(null);setHelperDraftAct("");}}}>
        <div className="modal" style={{background:"#0d1512",color:"#fff"}}><div className="mhandle" style={{background:"rgba(255,255,255,.2)"}}/>
          <div className="mtitle" style={{color:"#fff"}}>Assign Leader</div>
          <button className="btn ghost bmd bfull" style={{background:"transparent",marginBottom:8,color:"#fff",borderColor:"rgba(255,255,255,.25)"}} disabled={reassignActBusy} onClick={()=>doSetActivityLead(reassignActivityId,{coachId:"",helperName:""})}>Unassign</button>
          {team&&team.coaches.map(c=>(<button key={c.id} className="btn outline bmd bfull" style={{background:"transparent",marginBottom:8,color:"#fff",borderColor:"#52b788"}} disabled={reassignActBusy} onClick={()=>doSetActivityLead(reassignActivityId,{coachId:c.id,helperName:""})}>{c.name}</button>))}
          <div style={{display:"flex",gap:6,marginTop:4}}>
            <input className="inp" style={{flex:1}} placeholder="Helper's name" autoFocus value={helperDraftAct} onChange={e=>setHelperDraftAct(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&helperDraftAct.trim())doSetActivityLead(reassignActivityId,{coachId:"",helperName:helperDraftAct.trim()});}}/>
            <button className="btn primary bxs" disabled={!helperDraftAct.trim()||reassignActBusy} onClick={()=>doSetActivityLead(reassignActivityId,{coachId:"",helperName:helperDraftAct.trim()})}>Set</button>
          </div>
          <button className="btn ghost bmd bfull" style={{background:"transparent",marginTop:8,color:"#fff",borderColor:"rgba(255,255,255,.25)"}} onClick={()=>{setReassignActivityId(null);setHelperDraftAct("");}}>Cancel</button>
        </div>
      </div>}
    </>);}
  const saveEndNote=async()=>{
    if(!noteText.trim()||savingNote)return;
    setSavingNote(true);setNoteError("");
    const {error}=await createNote({practiceId:liveId,practiceActivityId:null,stationId:null,text:noteText.trim(),createdBy:coachId,playerIds:noteTaggedIds});
    setSavingNote(false);
    if(error){setNoteError("Couldn't save note. Try again.");return;}
    setNoteText("");setNoteTaggedIds([]);
  };
  // Save Note and Done used to sit right on top of each other (both
  // full-width primary buttons a few px apart), so a note typed then tapped
  // in a hurry landed on Done and was silently discarded. Done is now
  // visually distinct and pushed further away, and still-unsaved text blocks
  // it with a confirmation instead of losing the note outright.
  const finishPractice=()=>{
    if(noteText.trim()&&!window.confirm("You have an unsaved note. Leave without saving it?"))return;
    setLiveId(null);setStage("pick");goHome();
  };
  if(stage==="end")return (<div className="ccs"><div className="cc-end"><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:36,fontWeight:900,color:endReason==="abandoned"?"var(--amber)":"var(--green)",marginBottom:4}}>{endReason==="abandoned"?"Practice Aborted":"Practice Complete"}</div><div style={{fontSize:16,color:"var(--tm)",marginBottom:24,lineHeight:1.5}}>{endReason==="abandoned"?(team&&team.name)+" practice aborted -- it won't count as completed. Start a fresh run any time.":(team&&team.name)+" practice complete."}</div><div style={{width:"100%",marginBottom:16}}><label className="lbl">End of Practice Notes</label><div style={{position:"relative"}}><textarea ref={noteTaRef} className="ta" style={{minHeight:80}} value={noteText} placeholder="Observations for next time... (type @ to tag a player)" onChange={onNoteTextChange}/>{noteMentionQuery!==null&&noteMentionMatches.length>0&&<div className="mini-menu" style={{position:"absolute",top:"100%",left:0,right:0,zIndex:5,maxHeight:160,overflowY:"auto"}}>{noteMentionMatches.map(p=>(<button key={p.id} type="button" className="mm-item" onClick={()=>pickNoteMention(p)}>{p.firstName} {p.lastName}</button>))}</div>}</div>{noteError&&<div style={{fontSize:12,color:"var(--red)",marginTop:4}}>{noteError}</div>}<button className="btn primary bsm bfull mt6" onClick={saveEndNote} disabled={savingNote}>{savingNote?"Saving...":"Save Note"}</button></div><button className="btn ghost bmd bfull" style={{marginTop:32}} onClick={finishPractice}>Done</button></div></div>);

  if(!cur)return null;

  const phaseLabel=isBlock?(inBlockIntro?"INTRODUCE STATIONS":blockRotate?(inTrans?"TRANSITION":"ROTATION "+(stIdx+1)+" of "+cur.stations.length):"STATION BREAKOUTS"):((cur&&cur.name)||"").toUpperCase();
  const schedBadge=schedDelta===null?null:(Math.abs(schedDelta)<1?<span style={{background:"var(--gbg)",color:"var(--green)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>On time</span>:schedDelta>0?<span style={{background:"var(--ambg)",color:"var(--amber)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>+{schedDelta}m behind</span>:<span style={{background:"var(--gbg)",color:"var(--green)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>{Math.abs(schedDelta)}m ahead</span>);

  return (<div className="ccs">
    {syncOffline&&<div style={{background:"var(--rbg)",borderBottom:"1px solid var(--rb)",padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>
      <span style={{width:8,height:8,borderRadius:"50%",background:"var(--red)",flexShrink:0}}/>
      <span style={{fontSize:12,color:"var(--red)",fontWeight:600}}>Offline. Will sync automatically when reconnected.</span>
    </div>}
    {!isController&&<div style={{background:"var(--ambg)",borderBottom:"1px solid var(--ambb)",padding:"8px 14px"}}>
      <span style={{fontSize:12,color:"var(--amber)",fontWeight:600}}>Read-only · {controllerName} has control</span>
    </div>}
    {controlToast&&<div style={{position:"fixed",top:12,left:"50%",transform:"translateX(-50%)",zIndex:50,background:"var(--black2)",color:"#fff",padding:"8px 16px",borderRadius:20,fontSize:13,fontWeight:600,boxShadow:"0 4px 12px rgba(0,0,0,.3)"}}>{controlToast}</div>}
    <div className="cc-header">
      {/* Direct feedback: the ellipsis used to share this row with the
          Live dot/label/schedule badge on the left (justify-content:
          space-between), which left it squeezed on narrow screens. Giving
          the dot+label+schedule badge+presence their own line below frees
          this whole row for just the action buttons. Also: the pulsing dot
          was going oval under a tight flex row -- it had no flex-shrink
          guard, so a cramped row could shrink its width below its fixed
          7px height; `.live` itself now has flex-shrink:0 (App.jsx) as the
          real fix, kept here too since this row has more room regardless. */}
      <div className="cc-header-top" style={{justifyContent:"flex-end"}}>
        <div className="row" style={{gap:6,flexShrink:0}}>
          <button onClick={()=>setShowAtt(true)} style={{background:pCount<pTotal?"var(--ambg)":"var(--gbg)",border:"1.5px solid",borderColor:pCount<pTotal?"var(--ambb)":"var(--gb)",borderRadius:20,padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
            <span style={{color:pCount<pTotal?"var(--amber)":"var(--green)",display:"flex"}}><Ic.Person/></span>
            <span style={{fontFamily:"DM Mono,monospace",fontSize:13,fontWeight:700,color:pCount<pTotal?"var(--amber)":"var(--green)"}}>{pCount}/{pTotal}</span>
          </button>
          <button className="btn ghost bxs" style={{display:"flex",alignItems:"center",gap:4}} onClick={()=>setShowROS(s=>!s)}>Overview<Ic.Chev up={showROS}/></button>
          <button onClick={()=>{
            if(!audioOn){
              try{
                window.speechSynthesis.cancel();
                const u=new SpeechSynthesisUtterance("Audio on");
                u.rate=1;u.volume=1;
                window.speechSynthesis.speak(u);
              }catch(e){}
              startBgAudioSession();
            }else{
              stopBgAudioSession();
            }
            spoken.current={};buzzedRef.current=false;warnedRef.current=false;setAudioOn(a=>!a);
          }} style={{background:audioOn?"var(--gbg)":"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"var(--rs)",padding:"4px 8px",fontSize:13,fontWeight:700,cursor:"pointer",color:audioOn?"var(--green)":"var(--td)",display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:13,lineHeight:1}}>{audioOn?"🔊":"🔇"}</span><span>{audioOn?"On":"Off"}</span></button>
          <div style={{position:"relative"}}>
            <button className="ell-btn" onClick={()=>setShowEllipsis(s=>!s)}><span/><span/><span/></button>
            {showEllipsis&&<div className="mini-menu" style={{right:0,minWidth:160}}>
              <button className="mm-item" onClick={()=>{setShowEllipsis(false);goHome();}}>Leave (keeps running)</button>
              {isController&&amHeadCoach&&<button className="mm-item" onClick={()=>{setShowEllipsis(false);setShowEditBuilder(true);}}>Edit Practice</button>}
              {session&&<button className="mm-item" onClick={()=>{setShowEllipsis(false);shareLive("helper_read");}}>Share Live View</button>}
              {isController&&<button className="mm-item" onClick={endPractice}>End Practice</button>}
              {isController&&<button className="mm-item mm-danger" onClick={abortPractice}>Abort Practice</button>}
            </div>}
          </div>
        </div>
      </div>
      <div className="row" style={{gap:6,flexWrap:"wrap",marginTop:6}}>
        <SyncBadge health={syncHealth}/>{schedBadge}
        <PresenceBadge coachNames={presence.coachNames} anonCount={presence.anonCount}/>
      </div>
      <div className="cc-act-name">{phaseLabel}</div>
      {/* Direct feedback: coach + area should read right under the title,
          before the timer -- not buried in the body below player focus/
          equipment, which is where it used to sit for a plain drill. Only
          for a plain drill/checklist (one coach, one area); a station
          block already shows each station's own coach/area on its own
          card, so there's no single one to put here. */}
      {!isBlock&&cur&&(leaderLabel(cur,team)||subName(cur.sublocationId))&&<div style={{fontSize:13,fontWeight:600,color:"var(--td)",marginTop:2,display:"flex",alignItems:"center",flexWrap:"wrap",gap:4}}>
        {leaderLabel(cur,team)&&<span className="bdg bp">Coach: {leaderLabel(cur,team)}</span>}
        {leaderLabel(cur,team)&&subName(cur.sublocationId)&&<span>·</span>}
        {subName(cur.sublocationId)&&<span>{subName(cur.sublocationId)}</span>}
      </div>}
      {isBlock&&<div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)"}}>
        {(()=>{const n2=cur.stations?cur.stations.length:0;const totalMins=n2*(cur.stationDuration||0)+Math.max(0,n2-1)*(blockRotate?(cur.transitionDuration||0):0);return (cur.name?cur.name+" · ":"")+n2+" Stations · "+totalMins+"min total";})()}
      </div>}
    </div>
    {showROS&&<div style={{background:"var(--s1)",borderBottom:"1px solid var(--b)",maxHeight:200,overflowY:"auto",flexShrink:0}}>
      {(()=>{
        const byUserId=id=>{const c=team&&team.coaches.find(c=>c.userId===id);return c?c.name:null;};
        const createdName=byUserId(practice&&practice.createdBy);
        const editedName=byUserId(practice&&practice.lastEditedBy);
        const sameAuthor=createdName&&editedName&&practice.createdBy===practice.lastEditedBy;
        if(!createdName&&!editedName)return null;
        return (<div style={{padding:"8px 14px",fontSize:12,color:"var(--td)",borderBottom:"1px solid var(--b)"}}>
          {createdName&&<span>Planned by {createdName}</span>}
          {!sameAuthor&&editedName&&<span>{createdName?" · ":""}Last edited by {editedName}</span>}
        </div>);
      })()}
      {liveActs.map((a,i)=>(<div key={a.id} style={{display:"flex",alignItems:"center",padding:"8px 14px",borderBottom:"1px solid var(--b)",background:i===idx?"var(--gbg)":"#fff",cursor:isController?"pointer":"default",opacity:i<idx?0.5:1}} onClick={()=>{if(isController)jumpTo(i);}}>
        <div style={{flex:1,fontSize:14,color:i===idx?"var(--green)":i<idx?"var(--td)":"var(--black)",textDecoration:i<idx?"line-through":"none"}}>{i===idx?">> ":""}{a.type==="station_block"?(a.name||"Station Block"):a.name}</div>
        <span className="bs bdg" style={{fontSize:11}}>{a.type==="station_block"?(a.stations.length*a.stationDuration+Math.max(0,a.stations.length-1)*a.transitionDuration)+"m":a.duration+"m"}</span>
      </div>))}
      <div style={{padding:"8px 14px"}}><button className="btn ghost bxs" onClick={()=>setShowROS(false)}>Close</button></div>
    </div>}
    <div className="cc-timer-row">
      <div className={"cc-timer"+(urg?" urg":"")+(isOver?" over":"")}>{fmt(rem)}</div>
      {isController&&<button onClick={togglePlay} style={{width:52,height:52,borderRadius:"50%",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,background:isOver?"var(--red)":running?"var(--s3)":"var(--green)",color:isOver?"#fff":running?"var(--black2)":"#fff",boxShadow:running?"none":"0 2px 8px rgba(45,106,79,.35)"}}>
        {running?<Ic.Pause/>:<Ic.Play/>}
      </button>}
      <div style={{flex:1}}/>
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
    {/* Assistant-coach handoff §1.3, confirmed decision: this exact spot --
        where advance/+-1min normally sit -- is where a thumb lands out of
        habit. Leaving it blank reads as broken/loading; a bare button here
        risks an accidental tap seizing control mid-drill. Showing who's
        driving plus a deliberately low-emphasis (outline, not primary)
        take-control affordance solves both at once. */}
    {!isController&&<div className="cc-controls" style={{flexDirection:"column",alignItems:"stretch",gap:6}}>
      <div style={{textAlign:"center",fontSize:13,color:"var(--td)"}}>{controllerName?controllerName+" is running this":"Someone else is running this"}</div>
      <button className="btn outline bmd" onClick={takeControlNow}>Take Control</button>
    </div>}
    <div className="cc-body">
      {isCl&&cur&&<div className="cc-focus">
        {/* Direct feedback: a Water Break (or any checklist-type component
            with no items -- e.g. an Intro nobody bothered to add a
            checklist to) showed "0/0 covered", which reads as broken
            rather than "nothing to check off here." Blank when there's
            nothing to cover; the real x/y still shows once items exist. */}
        <div className="cc-focus-lbl">{cur.name}{(cur.items||[]).length>0?" - "+Object.values(clState[cur.id]||{}).filter(Boolean).length+"/"+(cur.items||[]).length+" covered":""}</div>
        {(cur.items||[]).map(it=>(<div key={it.id} className="cl-item" onClick={()=>toggleCl(cur.id,it.id)}>
          <div className={"cl-check "+((clState[cur.id]||{})[it.id]?"done":"")}>{(clState[cur.id]||{})[it.id]&&<Ic.Check/>}</div>
          <div className={"cl-text "+((clState[cur.id]||{})[it.id]?"done":"")}>{it.text}</div>
        </div>))}
        {cur.notes&&<div style={{fontSize:13,color:"var(--black2)",marginTop:8,fontStyle:"italic"}}>{cur.notes}</div>}
      </div>}
      {!isBlock&&!isCl&&cur&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {cur.description&&<div style={{borderLeft:"3px solid var(--black)",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--black)",marginBottom:4}}>Description</div>
          <div style={{fontSize:14,color:"var(--black)",lineHeight:1.5}}>{cur.description}</div>
        </div>}
        {cur.coachingPoints&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:10,paddingTop:4,paddingBottom:4}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#16a34a",marginBottom:4}}>💡 Coaching Focus</div>
          <div style={{fontSize:15,color:"var(--black)",lineHeight:1.5}}>{cur.coachingPoints}</div>
        </div>}
        {isController&&untaggedOwnLibraryId(cur.libraryId)&&<button type="button" onClick={()=>openTagPicker(cur.libraryId)} style={{textAlign:"left",background:"var(--ambg)",border:"1px solid var(--ambb)",borderRadius:8,padding:"8px 10px",fontSize:12,color:"var(--amber)",fontWeight:600,cursor:"pointer"}}>No skill tag yet -- tap to add one</button>}
        {categoryIdsForLibraryId(cur.libraryId).length>0&&<button type="button" className="btn ghost bsm" style={{alignSelf:"flex-start"}} onClick={()=>setShowPlayerFocus(true)}>Player Focus</button>}
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
      {/* Direct feedback: "Introduce Stations" looked identical to the
          actual coaching view (same white/grey cards), which made it easy
          to mistake for a station already underway. Same dark #0d1512 /
          #52b788 palette PreviewView's own pre-live "Practice Setup" screen
          already uses -- a coach glancing at the screen should be able to
          tell "I'm getting organized" from "I'm coaching" at a glance.
          "Start Block" removed here too: it duplicated the same generic
          advance control that already moves the session out of block-intro
          (see advance()'s own inBlockIntro branch) -- a coach could always
          reach the same result via the normal next control, just with a
          same-purpose button hidden further down the screen.
          Direct feedback: reassignment now happens right here, same
          pick-up-and-drop (tap a player, tap the dashed slot in another
          station) as Practice Setup's own groupings dialog, reusing
          movePlayer/movePlayerToStation which already resolve the right
          raw group index -- stIdx is still 0 at this point in the block, so
          no rotation offset to account for yet. */}
      {isBlock&&inBlockIntro&&cur.stations&&<div style={{background:"#0d1512",borderRadius:"var(--r)",padding:"14px 12px",marginBottom:4}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"#8fa89b",marginBottom:4}}>Get everyone to their station</div>
        {isController&&<div style={{fontSize:11,color:"#8fa89b",marginBottom:8}}>{movePlayer?"Tap the dashed spot in another station to move them there.":"Tap a player to move them."}</div>}
        {cur.stations.map((st,i)=>{
          const stEquip=(Array.isArray(st.equipment)?st.equipment:[]).map(id=>{const a=(data.assets||[]).find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);
          const assignments=liveGroups?(liveGroups[i]||[]):[];
          const groupLabel=(liveGroupLabels&&liveGroupLabels[i])||st.groupLabel||"";
          const isSourceOfSelection=movePlayer&&assignments.includes(movePlayer);
          return(<div key={st.id} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#52b788"}}>Station {i+1}</div>
              {subName(st.sublocationId)&&<div style={{fontSize:11,color:"#52b788",fontWeight:600}}>{subName(st.sublocationId)}</div>}
              {isController?<button type="button" onClick={()=>setReassignStationId(st.id)} style={{background:"none",border:"none",padding:0,fontSize:11,color:"#52b788",cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:2}}>{leadName(st)||"Assign a coach"}</button>
                :leadName(st)&&<div style={{fontSize:11,color:"#52b788"}}>{leadName(st)}</div>}
            </div>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"#fff",marginBottom:6}}>{st.activityName||st.name||"Station "+(i+1)}</div>
            {groupLabel&&<div style={{marginBottom:6}}><span className="bdg bp">Group: {groupLabel}</span></div>}
            {(stEquip.length>0||st.playerGear)&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
              {stEquip.length>0&&<span style={{border:"1.5px solid #fde047",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#854d0e",fontWeight:600,background:"#fff"}}>Equipment: {stEquip.join(", ")}</span>}
              {st.playerGear&&<span style={{border:"1.5px solid #fdba74",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#9a3412",fontWeight:600,background:"#fff"}}>Player Gear: {st.playerGear}</span>}
            </div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {assignments.map(pid=>{
                if(!isController)return <StationPlayerChip key={pid} pid={pid} team={team}/>;
                const isPicked=movePlayer===pid;
                const pl=team&&team.players.find(p=>p.id===pid);
                return(<button key={pid} type="button" onClick={()=>setMovePlayer(m=>m===pid?null:pid)} style={{padding:"6px 10px",borderRadius:20,background:isPicked?"rgba(245,158,11,.25)":"rgba(255,255,255,.1)",border:"1.5px solid "+(isPicked?"#f59e0b":"rgba(255,255,255,.25)"),fontSize:12,fontWeight:600,color:isPicked?"#fde68a":"#fff",cursor:"pointer"}}>
                  {pl&&pl.jersey&&<span style={{fontFamily:"DM Mono,monospace",fontSize:11,color:isPicked?"#fde68a":"#52b788",marginRight:4}}>#{pl.jersey}</span>}{pl?pl.firstName:""}{isPicked?" · picked up":""}
                </button>);
              })}
              {isController&&movePlayer&&!isSourceOfSelection&&<button type="button" onClick={()=>movePlayerToStation(i)} style={{padding:"6px 14px",borderRadius:20,background:"transparent",border:"1.5px dashed #52b788",fontSize:12,fontWeight:600,color:"#52b788",cursor:"pointer"}}>+ Drop here</button>}
            </div>
          </div>);
        })}
        {isController&&<button className="btn outline bmd bfull mt10" style={{borderColor:"rgba(255,255,255,.3)",color:"#fff",background:"transparent"}} onClick={reshuffleBlockIntro}>Reshuffle</button>}
      </div>}
      {isBlock&&!inBlockIntro&&!inTrans&&rotatedStations&&<div>
        {focusSt!==null&&<div>
          <button className="btn ghost bxs" style={{marginBottom:10}} onClick={()=>setFocusSt(null)}>&#8249; All Stations</button>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginBottom:2}}>Station {focusSt+1}</div>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:36,fontWeight:900,color:"var(--black)",lineHeight:1,marginBottom:6}}>{rotatedStations[focusSt].activityName||rotatedStations[focusSt].name||"Station "+(focusSt+1)}</div>
          {rotatedStations[focusSt].groupLabel&&<div style={{marginBottom:6}}><span className="bdg bp">Group: {rotatedStations[focusSt].groupLabel}</span></div>}
          {(leadName(rotatedStations[focusSt])||subName(rotatedStations[focusSt].sublocationId)||isController)&&<div style={{fontSize:14,fontWeight:600,color:"var(--green2)",marginBottom:10,display:"flex",alignItems:"center",flexWrap:"wrap",gap:4}}>
            {isController?<button type="button" onClick={()=>setReassignStationId(rotatedStations[focusSt].id)} style={{background:"none",border:"none",padding:0,font:"inherit",color:"inherit",cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:2}}>{leadName(rotatedStations[focusSt])||"Assign a coach"}</button>
              :leadName(rotatedStations[focusSt])&&<span>{leadName(rotatedStations[focusSt])}</span>}
            {leadName(rotatedStations[focusSt])&&subName(rotatedStations[focusSt].sublocationId)&&<span> · </span>}
            {subName(rotatedStations[focusSt].sublocationId)&&<span>{subName(rotatedStations[focusSt].sublocationId)}</span>}
          </div>}
          {rotatedStations[focusSt].description&&<div style={{borderLeft:"3px solid var(--black)",paddingLeft:10,paddingTop:4,paddingBottom:8,marginBottom:4}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--black)",marginBottom:4}}>Description</div>
            <div style={{fontSize:14,color:"var(--black)",lineHeight:1.5}}>{rotatedStations[focusSt].description}</div>
          </div>}
          {rotatedStations[focusSt].coachingPoints&&<div style={{borderLeft:"3px solid #16a34a",paddingLeft:10,paddingTop:4,paddingBottom:8,marginBottom:4}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#16a34a",marginBottom:4}}>💡 Coaching Focus</div>
            <div style={{fontSize:15,color:"var(--black)",lineHeight:1.5}}>{rotatedStations[focusSt].coachingPoints}</div>
          </div>}
          {(()=>{const stEquip=Array.isArray(rotatedStations[focusSt].equipment)?rotatedStations[focusSt].equipment:[];const names=stEquip.map(id=>{const a=(data&&data.assets||[]).find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);return(names.length>0||rotatedStations[focusSt].playerGear)?(<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {names.length>0&&<span style={{background:"#fefce8",border:"1px solid #fde047",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#854d0e",fontWeight:600}}>Equipment: {names.join(", ")}</span>}
            {rotatedStations[focusSt].playerGear&&<span style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:20,padding:"4px 10px",fontSize:12,color:"#9a3412",fontWeight:600}}>Player Gear: {rotatedStations[focusSt].playerGear}</span>}
          </div>):null;})()}
          {rotatedStations[focusSt].grouping&&rotatedStations[focusSt].grouping!=="whole"&&<div style={{borderLeft:"3px solid #c4b5fd",paddingLeft:10,paddingTop:4,paddingBottom:8,marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#7c3aed"}}>👥 {rotatedStations[focusSt].grouping==="partners"?"Partners":"Groups"} at this station</div>
              {isController&&<button className="btn ghost bxs" onClick={()=>reshuffleStationGroup(rotatedStations[focusSt])}>Reshuffle</button>}
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {(stationSubGroups[rotatedStations[focusSt].id]||[]).map((g,i)=>(<div key={i} style={{display:"inline-flex",alignItems:"center",gap:6,border:"1.5px solid #c4b5fd",borderRadius:20,padding:"5px 12px",background:"#fff"}}>
                <span style={{fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700,color:"#7c3aed",flexShrink:0}}>{rotatedStations[focusSt].grouping==="partners"?"P"+(i+1):"G"+(i+1)}</span>
                <span style={{fontSize:13,fontWeight:600,color:"var(--black)"}}>{g.map(pid=>{const pl=team&&team.players.find(p=>p.id===pid);return pl?pl.firstName:null;}).filter(Boolean).join(" · ")}</span>
              </div>))}
              {!(stationSubGroups[rotatedStations[focusSt].id]||[]).length&&<span style={{fontSize:12,color:"var(--td)"}}>Assigning...</span>}
            </div>
          </div>}
          <div>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Players at this station</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {(rotatedStations[focusSt].assignments||[]).map(pid=>isController
                ?<PlayerChipLive key={pid} pid={pid} team={team} note={noteForPlayerAtDrill(pid,rotatedStations[focusSt].libraryId)} onProfile={pl=>setLivePlayerProfile(pl)}/>
                :<StationPlayerChip key={pid} pid={pid} team={team} note={noteForPlayerAtDrill(pid,rotatedStations[focusSt].libraryId)}/>)}
            </div>
          </div>
        </div>}
        {focusSt===null&&<div>
          {/* Direct feedback: this hint used to also repeat at the bottom of
              every single station card below -- one clear hint up here,
              sized to actually be noticed, is enough. Also: pre-tap should
              show only station #/drill/area/coach/equipment/player names --
              coaching points and per-player focus notes are what tapping in
              reveals, not something to see at a glance across every station
              at once. */}
          <div style={{fontSize:13,fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>{blockRotate?"Round "+(stIdx+1)+" of "+cur.stations.length+" · Tap a station to focus":"Tap a station to focus"}</div>
          {rotatedStations.map((st,i)=>{
            const stEquip=Array.isArray(st.equipment)?st.equipment:[];
            const equipNames=stEquip.map(id=>{const a=(data&&data.assets||[]).find(a=>a.id===id);return a?a.name:null;}).filter(Boolean);
            return (<div key={st.id} onClick={()=>setFocusSt(i)} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8,cursor:"pointer"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}>
                <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)"}}>Station {i+1}</div>
                {isController?<button type="button" onClick={e=>{e.stopPropagation();setReassignStationId(st.id);}} style={{background:"none",border:"none",padding:0,fontSize:11,color:"var(--td)",cursor:"pointer",textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:2}}>{leadName(st)||"Assign a coach"}</button>
                  :leadName(st)&&<div style={{fontSize:11,color:"var(--td)"}}>{leadName(st)}</div>}
              </div>
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,color:"var(--black)",lineHeight:1.1,marginBottom:4}}>{st.activityName||st.name||"Station "+(i+1)}</div>
              {st.groupLabel&&<div style={{marginBottom:4}}><span className="bdg bp">Group: {st.groupLabel}</span></div>}
              {subName(st.sublocationId)&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:4}}>{subName(st.sublocationId)}</div>}
              {(equipNames.length>0||st.playerGear)&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
                {equipNames.length>0&&<span style={{background:"#fefce8",border:"1px solid #fde047",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#854d0e",fontWeight:600}}>Equipment: {equipNames.join(", ")}</span>}
                {st.playerGear&&<span style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:20,padding:"2px 8px",fontSize:11,color:"#9a3412",fontWeight:600}}>Player Gear: {st.playerGear}</span>}
              </div>}
              {/* Stopped from bubbling into the card's own onClick so
                  tapping a player's card doesn't also jump into that
                  station's focus view -- player movement now happens on
                  the Introduce Stations screen, so a tap here just opens
                  the player's card instead. */}
              <div style={{display:"flex",flexWrap:"wrap",gap:5}} onClick={e=>e.stopPropagation()}>
                {(st.assignments||[]).map(pid=>isController
                  ?<PlayerChipLive key={pid} pid={pid} team={team} onProfile={pl=>setLivePlayerProfile(pl)}/>
                  :<StationPlayerChip key={pid} pid={pid} team={team}/>)}
              </div>
            </div>);
          })}
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
                <div className="clbl mb8">Player Focus</div>
                {livePlayerProfile.focusAreas.map(a=>{
                  const cat=(data.skillCategories||[]).find(c=>c.id===a.categoryId);
                  return(<div key={a.id} style={{marginBottom:8,padding:"10px 12px",background:"var(--s2)",borderRadius:"var(--rs)"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"var(--td)"}}>{cat?cat.name:""}</div>
                    {a.note&&<div style={{fontSize:14,lineHeight:1.5,marginTop:2}}>{a.note}</div>}
                  </div>);
                })}
              </div>}
              {(!livePlayerProfile.focusAreas||livePlayerProfile.focusAreas.length===0)&&<div style={{fontSize:14,color:"var(--td)",textAlign:"center",padding:"16px 0"}}>No focus areas added yet.</div>}
            </div>
          </div>
        </div>}
      </div>}
      {/* Real bug: this modal used to be nested inside the isBlock-only
          "focus station" wrapper below, but the reminder button that opens
          it only ever renders for a plain (non-station) drill -- the two
          conditions (isBlock true vs. !isBlock) can never both hold at
          once, so the modal could never actually appear no matter what was
          clicked. Moved out to the same unconditional level as the other
          top-level live-view modals. */}
      {tagPickerLibraryId&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setTagPickerLibraryId(null);}}>
        <div className="modal">
          <div className="mhandle"/>
          <div className="mtitle">Add a Skill Tag</div>
          <div style={{fontSize:13,color:"var(--td)",marginBottom:12}}>This updates the drill in your library, so it's tagged going forward too.</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
            {availableSkillTags.map(t=>{
              const on=tagPickerSel.includes(t.id);
              return(<button key={t.id} type="button" onClick={()=>setTagPickerSel(s=>on?s.filter(id=>id!==t.id):[...s,t.id])} style={{padding:"6px 12px",borderRadius:20,border:"1.5px solid var(--b)",background:on?"var(--green)":"var(--s1)",color:on?"#fff":"var(--black)",fontSize:13,fontWeight:600,cursor:"pointer"}}>{t.name}</button>);
            })}
            {availableSkillTags.length===0&&<div style={{fontSize:13,color:"var(--td)"}}>No skill tags yet -- add one from Library first.</div>}
          </div>
          <button className="btn primary bmd bfull mb8" disabled={!tagPickerSel.length||tagPickerSaving} onClick={saveTagPicker}>{tagPickerSaving?"Saving...":"Save"}</button>
          <button className="btn ghost bmd bfull" onClick={()=>setTagPickerLibraryId(null)}>Cancel</button>
        </div>
      </div>}
      {/* Same dark practice-setup palette as the block-intro screen above --
          a rotation transition is another "getting organized, not
          coaching" moment. */}
      {isBlock&&inTrans&&rotatedStations&&<div style={{background:"#0d1512",borderRadius:"var(--r)",padding:"14px 12px",marginBottom:4}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:900,color:"#f87171",letterSpacing:".08em",textTransform:"uppercase",marginBottom:10}}>Rotate Now</div>
        {/* Direct feedback: a coach scanning card-by-card for "who's coming
            to my station" had to piece the whole rotation together in their
            head -- one summary line up top, the fixed area sequence every
            rotation in this block follows (station order never changes,
            only who's occupying each slot does), reads at a glance. */}
        {cur.stations.length>1&&<div style={{fontSize:17,fontWeight:800,color:"#fff",lineHeight:1.4,marginBottom:12,paddingBottom:12,borderBottom:"1px solid rgba(255,255,255,.1)"}}>
          {cur.stations.map((st,i)=>{
            const nextSt=cur.stations[(i+1)%cur.stations.length];
            const fromLoc=subName(st.sublocationId)||"Station "+(i+1);
            const toLoc=subName(nextSt.sublocationId)||"Station "+((i+1)%cur.stations.length+1);
            return fromLoc+" to "+toLoc;
          }).join(", ")}
        </div>}
        {rotatedStations.map((st,i)=>{
          const nextSt=cur.stations[(i+1)%cur.stations.length];
          const fromLoc=subName(st.sublocationId);
          const toLoc=subName(nextSt.sublocationId);
          const fromLabel="Station "+(i+1)+(fromLoc?": "+fromLoc:"")+(leadName(st)?" · "+leadName(st):"")+(st.activityName?" · "+st.activityName:"");
          const toLabel="Station "+((i+1)%cur.stations.length+1)+(toLoc?": "+toLoc:"")+(leadName(nextSt)?" · "+leadName(nextSt):"")+(nextSt.activityName?" · "+nextSt.activityName:"");
          const nextCatIds=categoryIdsForLibraryId(nextSt.libraryId);
          return (<div key={st.id} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.1)",borderRadius:"var(--r)",padding:"14px",marginBottom:8}}>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"#fff",lineHeight:1.2,marginBottom:6}}>{pnames(st.assignments)||"--"}</div>
            {st.groupLabel&&<div style={{marginBottom:4}}><span className="bdg bp">Group: {st.groupLabel}</span></div>}
            <div style={{fontSize:13,fontWeight:700,color:"#52b788",marginBottom:3}}>TO: <span style={{fontWeight:400}}>{toLabel}</span></div>
            <div style={{fontSize:12,fontWeight:700,color:"#8fa89b"}}>FROM: <span style={{fontWeight:400}}>{fromLabel}</span></div>
            {/* Direct feedback: a station leader tapping the group headed
                their way next should see that drill's skill-tag focus right
                here, without needing their phone once they're actually at
                the station -- same Player Focus modal a plain drill already
                shows, keyed to the destination station's own drill instead
                of the whole team's. */}
            {nextCatIds.length>0&&<button type="button" className="btn ghost bxs" style={{marginTop:8,background:"transparent",color:"#fff",borderColor:"rgba(255,255,255,.3)"}} onClick={()=>setTransitionFocus({libraryId:nextSt.libraryId,playerIds:st.assignments||[],label:toLabel})}>Player Focus</button>}
          </div>);
        })}
      </div>}
      {/* Mid-block and not on the last station yet: what's "next" for this
          practice is really the next rotation, not whatever activity
          follows the whole block -- showing that here would spoil it before
          it's actually relevant. Offer a local peek at the next transition
          instead of the real (session-wide) queue. */}
      {isBlock&&blockRotate&&!inBlockIntro&&!inTrans&&stIdx<n-1?(
        <>
          <div className="cc-queue-hdr"><span className="cc-queue-hdr-label">Up Next</span><span className="cc-queue-hdr-line"/></div>
          <div className="cc-queue">
            <button type="button" className="cc-queue-item" style={{width:"100%",border:"none",background:"none",cursor:"pointer",textAlign:"left"}} onClick={()=>setPreviewTrans(true)}>
              <span style={{fontSize:14,color:"var(--black2)"}}>Station rotation coming up</span>
              <span className="bdg bs">See next transition</span>
            </button>
          </div>
        </>
      ):(liveActs.slice(idx+1).length>0&&<>
        <div className="cc-queue-hdr"><span className="cc-queue-hdr-label">Up Next</span><span className="cc-queue-hdr-line"/></div>
        <div className="cc-queue" style={{maxHeight:220,overflowY:"auto"}}>
        {/* Direct feedback: any viewer should be able to peek at what's
            coming (equipment/location/rotations) without advancing --
            everything needed is already in liveActs (the local plan),
            resolved the same way the rest of this screen already resolves
            equipment/location/player ids. Player rotations specifically
            check session_groups first (fetchLatestGroups) -- a station
            block reassigned during Practice Setup or mid-live should
            preview the real current rotation, not the plan's original
            default, which fetchLatestGroups' own "latest batch wins"
            resolution already gives us for free. Direct feedback (second
            round): this used to cap at 3 -- now shows every remaining
            activity, scrollable, rather than hiding the tail of a longer
            practice. */}
        {liveActs.slice(idx+1).map(a=>(<button key={a.id} type="button" className="cc-queue-item" style={{width:"100%",border:"none",background:"none",cursor:"pointer",textAlign:"left"}} onClick={async()=>{
          let liveStationGroups=null;
          if(a.type==="station_block"&&session)liveStationGroups=await fetchLatestGroups(session.id,a.id);
          setPreviewUpcoming({
            name:a.type==="station_block"?(a.name||"Station Block"):a.name,
            durationMins:a.type==="station_block"?(a.stations.length*a.stationDuration+Math.max(0,a.stations.length-1)*a.transitionDuration):a.duration,
            locationName:subName(a.sublocationId)||"",
            equipmentNames:(Array.isArray(a.equipment)?a.equipment:[]).map(id=>{const x=(data.assets||[]).find(x=>x.id===id);return x?x.name:null;}).filter(Boolean),
            stations:a.type==="station_block"?a.stations.map((st,si)=>({name:st.name||"",locationName:subName(st.sublocationId)||"",coachName:leaderLabel(st,team),equipmentNames:(Array.isArray(st.equipment)?st.equipment:[]).map(id=>{const x=(data.assets||[]).find(x=>x.id===id);return x?x.name:null;}).filter(Boolean),playerNames:((liveStationGroups&&liveStationGroups.length)?(liveStationGroups[si]||[]):(st.assignments||[])).map(pid=>{const p=team&&team.players.find(p=>p.id===pid);return p?(p.jersey?"#"+p.jersey+" ":"")+p.firstName:null;}).filter(Boolean)})):[],
          });
        }}>
          <span style={{fontSize:14,color:"var(--td)"}}>{a.type==="station_block"?(a.name||"Station Block"):a.name}</span>
          <span className="bdg bs">{a.type==="station_block"?(a.stations.length*a.stationDuration+Math.max(0,a.stations.length-1)*a.transitionDuration)+"m":a.duration+"m"}</span>
        </button>))}
        </div>
      </>)}
      {previewUpcoming&&<UpcomingPreview item={previewUpcoming} onClose={()=>setPreviewUpcoming(null)}/>}
      {previewTrans&&rotatedStations&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setPreviewTrans(false);}}>
        <div className="modal">
          <div className="mhandle"/>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:900,color:"var(--red)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:10}}>Next Transition</div>
          <div style={{fontSize:12,color:"var(--td)",marginBottom:12}}>A preview only -- visible just to you, doesn't advance the practice.</div>
          {rotatedStations.map((st,i)=>{
            const nextSt=cur.stations[(i+1)%cur.stations.length];
            const fromLoc=subName(st.sublocationId);
            const toLoc=subName(nextSt.sublocationId);
            const fromLabel="Station "+(i+1)+(st.activityName?": "+st.activityName:"")+(leadName(st)?" · "+leadName(st):"")+(fromLoc?" · "+fromLoc:"");
            const toLabel="Station "+((i+1)%cur.stations.length+1)+(nextSt.activityName?": "+nextSt.activityName:"")+(leadName(nextSt)?" · "+leadName(nextSt):"")+(toLoc?" · "+toLoc:"");
            return (<div key={st.id} className="cc-trans-card">
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"var(--black)",lineHeight:1.2,marginBottom:6}}>{pnames(st.assignments)||"--"}</div>
              {st.groupLabel&&<div style={{marginBottom:4}}><span className="bdg bp">Group: {st.groupLabel}</span></div>}
              <div style={{fontSize:13,fontWeight:700,color:"var(--green)",marginBottom:3}}>TO: <span style={{fontWeight:400}}>{toLabel}</span></div>
              <div style={{fontSize:12,fontWeight:700,color:"var(--td)"}}>FROM: <span style={{fontWeight:400}}>{fromLabel}</span></div>
            </div>);
          })}
          <button className="btn ghost bmd bfull" style={{marginTop:8}} onClick={()=>setPreviewTrans(false)}>Close</button>
        </div>
      </div>}
      {reassignStationId&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget){setReassignStationId(null);setHelperDraft("");}}}>
        <div className="modal">
          <div className="mhandle"/>
          <div className="mtitle">Who's Leading This Station?</div>
          <button className="btn ghost bmd bfull" style={{marginBottom:8}} disabled={reassignBusy} onClick={()=>doSetLead(reassignStationId,{coachId:"",helperName:""})}>Unassign</button>
          {team&&team.coaches.map(c=>(<button key={c.id} className="btn outline bmd bfull" style={{marginBottom:8}} disabled={reassignBusy} onClick={()=>doSetLead(reassignStationId,{coachId:c.id,helperName:""})}>{c.name}</button>))}
          <div className="fld" style={{marginTop:4}}>
            <label className="lbl">Or a helper not on the roster</label>
            <div style={{display:"flex",gap:6}}>
              <input className="inp" style={{flex:1}} placeholder="Helper's name" autoFocus value={helperDraft} onChange={e=>setHelperDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&helperDraft.trim())doSetLead(reassignStationId,{coachId:"",helperName:helperDraft.trim()});}}/>
              <button className="btn primary bxs" disabled={!helperDraft.trim()||reassignBusy} onClick={()=>doSetLead(reassignStationId,{coachId:"",helperName:helperDraft.trim()})}>Set</button>
            </div>
          </div>
          <button className="btn ghost bmd bfull" style={{marginTop:8}} onClick={()=>{setReassignStationId(null);setHelperDraft("");}}>Cancel</button>
        </div>
      </div>}
      {showAudioPrompt&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setShowAudioPrompt(false);}}>
        <div className="modal">
          <div className="mhandle"/>
          <div className="mtitle">Turn On Audio?</div>
          <div style={{fontSize:13,color:"var(--td)",marginBottom:10}}>Run of Practice can call out the two-minute warning and time's up, so you don't need to keep watching the screen.</div>
        {/* Direct feedback: also remind the coach to turn their device's
            volume up. Browsers don't expose the device's actual output
            volume level to a web page (no Web Audio/media API reads system
            or hardware volume, only in-page gain) -- there's no way to tell
            whether it's already loud enough, so this always shows rather
            than only below some volume threshold. */}
        <div style={{fontSize:13,fontWeight:700,color:"var(--amber)",background:"var(--ambg)",border:"1.5px solid var(--ambb)",borderRadius:8,padding:"8px 10px",marginBottom:14}}>🔉 Reminder: Turn up your device's volume.</div>
          <button className="btn primary bmd bfull mb8" onClick={()=>{
            if(!audioOn){try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance("Audio on");u.rate=1;u.volume=1;window.speechSynthesis.speak(u);}catch(e){}startBgAudioSession();}
            spoken.current={};buzzedRef.current=false;warnedRef.current=false;setAudioOn(true);setShowAudioPrompt(false);
          }}>🔊 Turn On Audio</button>
          <button className="btn ghost bmd bfull" onClick={()=>{setAudioOn(false);setShowAudioPrompt(false);}}>🔇 Keep Audio Off</button>
        </div>
      </div>}
      {showStationWarning&&!showAudioPrompt&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setShowStationWarning(false);}}>
        <div className="modal">
          <div className="mhandle"/>
          <div className="mtitle">{unassignedStations.length===1?"A Station Has No Leader":unassignedStations.length+" Stations Have No Leader"}</div>
          <div style={{fontSize:13,color:"var(--td)",marginBottom:14}}>That's fine if players there are independent enough to work unsupervised -- otherwise assign a coach or helper now, and share the live link with them right away.</div>
          {unassignedStations.map(st=>(<div key={st.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"10px 12px",marginBottom:8}}>
            <div style={{fontWeight:700,fontSize:14}}>{st.name||"Station"}</div>
            <div className="row" style={{gap:6}}>
              <button className="btn outline bxs" onClick={()=>{setShowStationWarning(false);setReassignStationId(st.id);}}>Assign</button>
              <button className="btn ghost bxs" onClick={()=>shareLive("helper_read")}>Share Link</button>
            </div>
          </div>))}
          <button className="btn primary bmd bfull" style={{marginTop:4}} onClick={()=>setShowStationWarning(false)}>Leave As-Is For Now</button>
        </div>
      </div>}
      {showPlayerFocus&&cur&&<div className="movly" onClick={()=>setShowPlayerFocus(false)}>
        <div className="modal" onClick={e=>e.stopPropagation()}>
          <div className="mhandle"/>
          <div className="mtitle">Player Focus</div>
          <div style={{fontSize:13,color:"var(--td)",marginBottom:12}}>What each present player is working on for {tagNamesForLibraryId(cur.libraryId).join(", ")||"this drill"}.</div>
          {(()=>{
            const catIds=categoryIdsForLibraryId(cur.libraryId);
            const present=(team?team.players:[]).filter(p=>presentIds.has(p.id));
            const withNotes=present.map(p=>({p,notes:(p.focusAreas||[]).filter(a=>catIds.includes(a.categoryId)&&a.note)})).filter(x=>x.notes.length>0);
            if(!withNotes.length)return <div style={{fontSize:14,color:"var(--td)",textAlign:"center",padding:"16px 0"}}>No player notes set for this yet.</div>;
            return withNotes.map(({p,notes})=>(<div key={p.id} style={{marginBottom:8,padding:"10px 12px",background:"var(--s2)",borderRadius:"var(--rs)"}}>
              <div style={{fontSize:14,fontWeight:700,color:"var(--black)"}}>{p.jersey?"#"+p.jersey+" ":""}{p.firstName}</div>
              {notes.map(n=>(<div key={n.id} style={{fontSize:13,color:"var(--black2)",marginTop:2}}>{n.note}</div>))}
            </div>));
          })()}
          <button className="btn ghost bmd bfull" style={{marginTop:8}} onClick={()=>setShowPlayerFocus(false)}>Close</button>
        </div>
      </div>}
      {transitionFocus&&<div className="movly" onClick={()=>setTransitionFocus(null)}>
        <div className="modal" onClick={e=>e.stopPropagation()}>
          <div className="mhandle"/>
          <div className="mtitle">Player Focus -- {transitionFocus.label}</div>
          <div style={{fontSize:13,color:"var(--td)",marginBottom:12}}>What this group is working on for {tagNamesForLibraryId(transitionFocus.libraryId).join(", ")||"this drill"}.</div>
          {(()=>{
            const catIds=categoryIdsForLibraryId(transitionFocus.libraryId);
            const incoming=(team?team.players:[]).filter(p=>(transitionFocus.playerIds||[]).includes(p.id));
            const withNotes=incoming.map(p=>({p,notes:(p.focusAreas||[]).filter(a=>catIds.includes(a.categoryId)&&a.note)})).filter(x=>x.notes.length>0);
            if(!withNotes.length)return <div style={{fontSize:14,color:"var(--td)",textAlign:"center",padding:"16px 0"}}>No player notes set for this yet.</div>;
            return withNotes.map(({p,notes})=>(<div key={p.id} style={{marginBottom:8,padding:"10px 12px",background:"var(--s2)",borderRadius:"var(--rs)"}}>
              <div style={{fontSize:14,fontWeight:700,color:"var(--black)"}}>{p.jersey?"#"+p.jersey+" ":""}{p.firstName}</div>
              {notes.map(n=>(<div key={n.id} style={{fontSize:13,color:"var(--black2)",marginTop:2}}>{n.note}</div>))}
            </div>));
          })()}
          <button className="btn ghost bmd bfull" style={{marginTop:8}} onClick={()=>setTransitionFocus(null)}>Close</button>
        </div>
      </div>}
    </div>
    <div className="cc-note-bar" style={{position:"relative"}}>
      <input ref={noteTaRef} className="inp" placeholder="Quick note... (@ to tag a player)" value={noteText} onChange={onNoteTextChange} onKeyDown={e=>e.key==="Enter"&&noteMentionQuery===null&&addNote()} style={{fontSize:14}}/>
      <button className="btn primary bsm" onClick={addNote} disabled={savingNote}>{savingNote?"Saving...":"Save"}</button>
      {/* Real bug: .mini-menu's own CSS always sets top:calc(100% - 4px)
          (it opens downward everywhere else it's used) -- overriding only
          `bottom` here left both top and bottom pinned at once, an
          inconsistent box the browser was rendering with ~zero height, so
          the picker existed in the DOM but was effectively invisible.
          Clearing `top` alongside `bottom` fixes it. */}
      {noteMentionQuery!==null&&noteMentionMatches.length>0&&<div className="mini-menu" style={{position:"absolute",top:"auto",bottom:"100%",left:0,right:0,zIndex:5,maxHeight:160,overflowY:"auto"}}>{noteMentionMatches.map(p=>(<button key={p.id} type="button" className="mm-item" onClick={()=>pickNoteMention(p)}>{p.firstName} {p.lastName}</button>))}</div>}
    </div>
    {noteError&&<div style={{padding:"0 14px 8px",fontSize:12,color:"var(--red)"}}>{noteError}</div>}
    {showShare&&shareToken&&<ShareSheet token={shareToken} scope={shareScope} onClose={()=>setShowShare(false)} title={"Help with the "+(practice&&practice.date?new Date(practice.date+"T12:00:00").toLocaleDateString(undefined,{month:"long",day:"numeric"})+" ":"")+(team?team.name+" ":"")+"Run of Practice"}/>}
  </div>);
}
