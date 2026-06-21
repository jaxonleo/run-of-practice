import React, { useState, useEffect, useRef, useCallback } from "react";
import { loadData, saveData, flushSave, setCoachKey, getCoaches, registerCoach, getSession, subscribeToSession, createSession, updateSession, endSession } from "./supabase.js";

// Storage imported from supabase.js

const uid=()=>Math.random().toString(36).slice(2,9);
const fmt12=(t)=>{if(!t)return"";const[h,m]=t.split(":").map(Number);const ampm=h>=12?"PM":"AM";const h12=h%12||12;return h12+":"+(m<10?"0":"")+m+" "+ampm;};
const fmt=(s)=>{const neg=s<0;const abs=Math.abs(s);const m=Math.floor(abs/60),sec=abs%60;return(neg?"-":"")+String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0");};
const actSecs=(a)=>{if(a.type==="station_block"){const n=(a.stations?a.stations.length:0);return(n*(a.stationDuration||0)+Math.max(0,n-1)*(a.transitionDuration||0))*60;}return(a.duration||0)*60;};
const sumMins=(acts)=>Math.round(acts.reduce((s,a)=>s+actSecs(a),0)/60);
const shuffle=(arr)=>[...arr].sort(()=>Math.random()-.5);
function mkGroups(ids,n){const s=shuffle(ids),g=Array.from({length:n},()=>[]);s.forEach((id,i)=>g[i%n].push(id));return g;}
function rebalanceKeep(stations,presentIds){return stations.map(st=>Object.assign({},st,{assignments:(st.assignments||[]).filter(id=>presentIds.has(id))}));}
function rebalanceEven(stations,presentIds,allPlayers){const present=allPlayers.filter(p=>presentIds.has(p.id));const n=stations.length;const s=shuffle(present);const g=Array.from({length:n},()=>[]);s.forEach((p,i)=>g[i%n].push(p.id));return stations.map((st,i)=>Object.assign({},st,{assignments:g[i]||[]}));}

const SPORTS=["Basketball","Soccer","Baseball","Lacrosse","Football","Softball","Volleyball","Hockey","Tennis","Swimming"];

// Blank INIT — every new coach starts with a clean slate
const INIT={
  teams:[],
  locations:[],
  assets:[],
  activityLibrary:[],
  practices:[],
  templates:[],
  notes:[],
};

// Demo seed data — only used for the "demo" coach
const DEMO_INIT={
  teams:[{
    id:"team_demo1",name:"Demo Team",sport:"Basketball",
    coaches:[{id:"coach_demo",name:"Coach Demo",role:"Head Coach",notes:""}],
    players:[
      {id:"dp1",firstName:"Alex",lastName:"Smith",jersey:"1",notes:"",focusAreas:[]},
      {id:"dp2",firstName:"Jordan",lastName:"Lee",jersey:"2",notes:"",focusAreas:[]},
      {id:"dp3",firstName:"Casey",lastName:"Brown",jersey:"3",notes:"",focusAreas:[]},
      {id:"dp4",firstName:"Morgan",lastName:"Davis",jersey:"4",notes:"",focusAreas:[]},
      {id:"dp5",firstName:"Riley",lastName:"Wilson",jersey:"5",notes:"",focusAreas:[]},
      {id:"dp6",firstName:"Taylor",lastName:"Moore",jersey:"6",notes:"",focusAreas:[]},
      {id:"dp7",firstName:"Drew",lastName:"Taylor",jersey:"7",notes:"",focusAreas:[]},
      {id:"dp8",firstName:"Quinn",lastName:"Johnson",jersey:"8",notes:"",focusAreas:[]},
    ]
  }],
  locations:[{id:"loc_demo1",name:"Main Gym",sublocations:[
    {id:"sl1",name:"Court A"},{id:"sl2",name:"Court B"},{id:"sl3",name:"Auxiliary Gym"}
  ]}],
  assets:[
    {id:"a1",name:"Basketballs",locationTags:["loc_demo1"]},
    {id:"a2",name:"Cones",locationTags:["loc_demo1"]},
    {id:"a3",name:"Ball Racks",locationTags:["loc_demo1"]},
  ],
  activityLibrary:[
    {id:"dl1",name:"Ball Handling",sport:"Basketball",description:"Dribbling fundamentals",coachingPoints:"Eyes up, stay low",duration:10,equipment:"1 ball per player"},
    {id:"dl2",name:"Passing",sport:"Basketball",description:"Chest pass and bounce pass technique",coachingPoints:"Step into the pass",duration:10,equipment:"1 ball per 2 players"},
    {id:"dl3",name:"Shooting Form",sport:"Basketball",description:"Form shooting from close range",coachingPoints:"BEEF - Balance, Eyes, Elbow, Follow through",duration:12,equipment:"Basketballs"},
    {id:"dl4",name:"Defensive Slides",sport:"Basketball",description:"Lateral defensive movement",coachingPoints:"Low stance, never cross feet",duration:8,equipment:"Cones"},
    {id:"dl5",name:"Layups",sport:"Basketball",description:"Right and left hand layups",coachingPoints:"Use the backboard",duration:10,equipment:"Basketballs"},
  ],
  practices:[{
    id:"demo_p1",teamId:"team_demo1",locationId:"loc_demo1",
    date:new Date().toISOString().slice(0,10),
    startTime:"16:00",durMin:60,
    activities:[
      {id:"da1",type:"activity",name:"Warm Up",duration:5,coachingPoints:"Light jog and dynamic stretching",equipment:""},
      {id:"da2",type:"station_block",name:"Station Block",rotate:true,stationDuration:10,transitionDuration:2,
        stations:[
          {id:"ds1",activityId:"dl1",activityName:"Ball Handling",coachId:"coach_demo",coachName:"Coach Demo",sublocationId:"sl1",equipment:"1 ball per player",coachingPoints:"Eyes up",assignments:[]},
          {id:"ds2",activityId:"dl3",activityName:"Shooting Form",coachId:"",coachName:"",sublocationId:"sl2",equipment:"Basketballs",coachingPoints:"BEEF",assignments:[]},
          {id:"ds3",activityId:"dl4",activityName:"Defensive Slides",coachId:"",coachName:"",sublocationId:"sl3",equipment:"Cones",coachingPoints:"Low stance",assignments:[]},
        ]
      },
      {id:"da3",type:"activity",name:"Scrimmage",duration:15,coachingPoints:"Apply what we practiced",equipment:"Basketballs"},
      {id:"da4",type:"activity",name:"Cool Down",duration:5,coachingPoints:"Static stretching",equipment:""},
    ]
  }],
  templates:[{
    id:"tpl_demo1",name:"Standard Practice",durMin:60,
    activities:[
      {id:"ta1",type:"activity",name:"Warm Up",duration:5,coachingPoints:"",equipment:""},
      {id:"ta2",type:"station_block",name:"Station Block",rotate:true,stationDuration:10,transitionDuration:2,
        stations:[
          {id:"ts1",activityId:"",activityName:"Drill 1",coachId:"",coachName:"",sublocationId:"",equipment:"",coachingPoints:"",assignments:[]},
          {id:"ts2",activityId:"",activityName:"Drill 2",coachId:"",coachName:"",sublocationId:"",equipment:"",coachingPoints:"",assignments:[]},
        ]
      },
      {id:"ta3",type:"activity",name:"Cool Down",duration:5,coachingPoints:"",equipment:""},
    ]
  }],
  notes:[],
};

function migrateData(d){
  // Schema-only migration — never adds or removes records
  // Only patches missing fields on existing records
  if(!d.notes)d.notes=[];
  if(!d.templates)d.templates=[];
  if(!d.assets)d.assets=[];
  if(!d.locations)d.locations=[];
  if(!d.activityLibrary)d.activityLibrary=[];
  if(!d.practices)d.practices=[];
  if(!d.teams)d.teams=[];
  d.teams.forEach(t=>{
    if(!t.players)t.players=[];
    if(!t.coaches)t.coaches=[];
    t.players.forEach(p=>{if(!p.focusAreas)p.focusAreas=[];});
    // Fix known coach ID bug: c_jaxon2 -> c_jaxon1
    t.coaches.forEach(c=>{if(c.id==="c_jaxon2")c.id="c_jaxon1";});
  });
  (d.activityLibrary||[]).forEach(a=>{
    if(!a.sport)a.sport="General";
    if(!Array.isArray(a.equipment))a.equipment=[];
    if(!a.grouping)a.grouping="whole";
    if(!a.numGroups)a.numGroups=2;
    if(!a.playerGear)a.playerGear="";
  });
  d.practices.forEach(p=>{
    (p.activities||[]).forEach(a=>{
      if(a.type==="station_block"&&a.rotate===undefined)a.rotate=true;
      if(a.type==="station_block")(a.stations||[]).forEach(s=>{if(!s.equipment)s.equipment="";});
    });
  });
  d.templates.forEach(t=>{
    (t.activities||[]).forEach(a=>{
      if(a.type==="station_block"&&a.rotate===undefined)a.rotate=true;
    });
  });
  return d;
}

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
  if(selectedPractice)return (<PracticeDetail practice={selectedPractice} data={data} update={update} setView={setView} setLiveId={setLiveId} setEditPracticeId={setEditPracticeId} onBack={()=>setSelectedPractice(null)}/>);
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
            const actLabel=a=>{if(a.type==="station_block")return "Station Block - "+a.stations.length+" stations";if(a.type==="checklist")return "Checklist: "+a.name;return a.name;};
            const actMins=a=>{if(a.type==="station_block")return a.stations.length*a.stationDuration+Math.max(0,a.stations.length-1)*a.transitionDuration;return a.duration||0;};
            const practiceNotes=(data.notes||[]).filter(n=>n.practiceId===p.id);
            return (<div key={p.id} style={{marginBottom:16,borderBottom:"1px solid var(--b)",paddingBottom:16}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <div>
                  <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:900}}>{new Date(p.date+"T12:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}</div>
                  <div style={{fontSize:12,color:"var(--td)"}}>{(p.activities||[]).length} activities - {(p.activities||[]).reduce((s,a)=>s+actMins(a),0)}min</div>
                </div>
                <button className="btn ghost bxs" onClick={()=>{const now=new Date();const newId=uid();const copy=JSON.parse(JSON.stringify(p));copy.id=newId;copy.date=now.toISOString().slice(0,10);copy.startTime=now.toTimeString().slice(0,5);update(d=>{d.practices.push(copy);return d;});setSelectedPractice(null);}}>Run Again</button>
              </div>
              {(p.activities||[]).map((a,i)=>(<div key={a.id||i} style={{display:"flex",gap:8,padding:"4px 0",borderBottom:"1px solid var(--s2)"}}>
                <span style={{width:20,fontSize:11,color:"var(--td)",flexShrink:0,paddingTop:1}}>{i+1}.</span>
                <span style={{fontSize:13,flex:1,color:"var(--black)"}}>{actLabel(a)}</span>
                <span style={{fontSize:11,fontFamily:"DM Mono,monospace",color:"var(--td)",flexShrink:0}}>{actMins(a)}m</span>
              </div>))}
              {practiceNotes.length>0&&<div style={{marginTop:10}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:6}}>Notes</div>
                {practiceNotes.map(n=>(<div key={n.id} style={{padding:"8px 10px",background:"var(--s2)",borderRadius:"var(--rs)",marginBottom:4,fontSize:13,color:"var(--black2)",lineHeight:1.5}}>{n.context&&<span style={{fontWeight:600,color:"var(--td)",marginRight:4}}>{n.context}:</span>}{n.text}</div>))}
              </div>}
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

function NewLibraryScreen({data,update,openModal,setView,setLiveId,launchRun,setEditPracticeId}){
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
  const myTeamIds=data.teams.filter(t=>t.coaches.some(c=>c.id===coachId)).map(t=>t.id);
  const myPractices=data.practices.filter(p=>myTeamIds.includes(p.teamId));
  const todayPractices=myPractices.filter(p=>{
    if(p.date!==todayStr)return false;
    if(!p.startTime)return true;
    const pts=p.startTime.split(":");
    const pm=parseInt(pts[0])*60+parseInt(pts[1]);
    const nm=now.getHours()*60+now.getMinutes();
    return pm-nm<=240&&pm-nm>=-90;
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
  const fmtDate=ds=>{
    const today=new Date().toISOString().slice(0,10);
    const yest=new Date(Date.now()-864e5).toISOString().slice(0,10);
    if(ds===today)return "Today";
    if(ds===yest)return "Yesterday";
    return new Date(ds+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"});
  };
  const del=id=>update(d=>{d.notes=d.notes.filter(n=>n.id!==id);return d;});
  const sorted=[...data.practices].sort((a,b)=>b.date.localeCompare(a.date));
  const standalone=data.notes.filter(n=>!n.practiceId);
  if(!sorted.length&&!standalone.length)return(<div className="empty"><div className="emtx">No practice history yet. Run a practice to see it here.</div></div>
  );
  return(<div>
      {sorted.map(p=>(<div key={p.id} className="card" style={{marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:data.notes.filter(n=>n.practiceId===p.id).length?10:0}}>
            <div>
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700}}>{(data.teams.find(t=>t.id===p.teamId)||{name:"Practice"}).name}</div>
              <div className="limt">{fmtDate(p.date)}{p.startTime?" at "+fmt12(p.startTime):""} - {sumMins(p.activities)}m</div>
            </div>
          </div>
          {data.notes.filter(n=>n.practiceId===p.id).sort((a,b)=>a.date.localeCompare(b.date)).map(n=>(<div key={n.id} style={{borderTop:"1px solid var(--b)",paddingTop:8,marginTop:8}}>
              <div style={{fontSize:11,fontFamily:"DM Mono,monospace",color:"var(--td)",marginBottom:3}}>
                {n.context&&<span style={{color:"var(--green2)",fontWeight:700,marginRight:4}}>{n.context}</span>}
                {new Date(n.date).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}
              </div>
              <div style={{fontSize:14,lineHeight:1.5}}>{n.text}</div>
            </div>
          ))}
          {!data.notes.filter(n=>n.practiceId===p.id).length&&<div style={{fontSize:12,color:"var(--td)"}}>No notes for this session</div>}
        </div>
      ))}
      {standalone.length>0&&(<div>
          <div className="clbl" style={{marginTop:8,marginBottom:8}}>Standalone Notes</div>
          {standalone.map(n=>(<div key={n.id} className="notec">
              <div className="notect">{n.context&&<span style={{color:"var(--green2)",fontWeight:700,marginRight:4}}>{n.context} -</span>}{new Date(n.date).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</div>
              <div className="notetx">{n.text}</div>
              <button className="btn danger bxs mt6" onClick={()=>del(n.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
    setActs(p=>[...p,{id:uid(),type:"activity",libraryId:lib.id,name:lib.name,duration:lib.duration,assignments:allPlayerIds,coachId:headCoachId,sublocationId:"",notes:"",coachingPoints:lib.coachingPoints||""}]);
  };
  const addChecklist=isClose=>{
    const a={id:uid(),type:"checklist",name:isClose?"Closer":"Intro",duration:5,assignments:allPlayerIds,coachId:headCoachId,items:[],notes:""};
    setActs(p=>[...p,a]);setExpandedId(a.id);
  };
  const addBlock=()=>{
    const n=3;const groups=mkGroups(allPlayerIds,n);
    const b={id:uid(),type:"station_block",stationDuration:10,transitionDuration:2,stations:[
      {id:uid(),name:"Station 1",activityName:"",coachId:headCoachId,sublocationId:"",assignments:groups[0]||[],coachingPoints:""},
      {id:uid(),name:"Station 2",activityName:"",coachId:"",sublocationId:"",assignments:groups[1]||[],coachingPoints:""},
      {id:uid(),name:"Station 3",activityName:"",coachId:"",sublocationId:"",assignments:groups[2]||[],coachingPoints:""},
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
                {act.type==="station_block"&&<StationConfig assets={data.assets} update={update} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)}/>}
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

function ActConfig({act,team,loc,onChange,onDone,assets,update}){
  const [showNewEquip,setShowNewEquip]=useState(false);
  const [newEquipName,setNewEquipName]=useState("");
  const tog=pid=>onChange({assignments:act.assignments&&act.assignments.includes(pid)?act.assignments.filter(x=>x!==pid):[...(act.assignments||[]),pid]});
  return (<div>
      {act.coachingPoints&&<div style={{background:"var(--gbg)",border:"1px solid var(--gb)",borderRadius:6,padding:"8px 10px",marginBottom:10,fontSize:13,color:"var(--green2)"}}>{act.coachingPoints}</div>}
      <div className="g2 mb8">
        <div className="fld"><label className="lbl">Duration (min)</label><DurStepper value={act.duration} min={1} onChange={v=>onChange({duration:v})}/></div>
        <div className="fld"><label className="lbl">Coach</label>
          <select className="sel" value={act.coachId||""} onChange={e=>onChange({coachId:e.target.value})}>
            <option value="">None</option>
            {team&&team.coaches.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="fld mb8"><label className="lbl">Area</label>
        <select className="sel" value={act.sublocationId||""} onChange={e=>onChange({sublocationId:e.target.value})}>
          <option value="">None</option>
          {loc&&loc.sublocations.map(sl=><option key={sl.id} value={sl.id}>{sl.name}</option>)}
        </select>
      </div>
      <div className="fld mb8"><label className="lbl">Team Equipment</label><div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>{(assets||[]).map(a=>{const sel=Array.isArray(act.equipment)&&act.equipment.includes(a.id);return(<button key={a.id} type="button" onClick={()=>{const cur=Array.isArray(act.equipment)?act.equipment:[];onChange({equipment:sel?cur.filter(x=>x!==a.id):[...cur,a.id]});}} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:sel?"var(--green)":"var(--s1)",color:sel?"#fff":"var(--black)",fontSize:12,cursor:"pointer"}}>{a.name}</button>);})} <button type="button" onClick={()=>setShowNewEquip(s=>!s)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px dashed var(--gb)",background:"transparent",color:"var(--green)",fontSize:12,cursor:"pointer"}}>+ New</button></div>{showNewEquip&&<div style={{display:"flex",gap:6,marginTop:6}}><input className="inp" style={{flex:1}} autoFocus placeholder="e.g. Agility ladder" value={newEquipName} onChange={e=>setNewEquipName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newEquipName.trim()){const nm=newEquipName.trim();const nid=uid();update(d=>{d.assets.push({id:nid,name:nm,locationTags:[]});return d;});onChange({equipment:[...(Array.isArray(act.equipment)?act.equipment:[]),nid]});setNewEquipName("");setShowNewEquip(false);}}}/><button type="button" className="btn primary bxs" onClick={()=>{if(!newEquipName.trim())return;const nm=newEquipName.trim();const nid=uid();update(d=>{d.assets.push({id:nid,name:nm,locationTags:[]});return d;});onChange({equipment:[...(Array.isArray(act.equipment)?act.equipment:[]),nid]});setNewEquipName("");setShowNewEquip(false);}}>Add</button><button type="button" className="btn ghost bxs" onClick={()=>{setShowNewEquip(false);setNewEquipName("");}}>Cancel</button></div>}</div>
      <div className="fld mb8"><label className="lbl">Notes</label><textarea className="ta" style={{minHeight:44}} value={act.notes||""} placeholder="Notes for this activity..." onChange={e=>onChange({notes:e.target.value})}/></div>
      <button className="btn primary bsm bfull mt6" onClick={onDone}>Done</button>
    </div>
  );
}

function ChecklistConfig({act,onChange,onDone}){
  const [newItem,setNewItem]=useState("");
  const addItem=()=>{if(!newItem.trim())return;onChange({items:[...(act.items||[]),{id:uid(),text:newItem,done:false}]});setNewItem("");};
  const remItem=id=>onChange({items:(act.items||[]).filter(it=>it.id!==id)});
  return (<div>
      <div className="fld"><label className="lbl">Duration (min)</label><DurStepper value={act.duration} min={1} onChange={v=>onChange({duration:v})}/></div>
      <div className="fld mb8"><label className="lbl">Checklist Items</label>
        {(act.items||[]).map(it=>(<div key={it.id} className="row" style={{marginBottom:6}}>
            <div className="inp" style={{flex:1,padding:"8px 10px",fontSize:14}}>{it.text}</div>
            <button className="btn danger bxs" onClick={()=>remItem(it.id)}>x</button>
          </div>
        ))}
        <div className="row mt6"><input className="inp" value={newItem} onChange={e=>setNewItem(e.target.value)} placeholder="Add item..." onKeyDown={e=>e.key==="Enter"&&addItem()}/><button className="btn primary bsm" onClick={addItem}>Add</button></div>
      </div>
      <div className="fld mb8"><label className="lbl">Notes</label><textarea className="ta" style={{minHeight:44}} value={act.notes||""} onChange={e=>onChange({notes:e.target.value})}/></div>
      <button className="btn primary bsm bfull mt6" onClick={onDone}>Done</button>
    </div>
  );
}

function RandGroupPlayer({id,team}){
  const pl=team&&team.players.find(p=>p.id===id);
  if(!pl)return null;
  return (<div className="gplayer">{pl.firstName} {pl.lastName}</div>);
}

function StationConfig({act,team,loc,onChange,onSt,onDone,assets,update}){
  const [exSt,setExSt]=useState(null);
  const [newStEquip,setNewStEquip]=useState(null);
  const [newStEquipName,setNewStEquipName]=useState("");
  const [randGroups,setRandGroups]=useState(null);
  const addSt=()=>onChange({stations:[...act.stations,{id:uid(),name:"Station "+(act.stations.length+1),activityName:"",coachId:"",sublocationId:"",assignments:[],equipment:"",coachingPoints:""}]});
  const remSt=id=>onChange({stations:act.stations.filter(s=>s.id!==id)});
  const togSt=(sid,pid)=>{const st=act.stations.find(s=>s.id===sid);const cur=st.assignments||[];onSt(sid,{assignments:cur.includes(pid)?cur.filter(x=>x!==pid):[...cur,pid]});};
  const genRand=()=>{if(team){const g=mkGroups(team.players.map(p=>p.id),act.stations.length);setRandGroups(g);}};
  const applyRand=()=>{randGroups.forEach((g,i)=>{if(act.stations[i])onSt(act.stations[i].id,{assignments:g});});setRandGroups(null);};
  const rotate=act.rotate!==false;
  const blockMins=act.stations.length*act.stationDuration+(rotate?Math.max(0,act.stations.length-1)*act.transitionDuration:0);
  return (<div>
      <div className="fld mb8">
        <label className="lbl">Mode</label>
        <div style={{display:"flex",borderRadius:"var(--rs)",overflow:"hidden",border:"1.5px solid var(--b)",background:"var(--s2)"}}>
          <button onClick={()=>onChange({rotate:true})} style={{flex:1,padding:"8px 0",border:"none",cursor:"pointer",fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".06em",background:rotate?"var(--green)":"transparent",color:rotate?"#fff":"var(--td)"}}>ROTATE</button>
          <button onClick={()=>onChange({rotate:false})} style={{flex:1,padding:"8px 0",border:"none",cursor:"pointer",fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:700,letterSpacing:".06em",background:!rotate?"var(--green)":"transparent",color:!rotate?"#fff":"var(--td)"}}>STATIC</button>
        </div>
      </div>
      <div className={rotate?"g3 mb8":"g2 mb8"}>
        <div className="fld"><label className="lbl">Station (min)</label><DurStepper value={act.stationDuration} min={1} onChange={v=>onChange({stationDuration:v})}/></div>
        {rotate&&<div className="fld"><label className="lbl">Transition (min)</label><DurStepper value={act.transitionDuration} min={0} onChange={v=>onChange({transitionDuration:v})}/></div>}
        <div className="fld"><label className="lbl">Total</label><div style={{padding:"10px 0"}}><span className="bdg bp">{blockMins}m</span></div></div>
      </div>
      <div className="row mb8">{team&&act.stations.length>0&&<button className="btn outline bxs" onClick={genRand}>Random Groups</button>}</div>
      {act.stations.map(st=>(<div key={st.id} style={{border:"1px solid var(--b)",borderRadius:"var(--rs)",marginBottom:8,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",padding:"9px 11px",background:"var(--bg)",cursor:"pointer",gap:8}} onClick={()=>setExSt(exSt===st.id?null:st.id)}>
            <span style={{font:"700 13px Barlow Condensed,sans-serif",flex:1}}>{st.name}{st.activityName?": "+st.activityName:""}</span>
            <span className="td" style={{fontSize:11}}>{st.assignments?st.assignments.length:0}p</span>
            <button className="btn danger bxs" onClick={e=>{e.stopPropagation();remSt(st.id);}}>x</button>
          </div>
          {exSt===st.id&&(<div style={{padding:"10px 11px",background:"var(--s2)",borderTop:"1px solid var(--b)"}}>
              <div className="g2 mb8">
                <div className="fld"><label className="lbl">Name</label><input className="inp" placeholder="e.g. Shooting" value={st.activityName||""} onChange={e=>onSt(st.id,{activityName:e.target.value})}/></div>
                <div className="fld"><label className="lbl">Coach</label>
                  <select className="sel" value={st.coachId||""} onChange={e=>onSt(st.id,{coachId:e.target.value})}>
                    <option value="">None</option>
                    {team&&team.coaches.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="fld mb8"><label className="lbl">Area</label>
                <select className="sel" value={st.sublocationId||""} onChange={e=>onSt(st.id,{sublocationId:e.target.value})}>
                  <option value="">None</option>
                  {loc&&loc.sublocations.map(sl=><option key={sl.id} value={sl.id}>{sl.name}</option>)}
                </select>
              </div>
              <div className="fld"><label className="lbl">Equipment</label><div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>{(assets||[]).map(a=>{const sel=Array.isArray(st.equipment)&&st.equipment.includes(a.id);return(<button key={a.id} type="button" onClick={()=>{const cur=Array.isArray(st.equipment)?st.equipment:[];onSt(st.id,{equipment:sel?cur.filter(x=>x!==a.id):[...cur,a.id]});}} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:sel?"var(--green)":"var(--s1)",color:sel?"#fff":"var(--black)",fontSize:12,cursor:"pointer"}}>{a.name}</button>);})} <button type="button" onClick={()=>setNewStEquip(st.id===newStEquip?null:st.id)} style={{padding:"4px 10px",borderRadius:20,border:"1.5px dashed var(--gb)",background:"transparent",color:"var(--green)",fontSize:12,cursor:"pointer"}}>+ New</button></div>{newStEquip===st.id&&<div style={{display:"flex",gap:6,marginTop:6}}><input className="inp" style={{flex:1}} autoFocus placeholder="e.g. Agility ladder" value={newStEquipName} onChange={e=>setNewStEquipName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newStEquipName.trim()){const nm=newStEquipName.trim();const nid=uid();update(d=>{d.assets.push({id:nid,name:nm,locationTags:[]});return d;});onSt(st.id,{equipment:[...(Array.isArray(st.equipment)?st.equipment:[]),nid]});setNewStEquipName("");setNewStEquip(null);}}}/><button type="button" className="btn primary bxs" onClick={()=>{if(!newStEquipName.trim())return;const nm=newStEquipName.trim();const nid=uid();update(d=>{d.assets.push({id:nid,name:nm,locationTags:[]});return d;});onSt(st.id,{equipment:[...(Array.isArray(st.equipment)?st.equipment:[]),nid]});setNewStEquipName("");setNewStEquip(null);}}>Add</button><button type="button" className="btn ghost bxs" onClick={()=>{setNewStEquip(null);setNewStEquipName("");}}>Cancel</button></div>}</div><div className="fld"><label className="lbl">Player Gear</label><input className="inp" placeholder="e.g. Batting helmet" value={st.playerGear||""} onChange={e=>onSt(st.id,{playerGear:e.target.value})}/></div>
              <div className="fld mb8"><label className="lbl">Coaching Points</label><input className="inp" placeholder="Key cue..." value={st.coachingPoints||""} onChange={e=>onSt(st.id,{coachingPoints:e.target.value})}/></div>
              {team&&(<div>
                  <label className="lbl">Players</label>
                  <div className="cgrid">
                    {team.players.map(p=>{const inThis=(st.assignments||[]).includes(p.id);const otherSt=act.stations.find(s=>s.id!==st.id&&(s.assignments||[]).includes(p.id));const handleClick=()=>{if(inThis){togSt(st.id,p.id);}else if(otherSt){onSt(otherSt.id,{assignments:(otherSt.assignments||[]).filter(id=>id!==p.id)});onSt(st.id,{assignments:[...(st.assignments||[]),p.id]});}else{togSt(st.id,p.id);}};return(<div key={p.id} className={"chip "+(inThis?"on":"")+" cp"} onClick={handleClick} style={{opacity:otherSt&&!inThis?0.4:1}}><div className="cn">{p.jersey?"#"+p.jersey:p.firstName.slice(0,2)}</div><div className="cf">{inThis?p.firstName:otherSt?"S"+(act.stations.findIndex(s=>s.id===otherSt.id)+1):p.firstName}</div></div>);})}
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:6,fontSize:11,color:"var(--td)",alignItems:"center"}}><span style={{width:8,height:8,borderRadius:"50%",background:"var(--green)",display:"inline-block"}}/><span>This station</span><span style={{width:8,height:8,borderRadius:"50%",background:"var(--b)",display:"inline-block",marginLeft:6,opacity:.5}}/><span>Other (tap to move)</span></div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      <div style={{display:"flex",gap:6,marginTop:8,marginBottom:8}}><button className="btn ghost bxs" style={{flex:1}} onClick={addSt}>+ Add Station</button><button className="btn ghost bxs" onClick={()=>onChange({stations:act.stations.map(s=>({...s,assignments:[]}))})}>Clear Groups</button></div>
      <button className="btn primary bsm bfull" onClick={onDone}>Done</button>
      {randGroups&&(<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setRandGroups(null);}}>
          <div className="modal"><div className="mhandle"/><div className="mtitle">Random Groups</div>
            <div className="gpreview">
              {act.stations.map((st,i)=>(<div key={st.id} className="gcard"><div className="gcardtitle">{st.name}</div>
                  {(randGroups[i]||[]).map(id=>(<RandGroupPlayer key={id} id={id} team={team}/>))}
                </div>
              ))}
            </div>
            <div className="brow mt8"><button className="btn ghost bsm" onClick={genRand}>Reshuffle</button><button className="btn primary bsm" onClick={applyRand}>Apply</button></div>
            <button className="btn ghost bsm bfull mt6" onClick={()=>setRandGroups(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PracticePicker({data,update,onSelect,onSelectTemplate,onViewHistory}){
  const [openSched,setOpenSched]=useState(true);
  const [openTpl,setOpenTpl]=useState(true);
  const [openHist,setOpenHist]=useState(false);
  const [collapsedSport,setCollapsedSport]=useState({});
  const [openMenu,setOpenMenu]=useState(null);
  const [editPractice,setEditPractice]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const togSport=sport=>setCollapsedSport(c=>Object.assign({},c,{[sport]:!c[sport]}));
  const today=new Date().toISOString().slice(0,10);
  const fmtDate=ds=>{
    const yest=new Date(Date.now()-864e5).toISOString().slice(0,10);
    if(ds===today)return "Today";
    if(ds===yest)return "Yesterday";
    return new Date(ds+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
  };
  const upcoming=[...data.practices].filter(p=>p.date>=today).sort((a,b)=>a.date.localeCompare(b.date));
  const past=[...data.practices].filter(p=>p.date<today).sort((a,b)=>b.date.localeCompare(a.date));
  const sports=[...new Set((data.templates||[]).map(t=>t.sport||"General"))].sort();
  const delPractice=id=>update(d=>{d.practices=d.practices.filter(p=>p.id!==id);return d;});
  if(editPractice)return(<div style={{padding:"14px",paddingBottom:80}}>
      <div className="row mb10"><button className="btn ghost bxs" onClick={()=>setEditPractice(null)}>Back</button><div className="ptitle" style={{fontSize:20}}>Edit Practice</div></div>
      <ScheduledPracticeEditor data={data} update={update} practice={editPractice} onDone={()=>setEditPractice(null)}/>
    </div>
  );
  return (<div style={{padding:"14px",paddingBottom:80}}>
      <div className="phdr"><div className="ptitle">Run</div></div>
      <div className="ablk" style={{marginBottom:10}}>
        <div className="abhdr" onClick={()=>setOpenSched(s=>!s)}>
          <div style={{flex:1,font:"700 14px Barlow Condensed,sans-serif"}}>Scheduled Practices ({upcoming.length})</div>
          <Ic.Chev up={!openSched}/>
        </div>
        {openSched&&(<div style={{padding:"8px 12px"}}>
            {!upcoming.length&&(<div style={{padding:"16px 0",textAlign:"center"}}>
                <div style={{fontSize:13,color:"var(--td)",marginBottom:10}}>No upcoming practices scheduled.</div>
                <button className="btn outline bsm" onClick={()=>window.__cbSetView&&window.__cbSetView("builder")}>Go to Builder</button>
              </div>
            )}
            {upcoming.map(p=>(<div key={p.id} className="card" style={{marginBottom:8,borderColor:"var(--gb)",position:"relative"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div>
                    <div style={{font:"700 15px Barlow Condensed,sans-serif"}}>{(data.teams.find(t=>t.id===p.teamId)||{name:"Unknown"}).name}</div>
                    <div className="limt">{fmtDate(p.date)}{p.startTime?" at "+fmt12(p.startTime):""}{data.locations.find(l=>l.id===p.locationId)?" - "+data.locations.find(l=>l.id===p.locationId).name:""}</div>
                  </div>
                  <div className="row">
                    <span className="bdg bp">{sumMins(p.activities)}m</span>
                    <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===p.id?null:p.id);}}><span/><span/><span/></button>
                  </div>
                </div>
                {openMenu===p.id&&(<div className="mini-menu" style={{right:8,top:8}}>
                    <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);setEditPractice(p);}}>Edit</button>
                    <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);setConfirmDel(p.id);}}>Delete</button>
                  </div>
                )}
                {confirmDel===p.id&&(<div className="confirm-box">
                    <div className="confirm-title">Delete this practice?</div>
                    <div className="brow"><button className="btn ghost bsm" onClick={()=>setConfirmDel(null)}>Cancel</button><button className="btn danger bsm" onClick={()=>{delPractice(p.id);setConfirmDel(null);}}>Delete</button></div>
                  </div>
                )}
                <button className="btn primary bsm bfull" onClick={()=>onSelect(p.id)}>Run This Practice</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="ablk" style={{marginBottom:10}}>
        <div className="abhdr" onClick={()=>setOpenTpl(s=>!s)}>
          <div style={{flex:1,font:"700 14px Barlow Condensed,sans-serif"}}>Saved Templates ({(data.templates||[]).length})</div>
          <Ic.Chev up={!openTpl}/>
        </div>
        {openTpl&&(<div style={{padding:"8px 12px"}}>
            {!sports.length&&<div className="empty" style={{padding:"16px 0"}}><div className="emtx">No templates yet.</div></div>}
            {sports.map(sport=>(<div key={sport} style={{marginBottom:6}}>
                <div className="sport-hdr" style={{marginBottom:4}} onClick={()=>togSport(sport)}>
                  <span className="sport-name">{sport} ({(data.templates||[]).filter(t=>(t.sport||"General")===sport).length})</span>
                  <Ic.Chev up={!!collapsedSport[sport]}/>
                </div>
                {!collapsedSport[sport]&&(data.templates||[]).filter(t=>(t.sport||"General")===sport).map(tpl=>(<div key={tpl.id} className="card" style={{marginBottom:8}}>
                    <div style={{marginBottom:8}}>
                      <div style={{font:"700 15px Barlow Condensed,sans-serif"}}>{tpl.name}</div>
                      <div className="limt">{tpl.sport} - {sumMins(tpl.activities)}m - {tpl.activities.length} activities</div>
                    </div>
                    <button className="btn primary bsm bfull" onClick={()=>onSelectTemplate(tpl)}>Use Template</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="ablk">
        <div className="abhdr" onClick={()=>setOpenHist(s=>!s)}>
          <div style={{flex:1,font:"700 14px Barlow Condensed,sans-serif"}}>Practice History ({past.length})</div>
          <Ic.Chev up={!openHist}/>
        </div>
        {openHist&&(<div style={{padding:"8px 12px"}}>
            {!past.length&&<div className="empty" style={{padding:"16px 0"}}><div className="emtx">No past practices yet.</div></div>}
            {past.map(p=>(<div key={p.id} className="card" style={{marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                  <div>
                    <div style={{font:"700 15px Barlow Condensed,sans-serif"}}>{(data.teams.find(t=>t.id===p.teamId)||{name:"Unknown"}).name}</div>
                    <div className="limt">{fmtDate(p.date)}{p.startTime?" at "+fmt12(p.startTime):""}</div>
                  </div>
                  <span className="bdg bs">{sumMins(p.activities)}m</span>
                </div>
                <button className="btn ghost bsm bfull" onClick={()=>onViewHistory(p)}>View / Run Again</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduledPracticeEditor({data,update,practice,onDone}){
  const [date,setDate]=useState(practice.date);
  const [startTime,setStartTime]=useState(practice.startTime||"");
  const [durMin,setDurMin]=useState(practice.durMin||60);
  const [locId,setLocId]=useState(practice.locationId||"");
  const [showActEditor,setShowActEditor]=useState(false);
  const [acts,setActs]=useState(()=>JSON.parse(JSON.stringify(practice.activities||[])));
  const [expandedId,setExpandedId]=useState(null);
  const team=data.teams.find(t=>t.id===practice.teamId)||null;
  const loc=data.locations.find(l=>l.id===locId)||null;
  const updAct=(id,ch)=>setActs(p=>p.map(a=>a.id===id?Object.assign({},a,ch):a));
  const updSt=(aid,sid,ch)=>setActs(p=>p.map(a=>a.id===aid?Object.assign({},a,{stations:a.stations.map(s=>s.id===sid?Object.assign({},s,ch):s)}):a));
  const remAct=id=>setActs(p=>p.filter(a=>a.id!==id));
  const save=()=>{
    update(d=>{
      const idx=d.practices.findIndex(p=>p.id===practice.id);
      if(idx>=0)d.practices[idx]=Object.assign({},d.practices[idx],{date,startTime,durMin,locationId:locId,activities:acts});
      return d;
    });
    onDone();
  };
  return(<div>
      <div className="card mb10">
        <div className="clbl">Schedule</div>
        <div className="g2">
          <div className="fld"><label className="lbl">Date</label><input className="inp" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
          <div className="fld"><label className="lbl">Start Time</label><input className="inp" type="time" value={startTime} onChange={e=>setStartTime(e.target.value)}/></div>
        </div>
        <div className="g2">
          <div className="fld"><label className="lbl">Duration (min)</label><DurStepper value={durMin} min={5} step={5} onChange={v=>setDurMin(v)}/></div>
          <div className="fld"><label className="lbl">Location</label>
            <select className="sel" value={locId} onChange={e=>setLocId(e.target.value)}>
              <option value="">None</option>
              {data.locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="sechdr mb8">
        <span className="sectitle">{acts.length} Activities - {sumMins(acts)}m</span>
        <button className="btn ghost bxs" onClick={()=>setShowActEditor(s=>!s)}>{showActEditor?"Done Editing":"Edit Activities"}</button>
      </div>
      {acts.map((act,i)=>(<div key={act.id} className="ablk">
          <div className="abhdr" onClick={()=>showActEditor?setExpandedId(expandedId===act.id?null:act.id):null}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{font:"700 14px Barlow Condensed,sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{act.type==="station_block"?"Station Block":act.name}</div>
              <div className="limt">{act.type==="station_block"?act.stations.map(s=>s.activityName||s.name).join(" / ")+" - "+act.stationDuration+"m each":act.duration+"min"}</div>
            </div>
            <div className="row">
              {act.type!=="station_block"&&<span className="bdg bs">{act.duration}m</span>}
              {showActEditor&&<button className="btn danger bxs" onClick={e=>{e.stopPropagation();remAct(act.id);}}>x</button>}
            </div>
          </div>
          {showActEditor&&expandedId===act.id&&(<div className="abbody">
              {act.type==="activity"&&<ActConfig assets={data.assets} update={update} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
              {act.type==="checklist"&&<ChecklistConfig act={act} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
              {act.type==="station_block"&&<StationConfig assets={data.assets} update={update} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)}/>}
            </div>
          )}
        </div>
      ))}
      <div className="brow mt10">
        <button className="btn ghost bmd" onClick={onDone}>Cancel</button>
        <button className="btn primary bmd" onClick={save}>Save Changes</button>
      </div>
    </div>
  );
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
          </button>
        ))}
      </div>
      {team&&team.coaches.length>0&&(<div>
          <div className="clbl mb8 mt8">Coaches</div>
          {team.coaches.map(c=>(<button key={c.id} onClick={()=>togC(c.id)} className={"att-btn bfull "+(coachPresent.has(c.id)?"on":"")} style={{marginBottom:8}}>
              <div className={"att-circle "+(coachPresent.has(c.id)?"on":"")}>{coachPresent.has(c.id)&&<Ic.Check/>}</div>
              <div><div style={{fontSize:14,fontWeight:600,color:coachPresent.has(c.id)?"var(--black)":"var(--td)"}}>{c.name}</div><div style={{fontSize:11,color:"var(--td)"}}>{c.role}</div></div>
            </button>
          ))}
        </div>
      )}
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
    </div>
  );
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
          <div className="limt">{fmtDate(practice.date)}{practice.startTime?" at "+fmt12(practice.startTime):""}{loc?" - "+loc.name:""}</div>
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
              ):(<div className="limt">{act.duration}min{coachName(act.coachId)?" - "+coachName(act.coachId):""}</div>
              )}
            </div>
            {act.type!=="station_block"&&<span className="bdg bs">{act.duration}m</span>}
          </div>
          {act.type==="station_block"&&(<div style={{padding:"10px 12px",borderTop:"1px solid var(--b)"}}>
              {act.stations.map(st=>(<div key={st.id} style={{marginBottom:8,paddingBottom:8,borderBottom:"1px solid var(--b)"}}>
                  <div style={{font:"700 13px Barlow Condensed,sans-serif"}}>{st.name}{st.activityName?": "+st.activityName:""}</div>
                  {(coachName(st.coachId)||subName(st.sublocationId))&&<div className="limt">{coachName(st.coachId)&&"Coach: "+coachName(st.coachId)+"  "}{subName(st.sublocationId)&&subName(st.sublocationId)}</div>}
                  {st.coachingPoints&&<div style={{fontSize:12,color:"var(--green2)"}}>{st.coachingPoints}</div>}
                  {st.assignments&&st.assignments.length>0&&<div className="limt">{pnames(st.assignments)}</div>}
                </div>
              ))}
            </div>
          )}
          {act.type==="activity"&&(act.coachingPoints||act.notes||(act.assignments&&act.assignments.length>0))&&(<div style={{padding:"10px 12px",borderTop:"1px solid var(--b)"}}>
              {act.coachingPoints&&<div style={{fontSize:13,color:"var(--green2)",marginBottom:4}}>{act.coachingPoints}</div>}
              {act.notes&&<div style={{fontSize:13,color:"var(--tm)",fontStyle:"italic",marginBottom:4}}>{act.notes}</div>}
              {act.assignments&&act.assignments.length>0&&<div className="limt">{pnames(act.assignments)}</div>}
            </div>
          )}
        </div>
      ))}
      <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid var(--b)"}}>
        <button className="btn primary bxl bfull" style={{marginBottom:8}} onClick={onRunAgain}>Run Again</button>
        {showTplInput&&<div>
            <div className="fld"><label className="lbl">Template Name</label><input className="inp" autoFocus placeholder={(team?team.name:"Practice")+" Template"} value={tplNameInput} onChange={e=>setTplNameInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSaveAsTpl()}/></div>
            <div className="brow"><button className="btn ghost bsm" onClick={()=>setShowTplInput(false)}>Cancel</button><button className="btn primary bsm" onClick={handleSaveAsTpl} disabled={!tplNameInput.trim()}>Save</button></div>
          </div>}
        {!showTplInput&&<button className="btn ghost bmd bfull" onClick={()=>setShowTplInput(true)}>{tplSaved?"Saved as Template":"Save as Template"}</button>}
      </div>
    </div>
  );
}

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
  const onDS=(e,i)=>{dragIdx.current=i;e.dataTransfer.effectAllowed="move";};
  const onDO=e=>e.preventDefault();
  const onDrop=(e,i)=>{e.preventDefault();if(dragIdx.current===null||dragIdx.current===i)return;setActs(p=>{const arr=[...p],[mv]=arr.splice(dragIdx.current,1);arr.splice(i,0,mv);return arr;});dragIdx.current=null;};
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
        </div>
      )}
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
              <span className="dh"><Ic.Dots/></span>
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
              </div>
            )}
          </div>
        </div>
      ))}
      <div style={{marginTop:12}}>
        {isEdit&&<div className="brow">
            <button className="btn ghost bmd" onClick={onBack}>Cancel</button>
            <button className="btn primary bmd" onClick={handleSave}>{saved?"Saved":"Save Template"}</button>
          </div>}
        {!isEdit&&<button className="btn primary bxl bfull" onClick={handleRun}>Run Now</button>}
      </div>
    </div>
  );
}

function StationPlayerChip({pid,team}){
  const pl=team&&team.players.find(p=>p.id===pid);
  if(!pl)return null;
  return (<span style={{background:"var(--s2)",border:"1px solid var(--b)",borderRadius:8,padding:"3px 8px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:4}}>
      {pl.jersey&&<span style={{fontFamily:"DM Mono,monospace",fontSize:11,color:"var(--green)"}}>#{pl.jersey}</span>}{pl.firstName}
    </span>
  );
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
    </button>
  );
}

function ShareSheet({sessionId,onClose}){
  const url=window.location.origin+"/live/"+sessionId;
  const [copied,setCopied]=useState(false);
  const copy=()=>{try{navigator.clipboard.writeText(url).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});}catch(e){}};
  const share=()=>{if(navigator.share)navigator.share({title:"Run of Practice - Live View",url});else copy();};
  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.72)",zIndex:200,display:"flex",alignItems:"flex-end"}}><div style={{background:"#fff",width:"100%",borderRadius:"20px 20px 0 0",padding:"24px 20px 40px"}}><div style={{width:36,height:4,background:"var(--b)",borderRadius:2,margin:"0 auto 20px"}}/><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,marginBottom:4}}>Share Live View</div><div style={{fontSize:13,color:"var(--td)",marginBottom:20}}>Anyone with this link can follow along in real time.</div><div style={{background:"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:12,wordBreak:"break-all",fontSize:13,color:"var(--black2)",fontFamily:"DM Mono,monospace"}}>{url}</div><div className="brow"><button className="btn outline bmd" style={{flex:1}} onClick={copy}>{copied?"Copied!":"Copy Link"}</button><button className="btn primary bmd" style={{flex:1}} onClick={share}>Share</button></div><button className="btn ghost bmd bfull" style={{marginTop:8}} onClick={onClose}>Done</button></div></div>);
}

function HelperView({sessionId}){
  const [session,setSession]=useState(null);
  const [loading,setLoading]=useState(true);
  const [focusSt,setFocusSt]=useState(null);
  const subRef=useRef(null);
  const [tick,setTick]=useState(0);
  useEffect(()=>{const iv=setInterval(()=>setTick(t=>t+1),1000);return()=>clearInterval(iv);},[]);
  useEffect(()=>{
    getSession(sessionId).then(s=>{setSession(s);setLoading(false);});
    subRef.current=subscribeToSession(sessionId,updated=>{setSession(updated);setFocusSt(f=>f);});
    return()=>{if(subRef.current)subRef.current.unsubscribe();};
  },[sessionId]);

  if(loading)return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#0d1512"}}><div style={{color:"#52b788",fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700,letterSpacing:".1em"}}>JOINING SESSION...</div></div>);
  if(!session)return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,background:"#0d1512",padding:"24px"}}><div style={{color:"#fff",fontFamily:"Barlow Condensed,sans-serif",fontSize:24,fontWeight:900,textAlign:"center"}}>Session not found</div><div style={{color:"#555",fontSize:14,textAlign:"center"}}>This link may be invalid or the practice has ended.</div></div>);
  if(session.ended_at||(session.state&&session.state.ended))return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,background:"#0d1512",padding:"24px"}}><div style={{color:"#52b788",fontFamily:"Barlow Condensed,sans-serif",fontSize:48,fontWeight:900,textAlign:"center"}}>Well Done</div><div style={{color:"#555",fontSize:14,textAlign:"center"}}>This practice session has ended.</div></div>);

  const state=session.state||{};
  const liveActs=state.liveActs||[];
  const roster=state.roster||[];
  const locations=state.locations||[];
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
  const coachNameH=id=>{if(!cur||!cur.stations)return null;const st=cur.stations.find(s=>s.coachId===id);return null;};
  const pnames=ids=>(ids||[]).map(id=>pname(id)).join(", ");

  return (<div className="ccs">
    
    <div className="cc-header">
      <div>
        <div className="row"><span className="live"/><span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginLeft:5}}>Live</span><span style={{marginLeft:8,fontSize:11,color:"var(--td)"}}>View only</span></div>
        {isBlock&&<div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)"}}>STATION BLOCK</div>}
        <div className="cc-act-name">{phaseLabel}</div>
      </div>
      <span style={{background:"var(--gbg)",border:"1.5px solid var(--gb)",borderRadius:20,padding:"4px 10px",fontFamily:"DM Mono,monospace",fontSize:13,fontWeight:700,color:"var(--green)"}}>{(state.presentIds||[]).length}/{roster.length}</span>
    </div>
    <div className="cc-timer-row">
      <div className={"cc-timer"+(urg?" urg":(elapsed>phaseSecs?" over":""))}>{fmt(rem)}</div>
    </div>
    <div className="cc-prog"><div className={"cc-prog-bar"+(elapsed>phaseSecs?" over":"")} style={{width:(Math.min(1,prog)*100)+"%"}}/></div>
    <div className="cc-body">
      {isCl&&cur&&<div className="cc-focus">
        <div className="cc-focus-lbl">{cur.name}</div>
        {(cur.items||[]).map(it=>(<div key={it.id} className="cl-item"><div className="cl-check"/><div className="cl-text">{it.text}</div></div>))}
        {cur.notes&&<div style={{fontSize:13,color:"var(--black2)",marginTop:8,fontStyle:"italic"}}>{cur.notes}</div>}
      </div>}
      {!isBlock&&!isCl&&cur&&<div className="cc-focus">
        {cur.coachingPoints&&<div><div className="cc-focus-lbl">Coaching Focus</div><div className="cc-focus-txt">{cur.coachingPoints}</div></div>}
        {cur.notes&&<div style={{fontSize:14,color:"var(--black2)",marginTop:8,fontStyle:"italic",lineHeight:1.5}}>{cur.notes}</div>}
      </div>}
      {isBlock&&!inTrans&&rotatedStations&&<div>
        {focusSt!==null&&<div>
          <button className="btn ghost bxs" style={{marginBottom:10}} onClick={()=>setFocusSt(null)}>&#8249; All Stations</button>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginBottom:4}}>{rotatedStations[focusSt].name}</div>
          {subName(rotatedStations[focusSt].sublocationId)&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:3}}>{subName(rotatedStations[focusSt].sublocationId)}</div>}
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:32,fontWeight:900,color:"var(--black)",lineHeight:1,marginBottom:4}}>{rotatedStations[focusSt].activityName||rotatedStations[focusSt].name}</div>
          {rotatedStations[focusSt].coachingPoints&&<div className="cc-focus"><div className="cc-focus-lbl">Coaching Focus</div><div className="cc-focus-txt">{rotatedStations[focusSt].coachingPoints}</div></div>}
          {rotatedStations[focusSt].equipment&&<div style={{marginTop:8,padding:"8px 10px",background:"var(--ambg)",border:"1px solid var(--ambb)",borderRadius:"var(--rs)",fontSize:13,color:"var(--amber)",fontWeight:600}}>Needs: {rotatedStations[focusSt].equipment}</div>}
          <div style={{marginTop:10}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Players at this station</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {(rotatedStations[focusSt].assignments||[]).map(pid=>(<span key={pid} style={{padding:"6px 12px",borderRadius:20,border:"1.5px solid var(--gb)",background:"var(--gbg)",fontSize:14,fontWeight:600,color:"var(--black)"}}>{pname(pid)}</span>))}
            </div>
          </div>
        </div>}
        {focusSt===null&&<div>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>{blockRotate?"Round "+(stIdx+1)+" of "+n+" - Tap a station to focus":"All Stations - Tap to focus"}</div>
          {rotatedStations.map((st,i)=>(<div key={i} onClick={()=>setFocusSt(i)} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8,cursor:"pointer"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)"}}>{st.name}</div>
            </div>
            {subName(st.sublocationId)&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:3}}>{subName(st.sublocationId)}</div>}
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:700,color:"var(--black)",marginBottom:6}}>{st.activityName||st.name}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {(st.assignments||[]).map(pid=>(<span key={pid} style={{background:"var(--s2)",border:"1px solid var(--b)",borderRadius:8,padding:"3px 8px",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:4}}>{pname(pid)}</span>))}
            </div>
            {st.equipment&&<div style={{fontSize:11,color:"var(--amber)",marginTop:4,fontWeight:600}}>Needs: {st.equipment}</div>}
            <div style={{fontSize:10,color:"var(--td)",marginTop:5}}>Tap to focus</div>
          </div>))}
        </div>}
      </div>}
      {isBlock&&inTrans&&rotatedStations&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:900,color:"var(--red)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:10}}>Rotate Now</div>
        {rotatedStations.map((st,i)=>(<div key={i} className="cc-trans-card">
          <div style={{fontSize:12,color:"var(--td)",marginBottom:3}}>From {st.name}</div>
          <div className="cc-trans-names">{pnames(st.assignments)||"--"}</div>
          <div className="cc-trans-to">to {cur.stations[(i+1)%n].name}{cur.stations[(i+1)%n].activityName?": "+cur.stations[(i+1)%n].activityName:""}</div>
          {subName(cur.stations[(i+1)%n].sublocationId)&&<div className="cc-trans-sub" style={{fontWeight:600,color:"var(--green2)"}}>{subName(cur.stations[(i+1)%n].sublocationId)}</div>}
        </div>))}
      </div>}
      {liveActs.slice(idx+1,idx+3).length>0&&<div className="cc-queue">
        <div style={{padding:"6px 12px",fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)"}}>Up Next</div>
        {liveActs.slice(idx+1,idx+3).map(a=>(<div key={a.id} className="cc-queue-item">
          <span style={{fontSize:14,color:"var(--black2)"}}>{a.type==="station_block"?"Station Block":a.name}</span>
          <span className="bdg bs">{a.type==="station_block"?(a.stations.length*a.stationDuration+(a.stations.length-1)*a.transitionDuration)+"m":a.duration+"m"}</span>
        </div>))}
      </div>}
    </div>
  </div>);
}

function assignGroups(players,grouping,numGroups){
  const arr=[...players].sort(()=>Math.random()-0.5);
  if(grouping==="partners"){const g=[];for(let i=0;i<arr.length;i+=2)g.push(arr.slice(i,i+2));return g;}
  if(grouping==="groups"){const n=numGroups||2;const g=Array.from({length:n},()=>[]);arr.forEach((p,i)=>g[i%n].push(p));return g.filter(x=>x.length>0);}
  return [arr];
}
function CommandScreen({data,update,liveId,setLiveId,coachId,setView}){
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
    if(!cur||cur.type==="station_block")return;
    const g=cur.grouping||"whole";
    if(g==="whole"){setLiveGroups(null);return;}
    const present=[...presentIds];
    const players=(team?team.players:[]).filter(p=>present.includes(p.id));
    setLiveGroups(assignGroups(players,g,cur.numGroups||2));
  },[idx]);
    const beep=useCallback(async()=>{if(!audioOn)return;const ctx=await unlockAudio();if(!ctx)return;try{const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.type='sine';o.frequency.value=880;g.gain.setValueAtTime(0.4,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.3);}catch(e){}},[ audioOn]);
  const speak=useCallback(txt=>{if(!audioOn)return;try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(txt);u.rate=0.9;window.speechSynthesis.speak(u);}catch(e){};},[audioOn]);

  const applyAtt=useCallback((pIds,cIds,mode,baseActs)=>{const allPlayers=team?team.players:[];return baseActs.map(act=>{if(act.type!=="station_block")return Object.assign({},act,{assignments:(act.assignments||[]).filter(id=>pIds.has(id))});const newSt=mode==="rebalance"?rebalanceEven(act.stations,pIds,allPlayers):rebalanceKeep(act.stations,pIds);return Object.assign({},act,{stations:newSt});});},[team]);

  const handleAttConfirm=useCallback(({presentIds:pIds,coachPresentIds:cIds,balanceMode})=>{
    setPresentIds(pIds);setCoachPresentIds(cIds);
    const newActs=applyAtt(pIds,cIds,balanceMode,practice.activities);
    setLiveActs(newActs);setStage("live");setShowAtt(false);
    setPracticeStart(Date.now());setIdx(0);setStIdx(0);setInTrans(false);setElapsed(0);setRunning(true);spoken.current={};
    createSession(coachId||"anon",liveId,{idx:0,stIdx:0,inTrans:false,elapsed:0,running:true,runningAt:Date.now(),presentIds:[...pIds],liveActs:newActs,roster:practice?data.teams.find(t=>t.id===practice.teamId)?data.teams.find(t=>t.id===practice.teamId).players:[]:[],locations:data.locations}).then(sid=>{
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
  if(tplPractice)return (<div className="screen" style={{padding:"14px 14px calc(var(--tab) + 40px)"}}><TemplateWorkspace data={data} template={tplPractice} mode="run" onRun={handleTplRun} onBack={()=>setTplPractice(null)}/></div>);
  
  if(stage==="attend"||showAtt){const attendPractice=livePracticeOverride||(liveId?data.practices.find(p=>p.id===liveId):null);const attendTeam=attendPractice?data.teams.find(t=>t.id===attendPractice.teamId):null;const attBack=()=>{if(showAtt)setShowAtt(false);else{setLiveId(null);setLivePracticeOverride(null);setStage("pick");}};return (<AttendanceScreen key={showAtt?"upd":"init"} practice={attendPractice} team={attendTeam} isUpdate={showAtt} initialPresent={showAtt?[...presentIds]:null} initialCoachPresent={showAtt?[...coachPresentIds]:null} onConfirm={showAtt?handleAttUpdate:handleAttConfirm} onBack={attBack}/>);}
  if(stage==="end")return (<div className="ccs"><div className="cc-end"><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:36,fontWeight:900,color:"var(--green)",marginBottom:4}}>Practice Complete</div><div style={{fontSize:16,color:"var(--tm)",marginBottom:24,lineHeight:1.5}}>{team&&team.name} practice complete.</div><div style={{width:"100%",marginBottom:16}}><label className="lbl">End of Practice Notes</label><textarea className="ta" style={{minHeight:80}} value={noteText} placeholder="Observations for next time..." onChange={e=>setNoteText(e.target.value)}/><button className="btn primary bsm bfull mt6" onClick={()=>{if(noteText.trim()){update(d=>{d.notes.push({id:uid(),text:noteText,context:"End of Practice",date:new Date().toISOString(),practiceId:liveId});return d;});setNoteText("");}}} >Save Note</button></div><button className="btn primary bmd bfull" onClick={()=>{setLiveId(null);setStage("pick");setView("today");}}>Done</button></div></div>);

  const phaseLabel=isBlock?(blockRotate?(inTrans?"TRANSITION":"STATION "+(stIdx+1)+" of "+cur.stations.length):"STATION BLOCK"):((cur&&cur.name)||"").toUpperCase();
  const blockCount=liveActs.slice(0,idx).filter(a=>a.type==="station_block").length;
  const schedBadge=schedDelta===null?null:(Math.abs(schedDelta)<1?<span style={{background:"var(--gbg)",color:"var(--green)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>On time</span>:schedDelta>0?<span style={{background:"var(--ambg)",color:"var(--amber)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>+{schedDelta}m behind</span>:<span style={{background:"var(--gbg)",color:"var(--green)",padding:"3px 10px",borderRadius:20,fontFamily:"DM Mono,monospace",fontSize:11,fontWeight:700}}>{Math.abs(schedDelta)}m ahead</span>);

  return (<div className="ccs">
      <div className="cc-header">
        <div>
          <div className="row"><span className="live"/><span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginLeft:5}}>Live</span>{schedBadge}</div>
          {isBlock&&<div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)"}}>STATION BLOCK {blockCount+1}</div>}
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
        {!isBlock&&!isCl&&cur&&<div className="cc-focus">
          {cur.coachingPoints&&<div><div className="cc-focus-lbl">Coaching Focus</div><div className="cc-focus-txt">{cur.coachingPoints}</div></div>}
          {cur.notes&&<div style={{fontSize:14,color:"var(--black2)",marginTop:8,fontStyle:"italic",lineHeight:1.5}}>{cur.notes}</div>}
          <div style={{marginTop:10,fontSize:13,color:"var(--tm)"}}>
            {coachName(cur.coachId)&&<div>Coach: {coachName(cur.coachId)}</div>}
            {subName(cur.sublocationId)&&<div>Location: {subName(cur.sublocationId)}</div>}
            {cur.assignments&&cur.assignments.length>0&&<div>Players: {pnames(cur.assignments)}</div>}
          </div>
        </div>}
        {isBlock&&!inTrans&&rotatedStations&&<div>
          {focusSt!==null&&<div>
            <button className="btn ghost bxs" style={{marginBottom:10}} onClick={()=>setFocusSt(null)}>&#8249; All Stations</button>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)",marginBottom:4}}>{rotatedStations[focusSt].name}</div>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:32,fontWeight:900,color:"var(--black)",lineHeight:1,marginBottom:4}}>{rotatedStations[focusSt].activityName||rotatedStations[focusSt].name}</div>
            {(coachName(rotatedStations[focusSt].coachId)||subName(rotatedStations[focusSt].sublocationId))&&<div style={{fontSize:14,fontWeight:600,color:"var(--green2)",marginBottom:8}}>
              {coachName(rotatedStations[focusSt].coachId)&&<span>{coachName(rotatedStations[focusSt].coachId)}</span>}
              {coachName(rotatedStations[focusSt].coachId)&&subName(rotatedStations[focusSt].sublocationId)&&<span> - </span>}
              {subName(rotatedStations[focusSt].sublocationId)&&<span>{subName(rotatedStations[focusSt].sublocationId)}</span>}
            </div>}
            {rotatedStations[focusSt].coachingPoints&&<div className="cc-focus">
              <div className="cc-focus-lbl">Coaching Focus</div>
              <div className="cc-focus-txt">{rotatedStations[focusSt].coachingPoints}</div>
            </div>}
            <div style={{marginTop:10}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>Players at this station</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {(rotatedStations[focusSt].assignments||[]).map(pid=>(<PlayerChipLive key={pid} pid={pid} team={team} onMove={()=>setMovePlayer(pid)} onProfile={pl=>setLivePlayerProfile(pl)}/>))}
              </div>
            </div>
          </div>}
          {focusSt===null&&<div>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--td)",marginBottom:8}}>{blockRotate?"Round "+(stIdx+1)+" of "+cur.stations.length+" - Tap a station to focus":"All Stations - Tap to focus"}</div>
            {rotatedStations.map((st,i)=>(<div key={st.id} onClick={()=>setFocusSt(i)} style={{background:"var(--s1)",border:"1.5px solid var(--b)",borderRadius:"var(--r)",padding:"12px 14px",marginBottom:8,cursor:"pointer"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:11,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--green)"}}>{st.name}</div>
                <div style={{fontSize:11,color:"var(--td)"}}>{coachName(st.coachId)||"No coach"}</div>
              </div>
              {subName(st.sublocationId)&&<div style={{fontSize:11,color:"var(--green2)",fontWeight:600,marginBottom:3}}>{subName(st.sublocationId)}</div>}
              <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:700,color:"var(--black)",marginBottom:6}}>{st.activityName||st.name}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {(st.assignments||[]).map(pid=>(<StationPlayerChip key={pid} pid={pid} team={team}/>))}
              </div>
              <div style={{fontSize:10,color:"var(--td)",marginTop:5}}>Tap to focus</div>
            </div>))}
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
          {rotatedStations.map((st,i)=>(<div key={st.id} className="cc-trans-card">
            <div style={{fontSize:12,color:"var(--td)",marginBottom:3,lineHeight:1.6}}><span style={{fontWeight:700}}>From {st.name}</span>{st.activityName&&<span>: {st.activityName}</span>}{coachName(st.coachId)&&<span style={{color:"var(--green)"}}> · {coachName(st.coachId)}</span>}</div>
            <div className="cc-trans-names">{pnames(st.assignments)||"--"}</div>
            <div className="cc-trans-to">to {cur.stations[(i+1)%cur.stations.length].name}{cur.stations[(i+1)%cur.stations.length].activityName?": "+cur.stations[(i+1)%cur.stations.length].activityName:""}</div>
            <div className="cc-trans-sub">
              {subName(cur.stations[(i+1)%cur.stations.length].sublocationId)&&<span style={{fontWeight:600,color:"var(--green2)"}}>{subName(cur.stations[(i+1)%cur.stations.length].sublocationId)}  </span>}
              {coachName(cur.stations[(i+1)%cur.stations.length].coachId)&&<span>Coach: {coachName(cur.stations[(i+1)%cur.stations.length].coachId)}</span>}
            </div>
          </div>))}
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
    </div>
  );
}

function LibraryScreen({data,update,openModal}){
  const [collapsed,setCollapsed]=useState({});
  const [openMenu,setOpenMenu]=useState(null);
  const libDrag=useRef(null);
  const toggle=sport=>setCollapsed(c=>Object.assign({},c,{[sport]:!c[sport]}));
  const del=id=>update(d=>{d.activityLibrary=d.activityLibrary.filter(a=>a.id!==id);return d;});
  const sports=[...new Set(data.activityLibrary.map(a=>a.sport||"General"))].sort();
  const onDS=(e,id)=>{libDrag.current=id;e.dataTransfer.effectAllowed="move";};
  const onDO=(e,id)=>{e.preventDefault();if(!libDrag.current||libDrag.current===id)return;update(d=>{const lib=d.activityLibrary;const from=lib.findIndex(a=>a.id===libDrag.current);const to=lib.findIndex(a=>a.id===id);if(from<0||to<0)return d;const[mv]=lib.splice(from,1);lib.splice(to,0,mv);return d;});};
  const onDE=()=>{libDrag.current=null;};
  return (<div style={{paddingBottom:80}} onClick={()=>setOpenMenu(null)}>
      <div className="phdr"><div className="ptitle">Library</div><button className="btn primary bsm" onClick={e=>{e.stopPropagation();openModal("addActivity");}}>+ Activity</button></div>
      {sports.map(sport=>(<div key={sport} className="sport-group">
          <div className="sport-hdr" onClick={()=>toggle(sport)}>
            <span className="sport-name">{sport} ({data.activityLibrary.filter(a=>(a.sport||"General")===sport).length})</span>
            <Ic.Chev up={!!collapsed[sport]}/>
          </div>
          {!collapsed[sport]&&data.activityLibrary.filter(a=>(a.sport||"General")===sport).map(a=>(<div key={a.id} draggable onDragStart={e=>onDS(e,a.id)} onDragOver={e=>onDO(e,a.id)} onDragEnd={onDE} className="li" style={{position:"relative",marginLeft:8}}>
              <span className="dh" style={{cursor:"grab"}}><Ic.Dots/></span>
              <div className="lim">
                <div className="lin">{a.name}</div>
                <div className="limt">{a.duration}min{a.description?" - "+a.description:""}</div>
                {a.coachingPoints&&<div style={{fontSize:11,color:"var(--green2)",marginTop:2}}>{a.coachingPoints}</div>}
              </div>
              <div className="lir"><span className="bdg bp">{a.duration}m</span>
                <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===a.id?null:a.id);}}><span/><span/><span/></button>
              </div>
              {openMenu===a.id&&(<div className="mini-menu">
                  <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editActivity",{activity:a});}}>Edit</button>
                  <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);del(a.id);}}>Remove</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      {!data.activityLibrary.length&&<div className="empty"><div className="emtx">No activities yet</div></div>}
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
    update(d=>{
      const t=d.teams.find(t=>t.id===team.id);
      if(t){const p=t.players.find(p=>p.id===player.id);if(p){if(!p.focusAreas)p.focusAreas=[];p.focusAreas.push({id:uid(),text:newArea.trim()});}}
      return d;
    });
    setNewArea("");
  };
  const delArea=aId=>update(d=>{
    const t=d.teams.find(t=>t.id===team.id);
    if(t){const p=t.players.find(p=>p.id===player.id);if(p)p.focusAreas=(p.focusAreas||[]).filter(a=>a.id!==aId);}
    return d;
  });
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
          </div>
        ))}
        {areas.length<10&&(<div>
            <div className="fld">
              <textarea className="ta" style={{minHeight:58}} placeholder="e.g. Keep dribble low and eyes up. Tends to go right only." value={newArea} onChange={e=>setNewArea(e.target.value)}/>
            </div>
            <button className="btn primary bsm bfull" onClick={addArea} disabled={!newArea.trim()}>Add Focus Area</button>
          </div>
        )}
      </div>
      {player.notes&&(<div className="card">
          <div className="clbl mb6">Notes</div>
          <div style={{fontSize:14,color:"var(--black)",lineHeight:1.6}}>{player.notes}</div>
        </div>
      )}
    </div>
  );
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
    update(d=>{
      d.teams=d.teams.filter(t=>t.id!==teamId);
      d.practices=d.practices.filter(p=>p.teamId!==teamId);
      d.templates=(d.templates||[]).filter(t=>t.teamId!==teamId);
      d.notes=d.notes.filter(n=>!n.practiceId||(d.practices.some(p=>p.id===n.practiceId)));
      return d;
    });
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
      <div className="row mb10">
        <button className="btn ghost bxs" onClick={()=>setViewPlayer(null)}>&#8249; Roster</button>
      </div>
      <PlayerProfile player={viewPlayer} team={team} data={data} update={update} onBack={()=>setViewPlayer(null)}/>
    </div>
  );
  return (<div style={{paddingBottom:80}} onClick={()=>setOpenMenu(null)}>
      {!fixedTeamId&&(<div className="sechdr mb8">
          <div>{data.teams.length>1&&<select className="sel" style={{maxWidth:200}} value={teamId} onChange={e=>{setTeamId(e.target.value);setConfirmDel(false);}}>{data.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>}</div>
          <button className="btn primary bsm" onClick={e=>{e.stopPropagation();openModal("addTeam");}}>+ Team</button>
        </div>
      )}
      {team&&(<div>
          <div className="card mb8" style={{position:"relative"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:900}}>{team.name}</div><div className="td" style={{fontSize:12}}>{team.sport}</div></div>
              <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu==="__team__"?null:"__team__");}}><span/><span/><span/></button>
            </div>
            {openMenu==="__team__"&&(<div className="mini-menu" style={{right:8,top:44}}>
                <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editTeam",{team});}}>Edit Team</button>
                <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);setConfirmDel(c=>!c);}}>Delete Team</button>
              </div>
            )}
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
                          </button>
                        ))}
                      </div>
                    )}
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
                </div>
              ))}
              {!team.players.length&&<div className="empty"><div className="emtx">No players yet</div></div>}
            </div>
          )}
          {tab==="coaches"&&(<div>
              <div className="sechdr mb8"><span className="sectitle">{team.coaches.length} Coaches</span><button className="btn outline bsm" onClick={e=>{e.stopPropagation();openModal("addCoach",{teamId});}}>+ Add</button></div>
              {team.coaches.map(c=>(<div key={c.id} className="li" style={{position:"relative"}}>
                  <div className="lim"><div className="lin">{c.name}</div><div className="limt">{c.role}</div></div>
                  <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu==="coach_"+c.id?null:"coach_"+c.id);}}><span/><span/><span/></button>
                  {openMenu==="coach_"+c.id&&<div className="mini-menu"><button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);delC(c.id);}}>Remove</button></div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {!team&&<div className="empty"><div className="emtx">Create a team to get started</div></div>}
    </div>
  );
}

function LocationsTab({data,update,openModal}){
  const [openMenu,setOpenMenu]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const delLoc=id=>{update(d=>{d.locations=d.locations.filter(l=>l.id!==id);return d;});setConfirmDel(null);};
  const delSub=(lid,sid)=>update(d=>{const loc=d.locations.find(l=>l.id===lid);if(loc)loc.sublocations=loc.sublocations.filter(s=>s.id!==sid);return d;});
  return (<div style={{paddingBottom:80}} onClick={()=>setOpenMenu(null)}>
      <div className="sechdr mb10"><span className="sectitle">{data.locations.length} Locations</span><button className="btn primary bsm" onClick={()=>openModal("addLocation")}>+ Location</button></div>
      {data.locations.map(loc=>(<div key={loc.id} className="card" style={{position:"relative"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700}}>{loc.name}</span>
            <div className="row">
              <button className="btn ghost bxs" onClick={()=>openModal("addSublocation",{locationId:loc.id})}>+ Area</button>
              <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===loc.id?null:loc.id);}}><span/><span/><span/></button>
            </div>
          </div>
          {openMenu===loc.id&&(<div className="mini-menu" style={{right:8,top:44}}>
              <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editLocation",{location:loc});}}>Edit Name</button>
              <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);setConfirmDel(loc.id);}}>Delete</button>
            </div>
          )}
          {confirmDel===loc.id&&(<div className="confirm-box"><div className="confirm-title">Delete {loc.name}?</div><div className="brow"><button className="btn ghost bsm" onClick={()=>setConfirmDel(null)}>Cancel</button><button className="btn danger bsm" onClick={()=>delLoc(loc.id)}>Delete</button></div></div>
          )}
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {loc.sublocations.map(sl=>(<div key={sl.id} className="row">
                <span className="bdg bs">{sl.name}</span>
                <button className="btn danger bxs" style={{minHeight:22,padding:"2px 6px"}} onClick={()=>delSub(loc.id,sl.id)}>x</button>
              </div>
            ))}
            {!loc.sublocations.length&&<span className="td" style={{fontSize:12}}>No areas yet</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function EquipmentTab({data,update,openModal}){
  const [openMenu,setOpenMenu]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const del=id=>{update(d=>{d.assets=d.assets.filter(a=>a.id!==id);return d;});setConfirmDel(null);};
  return (<div style={{paddingBottom:80}} onClick={()=>setOpenMenu(null)}>
      <div className="sechdr mb10"><span className="sectitle">{data.assets.length} Items</span><button className="btn primary bsm" onClick={()=>openModal("addAsset")}>+ Equipment</button></div>
      {data.assets.map(a=>(<div key={a.id} className="li" style={{position:"relative"}}>
          <div className="lim"><div className="lin">{a.name}</div>
            {a.locationTags&&a.locationTags.length>0&&<div className="limt">{a.locationTags.map(lid=>{const l=data.locations.find(l=>l.id===lid);return l?l.name:null;}).filter(Boolean).join(", ")}</div>}
          </div>
          <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===a.id?null:a.id);}}><span/><span/><span/></button>
          {openMenu===a.id&&(<div className="mini-menu">
              <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editAsset",{asset:a});}}>Edit</button>
              <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);setConfirmDel(a.id);}}>Delete</button>
            </div>
          )}
          {confirmDel===a.id&&<div className="confirm-box" style={{position:"absolute",right:0,top:"100%",zIndex:60,minWidth:200}}><div className="confirm-title">Delete {a.name}?</div><div className="brow"><button className="btn ghost bxs" onClick={()=>setConfirmDel(null)}>No</button><button className="btn danger bxs" onClick={()=>del(a.id)}>Yes</button></div></div>}
        </div>
      ))}
    </div>
  );
}

function TemplatesTab({data,update,openModal,launchRun,setView,setLiveId}){
  const [openMenu,setOpenMenu]=useState(null);
  const [collapsed,setCollapsed]=useState({});
  const [editingTpl,setEditingTpl]=useState(null);
  const [confirmDel,setConfirmDel]=useState(null);
  const togSport=sport=>setCollapsed(c=>Object.assign({},c,{[sport]:!c[sport]}));
  const del=id=>update(d=>{d.templates=d.templates.filter(t=>t.id!==id);return d;});
  const handleRun=tpl=>{
    const now=new Date();
    const newP={id:uid(),teamId:tpl.teamId,locationId:"",date:now.toISOString().slice(0,10),startTime:now.toTimeString().slice(0,5),durMin:sumMins(tpl.activities),activities:JSON.parse(JSON.stringify(tpl.activities)),fromTemplate:tpl.id};
    update(d=>{d.practices.push(newP);return d;});
    setLiveId(newP.id);
    setView("command");
  };
  const sports=[...new Set((data.templates||[]).map(t=>t.sport||"General"))].sort();
  if(editingTpl)return(<div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <button className="btn ghost bxs" onClick={()=>setEditingTpl(null)}>Back</button>
        <div className="ptitle" style={{fontSize:20}}>{editingTpl.name}</div>
      </div>
      <TemplateWorkspace data={data} update={update} template={editingTpl} mode="edit" onSave={()=>setEditingTpl(null)} onBack={()=>setEditingTpl(null)}/>
    </div>
  );
  return (<div style={{paddingBottom:80}} onClick={()=>setOpenMenu(null)}>
      <div className="sechdr mb10"><span className="sectitle">{(data.templates||[]).length} Templates</span></div>
      {!sports.length&&<div className="empty"><div className="emtx">No templates yet. Build a practice and tap Save as Template.</div></div>}
      {sports.map(sport=>(<div key={sport} className="sport-group">
          <div className="sport-hdr" onClick={()=>togSport(sport)}>
            <span className="sport-name">{sport} ({(data.templates||[]).filter(t=>(t.sport||"General")===sport).length})</span>
            <Ic.Chev up={!!collapsed[sport]}/>
          </div>
          {!collapsed[sport]&&(data.templates||[]).filter(t=>(t.sport||"General")===sport).map(tpl=>(<div key={tpl.id} className="card" style={{marginBottom:8,position:"relative"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div>
                  <div style={{font:"700 15px Barlow Condensed,sans-serif"}}>{tpl.name}</div>
                  <div className="limt">{tpl.sport} - {sumMins(tpl.activities)}m - {tpl.activities.length} activities</div>
                </div>
                <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===tpl.id?null:tpl.id);}}><span/><span/><span/></button>
              </div>
              {openMenu===tpl.id&&(<div className="mini-menu" style={{top:8,right:8}}>
                  <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);setEditingTpl(tpl);}}>Edit</button>
                  <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);handleRun(tpl);}}>Run Now</button>
                  <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);setConfirmDel(tpl.id);}}>Delete</button>
                </div>
              )}
              {confirmDel===tpl.id&&(<div className="confirm-box">
                  <div className="confirm-title">Delete {tpl.name}?</div>
                  <div className="brow"><button className="btn ghost bsm" onClick={()=>setConfirmDel(null)}>Cancel</button><button className="btn danger bsm" onClick={()=>{del(tpl.id);setConfirmDel(null);}}>Delete</button></div>
                </div>
              )}
              <div className="brow">
                <button className="btn ghost bsm" onClick={e=>{e.stopPropagation();setEditingTpl(tpl);}}>Edit</button>
                <button className="btn primary bsm" onClick={e=>{e.stopPropagation();handleRun(tpl);}}>Run Now</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
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

function ModalLayer({modal,data,update,closeModal}){
  const player=modal.type==="editPlayer"?modal.payload.player:null;
  const activity=modal.type==="editActivity"?modal.payload.activity:null;
  const location=modal.type==="editLocation"?modal.payload.location:null;
  const editTeamData=modal.type==="editTeam"?modal.payload.team:null;
  const asset=modal.type==="editAsset"?modal.payload.asset:null;
  const template=modal.type==="editTemplate"?modal.payload.template:null;
  const [f,setF]=useState(()=>{
    if(player)return{firstName:player.firstName,lastName:player.lastName,jersey:player.jersey,notes:player.notes||""};
    if(activity){lastSportRef.current=activity.sport||"Basketball";return{name:activity.name,sport:activity.sport||"Basketball",duration:activity.duration,description:activity.description||"",coachingPoints:activity.coachingPoints||"",equipment:Array.isArray(activity.equipment)?activity.equipment:[],playerGear:activity.playerGear||"",grouping:activity.grouping||"whole",numGroups:activity.numGroups||2};}
    if(location)return{name:location.name};
    if(asset)return{name:asset.name,locationTags:asset.locationTags||[]};
    if(template)return{name:template.name,sport:template.sport||"General"};
    if(editTeamData)return{name:editTeamData.name,sport:editTeamData.sport||"Basketball"};
    return{sport:lastSportRef.current||"Basketball"};
  });
  const set=(k,v)=>setF(p=>Object.assign({},p,{[k]:v}));
  const togTag=lid=>setF(p=>Object.assign({},p,{locationTags:p.locationTags&&p.locationTags.includes(lid)?p.locationTags.filter(x=>x!==lid):[...(p.locationTags||[]),lid]}));
  const SPORTS=["Basketball","Soccer","Baseball","Lacrosse","Football","Softball","Volleyball","Hockey","Tennis","Swimming","General","Other"];
  const save=()=>{
    const t=modal.type,p=modal.payload;
    if(t==="addTeam"){if(!f.name)return;update(d=>{d.teams.push({id:uid(),name:f.name,sport:f.sport||"Basketball",players:[],coaches:[]});return d;});}
    if(t==="addPlayer"){if(!f.firstName)return;update(d=>{const tm=d.teams.find(tm=>tm.id===p.teamId);if(tm)tm.players.push({id:uid(),firstName:f.firstName,lastName:f.lastName||"",jersey:f.jersey||"",notes:f.notes||""});return d;});}
    if(t==="editPlayer"){if(!f.firstName)return;update(d=>{const tm=d.teams.find(tm=>tm.id===p.teamId);if(tm){const pl=tm.players.find(pl=>pl.id===p.player.id);if(pl){pl.firstName=f.firstName;pl.lastName=f.lastName||"";pl.jersey=f.jersey||"";pl.notes=f.notes||"";}}return d;});}
    if(t==="addCoach"){if(!f.name)return;update(d=>{const tm=d.teams.find(tm=>tm.id===p.teamId);if(tm)tm.coaches.push({id:uid(),name:f.name,role:f.role||"Assistant",notes:""});return d;});}
    if(t==="addLocation"){if(!f.name)return;update(d=>{d.locations.push({id:uid(),name:f.name,sublocations:[]});return d;});}
    if(t==="editLocation"){if(!f.name)return;update(d=>{const l=d.locations.find(l=>l.id===p.location.id);if(l)l.name=f.name;return d;});}
    if(t==="addSublocation"){if(!f.name)return;update(d=>{const l=d.locations.find(l=>l.id===p.locationId);if(l)l.sublocations.push({id:uid(),name:f.name});return d;});}
    if(t==="addAsset"){if(!f.name)return;update(d=>{d.assets.push({id:uid(),name:f.name,locationTags:f.locationTags||[]});return d;});}
    if(t==="editAsset"){if(!f.name)return;update(d=>{const a=d.assets.find(a=>a.id===p.asset.id);if(a){a.name=f.name;a.locationTags=f.locationTags||[];}return d;});}
    if(t==="addActivity"){if(!f.name)return;update(d=>{d.activityLibrary.push({id:uid(),name:f.name,sport:f.sport||"General",category:f.category||"",description:f.description||"",duration:+(f.duration||10),coachingPoints:f.coachingPoints||"",equipment:f.equipment||[],playerGear:f.playerGear||"",grouping:f.grouping||"whole",numGroups:f.numGroups||2});return d;});}
    if(t==="editActivity"){if(!f.name)return;update(d=>{const a=d.activityLibrary.find(a=>a.id===p.activity.id);if(a){a.name=f.name;a.sport=f.sport||"General";a.duration=+(f.duration||10);a.description=f.description||"";a.coachingPoints=f.coachingPoints||"";}return d;});}
    if(t==="editTemplate"){if(!f.name)return;update(d=>{const tpl=d.templates.find(t=>t.id===p.template.id);if(tpl){tpl.name=f.name;tpl.sport=f.sport||"General";}return d;});}
    if(t==="editTeam"){if(!f.name)return;update(d=>{const tm=d.teams.find(tm=>tm.id===p.team.id);if(tm){tm.name=f.name;tm.sport=f.sport||"Basketball";}return d;});}
    closeModal();
  };
  const TITLES={addTemplate:"New Template",editTemplate:"Edit Template",addTeam:"New Team",editTeam:"Edit Team",addPlayer:"Add Player",editPlayer:"Edit Player",addCoach:"Add Coach",addLocation:"Add Location",editLocation:"Edit Location",addSublocation:"Add Area",addAsset:"Add Equipment",editAsset:"Edit Equipment",addActivity:"New Drill",editActivity:"Edit Drill"};
  return (<div className="movly" onClick={e=>{if(e.target===e.currentTarget)closeModal();}}>
      <div className="modal">
        <div className="mhandle"/>
        <div className="mtitle">{TITLES[modal.type]||"Add"}</div>
        {modal.type==="addTeam"&&(<div><div className="fld"><label className="lbl">Team Name</label><input className="inp" autoFocus placeholder="e.g. Peoria Eagles 10U" onChange={e=>set("name",e.target.value)}/></div>
          <div className="fld"><label className="lbl">Sport</label><select className="sel" onChange={e=>{set("sport",e.target.value);lastSportRef.current=e.target.value;}}>{SPORTS.map(s=><option key={s}>{s}</option>)}</select></div></div>
        )}
        {(modal.type==="addPlayer"||modal.type==="editPlayer")&&(<div>
            <div className="g2"><div className="fld"><label className="lbl">First Name</label><input className="inp" autoFocus value={f.firstName||""} onChange={e=>set("firstName",e.target.value)}/></div><div className="fld"><label className="lbl">Last Name</label><input className="inp" value={f.lastName||""} onChange={e=>set("lastName",e.target.value)}/></div></div>
            <div className="fld"><label className="lbl">Jersey #</label><input className="inp" type="number" inputMode="numeric" value={f.jersey||""} onChange={e=>set("jersey",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Notes</label><textarea className="ta" value={f.notes||""} onChange={e=>set("notes",e.target.value)}/></div>
          </div>
        )}
        {modal.type==="addCoach"&&(<div><div className="fld"><label className="lbl">Name</label><input className="inp" autoFocus onChange={e=>set("name",e.target.value)}/></div><div className="fld"><label className="lbl">Role</label><input className="inp" placeholder="Assistant" onChange={e=>set("role",e.target.value)}/></div></div>
        )}
        {(modal.type==="addLocation"||modal.type==="editLocation"||modal.type==="addSublocation")&&(<div className="fld"><label className="lbl">Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
        )}
        {(modal.type==="addAsset"||modal.type==="editAsset")&&(<div>
            <div className="fld"><label className="lbl">Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Category</label><div style={{display:"flex",gap:6}}><select className="sel" style={{flex:1}} value={f.category||""} onChange={e=>{if(e.target.value==="__new__")return;set("category",e.target.value);}}><option value="">General</option>{[...new Set((data.activityLibrary||[]).filter(a=>a.sport===(f.sport||"Basketball")).map(a=>a.category).filter(Boolean))].map(c=><option key={c} value={c}>{c}</option>)}<option value="__new__">+ Add new...</option></select></div>{(f.category==="__new__"||f._addingCat)&&<div style={{display:"flex",gap:6,marginTop:6}}><input className="inp" style={{flex:1}} autoFocus placeholder="New category name..." value={f._newCat||""} onChange={e=>set("_newCat",e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&f._newCat?.trim()){set("category",f._newCat.trim());set("_newCat","");set("_addingCat",false);}}}/><button type="button" className="btn ghost bxs" onClick={()=>{if(f._newCat?.trim()){set("category",f._newCat.trim());set("_newCat","");set("_addingCat",false);}else{set("category","");set("_addingCat",false);}}}>{f._newCat?.trim()?"Save":"Cancel"}</button></div>}</div>
            <div className="fld"><label className="lbl">Tag Locations (leave empty for all)</label>
              {data.locations.map(l=>(<div key={l.id} className="row" style={{marginBottom:8}}>
                  <div onClick={()=>togTag(l.id)} style={{width:22,height:22,borderRadius:4,border:"1.5px solid",borderColor:f.locationTags&&f.locationTags.includes(l.id)?"var(--green)":"var(--b)",background:f.locationTags&&f.locationTags.includes(l.id)?"var(--green)":"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                    {f.locationTags&&f.locationTags.includes(l.id)&&<Ic.Check/>}
                  </div>
                  <span style={{fontSize:14}}>{l.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {(modal.type==="editTeam")&&(<div>
            <div className="fld"><label className="lbl">Team Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Sport</label><select className="sel" value={f.sport||"Basketball"} onChange={e=>set("sport",e.target.value)}>{["General","Baseball","Basketball","Football","Soccer","Softball","Volleyball","Other"].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          </div>
        )}
        {(modal.type==="editTemplate")&&(<div>
            <div className="fld"><label className="lbl">Template Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Sport</label><select className="sel" value={f.sport||"General"} onChange={e=>set("sport",e.target.value)}>{["General","Baseball","Basketball","Football","Soccer","Softball","Volleyball","Other"].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          </div>
        )}
        {(modal.type==="addActivity"||modal.type==="editActivity")&&(<div>
            <div className="fld"><label className="lbl">Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
            <div className="g2"><div className="fld"><label className="lbl">Sport</label><select className="sel" value={f.sport||"General"} onChange={e=>set("sport",e.target.value)}>{SPORTS.map(s=><option key={s} value={s}>{s}</option>)}</select></div><div className="fld"><label className="lbl">Duration (min)</label><DurStepper value={f.duration||10} min={1} onChange={v=>set("duration",v)}/></div></div>
            <div className="fld"><label className="lbl">Description</label><textarea className="ta" style={{minHeight:50}} value={f.description||""} onChange={e=>set("description",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Player Grouping</label>
              <div style={{display:"flex",gap:6}}>
                {[{v:"whole",l:"Whole Team",sub:"All players together"},{v:"partners",l:"Partners",sub:"Paired in groups of 2"},{v:"groups",l:"Groups",sub:"Split into groups"}].map(({v,l,sub})=>(<button key={v} type="button" onClick={()=>set("grouping",v)} style={{flex:1,padding:"8px 4px",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:(f.grouping||"whole")===v?"var(--green)":"var(--s1)",color:(f.grouping||"whole")===v?"#fff":"var(--black)",fontSize:13,cursor:"pointer",lineHeight:1.3}}>
                  <div style={{fontWeight:700}}>{l}</div>
                  {(f.grouping||"whole")===v&&<div style={{fontSize:10,opacity:.8,marginTop:2}}>{sub}</div>}
                </button>))}
              </div>
              {(f.grouping||"whole")==="groups"&&<div style={{marginTop:8}}>
                <div style={{fontSize:12,color:"var(--td)",marginBottom:6}}>How many groups?</div>
                <div style={{display:"flex",gap:6}}>
                  {[2,3,4,5,6].map(n=>(<button key={n} type="button" onClick={()=>set("numGroups",n)} style={{flex:1,padding:"8px 0",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:f.numGroups===n?"var(--green)":"var(--s1)",color:f.numGroups===n?"#fff":"var(--black)",fontSize:14,fontWeight:700,cursor:"pointer"}}>{n}</button>))}
                </div>
              </div>}
            </div>
            <div className="fld"><label className="lbl">Coaching Points</label><textarea className="ta" style={{minHeight:50}} value={f.coachingPoints||""} onChange={e=>set("coachingPoints",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Team Equipment</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:6}}>
                {data.assets.map(a=>(<button key={a.id} type="button" onClick={()=>{const cur=(f.equipment||[]);const has=cur.includes(a.id);set("equipment",has?cur.filter(x=>x!==a.id):[...cur,a.id]);}} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:(f.equipment||[]).includes(a.id)?"var(--green)":"var(--s1)",color:(f.equipment||[]).includes(a.id)?"#fff":"var(--black)",fontSize:13,cursor:"pointer"}}>{a.name}</button>))}
                {data.assets.length===0&&<span style={{fontSize:12,color:"var(--td)"}}>No equipment in library yet</span>}
              </div>
              <div style={{display:"flex",gap:6}}>
                <input className="inp" placeholder="Add new equipment..." id="new-equip-inp" style={{flex:1}}/>
                <button type="button" className="btn ghost bxs" onClick={()=>{const el=document.getElementById("new-equip-inp");if(!el||!el.value.trim())return;const nm=el.value.trim();const newId=uid();update(d=>{d.assets.push({id:newId,name:nm,locationTags:[]});return d;});set("equipment",[...(f.equipment||[]),newId]);el.value="";}}>Add</button>
              </div>
            </div>
            <div className="fld"><label className="lbl">Player Gear Needed</label><input className="inp" placeholder="e.g. Batting helmet, glove" value={f.playerGear||""} onChange={e=>set("playerGear",e.target.value)}/></div>
          </div>
        )}
        <div className="mfooter"><button className="btn ghost bmd" onClick={closeModal}>Cancel</button><button className="btn primary bmd" onClick={save}>Save</button></div>
      </div>
    </div>
  );
}