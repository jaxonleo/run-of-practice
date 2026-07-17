import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider, Navigate, Outlet, useNavigate, useParams, useBlocker } from "react-router-dom";
import Layout from "./Layout.jsx";
import PlanScreen from "./components/PlanScreen.jsx";
import TeamsListScreen from "./components/TeamsListScreen.jsx";
import SettingsScreen, { EquipmentTab } from "./components/SettingsScreen.jsx";
import { Ic } from "./icons.jsx";
import { loadData, saveData, flushSave, setCoachKey, sendEmailOtp, verifyEmailOtp, getCurrentSession, onAuthStateChange, signOut, fetchMyTeams, archivePlayer, archiveStaff, archiveTeam, addPlayerFocusArea, removePlayerFocusArea, createSkillTag, fetchLibraryData, fetchLocations, fetchPracticesFull, fetchTemplatesFull, archiveTemplate, savePracticeTree, deactivateOwnAccount, reactivateIfNeeded, ensureDefaultSkillTags, fetchOwnProfile, updateOwnProfile, fetchPlannedAbsences, checkIsAdmin } from "./supabase.js";
import { uid, fmt12, fmt, actSecs, sumMins, shuffle, mkGroups, rebalanceKeep, rebalanceEven, SPORTS, INIT, migrateData, isHeadCoach, localDateStr, stripIdsForCopy } from "./constants.js";
import ModalLayer from "./components/ModalLayer.jsx";
import NewLibraryScreen from "./components/NewLibraryScreen.jsx";
import { ActConfig, ChecklistConfig, StationConfig } from "./components/ActivityConfigs.jsx";
import CommandScreen, { HelperView, HistoryViewer, PreviewView } from "./components/CommandScreen.jsx";
import HomeScreen from "./components/HomeScreen.jsx";
import ScheduleScreen from "./components/ScheduleScreen.jsx";
import AbsencePicker from "./components/AbsencePicker.jsx";
import LandingPage from "./components/LandingPage.jsx";
import { TermsPage, PrivacyPage } from "./components/LegalPages.jsx";
import FounderMetricsScreen from "./components/FounderMetricsScreen.jsx";

// INIT, DEMO_INIT, migrateData, uid, fmt, sumMins, etc. imported from constants.js

// "Run Again" copies a past practice's activities into a brand-new one --
// every nested id (activity, station) must be regenerated as a fresh local
// id first, or savePracticeTree's isDbId check would treat them as
// already-saved rows belonging to the OLD practice and silently reparent
// (steal) them instead of inserting real copies. (stripIdsForCopy lives in
// constants.js so ScheduleScreen's own History routing can reuse it too.)

const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=DM+Mono:wght@400;500&family=Barlow:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
:root{
  --bg:#f7f8f6;--s1:#fff;--s2:#f0f2ee;--s3:#e6e9e2;--b:#d8ddd3;
  --green:#2d6a4f;--green2:#40916c;--gbg:#eaf4ef;--gb:#b7d5c8;
  --black:#111714;--black2:#2c3830;--red:#c0392b;--rbg:#fdf0ef;--rb:#f5c6c2;
  --amber:#b45309;--ambg:#fffbeb;--ambb:#fde68a;
  --tm:#5a6b62;--td:#8a9e94;--r:10px;--rs:6px;--tab:58px;
}
body{background:var(--bg);color:var(--black);font-family:'Barlow',sans-serif;font-size:15px;}
.app{display:flex;flex-direction:column;height:100dvh;max-width:480px;margin:0 auto;overflow:hidden;}
.screen{flex:1;overflow-y:auto;overflow-x:hidden;padding:14px 14px calc(var(--tab)+80px);scrollbar-width:none;}
.screen::-webkit-scrollbar{display:none;}
.tabbar{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;height:var(--tab);background:var(--s1);border-top:1px solid var(--b);display:flex;z-index:100;padding-bottom:env(safe-area-inset-bottom,0);}
.live-resume{position:fixed;bottom:var(--tab);left:50%;transform:translateX(-50%);width:100%;max-width:480px;z-index:99;background:var(--green);color:#fff;display:flex;align-items:center;justify-content:center;gap:8px;padding:9px 14px;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border:none;border-top:1px solid rgba(255,255,255,.15);}
.ti{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:none;border:none;cursor:pointer;color:var(--td);font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:4px 2px;position:relative;}
.ti.on{color:var(--green);}.ti svg{width:20px;height:20px;stroke-width:1.8;stroke:var(--td);}.ti.on svg{stroke:var(--green);}
.phdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.ptitle{font-size:26px;font-weight:900;letter-spacing:.02em;font-family:'Barlow Condensed',sans-serif;}
.card{background:var(--s1);border:1px solid var(--b);border-radius:var(--r);padding:14px;margin-bottom:10px;}
.clbl{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--td);margin-bottom:8px;}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:none;border-radius:var(--rs);cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;transition:opacity .12s;}
.btn:active{opacity:.7;}
.bxs{padding:4px 10px;font-size:11px;min-height:28px;}.bsm{padding:7px 14px;font-size:13px;min-height:34px;}.bmd{padding:10px 18px;font-size:15px;min-height:40px;}.blg{padding:14px 20px;font-size:17px;min-height:50px;}
.primary{background:var(--green);color:#fff;}.primary:active{background:var(--green2);}
.ghost{background:var(--s2);color:var(--black2);border:1px solid var(--b);}.ghost:active{background:var(--s3);}
.danger{background:var(--rbg);color:var(--red);border:1px solid var(--rb);}
.success{background:var(--gbg);color:var(--green);border:1px solid var(--gb);}
.outline{background:#fff;color:var(--green);border:1.5px solid var(--green);}.outline:active{background:var(--gbg);}
.warn{background:var(--ambg);color:var(--amber);border:1px solid var(--ambb);}
.brow{display:flex;gap:8px;}.brow .btn{flex:1;}.bfull{width:100%;}
.fld{margin-bottom:10px;}
.lbl{display:block;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--td);margin-bottom:4px;}
.inp,.sel,.ta{width:100%;background:#fff;border:1.5px solid var(--b);border-radius:var(--rs);color:var(--black);padding:10px 12px;font-family:'Barlow',sans-serif;font-size:16px;-webkit-appearance:none;}
.inp:focus,.sel:focus,.ta:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px var(--gbg);}
.ta{resize:vertical;min-height:58px;}
.sel{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7'%3E%3Cpath fill='%238a9e94' d='M5 7L0 0h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:30px;}
.sel option{background:#fff;color:var(--black);}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
.li{display:flex;align-items:center;padding:11px 12px;border:1px solid var(--b);border-radius:var(--r);margin-bottom:7px;background:#fff;gap:9px;}
.li.tap{cursor:pointer;}.li.tap:active{background:var(--s2);}
.lim{flex:1;min-width:0;}.lin{font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.limt{font-size:12px;color:var(--td);margin-top:2px;}
.lir{display:flex;align-items:center;gap:6px;flex-shrink:0;}
.bdg{display:inline-flex;align-items:center;padding:3px 8px;border-radius:4px;font-size:11px;font-family:'DM Mono',monospace;font-weight:500;}
.bp{background:var(--gbg);color:var(--green);border:1px solid var(--gb);}
.bs{background:var(--s2);color:var(--tm);border:1px solid var(--b);}
.bk{background:var(--black);color:#fff;}
.cgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px;}
.chip{display:flex;flex-direction:column;align-items:center;padding:8px 4px;border:1.5px solid var(--b);border-radius:var(--rs);background:#fff;cursor:pointer;min-height:48px;justify-content:center;}
.chip.on{border-color:var(--green);background:var(--gbg);}
.cn{font-family:'DM Mono',monospace;font-size:13px;color:var(--tm);}.chip.on .cn{color:var(--green);}
.cf{font-size:11px;font-weight:600;margin-top:1px;color:var(--tm);}.chip.on .cf{color:var(--green);}
.itabs{display:flex;border-bottom:1.5px solid var(--b);margin-bottom:14px;}
.itab{padding:9px 14px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--td);cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-1.5px;background:none;border-top:none;border-left:none;border-right:none;}
.itab.on{color:var(--green);border-bottom-color:var(--green);}
.ablk{border:1px solid var(--b);border-radius:var(--r);margin-bottom:9px;overflow:hidden;background:#fff;}
.abhdr{display:flex;align-items:center;padding:11px 12px;background:var(--s2);gap:8px;cursor:pointer;user-select:none;}
.abhdr:active{background:var(--s3);}.abbody{padding:12px;border-top:1px solid var(--b);background:#fff;}
.dh{color:var(--b2);padding:4px;flex-shrink:0;display:flex;align-items:center;cursor:grab;}
.sechdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.sectitle{font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tm);}
.pill{background:var(--gbg);border:1px solid var(--gb);border-radius:20px;padding:4px 12px;font-family:'DM Mono',monospace;font-size:12px;color:var(--green);}
.pill.over{background:var(--rbg);border-color:var(--rb);color:var(--red);}
.confirm-box{background:var(--rbg);border:1.5px solid var(--rb);border-radius:var(--r);padding:14px;margin-top:8px;}
.confirm-title{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:var(--red);margin-bottom:4px;}
.confirm-body{font-size:13px;color:var(--black2);margin-bottom:12px;line-height:1.5;}
.ell-btn{background:none;border:none;cursor:pointer;padding:6px 8px;display:flex;flex-direction:column;gap:3.5px;align-items:center;border-radius:4px;flex-shrink:0;}
.ell-btn:active{background:var(--s2);}
.ell-btn span{display:block;width:4px;height:4px;border-radius:50%;background:var(--td);}
.mini-menu{position:absolute;right:8px;top:calc(100% - 4px);background:#fff;border:1px solid var(--b);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:50;min-width:120px;overflow:hidden;}
.mm-item{display:block;width:100%;padding:11px 14px;background:none;border:none;cursor:pointer;font-family:'Barlow',sans-serif;font-size:14px;font-weight:500;text-align:left;color:var(--black);}
.mm-item:active{background:var(--s2);}.mm-danger{color:var(--red);}
.sort-btn{background:none;border:1px solid var(--b);border-radius:6px;padding:5px 7px;cursor:pointer;display:inline-flex;align-items:center;color:var(--td);}
.sport-group{margin-bottom:4px;}
.sport-hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--s2);border:1px solid var(--b);border-radius:var(--r);cursor:pointer;margin-bottom:6px;}
.sport-hdr:active{background:var(--s3);}
.sport-name{font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--black2);}
.movly{position:fixed;inset:0;background:rgba(17,23,20,.55);display:flex;align-items:flex-end;justify-content:center;z-index:200;}
.modal{background:#fff;border:1px solid var(--b);border-radius:16px 16px 0 0;padding:18px 16px;width:100%;max-width:480px;max-height:88dvh;overflow-y:auto;}
.mhandle{width:38px;height:4px;background:var(--b);border-radius:2px;margin:0 auto 16px;}
.mtitle{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;margin-bottom:14px;}
.mfooter{display:flex;gap:8px;margin-top:14px;}.mfooter .btn{flex:1;}
.gpreview{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0;}
.gcard{background:var(--bg);border:1px solid var(--b);border-radius:var(--rs);padding:10px;}
.gcardtitle{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:var(--td);margin-bottom:5px;letter-spacing:.06em;text-transform:uppercase;}
.gplayer{font-size:13px;padding:2px 0;}
.notec{background:#fff;border:1px solid var(--b);border-radius:var(--r);padding:11px 12px;margin-bottom:7px;}
.notect{font-size:11px;font-family:'DM Mono',monospace;color:var(--td);margin-bottom:3px;}
.notetx{font-size:14px;line-height:1.5;}
.empty{text-align:center;padding:36px 20px;color:var(--td);}
.emtx{font-size:14px;line-height:1.5;}
.live{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 1.5s infinite;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.row{display:flex;align-items:center;gap:8px;}
.mt6{margin-top:6px;}.mt8{margin-top:8px;}.mb8{margin-bottom:8px;}.mb10{margin-bottom:10px;}
.td{color:var(--td);}.tm{color:var(--tm);}.tg{color:var(--green);}
.att-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;}
.att-btn{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid var(--b);border-radius:8px;cursor:pointer;background:var(--s2);text-align:left;width:100%;}
.att-btn.on{background:var(--gbg);border-color:var(--green);}
.att-circle{width:26px;height:26px;border-radius:50%;background:var(--b2);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.att-circle.on{background:var(--green);}
.ccs{display:flex;flex-direction:column;height:100%;overflow:hidden;padding-bottom:0;}
.cc-header{padding:8px 14px;background:var(--s1);border-bottom:1px solid var(--b);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.cc-act-name{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;line-height:1;}
.cc-timer-row{padding:4px 14px;display:flex;align-items:center;gap:12px;flex-shrink:0;}
.cc-timer{font-family:'DM Mono',monospace;font-size:64px;font-weight:500;line-height:1;color:var(--green);}
.cc-timer.urg{color:var(--red);}.cc-timer.over{color:var(--red);animation:pulse .8s infinite;}
.cc-prog{height:4px;background:var(--s2);flex-shrink:0;}
.cc-prog-bar{height:100%;background:var(--green);transition:width .5s linear;}
.cc-prog-bar.over{background:var(--red);}
.cc-controls{padding:6px 14px;display:flex;gap:8px;flex-shrink:0;}
.cc-body{flex:1;overflow-y:auto;padding:0 14px 8px;display:flex;flex-direction:column;gap:10px;}
.cc-focus{background:var(--gbg);border:1.5px solid var(--gb);border-radius:var(--r);padding:14px;}
.cc-focus-lbl{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--green2);margin-bottom:6px;}
.cc-focus-txt{font-size:17px;font-weight:600;color:var(--black);line-height:1.5;}
.cc-st-card{background:#fff;border:1px solid var(--b);border-radius:var(--r);padding:12px;margin-bottom:6px;}
.cc-st-card.active{border-color:var(--green);background:var(--gbg);}
.cc-st-name{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;}
.cc-st-detail{font-size:13px;color:var(--tm);margin-top:4px;line-height:1.7;}
.cc-trans-card{background:#fff;border:1.5px solid var(--b);border-radius:var(--r);padding:14px;margin-bottom:8px;}
.cc-trans-names{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;color:var(--black);line-height:1.2;margin-bottom:6px;}
.cc-trans-to{font-size:14px;color:var(--green);font-weight:600;}
.cc-trans-sub{font-size:12px;color:var(--td);margin-top:2px;}
.cc-queue{background:var(--s2);border-radius:var(--r);overflow:hidden;}
.cc-queue-item{padding:8px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--b);}
.cc-queue-item:last-child{border-bottom:none;}
.cc-note-bar{padding:6px 14px;display:flex;gap:7px;flex-shrink:0;background:var(--s1);border-top:1px solid var(--b);}
.cc-end{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;text-align:center;flex:1;}
.cl-item{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid var(--b);cursor:pointer;}
.cl-item:last-child{border-bottom:none;}
.cl-check{width:26px;height:26px;border-radius:50%;border:2px solid var(--b);background:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
.cl-check.done{background:var(--green);border-color:var(--green);}
.cl-text{font-size:16px;line-height:1.5;flex:1;}.cl-text.done{text-decoration:line-through;color:var(--td);}
`;

// Shared app state (data, coachId, navigation helpers, etc.) for every route
// wrapper below Layout -- the router is created once via useMemo (recreating
// it on every render would reset navigation state), so route elements can't
// close over fresh render-time values directly. Route wrapper components
// read this instead of receiving props from a re-rendered parent.
export const AppCtx=createContext(null);
export const useAppCtx=()=>useContext(AppCtx);

// The team workspace's "Team" tab (roster/practices/history). Was the old
// Manage screen; its top-level list mode (My Teams / Locations / Equipment /
// Gear / Account) is gone -- team picking moved to /teams, everything else
// moved to /settings (SettingsScreen.jsx) in the 2026-07-15 nav restructure.
// Team tab (nav restructure round 2, 2026-07-15): "people, places, and
// things" for one team -- Roster (players + coaches/helpers, via the
// existing RostersTab) and Equipment (team equipment + player gear,
// sport-filtered to this team -- see EquipmentTab's own comment on why).
// Practices and History are gone from here entirely: Schedule already
// covers both (forward-looking agenda/month and its own collapsible
// completed/history section), so this was pure duplication, not a second
// source of truth worth keeping. Locations and Skill Tags stayed in
// Settings on purpose (a location or a skill tag isn't owned by one team,
// unlike equipment/gear/roster).
function ManageScreen({data,update,coachId,openModal,refreshTeams,refreshLibrary,initialTeamId}){
  const navigate=useNavigate();
  // initialTeamId (from /team/:teamId/team) jumps straight into that team's
  // workspace -- same fixedTeamId precedent RostersTab already uses.
  const [selectedTeam,setSelectedTeam]=useState(initialTeamId||null);
  useEffect(()=>{if(initialTeamId&&initialTeamId!==selectedTeam)setSelectedTeam(initialTeamId);},[initialTeamId]);
  const [teamTab,setTeamTab]=useState("roster");
  // If the selected team was just deleted (e.g. via the Roster tab's
  // Delete Team), this route's teamId no longer resolves -- leave for the
  // Teams list instead of rendering blank.
  useEffect(()=>{if(selectedTeam&&!data.teams.some(t=>t.id===selectedTeam))navigate("/teams");},[selectedTeam,data.teams]);
  if(selectedTeam){
    const team=data.teams.find(t=>t.id===selectedTeam);
    if(!team)return null;
    const TTABS=["roster","equipment"];
    return (<div style={{paddingBottom:80}}>
      <div style={{padding:"8px 16px 12px"}}>
        <div style={{borderLeft:"4px solid "+(team.colorPrimary||"transparent"),paddingLeft:10,marginBottom:14}}>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,lineHeight:1,marginBottom:2}}>{team.name}</div>
          <div style={{fontSize:13,color:"var(--td)"}}>{team.sport} - {team.players.length} players</div>
        </div>
        <div style={{display:"flex",gap:0,background:"var(--s2)",borderRadius:"var(--r)",padding:3,marginBottom:16}}>
          {TTABS.map(t=>(<button key={t} onClick={()=>setTeamTab(t)} style={{flex:1,padding:"8px 0",border:"none",cursor:"pointer",borderRadius:"calc(var(--r) - 2px)",background:teamTab===t?"#fff":"transparent",fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".04em",textTransform:"uppercase",color:teamTab===t?"var(--black)":"var(--td)"}}>{t}</button>))}
        </div>
        {teamTab==="roster"&&<div><RostersTab data={data} update={update} openModal={openModal} fixedTeamId={selectedTeam} refreshTeams={refreshTeams} coachId={coachId} refreshLibrary={refreshLibrary}/></div>}
        {teamTab==="equipment"&&<EquipmentTab data={data} coachId={coachId} refreshLibrary={refreshLibrary} openModal={openModal} sportFilter={team.sport}/>}
      </div>
    </div>);
  }
  // No list mode anymore: this component is only mounted with a teamId in
  // the URL, and the deleted-team effect above navigates away when it stops
  // resolving -- render nothing during that redirect tick.
  return null;
}

function AuthScreen({onBack}){
  const [email,setEmail]=useState("");
  const [code,setCode]=useState("");
  const [sent,setSent]=useState(false);
  const [sending,setSending]=useState(false);
  const [verifying,setVerifying]=useState(false);
  const [error,setError]=useState("");
  const send=async()=>{
    if(!email.trim()||sending)return;
    setSending(true);setError("");
    const { error }=await sendEmailOtp(email.trim());
    setSending(false);
    if(error){setError(error.message||"Something went wrong. Try again.");return;}
    setSent(true);
  };
  const verify=async()=>{
    if(!code.trim()||verifying)return;
    setVerifying(true);setError("");
    let { error }=await verifyEmailOtp(email.trim(),code.trim());
    if(error){
      // Observed in the wild: the very first verify of an otherwise-correct
      // code fails, and resubmitting the identical code immediately after
      // succeeds -- a transient hiccup on that first call, not a wrong or
      // stale code (same string both times). One silent retry means the
      // coach never has to notice or resubmit by hand.
      await new Promise(r=>setTimeout(r,800));
      ({ error }=await verifyEmailOtp(email.trim(),code.trim()));
    }
    setVerifying(false);
    if(error){
      // If the first attempt actually succeeded server-side and only the
      // response was lost, the retry above would fail with "already used"
      // even though we're signed in -- don't show an error in that case.
      const existing=await getCurrentSession();
      if(existing)return;
      setError(error.message||"That code didn't work. Check it and try again.");
      return;
    }
    // onAuthStateChange picks up the new session automatically.
  };
  return (<div style={{height:"100dvh",display:"flex",flexDirection:"column",background:"var(--black)",overflowY:"auto"}}>
    {onBack&&<button onClick={onBack} style={{position:"absolute",top:16,left:16,background:"rgba(255,255,255,.08)",border:"none",borderRadius:"50%",width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#fff",fontSize:18,zIndex:10}}>&#8249;</button>}
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px 24px"}}>
      <div style={{width:96,height:96,borderRadius:22,overflow:"hidden",marginBottom:20,boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}>
        <img src="/apple-touch-icon.png" style={{width:"100%",height:"100%",objectFit:"cover"}} alt="Run of Practice"/>
      </div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:38,fontWeight:900,color:"#fff",letterSpacing:"-.01em",lineHeight:1,marginBottom:6,textAlign:"center"}}>Run of Practice</div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:14,fontWeight:600,letterSpacing:".12em",textTransform:"uppercase",color:"var(--green)",textAlign:"center"}}>Organize. Execute. Elevate.</div>
    </div>
    <div style={{background:"#fff",borderRadius:"24px 24px 0 0",padding:"28px 20px 48px"}}>
      <div style={{width:36,height:4,background:"var(--b)",borderRadius:2,margin:"0 auto 24px"}}/>
      {!sent&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,marginBottom:4}}>Welcome, Coach</div>
        <div style={{fontSize:14,color:"var(--td)",marginBottom:20}}>Enter your email — we'll send you a sign-in code.</div>
        <div className="fld mb10">
          <label className="lbl">Email</label>
          <input className="inp" autoFocus type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")send();}}/>
        </div>
        {error&&<div style={{fontSize:13,color:"var(--red)",marginBottom:10}}>{error}</div>}
        <button className="btn primary bmd bfull" onClick={send} disabled={!email.trim()||sending}>{sending?"Sending...":"Send Code"}</button>
        <div style={{fontSize:11,color:"var(--td)",marginTop:12,textAlign:"center",lineHeight:1.5}}>By continuing you agree to our <a href="/terms" style={{color:"var(--green)"}}>Terms</a> and <a href="/privacy" style={{color:"var(--green)"}}>Privacy Policy</a>.</div>
      </div>}
      {sent&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,marginBottom:4}}>Enter your code</div>
        <div style={{fontSize:14,color:"var(--td)",marginBottom:20,lineHeight:1.5}}>We sent a code to <strong>{email}</strong>. Enter the full code exactly as it appears in the email.</div>
        <div className="fld mb10">
          <label className="lbl">Code</label>
          <input className="inp" autoFocus type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="Enter code" value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")verify();}}/>
        </div>
        {error&&<div style={{fontSize:13,color:"var(--red)",marginBottom:10}}>{error}</div>}
        <button className="btn primary bmd bfull" onClick={verify} disabled={!code.trim()||verifying} style={{marginBottom:10}}>{verifying?"Verifying...":"Verify & Sign In"}</button>
        <button className="btn ghost bmd bfull" onClick={()=>{setSent(false);setCode("");setError("");}}>Use a different email</button>
      </div>}
    </div>
  </div>);
}
function NameScreen({onSave}){
  const [firstName,setFirstName]=useState("");
  const [lastName,setLastName]=useState("");
  const [saving,setSaving]=useState(false);
  const save=async()=>{
    if(!firstName.trim()||saving)return;
    setSaving(true);
    await onSave(firstName.trim(),lastName.trim());
    setSaving(false);
  };
  return (<div style={{height:"100dvh",display:"flex",flexDirection:"column",background:"var(--black)",overflowY:"auto"}}>
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px 24px"}}>
      <div style={{width:96,height:96,borderRadius:22,overflow:"hidden",marginBottom:20,boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}>
        <img src="/apple-touch-icon.png" style={{width:"100%",height:"100%",objectFit:"cover"}} alt="Run of Practice"/>
      </div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,color:"#fff",letterSpacing:"-.01em",lineHeight:1,marginBottom:6,textAlign:"center"}}>What should we call you?</div>
    </div>
    <div style={{background:"#fff",borderRadius:"24px 24px 0 0",padding:"28px 20px 48px"}}>
      <div style={{width:36,height:4,background:"var(--b)",borderRadius:2,margin:"0 auto 24px"}}/>
      <div style={{fontSize:14,color:"var(--td)",marginBottom:20}}>We'll use this to greet you instead of your email.</div>
      <div className="fld mb10">
        <label className="lbl">First name</label>
        <input className="inp" autoFocus type="text" placeholder="Alex" value={firstName} onChange={e=>setFirstName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")save();}}/>
      </div>
      <div className="fld mb10">
        <label className="lbl">Last name (optional)</label>
        <input className="inp" type="text" placeholder="Rivera" value={lastName} onChange={e=>setLastName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")save();}}/>
      </div>
      <button className="btn primary bmd bfull" onClick={save} disabled={!firstName.trim()||saving}>{saving?"Saving...":"Continue"}</button>
    </div>
  </div>);
}
export default function App(){
  const [data,setData]=useState(INIT);
  useEffect(()=>{let el=document.getElementById('rop-css');if(!el){el=document.createElement('style');el.id='rop-css';document.head.appendChild(el);}el.textContent=CSS;},[]);
  const [loaded,setLoaded]=useState(false);
  const [modal,setModal]=useState(null);
  const [liveId,setLiveId]=useState(null);
  const [editPracticeId,setEditPracticeId]=useState(null);
  const [startTemplateId,setStartTemplateId]=useState(null);
  const [session,setSession]=useState(undefined); // undefined=loading, null=signed out, object=signed in
  const [wantsAuth,setWantsAuth]=useState(false);
  const update=useCallback(fn=>{setData(d=>{const nx=fn(JSON.parse(JSON.stringify(d)));saveData(nx);return nx;});},[]);
  useEffect(()=>{
    getCurrentSession().then(setSession);
    const sub=onAuthStateChange(s=>setSession(s));
    return ()=>sub.unsubscribe();
  },[]);
  const coachId=session?session.user.id:null;
  // "Come back and everything's still there" -- signing in again is the
  // entire reactivation flow, no separate confirmation step.
  useEffect(()=>{if(coachId)reactivateIfNeeded(coachId);},[coachId]);
  // Idempotent server-side, so re-running on every sign-in is cheap and
  // means a coach picks up starter skill tags for any sport/category added
  // after their account was first created, not just at signup.
  useEffect(()=>{if(coachId)ensureDefaultSkillTags(coachId);},[coachId]);
  const [profile,setProfile]=useState(null);
  useEffect(()=>{
    if(!coachId){setProfile(null);return;}
    fetchOwnProfile(coachId).then(setProfile);
  },[coachId]);
  const saveName=useCallback(async(firstName,lastName)=>{
    await updateOwnProfile(coachId,{firstName,lastName});
    setProfile(p=>Object.assign({},p,{first_name:firstName,last_name:lastName||null}));
  },[coachId]);
  const handleDeactivate=useCallback(async()=>{
    await deactivateOwnAccount(coachId);
    await signOut();
  },[coachId]);
  useEffect(()=>{
    if(!coachId){setLoaded(false);return;}
    setCoachKey(coachId);
    loadData().then(raw=>{
      if(raw===null){const seeded=migrateData(JSON.parse(JSON.stringify(INIT)));setData(seeded);flushSave(seeded);}
      else{setData(migrateData(raw));}
      setLoaded(true);
    });
  },[coachId]);
  const [teams,setTeams]=useState([]);
  const refreshTeams=useCallback(async()=>{
    if(!coachId)return;
    setTeams(await fetchMyTeams());
  },[coachId]);
  useEffect(()=>{refreshTeams();},[refreshTeams]);
  const [library,setLibrary]=useState({assets:[],skillCategories:[],skillTags:[],activityLibrary:[],myOrgs:[],profilesById:{}});
  const refreshLibrary=useCallback(async()=>{
    if(!coachId)return;
    setLibrary(await fetchLibraryData());
  },[coachId]);
  useEffect(()=>{refreshLibrary();},[refreshLibrary]);
  const [planning,setPlanning]=useState({locations:[],practices:[],templates:[]});
  const refreshPlanning=useCallback(async()=>{
    if(!coachId)return;
    const [locations,practices,templates]=await Promise.all([fetchLocations(),fetchPracticesFull(),fetchTemplatesFull()]);
    setPlanning({locations,practices,templates});
  },[coachId]);
  useEffect(()=>{refreshPlanning();},[refreshPlanning]);
  const fullData=useMemo(()=>Object.assign({},data,{teams},library,planning),[data,teams,library,planning]);
  const openModal=(t,p)=>setModal({type:t,payload:p||{}});
  const closeModal=()=>setModal(null);
  const coachName=profile&&profile.first_name?profile.first_name:(session?(session.user.email||"Coach"):"Coach");
  const coachEmailStr=profile&&profile.email?profile.email:(session?session.user.email:"");

  // Router is created once (empty deps) -- recreating it on every render
  // would reset in-flight navigation/blocker state. Route elements read
  // current data/callbacks from AppCtx instead of closing over this render's
  // values. /live/:token, /preview/:token, /terms, /privacy are top-level
  // siblings of the authed shell (not nested under it) so they render
  // regardless of auth/loading state, exactly like the old regex checks did.
  const router=useMemo(()=>createBrowserRouter(createRoutesFromElements(
    <>
      <Route path="/live/:token" element={<HelperViewRoute/>}/>
      <Route path="/preview/:token" element={<PreviewViewRoute/>}/>
      <Route path="/terms" element={<TermsPage/>}/>
      <Route path="/privacy" element={<PrivacyPage/>}/>
      <Route path="/*" element={<AuthedShell/>}>
        <Route path="admin/metrics" element={<FounderAdminRoute/>}/>
        <Route element={<LayoutRoute/>}>
          <Route index element={<HomeRoute/>}/>
          <Route path="library" element={<LibraryRoute/>}/>
          <Route path="teams" element={<TeamsRoute/>}/>
          <Route path="settings" element={<SettingsRoute/>}/>
          <Route path="builder/:practiceId" element={<BuilderRoute/>}/>
          <Route path="run/:practiceId" element={<RunRoute/>}/>
          {/* Step-3 bridge only: the old cross-team Schedule screen, reachable
              until step 4 (Snapshot/handoff §4.4) folds it into
              /team/:teamId/schedule and Home's own agenda. Not in the
              handoff's §4.1 route list -- remove once step 4 lands. */}
          <Route path="schedule" element={<ScheduleLegacyRoute/>}/>
          <Route path="team/:teamId" element={<TeamIndexRedirect/>}/>
          <Route path="team/:teamId/schedule" element={<TeamScheduleRoute/>}/>
          <Route path="team/:teamId/plan" element={<PlanRoute/>}/>
          <Route path="team/:teamId/team" element={<TeamRosterRoute/>}/>
        </Route>
      </Route>
    </>
  )),[]);

  const ctxValue=useMemo(()=>({
    data:fullData,update,coachId,profile,coachName,coachEmail:coachEmailStr,
    session,wantsAuth,setWantsAuth,loaded,
    openModal,closeModal,modal,
    refreshTeams,refreshLibrary,refreshPlanning,
    saveName,onSignOut:signOut,onDeactivate:handleDeactivate,
  }),[fullData,update,coachId,profile,coachName,coachEmailStr,session,wantsAuth,loaded,modal,refreshTeams,refreshLibrary,refreshPlanning,saveName,handleDeactivate]);

  return (<AppCtx.Provider value={ctxValue}>
    <RouterProvider router={router}/>
  </AppCtx.Provider>);
}

// ── Route wrappers ───────────────────────────────────────────────────────────
// Thin components so the router config above can stay a stable, one-time
// tree while still reading live data via AppCtx. None of the screens they
// render (HomeScreen, ScheduleScreen, etc.) had their own internals touched
// beyond swapping setView/setLiveId/setEditPracticeId navigation call sites
// for goToBuilder/goToRun/goHome (handoff §4, "ship with existing screens
// mounted before touching their internals").

function AuthedShell(){
  const ctx=useAppCtx();
  const {session,wantsAuth,setWantsAuth,profile,saveName,loaded}=ctx;
  const [liveId,setLiveId]=useState(null);
  const [editPracticeId,setEditPracticeId]=useState(null);
  const [startTemplateId,setStartTemplateId]=useState(null);
  const [presetTeamId,setPresetTeamId]=useState(null);
  const navigate=useNavigate();
  // presetTeamId (nav restructure round 2): Plan's Build tab already knows
  // which team it's for -- without this, a new practice defaults to
  // data.teams[0], which is wrong the moment a coach has more than one team
  // and starts from a team's own Plan tab instead of the old flat Manage
  // team-picker.
  const goToBuilder=useCallback((practiceId,templateId,teamId)=>{
    setEditPracticeId(practiceId||null);
    setStartTemplateId(templateId||null);
    setPresetTeamId(practiceId?null:(teamId||null));
    navigate("/builder/"+(practiceId||"new"));
  },[navigate]);
  const goToRun=useCallback(practiceId=>{
    setLiveId(practiceId||null);
    navigate("/run/"+(practiceId||"new"));
  },[navigate]);
  const goHome=useCallback(()=>navigate("/"),[navigate]);
  // Step-3 bridge only (see the /schedule route comment above) -- retire
  // once step 4 folds Schedule into /team/:teamId/schedule.
  const goToSchedule=useCallback(()=>navigate("/schedule"),[navigate]);
  const goToTeam=useCallback(teamId=>navigate("/team/"+teamId+"/schedule"),[navigate]);
  // Goals is a Plan sub-tab now, not its own route -- ?tab=goals tells
  // PlanScreen which sub-tab to default to (read via useSearchParams there).
  const goToTeamGoals=useCallback(teamId=>navigate("/team/"+teamId+"/plan?tab=goals"),[navigate]);
  const goToSettings=useCallback(()=>navigate("/settings"),[navigate]);

  // Loading initial session
  if(session===undefined)return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--black)"}}><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:700,color:"var(--green)"}}>Loading...</div></div>);
  // Landing-page addendum §1: "/" is adaptive on session state -- an
  // installed PWA icon's start_url stays "/" and keeps launching straight
  // into the app for a signed-in user, while a signed-out visitor sees the
  // marketing pitch instead of a dead-end sign-in form. Both CTAs on the
  // landing page lead to the same AuthScreen (wantsAuth), just weighted
  // differently.
  if(!session)return wantsAuth?(<AuthScreen onBack={()=>setWantsAuth(false)}/>):(<LandingPage onGetStarted={()=>setWantsAuth(true)}/>);
  // One-time name prompt -- covers both fresh signups and pre-existing
  // accounts created before name collection existed.
  if(profile&&!profile.first_name)return (<NameScreen onSave={saveName}/>);
  // Show data loading spinner after auth but before data loaded
  if(!loaded)return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--black)"}}><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:700,color:"var(--green)"}}>Loading your data...</div></div>);

  return (<AppCtx.Provider value={{...ctx,liveId,setLiveId,editPracticeId,setEditPracticeId,startTemplateId,setStartTemplateId,presetTeamId,setPresetTeamId,goToBuilder,goToRun,goHome,goToSchedule,goToTeam,goToTeamGoals,goToSettings}}>
    <Outlet/>
    {ctx.modal&&<ModalLayer modal={ctx.modal} data={ctx.data} update={ctx.update} closeModal={ctx.closeModal} refreshTeams={ctx.refreshTeams} refreshLibrary={ctx.refreshLibrary} refreshPlanning={ctx.refreshPlanning} coachId={ctx.coachId}/>}
  </AppCtx.Provider>);
}

function LayoutRoute(){
  const {data,liveId,goToRun}=useAppCtx();
  return <Layout data={data} liveId={liveId} goToRun={goToRun}/>;
}

// Founder-only gate. Settings shows a "Founder Metrics" row only when
// checkIsAdmin() resolves true, so this is otherwise unreachable via nav.
// The real enforcement is server-side (is_admin() inside every
// admin_metrics_* RPC); this redirect is UX only, and deliberately gives
// no "admin exists" hint to a non-founder who lands here.
function FounderAdminRoute(){
  const [isAdmin,setIsAdmin]=useState(null);
  useEffect(()=>{checkIsAdmin().then(setIsAdmin);},[]);
  if(isAdmin===null)return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--black)"}}><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:700,color:"var(--green)"}}>Loading...</div></div>);
  if(!isAdmin)return <Navigate to="/" replace/>;
  return <FounderMetricsScreen/>;
}

function HelperViewRoute(){ const {token}=useParams(); return <HelperView token={token}/>; }
function PreviewViewRoute(){ const {token}=useParams(); return <PreviewView token={token}/>; }

function HomeRoute(){
  const {data,update,goToBuilder,goToRun,goToSchedule,goToTeamGoals,goToSettings,coachId,coachName,coachEmail,refreshPlanning,refreshTeams}=useAppCtx();
  return <HomeScreen data={data} update={update} goToBuilder={goToBuilder} goToRun={goToRun} goToSchedule={goToSchedule} goToTeamGoals={goToTeamGoals} goToSettings={goToSettings} coachId={coachId} coachName={coachName} coachEmail={coachEmail} refreshPlanning={refreshPlanning} refreshTeams={refreshTeams}/>;
}

function LibraryRoute(){
  const {data,update,openModal,goToBuilder,refreshLibrary,coachId,refreshPlanning}=useAppCtx();
  return <NewLibraryScreen data={data} update={update} openModal={openModal} goToBuilder={goToBuilder} refreshLibrary={refreshLibrary} coachId={coachId} refreshPlanning={refreshPlanning}/>;
}

function TeamsRoute(){
  const {data,goToTeam,openModal}=useAppCtx();
  return <TeamsListScreen data={data} goToTeam={goToTeam} openModal={openModal}/>;
}

function SettingsRoute(){
  const {data,coachId,openModal,refreshLibrary,refreshPlanning,profile,coachEmail,saveName,onSignOut,onDeactivate}=useAppCtx();
  return <SettingsScreen data={data} coachId={coachId} openModal={openModal} refreshLibrary={refreshLibrary} refreshPlanning={refreshPlanning} profile={profile} coachEmail={coachEmail} saveName={saveName} onSignOut={onSignOut} onDeactivate={onDeactivate}/>;
}

// step-3 bridge -- see the router config comment above.
function ScheduleLegacyRoute(){
  const {data,update,goToBuilder,goToRun,coachId,refreshPlanning}=useAppCtx();
  return <ScheduleScreen data={data} update={update} goToBuilder={goToBuilder} goToRun={goToRun} coachId={coachId} refreshPlanning={refreshPlanning}/>;
}

// Team-scoped Schedule (handoff §4.4). Fetches practices scoped to this one
// team (fetchPracticesFull(teamId)) rather than reusing the app-wide
// unbounded fetch -- a separate local fetch/state from App's own
// `planning.practices`, since Home/My Week still needs the cross-team
// unscoped list. refreshPlanning here refreshes both this team's scoped
// list (immediate) and the global one (so Home stays in sync after a
// mutation made from inside a team's Schedule tab).
function TeamScheduleRoute(){
  const {teamId}=useParams();
  const {data,update,goToBuilder,goToRun,coachId,refreshPlanning:refreshGlobalPlanning}=useAppCtx();
  const [teamPractices,setTeamPractices]=useState(null);
  const refreshTeamPractices=useCallback(()=>{
    fetchPracticesFull(teamId).then(setTeamPractices);
  },[teamId]);
  useEffect(()=>{refreshTeamPractices();},[refreshTeamPractices]);
  const refreshBoth=useCallback(async()=>{
    await Promise.all([refreshTeamPractices(),refreshGlobalPlanning()]);
  },[refreshTeamPractices,refreshGlobalPlanning]);
  if(teamPractices===null)return (<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>Loading...</div>);
  const scopedData=Object.assign({},data,{practices:teamPractices});
  return <ScheduleScreen data={scopedData} update={update} goToBuilder={goToBuilder} goToRun={goToRun} coachId={coachId} refreshPlanning={refreshBoth} fixedTeamId={teamId}/>;
}

function TeamIndexRedirect(){
  const {teamId}=useParams();
  return <Navigate to={"/team/"+teamId+"/schedule"} replace/>;
}

function TeamRosterRoute(){
  const {teamId}=useParams();
  const {data,update,coachId,openModal,refreshTeams,refreshLibrary}=useAppCtx();
  return <ManageScreen data={data} update={update} coachId={coachId} openModal={openModal} refreshTeams={refreshTeams} refreshLibrary={refreshLibrary} initialTeamId={teamId}/>;
}

function PlanRoute(){
  const {teamId}=useParams();
  const {data,coachId,goToBuilder}=useAppCtx();
  return <PlanScreen data={data} teamId={teamId} coachId={coachId} goToBuilder={goToBuilder}/>;
}

function BuilderRoute(){
  const {practiceId}=useParams();
  const {data,update,openModal,goToRun,editPracticeId,setEditPracticeId,startTemplateId,setStartTemplateId,presetTeamId,coachId,refreshPlanning,refreshLibrary}=useAppCtx();
  // Restores state from the URL on a fresh mount (direct link / refresh) --
  // navigation via goToBuilder() already set this state before navigating,
  // so this is a no-op in the normal in-app flow.
  useEffect(()=>{
    const wanted=practiceId&&practiceId!=="new"?practiceId:null;
    if(wanted!==editPracticeId)setEditPracticeId(wanted);
  },[practiceId]);
  return <BuilderScreen data={data} update={update} openModal={openModal} launchRun={goToRun} editPracticeId={editPracticeId} setEditPracticeId={setEditPracticeId} startTemplateId={startTemplateId} setStartTemplateId={setStartTemplateId} presetTeamId={presetTeamId} coachId={coachId} refreshPlanning={refreshPlanning} refreshLibrary={refreshLibrary}/>;
}

function RunRoute(){
  const {practiceId}=useParams();
  const {data,update,liveId,setLiveId,coachId,goHome,refreshPlanning,refreshLibrary}=useAppCtx();
  useEffect(()=>{
    const wanted=practiceId&&practiceId!=="new"?practiceId:null;
    if(wanted!==liveId)setLiveId(wanted);
  },[practiceId]);
  return <CommandScreen data={data} update={update} liveId={liveId} setLiveId={setLiveId} coachId={coachId} goHome={goHome} refreshPlanning={refreshPlanning} refreshLibrary={refreshLibrary}/>;
}

function PracticeLog({data,update,launchRun}){
  const [viewPractice,setViewPractice]=useState(null);
  const fmtDate=ds=>{
    const today=localDateStr();
    const yest=localDateStr(new Date(Date.now()-864e5));
    if(ds===today)return "Today";
    if(ds===yest)return "Yesterday";
    return new Date(ds+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
  };
  const sorted=[...data.practices].sort((a,b)=>b.date.localeCompare(a.date));
  const standalone=data.notes.filter(n=>!n.practiceId);
  if(viewPractice)return(<div style={{paddingBottom:80}}><HistoryViewer data={data} update={update} practice={viewPractice} onRunAgain={()=>{const now=new Date();const newId=uid();const copy=JSON.parse(JSON.stringify(viewPractice));copy.id=newId;copy.date=localDateStr(now);copy.startTime=now.toTimeString().slice(0,5);update(d=>{d.practices.push(copy);return d;});setViewPractice(null);launchRun(newId);}} onBack={()=>setViewPractice(null)}/></div>);
  if(!sorted.length&&!standalone.length)return(<div className="empty"><div className="emtx">No practice history yet. Run a practice to see it here.</div></div>);
  return(<div>
    {sorted.map(p=>{
      const practiceNotes=(data.notes||[]).filter(n=>n.practiceId===p.id);
      const team=data.teams.find(t=>t.id===p.teamId);
      return(<div key={p.id} className="card" style={{marginBottom:10,cursor:"pointer"}} onClick={()=>setViewPractice(p)}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700}}>{team?team.name:"Practice"}</div>
            <div className="limt">{fmtDate(p.date)}{p.startTime?" at "+fmt12(p.startTime):""} · {sumMins(p.activities)}m{practiceNotes.length>0?" · "+practiceNotes.length+" note"+(practiceNotes.length>1?"s":""):""}</div>
          </div>
          <span style={{color:"var(--td)",fontSize:13}}>&#8250;</span>
        </div>
      </div>);
    })}
    {standalone.length>0&&(<div>
      <div className="clbl" style={{marginTop:8,marginBottom:8}}>Standalone Notes</div>
      {standalone.map(n=>(<div key={n.id} className="notec">
        <div className="notect">{n.context&&<span style={{color:"var(--green2)",fontWeight:700,marginRight:4}}>{n.context} -</span>}{new Date(n.date).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</div>
        <div className="notetx">{n.text}</div>
      </div>))}
    </div>)}
  </div>);
}

function DurStepper({value,min,onChange,step}){
  const s=step||1;
  const mn=min||1;
  return (<div style={{display:"flex",alignItems:"center",gap:0,border:"1.5px solid var(--b)",borderRadius:"var(--rs)",overflow:"hidden",background:"#fff"}}>
      <button onClick={()=>onChange(Math.max(mn,value-s))} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>-</button>
      <div style={{flex:1,textAlign:"center",fontFamily:"DM Mono,monospace",fontSize:15,fontWeight:600,color:"var(--black)"}}>{value}m</div>
      <button onClick={()=>onChange(value+s)} style={{width:40,height:40,border:"none",background:"var(--s2)",color:"var(--black2)",fontSize:20,fontWeight:700,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
    </div>
  );
}

function BuilderScreen({data,update,openModal,launchRun,editPracticeId,setEditPracticeId,startTemplateId,setStartTemplateId,presetTeamId,coachId,refreshPlanning,refreshLibrary}){
  const navigate=useNavigate();
  const editP=editPracticeId?data.practices.find(p=>p.id===editPracticeId):null;
  // "Start from Template" seeds a brand-new (not editP) practice from a
  // saved template's contents -- distinct from editing an already-scheduled
  // practice, so it still gets the full Team/Schedule/Template/Run Now bar.
  const startTpl=(!editP&&startTemplateId)?(data.templates||[]).find(t=>t.id===startTemplateId):null;
  // Consume the intent once on mount so leaving and returning to Builder
  // later (e.g. to edit a different practice) doesn't silently re-seed it.
  useEffect(()=>{if(startTemplateId&&setStartTemplateId)setStartTemplateId(null);},[]);
  const [existingId,setExistingId]=useState(editP?editP.id:null);
  const [teamId,setTeamId]=useState(editP?editP.teamId:(presetTeamId||(startTpl&&startTpl.defaultTeamId)||(data.teams[0]?data.teams[0].id:"")));
  const lastLocForTeam=(tid)=>{const tps=data.practices.filter(p=>p.teamId===tid&&p.locationId).sort((a,b)=>b.date>a.date?1:-1);return tps.length?tps[0].locationId:(data.locations[0]?data.locations[0].id:"");};
  const [locId,setLocId]=useState(editP?editP.locationId:((startTpl&&startTpl.locationId)||lastLocForTeam(editP?editP.teamId:(data.teams[0]?data.teams[0].id:""))));
  const [acts,setActs]=useState(editP?JSON.parse(JSON.stringify(editP.activities)):(startTpl?stripIdsForCopy(startTpl.activities):[]));
  const [expandedId,setExpandedId]=useState(null);
  const [savedTpl,setSavedTpl]=useState(false);
  const [bottomMode,setBottomMode]=useState(null);
  const [schedDate,setSchedDate]=useState(editP?(editP.date||localDateStr()):localDateStr());
  const [schedTime,setSchedTime]=useState(editP?(editP.startTime||"16:00"):"16:00");
  const [schedDur,setSchedDur]=useState(60);
  const [tplName,setTplName]=useState("");
  const dragIdx=useRef(null);
  // Snapshot of what's actually persisted, so the router blocker (and the
  // beforeunload guard below) can warn before discarding edits that only
  // exist in this component's state. Replaces the old App-level
  // guardedSetView/builderDirtyRef/priorView mechanism (handoff §4.2) --
  // useBlocker replaces client-side-nav guarding, beforeunload covers a hard
  // refresh/tab close, which the old mechanism never actually protected
  // against either (it only guarded App.jsx's own setView calls).
  const savedSnapshotRef=useRef();
  if(savedSnapshotRef.current===undefined)savedSnapshotRef.current=JSON.stringify({teamId,locId,acts});
  const [dirty,setDirty]=useState(false);
  const markSaved=()=>{savedSnapshotRef.current=JSON.stringify({teamId,locId,acts});setDirty(false);};
  useEffect(()=>{
    setDirty(JSON.stringify({teamId,locId,acts})!==savedSnapshotRef.current);
  },[teamId,locId,acts]);
  useEffect(()=>{
    if(!dirty)return;
    const onBeforeUnload=e=>{e.preventDefault();e.returnValue="";};
    window.addEventListener("beforeunload",onBeforeUnload);
    return()=>window.removeEventListener("beforeunload",onBeforeUnload);
  },[dirty]);
  const blocker=useBlocker(useCallback(({currentLocation,nextLocation})=>dirty&&currentLocation.pathname!==nextLocation.pathname,[dirty]));
  useEffect(()=>{
    if(blocker.state!=="blocked")return;
    if(window.confirm("You have unsaved changes to this practice. Leave without saving?"))blocker.proceed();
    else blocker.reset();
  },[blocker]);
  const team=data.teams.find(t=>t.id===teamId)||null;
  const loc=data.locations.find(l=>l.id===locId)||null;
  const teamSport=(team&&team.sport)||"General";
  const filteredLib=data.activityLibrary.filter(a=>(a.sport||"General")===teamSport||(a.sport||"General")==="General");
  const headCoach=(team&&(team.coaches.find(c=>c.role==="Head Coach")||team.coaches[0]))||null;
  const headCoachId=(headCoach&&headCoach.id)||"";
  const allPlayerIds=team?team.players.map(p=>p.id):[];
  const [absentPlayerIds,setAbsentPlayerIds]=useState(new Set());
  useEffect(()=>{
    if(!existingId){setAbsentPlayerIds(new Set());return;}
    fetchPlannedAbsences([existingId]).then(rows=>setAbsentPlayerIds(new Set(rows.map(r=>r.player_id))));
  },[existingId]);
  // Default assignment for newly-added activities excludes players marked
  // out in advance -- the coach can still tap them back in per-activity.
  const defaultAssignIds=allPlayerIds.filter(id=>!absentPlayerIds.has(id));
  const totalMins=sumMins(acts);
  const addAct=lib=>{
    setActs(p=>[...p,{id:uid(),type:"activity",libraryId:lib.id,name:lib.name,duration:lib.duration,assignments:defaultAssignIds,coachId:headCoachId,sublocationId:"",notes:"",description:lib.description||"",coachingPoints:lib.coachingPoints||"",grouping:lib.grouping||"whole",numGroups:lib.numGroups||2,playerGear:lib.playerGear||"",equipment:Array.isArray(lib.equipment)?lib.equipment:[]}]);
  };
  const addChecklist=isClose=>{
    const a={id:uid(),type:"checklist",name:isClose?"Closer":"Intro",duration:5,assignments:defaultAssignIds,coachId:headCoachId,items:[],notes:""};
    setActs(p=>[...p,a]);setExpandedId(a.id);
  };
  const addBlock=()=>{
    const n=2;const groups=mkGroups(defaultAssignIds,n);
    const b={id:uid(),type:"station_block",rotate:true,stationDuration:10,transitionDuration:2,stations:[
      {id:uid(),name:"Station 1",activityName:"",coachId:headCoachId,sublocationId:"",assignments:groups[0]||[],coachingPoints:"",equipment:[],playerGear:""},
      {id:uid(),name:"Station 2",activityName:"",coachId:"",sublocationId:"",assignments:groups[1]||[],coachingPoints:"",equipment:[],playerGear:""},
    ]};
    setActs(p=>[...p,b]);setExpandedId(b.id);
  };
  const remAct=id=>setActs(p=>p.filter(a=>a.id!==id));
  const updAct=(id,ch)=>setActs(p=>p.map(a=>a.id===id?Object.assign({},a,ch):a));
  const updSt=(aid,sid,ch)=>setActs(p=>p.map(a=>a.id===aid?Object.assign({},a,{stations:a.stations.map(s=>s.id===sid?Object.assign({},s,ch):s)}):a));
  const onDS=(e,i)=>{dragIdx.current=i;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",String(i));};
  const onDO=e=>{e.preventDefault();e.dataTransfer.dropEffect="move";};
  const onDrop=(e,i)=>{e.preventDefault();if(dragIdx.current===null||dragIdx.current===i){dragIdx.current=null;return;}setActs(p=>{const arr=[...p],[mv]=arr.splice(dragIdx.current,1);arr.splice(i,0,mv);return arr;});dragIdx.current=null;};
  const onDE=()=>{dragIdx.current=null;};
  const doSchedule=async(dateVal,timeVal)=>{
    if(!dateVal)return;
    const {data:saved}=await savePracticeTree(existingId,{teamId,locationId:locId,date:dateVal,startTime:timeVal||"",timezone:team&&team.timezone,activities:acts});
    if(saved){setExistingId(saved.id);markSaved();}
    await refreshPlanning();
    setBottomMode("done_sched");
  };
  const doSaveTpl=async(tname)=>{
    if(!tname.trim())return;
    await saveTemplateTree(coachId,null,{name:tname,sport:teamSport,locationId:locId,activities:acts});
    await refreshPlanning();
    setBottomMode("done_tpl");
    setTimeout(()=>setBottomMode(null),2000);
  };
  const handleSave=async()=>{
    const {data:saved}=await savePracticeTree(existingId,{teamId,locationId:locId,date:schedDate,startTime:schedTime,timezone:team&&team.timezone,activities:acts});
    if(saved){setExistingId(saved.id);markSaved();}
    await refreshPlanning();
    if(existingId&&setEditPracticeId)setEditPracticeId(null);
  };
  const handleRun=async()=>{
    const {data:saved}=await savePracticeTree(existingId,{teamId,locationId:locId,date:schedDate,startTime:schedTime,timezone:team&&team.timezone,activities:acts});
    if(saved)markSaved();
    await refreshPlanning();
    if(saved)launchRun(saved.id);
  };
  return (<div style={{paddingBottom:80}}>
      {/* Back-button audit (2026-07-15): was a hardcoded navigate("/") --
          always dropped you on Home regardless of where you actually came
          from (a team's Plan tab, Schedule, Library...). navigate(-1)
          returns to wherever that was; the useBlocker guard above already
          intercepts this exact navigation when there are unsaved edits. */}
      <div style={{padding:"10px 14px 0"}}><button className="btn ghost bxs" onClick={()=>navigate(-1)}>Back</button></div>
      <div style={{position:"sticky",top:0,zIndex:10,background:"#fff",borderBottom:"1px solid var(--b)"}}>
      {editP&&<div style={{padding:"8px 14px",background:"var(--gbg)",borderBottom:"1px solid var(--gb)",display:"flex",alignItems:"baseline",gap:8}}>
        <span style={{fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"var(--green)",flexShrink:0}}>Editing</span>
        <span style={{fontSize:13,fontWeight:700,color:"var(--black)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team?team.name:"Practice"} · {schedDate?new Date(schedDate+"T12:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}):"No date"}{schedTime?" · "+fmt12(schedTime):""}</span>
      </div>}
      {!editP&&startTpl&&<div style={{padding:"8px 14px",background:"var(--gbg)",borderBottom:"1px solid var(--gb)",display:"flex",alignItems:"baseline",gap:8}}>
        <span style={{fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"var(--green)",flexShrink:0}}>From Template</span>
        <span style={{fontSize:13,fontWeight:700,color:"var(--black)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{startTpl.name}</span>
      </div>}
      <div style={{padding:"8px 14px",display:"flex",gap:6}}>
        {(!bottomMode||bottomMode==="")&&<div style={{display:"flex",gap:6,width:"100%"}}>
          <button className="btn outline bsm" style={{flex:1}} onClick={handleSave}>Save</button>
          {!editP&&<button className="btn outline bsm" style={{flex:1}} onClick={()=>setBottomMode("schedule")}>Schedule</button>}
          {!editP&&<button className="btn ghost bsm" style={{flex:1}} onClick={()=>{setTplName("");setBottomMode("template");}}>Template</button>}
          <button className="btn primary bsm" style={{flex:2}} onClick={handleRun}>Run Now</button>
        </div>}
        {bottomMode==="schedule"&&<div style={{width:"100%"}}>
          <div className="g2 mb6">
            <div className="fld"><label className="lbl">Date</label><input className="inp" type="date" value={schedDate} onChange={e=>setSchedDate(e.target.value)}/></div>
            <div className="fld"><label className="lbl">Time</label><input className="inp" type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)}/></div>
          </div>
          <div className="brow">
            <button className="btn ghost bsm" onClick={()=>setBottomMode(null)}>Cancel</button>
            <button className="btn primary bsm" onClick={()=>doSchedule(schedDate,schedTime,schedDur)}>Save Schedule</button>
          </div>
        </div>}
        {bottomMode==="template"&&<div style={{width:"100%"}}>
          <div className="fld mb6"><input className="inp" autoFocus placeholder="Template name..." value={tplName} onChange={e=>setTplName(e.target.value)}/></div>
          <div className="brow">
            <button className="btn ghost bsm" onClick={()=>setBottomMode(null)}>Cancel</button>
            <button className="btn primary bsm" onClick={()=>doSaveTpl(tplName)} disabled={!tplName.trim()}>Save Template</button>
          </div>
        </div>}
        {bottomMode==="done_sched"&&<div style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{color:"var(--green)",fontFamily:"Barlow Condensed,sans-serif",fontSize:14,fontWeight:700}}>Scheduled!</span>
          <button className="btn ghost bxs" onClick={()=>setBottomMode(null)}>Done</button>
        </div>}
      </div>
      </div>
      <div className="card mb10">
        <div className="clbl">Practice Setup</div>
        {!editP&&<div className="fld"><label className="lbl">Team</label>
          <select className="sel" value={teamId} onChange={e=>{const tid=e.target.value;setTeamId(tid);setLocId(lastLocForTeam(tid));}}>
            {!data.teams.length&&<option value="">-- Add a team first --</option>}
            {data.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>}
        <div className={editP?"g2":undefined}>
          <div className="fld"><label className="lbl">Location</label>
            <select className="sel" value={locId} onChange={e=>setLocId(e.target.value)}>
              {data.locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          {editP&&<div className="fld"><label className="lbl">Start Time</label>
            <input className="inp" type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)}/>
          </div>}
        </div>
      </div>
      {acts.length===0&&(<div style={{textAlign:"center",padding:"20px 16px",background:"var(--s2)",borderRadius:"var(--r)",marginBottom:10,border:"1.5px dashed var(--b)"}}>
          <div style={{fontSize:13,color:"var(--td)",lineHeight:1.7}}>Nothing added yet.<br/>Select activities below to begin building your practice.</div>
        </div>
      )}
      {acts.length>0&&(<div className="sechdr mb8">
          <span className="sectitle">{acts.length} Activities</span>
          <span className="pill">{totalMins}m</span>
        </div>
      )}
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
                {act.type==="station_block"?<div className="limt">{act.stations.map(s=>s.activityName||s.name).join(" / ")} - {act.stationDuration}m x{act.stations.length} + {act.transitionDuration}m trans = {act.stations.length*act.stationDuration+Math.max(0,act.stations.length-1)*act.transitionDuration}m</div>:<div className="limt">{act.duration}min</div>}
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
                {act.type==="station_block"&&<StationConfig assets={data.assets} coachId={coachId} refreshLibrary={refreshLibrary} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)} teamSport={teamSport} libraryDrills={data.activityLibrary}/>}
              </div>
            )}
          </div>
        </div>
      ))}
      <div style={{borderTop:"1px solid var(--b)",paddingTop:14}}>
        <div className="sechdr mb8"><span className="sectitle">Add Drills</span><div className="row"><button className="btn ghost bxs" onClick={()=>openModal("addActivity")}>+ New Activity</button></div></div>
        <div className="g2" style={{marginBottom:6}}>
          <div className="li tap" style={{marginBottom:0}} onClick={()=>addChecklist(false)}><div className="lim"><div className="lin">Intro</div><div className="limt">Checklist</div></div><span style={{color:"var(--green)",fontSize:18,fontWeight:700}}>+</span></div>
          <div className="li tap" style={{marginBottom:0}} onClick={()=>addChecklist(true)}><div className="lim"><div className="lin">Closer</div><div className="limt">Checklist</div></div><span style={{color:"var(--green)",fontSize:18,fontWeight:700}}>+</span></div>
        </div>
        <div className="li tap" style={{marginBottom:6,background:"var(--gbg)",borderColor:"var(--gb)"}} onClick={addBlock}>
          <div className="lim"><div className="lin" style={{color:"var(--green)"}}>Station Block</div><div className="limt">2 stations, add or remove as needed</div></div>
          <span style={{color:"var(--green)",fontSize:22,fontWeight:700,flexShrink:0}}>+</span>
        </div>
        {team&&<div className="clbl" style={{marginBottom:8}}>{teamSport} + General</div>}
        {filteredLib.map(lib=>(<div key={lib.id} className="li tap" onClick={()=>addAct(lib)}>
            <div className="lim"><div className="lin">{lib.name}</div><div className="limt">{lib.duration}min{lib.description?" - "+lib.description:""}</div>{lib.coachingPoints&&<div style={{fontSize:11,color:"var(--green2)",marginTop:2}}>{lib.coachingPoints}</div>}</div>
            <div className="lir"><span className="bdg bp">{lib.duration}m</span><span style={{color:"var(--green)",fontSize:20,fontWeight:700,marginLeft:4}}>+</span></div>
          </div>
        ))}
      </div>


    </div>
  );
}

function PlayerProfile({player:playerInit,team:teamInit,data,update,refreshTeams,coachId,refreshLibrary,onBack}){
  const team=data.teams.find(t=>t.id===teamInit.id)||teamInit;
  const player=team.players.find(p=>p.id===playerInit.id)||playerInit;
  const [markingOut,setMarkingOut]=useState(false);
  const [picking,setPicking]=useState(false);
  const [pickedCategoryId,setPickedCategoryId]=useState(null);
  const [customName,setCustomName]=useState("");
  const [busy,setBusy]=useState(false);
  const areas=player.focusAreas||[];
  const categories=(data.skillCategories||[]).filter(c=>c.sport===team.sport).sort((a,b)=>a.sort_order-b.sort_order);
  const catName=id=>{const c=(data.skillCategories||[]).find(c=>c.id===id);return c?c.name:"";};
  const tagsForCategory=cid=>(data.skillTags||[]).filter(t=>t.categoryId===cid&&(t.scope==="global"||t.scope==="org"||t.ownerUserId===coachId));
  const alreadyAddedTagIds=new Set(areas.map(a=>a.skillTagId));
  const startAdd=()=>{setPicking(true);setPickedCategoryId(null);setCustomName("");};
  const cancelAdd=()=>{setPicking(false);setPickedCategoryId(null);setCustomName("");};
  const pickTag=async tagId=>{
    setBusy(true);
    await addPlayerFocusArea(player.id,tagId,coachId);
    await refreshTeams();
    setBusy(false);cancelAdd();
  };
  const addCustomTag=async()=>{
    if(!customName.trim()||!pickedCategoryId)return;
    setBusy(true);
    const{data:tag}=await createSkillTag(coachId,{categoryId:pickedCategoryId,name:customName.trim()});
    if(refreshLibrary)await refreshLibrary();
    if(tag)await addPlayerFocusArea(player.id,tag.id,coachId);
    await refreshTeams();
    setBusy(false);cancelAdd();
  };
  const delArea=async id=>{
    await removePlayerFocusArea(id);
    await refreshTeams();
  };
  return (<div style={{paddingBottom:80}}>
    <div className="row mb10" style={{justifyContent:"space-between"}}>
      <div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900}}>{player.firstName} {player.lastName}</div>
        <div className="td" style={{fontSize:12}}>{team.name}{player.jersey?" - #"+player.jersey:""}</div>
      </div>
      <button className="btn ghost bxs" onClick={onBack}>Back</button>
    </div>
    <button className="btn outline bsm bfull" style={{marginBottom:10}} onClick={()=>setMarkingOut(true)}>Mark Out For...</button>
    {markingOut&&<AbsencePicker data={data} coachId={coachId} mode="pickPlayerThenPractices" presetPlayer={Object.assign({},player,{teamId:team.id})} onClose={()=>setMarkingOut(false)}/>}
    <div className="card mb10">
      <div className="clbl mb8">Focus Areas</div>
      {!areas.length&&<div style={{fontSize:13,color:"var(--td)",marginBottom:10}}>No focus areas yet. Add what this player is working on.</div>}
      {areas.map(a=>(<div key={a.id} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:8,padding:"10px 12px",background:"var(--s2)",borderRadius:"var(--rs)"}}>
        <div style={{flex:1,fontSize:14,lineHeight:1.5,color:"var(--black)"}}><span style={{color:"var(--td)",fontWeight:600}}>{catName(a.categoryId)}: </span>{a.name}</div>
        <button className="btn danger bxs" onClick={()=>delArea(a.id)}>x</button>
      </div>))}
      {!picking&&<button className="btn primary bsm bfull" onClick={startAdd}>Add Focus Area</button>}
      {picking&&!pickedCategoryId&&(<div>
        <div style={{fontSize:12,color:"var(--td)",marginBottom:8}}>Pick a category</div>
        {!categories.length&&<div style={{fontSize:13,color:"var(--td)",marginBottom:10}}>No skill categories set up yet for {team.sport}.</div>}
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
          {categories.map(c=>(<button key={c.id} className="btn ghost bsm" onClick={()=>setPickedCategoryId(c.id)}>{c.name}</button>))}
        </div>
        <button className="btn ghost bsm bfull" onClick={cancelAdd}>Cancel</button>
      </div>)}
      {picking&&pickedCategoryId&&(<div>
        <div style={{fontSize:12,color:"var(--td)",marginBottom:8}}>{catName(pickedCategoryId)} — pick a tag or add your own</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
          {tagsForCategory(pickedCategoryId).filter(t=>!alreadyAddedTagIds.has(t.id)).map(t=>(<button key={t.id} className="btn ghost bsm" disabled={busy} onClick={()=>pickTag(t.id)}>{t.name}</button>))}
        </div>
        <div className="fld"><input className="inp" placeholder="Add your own tag under this category" value={customName} onChange={e=>setCustomName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCustomTag()}/></div>
        <div className="brow">
          <button className="btn ghost bsm" onClick={cancelAdd}>Cancel</button>
          <button className="btn primary bsm" onClick={addCustomTag} disabled={!customName.trim()||busy}>Add</button>
        </div>
      </div>)}
    </div>
    {player.notes&&(<div className="card"><div className="clbl mb6">Notes</div><div style={{fontSize:14,color:"var(--black)",lineHeight:1.6}}>{player.notes}</div></div>)}
  </div>);
}

function RostersTab({data,update,openModal,fixedTeamId,refreshTeams,coachId,refreshLibrary}){
  const [teamId,setTeamId]=useState(fixedTeamId||(data.teams[0]?data.teams[0].id:""));
  useEffect(()=>{
    if(fixedTeamId){if(teamId!==fixedTeamId)setTeamId(fixedTeamId);return;}
    if(!data.teams.some(t=>t.id===teamId))setTeamId(data.teams[0]?data.teams[0].id:"");
  },[data.teams,fixedTeamId]);
  const [tab,setTab]=useState("players");
  const [confirmDel,setConfirmDel]=useState(false);
  const [openMenu,setOpenMenu]=useState(null);
  const [sort,setSort]=useState({by:"firstName",dir:"asc"});
  const [viewPlayer,setViewPlayer]=useState(null);
  const team=data.teams.find(t=>t.id===teamId)||null;
  const canManage=isHeadCoach(team,coachId);
  const delP=async id=>{await archivePlayer(id);await refreshTeams();};
  const delC=async id=>{await archiveStaff(id);await refreshTeams();};
  const delTeam=async()=>{
    const rem=data.teams.filter(t=>t.id!==teamId);
    await archiveTeam(teamId);
    await refreshTeams();
    setConfirmDel(false);setTeamId(rem[0]?rem[0].id:"");
  };
  const sorted=team?[...team.players].sort((a,b)=>{
    let av,bv;
    if(sort.by==="jersey"){av=parseInt(a.jersey)||0;bv=parseInt(b.jersey)||0;}
    else if(sort.by==="firstName"){av=(a.firstName||"").toLowerCase();bv=(b.firstName||"").toLowerCase();}
    else if(sort.by==="lastName"){av=(a.lastName||"").toLowerCase();bv=(b.lastName||"").toLowerCase();}
    else{av=(a.firstName+" "+a.lastName).toLowerCase();bv=(b.firstName+" "+b.lastName).toLowerCase();}
    return sort.dir==="asc"?(av>bv?1:av<bv?-1:0):(av<bv?1:av>bv?-1:0);
  }):[];
  if(viewPlayer)return(<div style={{paddingBottom:80}}>
    <div className="row mb10"><button className="btn ghost bxs" onClick={()=>setViewPlayer(null)}>&#8249; Roster</button></div>
    <PlayerProfile player={viewPlayer} team={team} data={data} update={update} refreshTeams={refreshTeams} coachId={coachId} refreshLibrary={refreshLibrary} onBack={()=>setViewPlayer(null)}/>
  </div>);
  return (<div style={{paddingBottom:80}} onClick={()=>setOpenMenu(null)}>
    {!fixedTeamId&&(<div className="sechdr mb8">
      <div>{data.teams.length>1&&<select className="sel" style={{maxWidth:200}} value={teamId} onChange={e=>{setTeamId(e.target.value);setConfirmDel(false);}}>{data.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>}</div>
      <button className="btn primary bsm" onClick={e=>{e.stopPropagation();openModal("addTeam");}}>+ Team</button>
    </div>)}
    {team&&(<div>
      <div className="card mb8" style={{position:"relative"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:900}}>{team.name}</div><div className="td" style={{fontSize:12}}>{team.sport}</div></div>
          {canManage&&<button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu==="__team__"?null:"__team__");}}><span/><span/><span/></button>}
        </div>
        {canManage&&openMenu==="__team__"&&(<div className="mini-menu" style={{right:8,top:44}}>
          <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editTeam",{team});}}>Edit Team</button>
          <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);setConfirmDel(c=>!c);}}>Delete Team</button>
        </div>)}
        {confirmDel&&<div className="confirm-box"><div className="confirm-title">Delete team?</div><div className="confirm-body">Permanently removes this team. Cannot be undone.</div><div className="brow"><button className="btn ghost bsm" onClick={()=>setConfirmDel(false)}>Cancel</button><button className="btn danger bsm" onClick={delTeam}>Delete</button></div></div>}
      </div>
      <div className="itabs">
        <button className={"itab "+(tab==="players"?"on":"")} onClick={()=>setTab("players")}>Players ({team.players.length})</button>
        <button className={"itab "+(tab==="coaches"?"on":"")} onClick={()=>setTab("coaches")}>Coaches ({team.coaches.length})</button>
      </div>
      {tab==="players"&&(<div>
        <div className="sechdr mb8">
          <div className="row"><span className="sectitle">{team.players.length} Players</span>
            <div style={{position:"relative"}}>
              <button className="sort-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu==="__sort__"?null:"__sort__");}}><Ic.Sort/></button>
              {openMenu==="__sort__"&&(<div className="mini-menu" style={{left:0,minWidth:160}}>
                {[
                  {by:"firstName",dir:"asc",label:"First Name A-Z"},
                  {by:"firstName",dir:"desc",label:"First Name Z-A"},
                  {by:"lastName",dir:"asc",label:"Last Name A-Z"},
                  {by:"lastName",dir:"desc",label:"Last Name Z-A"},
                  {by:"jersey",dir:"asc",label:"# Low-High"},
                  {by:"jersey",dir:"desc",label:"# High-Low"},
                ].map(opt=>(<button key={opt.by+opt.dir} className="mm-item" onClick={e=>{e.stopPropagation();setSort({by:opt.by,dir:opt.dir});setOpenMenu(null);}}>
                  {sort.by===opt.by&&sort.dir===opt.dir?"* ":""}{opt.label}
                </button>))}
              </div>)}
            </div>
          </div>
          {canManage&&<button className="btn outline bsm" onClick={e=>{e.stopPropagation();openModal("addPlayer",{teamId});}}>+ Add</button>}
        </div>
        {sorted.map(p=>(<div key={p.id} className="li tap" style={{position:"relative"}} onClick={()=>setViewPlayer(p)}>
          <div className="lim">
            <div className="lin">{p.jersey?"#"+p.jersey+" ":""}{p.firstName} {p.lastName}{p.positions&&p.positions.length>0?" · "+p.positions.join("/"):""}</div>
            {(p.focusAreas&&p.focusAreas.length>0)&&<div className="limt">{p.focusAreas.length} focus area{p.focusAreas.length>1?"s":""}</div>}
            {(!p.focusAreas||!p.focusAreas.length)&&p.notes&&<div className="limt">{p.notes}</div>}
          </div>
          {canManage&&<button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===p.id?null:p.id);}}><span/><span/><span/></button>}
          {canManage&&openMenu===p.id&&<div className="mini-menu"><button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);setViewPlayer(p);}}>View Profile</button><button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editPlayer",{teamId,player:p});}}>Edit</button><button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);delP(p.id);}}>Remove</button></div>}
        </div>))}
        {!team.players.length&&<div className="empty"><div className="emtx">No players yet{canManage?" -- tap + Add.":"."}</div></div>}
      </div>)}
      {tab==="coaches"&&(<div>
        <div className="sechdr mb8"><span className="sectitle">{team.coaches.length} Coaches</span>{canManage&&<button className="btn outline bsm" onClick={e=>{e.stopPropagation();openModal("addCoach",{teamId});}}>+ Add</button>}</div>
        {team.coaches.map(c=>(<div key={c.id} className="li" style={{position:"relative"}}>
          <div className="lim"><div className="lin">{c.name}</div><div className="limt">{c.role}{!c.userId&&c.inviteEmail?" · Invite pending ("+c.inviteEmail+")":""}</div></div>
          {canManage&&<button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu==="coach_"+c.id?null:"coach_"+c.id);}}><span/><span/><span/></button>}
          {canManage&&openMenu==="coach_"+c.id&&<div className="mini-menu"><button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editCoach",{teamId,coach:c});}}>Edit</button><button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);delC(c.id);}}>Remove</button></div>}
        </div>))}
      </div>)}
    </div>)}
    {!team&&<div className="empty"><div className="emtx">Create a team to get started</div></div>}
  </div>);
}

function NotesTab({data,update}){
  const [txt,setTxt]=useState("");const [ctx,setCtx]=useState("");
  const [search,setSearch]=useState("");const [filterCtx,setFilterCtx]=useState("");
  const add=()=>{if(!txt.trim())return;update(d=>{d.notes.push({id:uid(),text:txt,context:ctx,date:new Date().toISOString()});return d;});setTxt("");setCtx("");};
  const del=id=>update(d=>{d.notes=d.notes.filter(n=>n.id!==id);return d;});
  const allCtx=[...new Set(data.notes.map(n=>n.context).filter(Boolean))].sort();
  const filtered=data.notes.filter(n=>{const q=search.toLowerCase();return(!q||(n.text.toLowerCase().includes(q)||(n.context||"").toLowerCase().includes(q)))&&(!filterCtx||n.context===filterCtx);}).slice().reverse();
  const grouped=filtered.reduce((acc,n)=>{const d=n.date.slice(0,10);if(!acc[d])acc[d]=[];acc[d].push(n);return acc;},{});
  const groupDates=Object.keys(grouped).sort().reverse();
  const fmtD=ds=>{const today=localDateStr();const yest=localDateStr(new Date(Date.now()-864e5));if(ds===today)return "Today";if(ds===yest)return "Yesterday";return new Date(ds+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});};
  return (<div style={{paddingBottom:80}}>
      <div className="card mb10">
        <div className="fld"><label className="lbl">Context</label><input className="inp" placeholder="e.g. Weston, Shooting" value={ctx} onChange={e=>setCtx(e.target.value)}/></div>
        <div className="fld"><label className="lbl">Note</label><textarea className="ta" placeholder="What did you observe?" value={txt} onChange={e=>setTxt(e.target.value)}/></div>
        <button className="btn primary bsm bfull" onClick={add}>Save Note</button>
      </div>
      {data.notes.length>0&&(<div>
          <div className="fld" style={{position:"relative"}}>
            <svg style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",width:15,height:15,stroke:"var(--td)",fill:"none",strokeWidth:2}} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className="inp" style={{paddingLeft:32}} placeholder="Search notes..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          {allCtx.length>0&&(<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {allCtx.map(c=>(<button key={c} onClick={()=>setFilterCtx(filterCtx===c?"":c)} style={{padding:"4px 10px",borderRadius:20,border:"1px solid",fontSize:12,fontWeight:600,cursor:"pointer",background:filterCtx===c?"var(--green)":"#fff",color:filterCtx===c?"#fff":"var(--tm)",borderColor:filterCtx===c?"var(--green)":"var(--b)"}}>{c}</button>
              ))}
            </div>
          )}
          {filtered.length===0&&<div className="empty"><div className="emtx">No notes match</div></div>}
          {groupDates.map(d=>(<div key={d}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:6,marginTop:4}}>{fmtD(d)}</div>
              {grouped[d].map(n=>(<div key={n.id} className="notec">
                  <div className="notect">{n.context&&<button onClick={()=>setFilterCtx(filterCtx===n.context?"":n.context)} style={{background:"none",border:"none",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700,color:"var(--green2)",marginRight:4,padding:0}}>{n.context} -</button>}{new Date(n.date).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</div>
                  <div className="notetx">{n.text}</div>
                  <button className="btn danger bxs mt6" onClick={()=>del(n.id)}>Delete</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {!data.notes.length&&<div className="empty"><div className="emtx">No notes yet</div></div>}
    </div>
  );
}

