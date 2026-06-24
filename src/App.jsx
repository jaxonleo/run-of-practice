import React, { useState, useEffect, useRef, useCallback } from "react";
import { loadData, saveData, flushSave, setCoachKey, getCoaches, registerCoach } from "./supabase.js";
import { uid, fmt12, fmt, actSecs, sumMins, shuffle, mkGroups, rebalanceKeep, rebalanceEven, SPORTS, INIT, DEMO_INIT, migrateData } from "./constants.js";
import ModalLayer from "./components/ModalLayer.jsx";
import NewLibraryScreen, { ActConfig, ChecklistConfig, StationConfig } from "./components/NewLibraryScreen.jsx";
import CommandScreen, { HelperView, HistoryViewer } from "./components/CommandScreen.jsx";

// INIT, DEMO_INIT, migrateData, uid, fmt, sumMins, etc. imported from constants.js

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
.inp,.sel,.ta{width:100%;background:#fff;border:1.5px solid var(--b);border-radius:var(--rs);color:var(--black);padding:10px 12px;font-family:'Barlow',sans-serif;font-size:15px;-webkit-appearance:none;}
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

const Ic={
  Build:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
  Run:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  Lib:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
  Admin:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
  Dots:()=><svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><circle cx="4" cy="3.5" r="1.4"/><circle cx="10" cy="3.5" r="1.4"/><circle cx="4" cy="7" r="1.4"/><circle cx="10" cy="7" r="1.4"/><circle cx="4" cy="10.5" r="1.4"/><circle cx="10" cy="10.5" r="1.4"/></svg>,
  Chev:({up})=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points={up?"4 10 8 6 12 10":"4 6 8 10 12 6"}/></svg>,
  Check:()=><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="2 7 6 11 12 3"/></svg>,
  Play:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" stroke="none"><polygon points="7 4 20 12 7 20 7 4"/></svg>,
  Pause:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" stroke="none"><rect x="5" y="3" width="4" height="18" rx="1"/><rect x="15" y="3" width="4" height="18" rx="1"/></svg>,
  Restart:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
  Sort:()=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="10" y2="8"/><line x1="2" y1="12" x2="6" y2="12"/></svg>,
  Home:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
};

function PracticeDetail({practice,data,update,setView,setLiveId,setEditPracticeId,onBack}){
  const team=data.teams.find(t=>t.id===practice.teamId);
  const loc=data.locations.find(l=>l.id===practice.locationId);
  const now=new Date();
  const todayStr=now.toISOString().slice(0,10);
  const timeLbl=p=>{if(!p.startTime)return "";const pts=p.startTime.split(":");const h=parseInt(pts[0]);const m=parseInt(pts[1]);return (h%12||12)+":"+(m<10?"0"+m:m)+(h>=12?" PM":" AM");};
  const actLabel=a=>{if(a.type==="station_block")return "Station Block - "+a.stations.length+" stations";if(a.type==="checklist")return "Checklist";return a.name;};
  const actMins=a=>{if(a.type==="station_block")return a.stations.length*a.stationDuration+Math.max(0,a.stations.length-1)*a.transitionDuration;return a.duration||0;};
  const totalMins=(practice.activities||[]).reduce((s,a)=>s+actMins(a),0);
  const equipmentNeeded=[...new Set((practice.activities||[]).filter(a=>a.equipment).map(a=>a.equipment))];
  return (<div style={{paddingBottom:80}}>
    <div style={{padding:"12px 14px 0",display:"flex",alignItems:"center",gap:8}}><button className="btn ghost bxs" onClick={onBack}>Back</button></div>
    <div style={{padding:"12px 16px 0"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:2}}>{practice.date===todayStr?"TODAY":"PRACTICE"} {practice.date&&new Date(practice.date+"T12:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,lineHeight:1,marginBottom:2}}>{team?team.name:"Practice"}</div>
      <div style={{fontSize:13,color:"var(--td)",marginBottom:12}}>{timeLbl(practice)}{loc?" - "+loc.name:""} - {totalMins}min</div>
      <div className="brow" style={{marginBottom:16}}>
        <button className="btn primary bmd bfull" onClick={()=>{const now=new Date();const newId=uid();const copy=JSON.parse(JSON.stringify(practice));copy.id=newId;copy.date=now.toISOString().slice(0,10);copy.startTime=now.toTimeString().slice(0,5);update(d=>{d.practices.push(copy);return d;});setEditPracticeId(newId);setView("builder");}}>{practice.date>=new Date().toISOString().slice(0,10)?"Run Now":"Run Again"}</button>
      </div>
      {equipmentNeeded.length>0&&<div className="card" style={{marginBottom:12,background:"var(--ambg)",border:"1.5px solid var(--ambb)"}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--amber)",marginBottom:6}}>Equipment Needed</div>
        {equipmentNeeded.map((eq,i)=>(<div key={i} style={{fontSize:14,color:"var(--black)",marginBottom:2}}>- {eq}</div>))}
      </div>}
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Run Order</div>
      {(practice.activities||[]).map((a,i)=>(<div key={a.id} style={{display:"flex",alignItems:"center",padding:"10px 12px",background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",marginBottom:6}}>
        <div style={{width:24,height:24,borderRadius:"50%",background:"var(--s2)",border:"1px solid var(--b)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"var(--td)",flexShrink:0,marginRight:10}}>{i+1}</div>
        <div style={{flex:1}}><div style={{fontSize:14,fontWeight:600,color:"var(--black)"}}>{actLabel(a)}</div>{a.coachingPoints&&<div style={{fontSize:12,color:"var(--td)",marginTop:2}}>{a.coachingPoints.slice(0,60)}{a.coachingPoints.length>60?"...":""}</div>}</div>
        <span style={{fontFamily:"DM Mono,monospace",fontSize:12,fontWeight:600,color:"var(--td)",flexShrink:0}}>{actMins(a)}m</span>
      </div>))}
    </div>
  </div>);
}

function TeamsScreen({data,update,setView,setLiveId,coachId,openModal,setEditPracticeId}){
  const [selectedTeam,setSelectedTeam]=useState(null);
  const [teamTab,setTeamTab]=useState("practices");
  const [selectedPractice,setSelectedPractice]=useState(null);
  const coachTeams=data.teams.filter(t=>t.coaches.some(c=>c.id===coachId));
  const myTeams=coachTeams.length>0?coachTeams:data.teams;
  const [practiceMenuId,setPracticeMenuId]=useState(null);
  const delPractice=id=>{update(d=>{d.practices=d.practices.filter(p=>p.id!==id);return d;});if(selectedPractice&&selectedPractice.id===id)setSelectedPractice(null);};
  const now=new Date();
  const todayStr=now.toISOString().slice(0,10);
  const timeLbl=p=>{if(!p.startTime)return "";const pts=p.startTime.split(":");const h=parseInt(pts[0]);const m=parseInt(pts[1]);return (h%12||12)+":"+(m<10?"0"+m:m)+(h>=12?" PM":" AM");};
  if(selectedPractice){
    const isPast=selectedPractice.date<new Date().toISOString().slice(0,10);
    if(isPast)return(<div style={{padding:"14px 14px calc(var(--tab)+40px)"}}><HistoryViewer data={data} update={update} practice={selectedPractice} onRunAgain={()=>{const now=new Date();const newId=uid();const copy=JSON.parse(JSON.stringify(selectedPractice));copy.id=newId;copy.date=now.toISOString().slice(0,10);copy.startTime=now.toTimeString().slice(0,5);update(d=>{d.practices.push(copy);return d;});setSelectedPractice(null);setLiveId(newId);setView("command");}} onBack={()=>setSelectedPractice(null)}/></div>);
    return (<PracticeDetail practice={selectedPractice} data={data} update={update} setView={setView} setLiveId={setLiveId} setEditPracticeId={setEditPracticeId} onBack={()=>setSelectedPractice(null)}/>);
  }
  if(selectedTeam){
    const team=data.teams.find(t=>t.id===selectedTeam);
    if(!team)return null;
    const teamPractices=data.practices.filter(p=>p.teamId===selectedTeam);
    const upcoming=teamPractices.filter(p=>p.date>=todayStr).sort((a,b)=>a.date>b.date?1:-1);
    const past=teamPractices.filter(p=>p.date<todayStr).sort((a,b)=>b.date>a.date?1:-1);
    const TTABS=["practices","roster","history"];
    return (<div style={{paddingBottom:80}}>
      <div style={{padding:"12px 14px 0",display:"flex",alignItems:"center",gap:8}}><button className="btn ghost bxs" onClick={()=>setSelectedTeam(null)}>Teams</button></div>
      <div style={{padding:"8px 16px 12px"}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,lineHeight:1,marginBottom:2}}>{team.name}</div>
        <div style={{fontSize:13,color:"var(--td)",marginBottom:14}}>{team.sport} - {team.players.length} players</div>
        <div style={{display:"flex",gap:0,background:"var(--s2)",borderRadius:"var(--r)",padding:3,marginBottom:16}}>
          {TTABS.map(t=>(<button key={t} onClick={()=>setTeamTab(t)} style={{flex:1,padding:"8px 0",border:"none",cursor:"pointer",borderRadius:"calc(var(--r) - 2px)",background:teamTab===t?"#fff":"transparent",fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".04em",textTransform:"uppercase",color:teamTab===t?"var(--black)":"var(--td)"}}>{t}</button>))}
        </div>
        {teamTab==="practices"&&<div>
          <div className="sechdr" style={{marginBottom:8}}><span className="sectitle">{upcoming.length>0?"Upcoming":"Practices"}</span><button className="btn primary bxs" onClick={()=>{setEditPracticeId(null);setView("builder");}}>+ Build</button></div>
          {upcoming.length===0&&<div style={{padding:"20px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No upcoming practices. Tap + Build.</div>}
          {upcoming.map(p=>(<div key={p.id} className="li" style={{marginBottom:6,cursor:"pointer",position:"relative"}} onClick={()=>setSelectedPractice(p)}>
            <div className="lim"><div className="lin">{new Date(p.date+"T12:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}{p.startTime?" - "+timeLbl(p):""}</div><div className="limt">{(p.activities||[]).length} activities</div></div>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{color:"var(--green)",fontSize:18}}>&#8250;</span>
              <div style={{position:"relative"}}>
                <button className="ell-btn" onClick={e=>{e.stopPropagation();setPracticeMenuId(practiceMenuId===p.id?null:p.id);}}><span/><span/><span/></button>
                {practiceMenuId===p.id&&<div className="mini-menu" style={{right:0,minWidth:140}}>
                  <button className="mm-item" onClick={e=>{e.stopPropagation();setPracticeMenuId(null);setEditPracticeId(p.id);setView("builder");}}>Edit</button>
                  <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();delPractice(p.id);setPracticeMenuId(null);}}>Delete</button>
                </div>}
              </div>
            </div>
          </div>))}
          </div>}
        {teamTab==="roster"&&<div><RostersTab data={data} update={update} openModal={openModal} fixedTeamId={selectedTeam}/></div>}
        {teamTab==="history"&&<div>
          {past.length===0&&<div style={{padding:"20px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No practice history yet.</div>}
          {past.map(p=>{
            const practiceNotes=(data.notes||[]).filter(n=>n.practiceId===p.id);
            return(<div key={p.id} className="card" style={{marginBottom:10,cursor:"pointer"}} onClick={()=>setSelectedPractice(p)}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:900}}>{new Date(p.date+"T12:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}</div>
                  <div style={{fontSize:12,color:"var(--td)"}}>{(p.activities||[]).length} activities · {(p.activities||[]).reduce((s,a)=>{if(a.type==="station_block")return s+a.stations.length*a.stationDuration+Math.max(0,a.stations.length-1)*(a.transitionDuration||0);return s+(a.duration||0);},0)}min{practiceNotes.length>0?" · "+practiceNotes.length+" note"+(practiceNotes.length>1?"s":""):""}</div>
                </div>
                <span style={{color:"var(--td)",fontSize:13}}>&#8250;</span>
              </div>
            </div>);
          })}
        </div>}
      </div>
    </div>);
  }
  return (<div style={{paddingBottom:80}}>
    <div style={{padding:"20px 16px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900}}>Teams</div>
      <button className="btn primary bsm" onClick={()=>openModal("addTeam")}>+ Team</button>
    </div>
    <div style={{padding:"0 16px"}}>
      {myTeams.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>No teams yet. Tap + Team to get started.</div>}
      {myTeams.map(t=>(<div key={t.id} className="card" style={{marginBottom:10,cursor:"pointer"}} onClick={()=>{setSelectedTeam(t.id);setTeamTab("practices");}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,lineHeight:1,marginBottom:2}}>{t.name}</div><div style={{fontSize:13,color:"var(--td)"}}>{t.sport} - {t.players.length} players</div></div>
          <span style={{color:"var(--green)",fontSize:22}}>›</span>
        </div>
      </div>))}
    </div>
  </div>);
}

function SplashScreen({onSelect,coaches}){
  const [adding,setAdding]=useState(false);
  const [newName,setNewName]=useState("");
  const save=()=>{
    if(!newName.trim())return;
    const nm=newName.trim();
    const cid="coach_"+nm.toLowerCase().replace(/[^a-z0-9]/g,"")+"_"+Math.random().toString(36).slice(2,6);
    onSelect(cid,nm);
  };
  return (<div style={{height:"100dvh",display:"flex",flexDirection:"column",background:"var(--black)",overflowY:"auto"}}>
    
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px 24px"}}>
      <div style={{width:96,height:96,borderRadius:22,overflow:"hidden",marginBottom:20,boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}>
        <img src="/apple-touch-icon.png" style={{width:"100%",height:"100%",objectFit:"cover"}} alt="Run of Practice"/>
      </div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:38,fontWeight:900,color:"#fff",letterSpacing:"-.01em",lineHeight:1,marginBottom:6,textAlign:"center"}}>Run of Practice</div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:14,fontWeight:600,letterSpacing:".12em",textTransform:"uppercase",color:"var(--green)",textAlign:"center"}}>Organize. Execute. Elevate.</div>
    </div>
    <div style={{background:"#fff",borderRadius:"24px 24px 0 0",padding:"28px 20px 48px"}}>
      <div style={{width:36,height:4,background:"var(--b)",borderRadius:2,margin:"0 auto 24px"}}/>
      {!adding&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,marginBottom:4}}>{coaches.length>0?"Who's coaching today?":"Welcome, Coach"}</div>
        <div style={{fontSize:14,color:"var(--td)",marginBottom:20}}>{coaches.length>0?"Select your name to continue.":"Get started by entering your name."}</div>
        {coaches.map(c=>(<button key={c.id} onClick={()=>onSelect(c.id,c.name)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:"var(--s1)",cursor:"pointer",marginBottom:8}}><span style={{fontSize:16,fontWeight:600}}>{c.name}</span><span style={{color:"var(--green)",fontSize:20,fontWeight:700}}>&#8594;</span></button>))}
        <button onClick={()=>setAdding(true)} style={{width:"100%",display:"flex",alignItems:"center",gap:12,padding:"14px 16px",borderRadius:"var(--r)",border:"1.5px dashed var(--gb)",background:"transparent",cursor:"pointer",marginBottom:8}}>
          <span style={{width:28,height:28,borderRadius:"50%",background:"var(--gbg)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--green)",fontSize:20,fontWeight:700,flexShrink:0}}>+</span>
          <span style={{fontSize:16,fontWeight:600,color:"var(--green)"}}>{coaches.length>0?"New Coach":"Get Started"}</span>
        </button>
      </div>}
      {adding&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,marginBottom:4}}>Welcome, Coach</div>
        <div style={{fontSize:14,color:"var(--td)",marginBottom:20}}>Enter your name to get started.</div>
        <div className="fld mb10">
          <label className="lbl">Your Name</label>
          <input className="inp" autoFocus placeholder="e.g. Coach Johnson" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")save();}}/>
        </div>
        <div className="brow">
          {coaches.length>0&&<button className="btn ghost bmd" onClick={()=>setAdding(false)}>Back</button>}
          <button className="btn primary bmd" style={{flex:1}} onClick={save} disabled={!newName.trim()}>Get Started</button>
        </div>
      </div>}
    </div>
  </div>);
}
function TodayScreen({data,update,setView,setLiveId,coachId,coachName,onSwitchCoach,setEditPracticeId}){
  const now=new Date();
  const todayStr=now.toISOString().slice(0,10);
  const hour=now.getHours();
  const myPractices=data.practices;
  const todayPractices=myPractices.filter(p=>{
    if(p.date!==todayStr)return false;
    if(!p.startTime)return true;
    const pts=p.startTime.split(":");
    const pm=parseInt(pts[0])*60+parseInt(pts[1]);
    const nm=now.getHours()*60+now.getMinutes();
    return pm-nm<=480&&pm-nm>=-180;
  }).sort((a,b)=>a.startTime>b.startTime?1:-1);
  const myTemplates=data.templates||[];
  const upcoming=myPractices.filter(p=>p.date>todayStr).sort((a,b)=>a.date>b.date?1:a.date<b.date?-1:0).slice(0,3);
  const recent=myPractices.filter(p=>p.date<todayStr).sort((a,b)=>b.date>a.date?1:-1).slice(0,3);
  const getTeam=id=>data.teams.find(t=>t.id===id);
  const getLoc=id=>data.locations.find(l=>l.id===id);
  const timeLbl=p=>{if(!p.startTime)return "";const pts=p.startTime.split(":");const h=parseInt(pts[0]);const m=parseInt(pts[1]);return (h%12||12)+":"+(m<10?"0"+m:m)+(h>=12?" PM":" AM");};
  const isSoon=p=>{if(!p.startTime||p.date!==todayStr)return false;const pts=p.startTime.split(":");const pm=parseInt(pts[0])*60+parseInt(pts[1]);const nm=now.getHours()*60+now.getMinutes();return pm-nm<=120&&pm-nm>=-90;};
  const greeting=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";
  const [practiceMenuId,setPracticeMenuId]=useState(null);
  const [viewPractice,setViewPractice]=useState(null);
  const delPractice=id=>{update(d=>{d.practices=d.practices.filter(p=>p.id!==id);return d;});if(viewPractice&&viewPractice.id===id)setViewPractice(null);};
  if(viewPractice)return (<div style={{padding:"0 0 calc(var(--tab) + 20px)"}}><PracticeDetail practice={viewPractice} data={data} update={update} setView={setView} setLiveId={setLiveId} setEditPracticeId={setEditPracticeId} onBack={()=>setViewPractice(null)}/></div>);
  return (<div style={{padding:"0 0 calc(var(--tab) + 20px)"}}>
    <div style={{padding:"20px 16px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:26,fontWeight:900,lineHeight:1}}>{greeting},</div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:26,fontWeight:900,color:"var(--green)",lineHeight:1}}>{coachName}</div>
      </div>
      <button onClick={()=>{if(onSwitchCoach)onSwitchCoach();}} style={{background:"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"50%",width:40,height:40,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </button>
    </div>
    <div style={{padding:"0 16px"}}>
      {todayPractices.length===0&&<div className="card" style={{marginBottom:12,textAlign:"center",padding:"28px 20px"}}>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:700,marginBottom:4}}>Nothing scheduled today</div>
        <div style={{fontSize:13,color:"var(--td)",marginBottom:16}}>Build a practice or schedule one for later.</div>
        <button className="btn primary bmd bfull" onClick={()=>setView("builder")}>+ Build a Practice</button>
      </div>}
      {todayPractices.map(p=>{const team=getTeam(p.teamId);const loc=getLoc(p.locationId);const soon=isSoon(p);return (<div key={p.id} className="card" style={{marginBottom:12,borderColor:soon?"var(--green)":"var(--b)",borderWidth:soon?2:1.5}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {soon&&<span style={{background:"var(--green)",color:"#fff",fontFamily:"Barlow Condensed,sans-serif",fontSize:10,fontWeight:700,letterSpacing:".08em",padding:"2px 8px",borderRadius:20}}>TODAY</span>}
            <span style={{fontSize:13,color:"var(--td)",fontWeight:600}}>{timeLbl(p)}</span>
          </div>
          <div style={{position:"relative"}}>
            <button className="ell-btn" onClick={e=>{e.stopPropagation();setPracticeMenuId(practiceMenuId===p.id?null:p.id);}}><span/><span/><span/></button>
            {practiceMenuId===p.id&&<div className="mini-menu" style={{right:0,minWidth:140}}>
              <button className="mm-item" onClick={()=>{setPracticeMenuId(null);if(setEditPracticeId)setEditPracticeId(p.id);setView("builder");}}>Edit</button>
              <button className="mm-item mm-danger" onClick={()=>{delPractice(p.id);setPracticeMenuId(null);}}>Delete</button>
            </div>}
          </div>
        </div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,lineHeight:1,marginBottom:2}}>{team?team.name:"Practice"}</div>
        {loc&&<div style={{fontSize:13,color:"var(--td)",marginBottom:10}}>{loc.name}</div>}
        <div style={{fontSize:12,color:"var(--td)",marginBottom:12}}>{(p.activities||[]).length} activities</div>
        {soon&&<button className="btn primary bxl bfull" onClick={()=>{setLiveId(p.id);setView("command");}}>Start Practice &#8594;</button>}
        {!soon&&<div className="brow"><button className="btn ghost bmd" style={{flex:1}} onClick={()=>{if(setEditPracticeId)setEditPracticeId(p.id);setView("builder");}}>Edit</button><button className="btn primary bmd" style={{flex:1}} onClick={()=>{setLiveId(p.id);setView("command");}}>Run Now</button></div>}
      </div>);})} 
      {upcoming.length>0&&<div>
        <div className="sechdr" style={{marginBottom:8}}><span className="sectitle">Coming Up</span></div>
        {upcoming.map(p=>{const team=getTeam(p.teamId);const d=new Date(p.date+"T12:00:00");const dl=d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});return (<div key={p.id} className="li" style={{marginBottom:6}}>
          <div className="lim"><div className="lin">{team?team.name:"Practice"}</div><div className="limt">{dl}{p.startTime?" - "+timeLbl(p):""}</div></div>
          <button className="btn ghost bxs" onClick={()=>setViewPractice(p)}>View</button>
        </div>);})}
      </div>}
      {recent.length>0&&<div style={{marginTop:16}}>
        <div className="sechdr" style={{marginBottom:8}}><span className="sectitle">Recent</span></div>
        {recent.map(p=>{const team=getTeam(p.teamId);const d=new Date(p.date+"T12:00:00");const dl=d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});return (<div key={p.id} className="li" style={{marginBottom:6,position:"relative"}}>
          <div className="lim"><div className="lin">{team?team.name:"Practice"}</div><div className="limt">{dl} - {(p.activities||[]).length} activities</div></div>
          <div style={{position:"relative"}}>
            <button className="ell-btn" onClick={e=>{e.stopPropagation();setPracticeMenuId(practiceMenuId===p.id?null:p.id);}}><span/><span/><span/></button>
            {practiceMenuId===p.id&&<div className="mini-menu" style={{right:0,minWidth:160}}>
              <button className="mm-item" onClick={()=>{setPracticeMenuId(null);const now=new Date();const newId=uid();const copy=JSON.parse(JSON.stringify(p));copy.id=newId;copy.date=now.toISOString().slice(0,10);copy.startTime=now.toTimeString().slice(0,5);update(d=>{d.practices.push(copy);return d;});if(setEditPracticeId)setEditPracticeId(newId);setView("builder");}}>Run Again</button>
              <button className="mm-item mm-danger" onClick={()=>{delPractice(p.id);setPracticeMenuId(null);}}>Delete</button>
            </div>}
          </div>
        </div>);})}
      </div>}
      <div style={{marginTop:20,display:"flex",gap:8}}>
        <button className="btn outline bmd" style={{flex:1}} onClick={()=>{if(setEditPracticeId)setEditPracticeId(null);setView("builder");}}>+ Build Practice</button>
        <button className="btn ghost bmd" style={{flex:1}} onClick={()=>{setView("library");setTimeout(()=>{window.__ropLibTab&&window.__ropLibTab("templates");},50);}}>Use Template</button>
      </div>
    </div>
  </div>);
}

export default function App(){
  const [data,setData]=useState(INIT);
  useEffect(()=>{let el=document.getElementById('rop-css');if(!el){el=document.createElement('style');el.id='rop-css';document.head.appendChild(el);}el.textContent=CSS;},[]);
  const [loaded,setLoaded]=useState(false);
  const [view,setView]=useState("today");
  const [modal,setModal]=useState(null);
  const [liveId,setLiveId]=useState(null);
  const [editPracticeId,setEditPracticeId]=useState(null);
  const [coachId,setCoachId]=useState(null);
  const [coaches,setCoaches]=useState([]);
  const [coachesLoaded,setCoachesLoaded]=useState(false);
  const [showCoachSelect,setShowCoachSelect]=useState(false);
  const update=useCallback(fn=>{setData(d=>{const nx=fn(JSON.parse(JSON.stringify(d)));saveData(nx);return nx;});},[]);
  useEffect(()=>{
    if(typeof window!=="undefined"&&window.localStorage){localStorage.removeItem("rop_coach_id");localStorage.removeItem("rop_coach_name");}
    getCoaches().then(list=>{setCoaches(list);setCoachesLoaded(true);});
  },[]);
  useEffect(()=>{
    if(!coachId)return;
    setCoachKey(coachId);
    loadData().then(raw=>{
      if(raw===null){const template=coachId==="coach_demo"?DEMO_INIT:INIT;const seeded=migrateData(JSON.parse(JSON.stringify(template)));setData(seeded);flushSave(seeded);}
      else{setData(migrateData(raw));}
      setLoaded(true);
    });
  },[coachId]);
  const openModal=(t,p)=>setModal({type:t,payload:p||{}});
  const closeModal=()=>setModal(null);
  const launchRun=id=>{if(id)setLiveId(id);setView("command");};
  useEffect(()=>{window.__cbSetView=setView;return()=>{delete window.__cbSetView;};},[]);
  const TABS=[
    {id:"today",label:"Today",I:Ic.Home},
    {id:"teams",label:"Teams",I:Ic.Build},
    {id:"library",label:"Library",I:Ic.Run},
  ];
  // needsCoach handled by full-screen SplashScreen route above
  const selectCoach=(id,name)=>{setCoachKey(id);setCoachId(id);setShowCoachSelect(false);if(name){registerCoach(id,name).then(()=>getCoaches().then(list=>setCoaches(list)));}setLoaded(false);loadData().then(raw=>{if(raw===null){const template=coachId==="coach_demo"?DEMO_INIT:INIT;const seeded=migrateData(JSON.parse(JSON.stringify(template)));setData(seeded);flushSave(seeded);}else{setData(migrateData(raw));}setLoaded(true);});};
  const coachName=(coaches.find(c=>c.id===coachId)||{}).name||"Coach";
  const liveMatch=window.location.pathname.match(/^\/live\/([a-z0-9]+)$/i);
  if(liveMatch)return (<HelperView sessionId={liveMatch[1]}/>);
  // Show splash until coaches are loaded
  if(!coachesLoaded)return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--black)"}}><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:700,color:"var(--green)"}}>Loading...</div></div>);
  // Show splash if no coach selected
  if(!coachId)return (<SplashScreen coaches={coaches} onSelect={selectCoach}/>);
  // Show data loading spinner after coach selected but data not loaded yet
  if(!loaded)return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--black)"}}><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:700,color:"var(--green)"}}>Loading your data...</div></div>);

  return (<div style={{display:"contents"}}>
    <div className="app">
      <div className="screen">
        {view==="today"&&<TodayScreen data={data} update={update} setView={setView} setLiveId={setLiveId} coachId={coachId} coachName={coachName} onSwitchCoach={()=>setShowCoachSelect(true)} setEditPracticeId={setEditPracticeId}/>}
        {view==="teams"&&<TeamsScreen data={data} update={update} setView={setView} setLiveId={setLiveId} coachId={coachId} openModal={openModal} setEditPracticeId={setEditPracticeId}/>}
        {view==="library"&&<NewLibraryScreen data={data} update={update} openModal={openModal} setView={setView} setLiveId={setLiveId} launchRun={launchRun} setEditPracticeId={setEditPracticeId}/>}
        {view==="builder"&&<BuilderScreen data={data} update={update} openModal={openModal} launchRun={launchRun} editPracticeId={editPracticeId} setEditPracticeId={setEditPracticeId}/>}
        {view==="command"&&<CommandScreen data={data} update={update} liveId={liveId} setLiveId={setLiveId} coachId={coachId} setView={setView}/>}
      </div>
      {view!=="command"&&<nav className="tabbar">
        {TABS.map(({id,label,I})=>(<button key={id} className={"ti "+(view===id?"on":"")} onClick={()=>setView(id)}>
            {id==="command"&&liveId&&<span className="live" style={{position:"absolute",top:6,right:"calc(50% - 14px)",width:6,height:6}}/>}
            <I/>{label}
          </button>
        ))}
      </nav>}
    </div>
    {modal&&<ModalLayer modal={modal} data={data} update={update} closeModal={closeModal}/>}
    {showCoachSelect&&<div style={{position:"fixed",inset:0,zIndex:300}}><SplashScreen coaches={coaches} onSelect={(id,name)=>{selectCoach(id,name);setShowCoachSelect(false);}}/></div>}
  </div>);
}

function PracticeLog({data,update,launchRun}){
  const [viewPractice,setViewPractice]=useState(null);
  const fmtDate=ds=>{
    const today=new Date().toISOString().slice(0,10);
    const yest=new Date(Date.now()-864e5).toISOString().slice(0,10);
    if(ds===today)return "Today";
    if(ds===yest)return "Yesterday";
    return new Date(ds+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
  };
  const sorted=[...data.practices].sort((a,b)=>b.date.localeCompare(a.date));
  const standalone=data.notes.filter(n=>!n.practiceId);
  if(viewPractice)return(<div style={{paddingBottom:80}}><HistoryViewer data={data} update={update} practice={viewPractice} onRunAgain={()=>{const now=new Date();const newId=uid();const copy=JSON.parse(JSON.stringify(viewPractice));copy.id=newId;copy.date=now.toISOString().slice(0,10);copy.startTime=now.toTimeString().slice(0,5);update(d=>{d.practices.push(copy);return d;});setViewPractice(null);launchRun(newId);}} onBack={()=>setViewPractice(null)}/></div>);
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

function BuilderScreen({data,update,openModal,launchRun,editPracticeId,setEditPracticeId}){
  const editP=editPracticeId?data.practices.find(p=>p.id===editPracticeId):null;
  const [existingId]=useState(editP?editP.id:null);
  const [teamId,setTeamId]=useState(editP?editP.teamId:(data.teams[0]?data.teams[0].id:""));
  const lastLocForTeam=(tid)=>{const tps=data.practices.filter(p=>p.teamId===tid&&p.locationId).sort((a,b)=>b.date>a.date?1:-1);return tps.length?tps[0].locationId:(data.locations[0]?data.locations[0].id:"");};
  const [locId,setLocId]=useState(editP?editP.locationId:lastLocForTeam(editP?editP.teamId:(data.teams[0]?data.teams[0].id:"")));
  const [acts,setActs]=useState(editP?JSON.parse(JSON.stringify(editP.activities)):[]);
  const [expandedId,setExpandedId]=useState(null);
  const [savedTpl,setSavedTpl]=useState(false);
  const [bottomMode,setBottomMode]=useState(null);
  const [schedDate,setSchedDate]=useState(editP?(editP.date||new Date().toISOString().slice(0,10)):new Date().toISOString().slice(0,10));
  const [schedTime,setSchedTime]=useState(editP?(editP.startTime||"16:00"):"16:00");
  const [schedDur,setSchedDur]=useState(60);
  const [tplName,setTplName]=useState("");
  const dragIdx=useRef(null);
  const team=data.teams.find(t=>t.id===teamId)||null;
  const loc=data.locations.find(l=>l.id===locId)||null;
  const teamSport=(team&&team.sport)||"General";
  const filteredLib=data.activityLibrary.filter(a=>(a.sport||"General")===teamSport||(a.sport||"General")==="General");
  const headCoach=(team&&(team.coaches.find(c=>c.role==="Head Coach")||team.coaches[0]))||null;
  const headCoachId=(headCoach&&headCoach.id)||"";
  const allPlayerIds=team?team.players.map(p=>p.id):[];
  const totalMins=sumMins(acts);
  const addAct=lib=>{
    setActs(p=>[...p,{id:uid(),type:"activity",libraryId:lib.id,name:lib.name,duration:lib.duration,assignments:allPlayerIds,coachId:headCoachId,sublocationId:"",notes:"",coachingPoints:lib.coachingPoints||"",grouping:lib.grouping||"whole",numGroups:lib.numGroups||2,playerGear:lib.playerGear||"",equipment:Array.isArray(lib.equipment)?lib.equipment:[]}]);
  };
  const addChecklist=isClose=>{
    const a={id:uid(),type:"checklist",name:isClose?"Closer":"Intro",duration:5,assignments:allPlayerIds,coachId:headCoachId,items:[],notes:""};
    setActs(p=>[...p,a]);setExpandedId(a.id);
  };
  const addBlock=()=>{
    const n=3;const groups=mkGroups(allPlayerIds,n);
    const b={id:uid(),type:"station_block",rotate:true,stationDuration:10,transitionDuration:2,stations:[
      {id:uid(),name:"Station 1",activityName:"",coachId:headCoachId,sublocationId:"",assignments:groups[0]||[],coachingPoints:"",equipment:[],playerGear:""},
      {id:uid(),name:"Station 2",activityName:"",coachId:"",sublocationId:"",assignments:groups[1]||[],coachingPoints:"",equipment:[],playerGear:""},
      {id:uid(),name:"Station 3",activityName:"",coachId:"",sublocationId:"",assignments:groups[2]||[],coachingPoints:"",equipment:[],playerGear:""},
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
  const doSchedule=(dateVal,timeVal,durVal)=>{
    if(!dateVal)return;
    update(d=>{
      d.practices=d.practices.filter(p=>!(p.teamId===teamId&&p.date===dateVal));
      d.practices.push({id:uid(),teamId,date:dateVal,locationId:locId,startTime:timeVal||"",durMin:+(durVal||60),activities:acts});
      return d;
    });
    setBottomMode("done_sched");
  };
  const doSaveTpl=(tname)=>{
    if(!tname.trim())return;
    update(d=>{
      if(!d.templates)d.templates=[];
      const existing=d.templates.findIndex(t=>t.name===tname&&t.sport===teamSport);
      const tpl={id:existing>=0?d.templates[existing].id:uid(),name:tname,sport:teamSport,teamId,activities:JSON.parse(JSON.stringify(acts))};
      if(existing>=0)d.templates[existing]=tpl;
      else d.templates.push(tpl);
      return d;
    });
    setBottomMode("done_tpl");
    setTimeout(()=>setBottomMode(null),2000);
  };
  const handleSave=()=>{
    if(existingId){
      update(d=>{const p=d.practices.find(p=>p.id===existingId);if(p){p.teamId=teamId;p.locationId=locId;p.activities=acts;p.durMin=totalMins;if(schedDate)p.date=schedDate;if(schedTime)p.startTime=schedTime;}return d;});
      if(setEditPracticeId)setEditPracticeId(null);
    }else{
      const now=new Date();const newId=uid();
      update(d=>{d.practices.push({id:newId,teamId,locationId:locId,date:schedDate||now.toISOString().slice(0,10),startTime:schedTime||now.toTimeString().slice(0,5),durMin:totalMins,activities:acts});return d;});
    }
  };
  const handleRun=()=>{
    if(existingId){
      update(d=>{const p=d.practices.find(p=>p.id===existingId);if(p){p.teamId=teamId;p.locationId=locId;p.activities=acts;p.durMin=totalMins;}return d;});
      launchRun(existingId);
    }else{
      const now=new Date();const newId=uid();
      update(d=>{d.practices.push({id:newId,teamId,locationId:locId,date:schedDate||now.toISOString().slice(0,10),startTime:schedTime||now.toTimeString().slice(0,5),durMin:totalMins,activities:acts});return d;});
      launchRun(newId);
    }
  };
  return (<div style={{paddingBottom:80}}>
      <div style={{position:"sticky",top:0,zIndex:10,background:"#fff",borderBottom:"1px solid var(--b)",padding:"8px 14px",display:"flex",gap:6}}>
        {(!bottomMode||bottomMode==="")&&<div style={{display:"flex",gap:6,width:"100%"}}>
          <button className="btn outline bsm" style={{flex:1}} onClick={handleSave}>{existingId?"Save":"Save"}</button>
          <button className="btn outline bsm" style={{flex:1}} onClick={()=>setBottomMode("schedule")}>Schedule</button>
          <button className="btn ghost bsm" style={{flex:1}} onClick={()=>{setTplName("");setBottomMode("template");}}>Template</button>
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
      <div className="card mb10">
        <div className="clbl">Practice Setup</div>
        <div className="fld"><label className="lbl">Team</label>
          <select className="sel" value={teamId} onChange={e=>{const tid=e.target.value;setTeamId(tid);setLocId(lastLocForTeam(tid));}}>
            {!data.teams.length&&<option value="">-- Add a team first --</option>}
            {data.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="fld"><label className="lbl">Location</label>
          <select className="sel" value={locId} onChange={e=>setLocId(e.target.value)}>
            {data.locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
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
                {act.type==="activity"&&<ActConfig assets={data.assets} update={update} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
                {act.type==="checklist"&&<ChecklistConfig act={act} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
                {act.type==="station_block"&&<StationConfig assets={data.assets} update={update} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)} teamSport={teamSport}/>}
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
          <div className="lim"><div className="lin" style={{color:"var(--green)"}}>Station Block</div><div className="limt">3 stations, players auto-split</div></div>
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

function PlayerProfile({player:playerInit,team:teamInit,data,update,onBack}){
  const team=data.teams.find(t=>t.id===teamInit.id)||teamInit;
  const player=team.players.find(p=>p.id===playerInit.id)||playerInit;
  const [newArea,setNewArea]=useState("");
  const addArea=()=>{
    if(!newArea.trim())return;
    if((player.focusAreas||[]).length>=10)return;
    update(d=>{const t=d.teams.find(t=>t.id===team.id);if(t){const p=t.players.find(p=>p.id===player.id);if(p){if(!p.focusAreas)p.focusAreas=[];p.focusAreas.push({id:uid(),text:newArea.trim()});}}return d;});
    setNewArea("");
  };
  const delArea=aId=>update(d=>{const t=d.teams.find(t=>t.id===team.id);if(t){const p=t.players.find(p=>p.id===player.id);if(p)p.focusAreas=(p.focusAreas||[]).filter(a=>a.id!==aId);}return d;});
  const areas=player.focusAreas||[];
  return (<div style={{paddingBottom:80}}>
    <div className="row mb10" style={{justifyContent:"space-between"}}>
      <div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900}}>{player.firstName} {player.lastName}</div>
        <div className="td" style={{fontSize:12}}>{team.name}{player.jersey?" - #"+player.jersey:""}</div>
      </div>
      <button className="btn ghost bxs" onClick={onBack}>Done</button>
    </div>
    <div className="card mb10">
      <div className="clbl mb8">Focus Areas ({areas.length}/10)</div>
      {!areas.length&&<div style={{fontSize:13,color:"var(--td)",marginBottom:10}}>No focus areas yet. Add what this player is working on.</div>}
      {areas.map((a,i)=>(<div key={a.id} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:8,padding:"10px 12px",background:"var(--s2)",borderRadius:"var(--rs)"}}>
        <div style={{width:20,height:20,borderRadius:"50%",background:"var(--green)",color:"#fff",fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{i+1}</div>
        <div style={{flex:1,fontSize:14,lineHeight:1.5,color:"var(--black)"}}>{a.text}</div>
        <button className="btn danger bxs" onClick={()=>delArea(a.id)}>x</button>
      </div>))}
      {areas.length<10&&(<div>
        <div className="fld"><textarea className="ta" style={{minHeight:58}} placeholder="e.g. Keep dribble low and eyes up. Tends to go right only." value={newArea} onChange={e=>setNewArea(e.target.value)}/></div>
        <button className="btn primary bsm bfull" onClick={addArea} disabled={!newArea.trim()}>Add Focus Area</button>
      </div>)}
    </div>
    {player.notes&&(<div className="card"><div className="clbl mb6">Notes</div><div style={{fontSize:14,color:"var(--black)",lineHeight:1.6}}>{player.notes}</div></div>)}
  </div>);
}

function RostersTab({data,update,openModal,fixedTeamId}){
  const [teamId,setTeamId]=useState(fixedTeamId||(data.teams[0]?data.teams[0].id:""));
  const [tab,setTab]=useState("players");
  const [confirmDel,setConfirmDel]=useState(false);
  const [openMenu,setOpenMenu]=useState(null);
  const [sort,setSort]=useState({by:"firstName",dir:"asc"});
  const [viewPlayer,setViewPlayer]=useState(null);
  const team=data.teams.find(t=>t.id===teamId)||null;
  const delP=id=>update(d=>{const t=d.teams.find(t=>t.id===teamId);if(t)t.players=t.players.filter(p=>p.id!==id);return d;});
  const delC=id=>update(d=>{const t=d.teams.find(t=>t.id===teamId);if(t)t.coaches=t.coaches.filter(c=>c.id!==id);return d;});
  const delTeam=()=>{
    const rem=data.teams.filter(t=>t.id!==teamId);
    update(d=>{d.teams=d.teams.filter(t=>t.id!==teamId);d.practices=d.practices.filter(p=>p.teamId!==teamId);d.templates=(d.templates||[]).filter(t=>t.teamId!==teamId);d.notes=d.notes.filter(n=>!n.practiceId||(d.practices.some(p=>p.id===n.practiceId)));return d;});
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
    <PlayerProfile player={viewPlayer} team={team} data={data} update={update} onBack={()=>setViewPlayer(null)}/>
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
          <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu==="__team__"?null:"__team__");}}><span/><span/><span/></button>
        </div>
        {openMenu==="__team__"&&(<div className="mini-menu" style={{right:8,top:44}}>
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
              {openMenu==="__sort__"&&(<div className="mini-menu" style={{right:0,left:"auto",minWidth:160}}>
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
          <button className="btn outline bsm" onClick={e=>{e.stopPropagation();openModal("addPlayer",{teamId});}}>+ Add</button>
        </div>
        {sorted.map(p=>(<div key={p.id} className="li tap" style={{position:"relative"}} onClick={()=>setViewPlayer(p)}>
          <div className="lim">
            <div className="lin">{p.jersey?"#"+p.jersey+" ":""}{p.firstName} {p.lastName}</div>
            {(p.focusAreas&&p.focusAreas.length>0)&&<div className="limt">{p.focusAreas.length} focus area{p.focusAreas.length>1?"s":""}</div>}
            {(!p.focusAreas||!p.focusAreas.length)&&p.notes&&<div className="limt">{p.notes}</div>}
          </div>
          <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===p.id?null:p.id);}}><span/><span/><span/></button>
          {openMenu===p.id&&<div className="mini-menu"><button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);setViewPlayer(p);}}>View Profile</button><button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editPlayer",{teamId,player:p});}}>Edit</button><button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);delP(p.id);}}>Remove</button></div>}
        </div>))}
        {!team.players.length&&<div className="empty"><div className="emtx">No players yet</div></div>}
      </div>)}
      {tab==="coaches"&&(<div>
        <div className="sechdr mb8"><span className="sectitle">{team.coaches.length} Coaches</span><button className="btn outline bsm" onClick={e=>{e.stopPropagation();openModal("addCoach",{teamId});}}>+ Add</button></div>
        {team.coaches.map(c=>(<div key={c.id} className="li" style={{position:"relative"}}>
          <div className="lim"><div className="lin">{c.name}</div><div className="limt">{c.role}</div></div>
          <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu==="coach_"+c.id?null:"coach_"+c.id);}}><span/><span/><span/></button>
          {openMenu==="coach_"+c.id&&<div className="mini-menu"><button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editCoach",{teamId,coach:c});}}>Edit</button><button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);delC(c.id);}}>Remove</button></div>}
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
  const fmtD=ds=>{const today=new Date().toISOString().slice(0,10);const yest=new Date(Date.now()-864e5).toISOString().slice(0,10);if(ds===today)return "Today";if(ds===yest)return "Yesterday";return new Date(ds+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});};
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

