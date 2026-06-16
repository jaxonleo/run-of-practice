import React, { useState, useEffect, useRef, useCallback } from "react";
import { loadData, saveData, setCoachKey, getSession, subscribeToSession, createSession, updateSession, endSession } from "./supabase.js";

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

const DEFAULT_TEAMS=[
  {id:"team_coed78",name:"Peoria Coed 7-8",sport:"Basketball",
   coaches:[{id:"c_jaxon1",name:"Coach Jaxon",role:"Head Coach",notes:""},{id:"c_steven1",name:"Coach Steven",role:"Assistant",notes:""}],
   players:[
    {id:"p_curtis",firstName:"Elijah",lastName:"Curtis",jersey:"",notes:""},
    {id:"p_dietrich",firstName:"Dominic",lastName:"Dietrich",jersey:"",notes:""},
    {id:"p_figueroa",firstName:"Milo",lastName:"Figueroa",jersey:"",notes:""},
    {id:"p_jones",firstName:"Jordan",lastName:"Jones",jersey:"",notes:""},
    {id:"p_leo_t",firstName:"Teagan",lastName:"Leo",jersey:"",notes:""},
    {id:"p_lonsberry_el",firstName:"Eliana",lastName:"Lonsberry",jersey:"",notes:""},
    {id:"p_lonsberry_ev",firstName:"Everett",lastName:"Lonsberry",jersey:"",notes:""},
    {id:"p_markel",firstName:"Elliot",lastName:"Markel",jersey:"",notes:""},
    {id:"p_neal",firstName:"Oliver",lastName:"Neal",jersey:"",notes:""},
    {id:"p_tew",firstName:"Lyndi",lastName:"Tew",jersey:"",notes:""},
  ]},
  {id:"team_boys910",name:"Peoria Boys 9-10",sport:"Basketball",
   coaches:[{id:"c_jaxon2",name:"Coach Jaxon",role:"Head Coach",notes:""},{id:"c_mike1",name:"Coach Mike",role:"Assistant",notes:""}],
   players:[
    {id:"p_bartels",firstName:"Wesley",lastName:"Bartels",jersey:"",notes:""},
    {id:"p_gonzalez",firstName:"Eli",lastName:"Gonzalez",jersey:"",notes:""},
    {id:"p_harrier",firstName:"Gus",lastName:"Harrier",jersey:"",notes:""},
    {id:"p_irrgang",firstName:"Enzo",lastName:"Irrgang",jersey:"",notes:""},
    {id:"p_kinkade",firstName:"Samuel",lastName:"Kinkade",jersey:"",notes:""},
    {id:"p_leo_w",firstName:"Weston",lastName:"Leo",jersey:"",notes:""},
    {id:"p_morris",firstName:"Jeshua",lastName:"Morris",jersey:"",notes:""},
    {id:"p_perez",firstName:"Santi",lastName:"Perez",jersey:"",notes:""},
    {id:"p_rackstein",firstName:"Brayden",lastName:"Rackstein",jersey:"",notes:""},
    {id:"p_zack",firstName:"Kane",lastName:"Zack",jersey:"",notes:""},
  ]},
];

const DEFAULT_LOCS=[
  {id:"l1",name:"Baseball Field",sublocations:[{id:"sl1",name:"Batting Cage"},{id:"sl2",name:"Infield"},{id:"sl3",name:"Outfield"},{id:"sl4",name:"Bullpen"},{id:"sl5",name:"Portable Mound"},{id:"sl6",name:"Dugout"}]},
  {id:"l2",name:"Indoor Facility",sublocations:[{id:"sl7",name:"Station A"},{id:"sl8",name:"Station B"},{id:"sl9",name:"Station C"},{id:"sl10",name:"Pitching Lane"}]},
  {id:"l3",name:"Basketball Gym",sublocations:[{id:"sl11",name:"Hoop 1"},{id:"sl12",name:"Hoop 2"},{id:"sl13",name:"Half Court A"},{id:"sl14",name:"Half Court B"},{id:"sl15",name:"Free Throw Line"}]},
];

const DEFAULT_ASSETS=[
  {id:"a1",name:"L Screen",locationTags:[]},{id:"a2",name:"Ball Bucket",locationTags:[]},
  {id:"a3",name:"Cones",locationTags:[]},{id:"a4",name:"Flyball Machine",locationTags:["l1"]},
  {id:"a5",name:"Bases",locationTags:["l1"]},{id:"a6",name:"Batting Tee",locationTags:["l1","l2"]},
  {id:"a7",name:"Portable Mound",locationTags:["l1","l2"]},{id:"a8",name:"Helmets",locationTags:[]},
  {id:"a9",name:"Basketballs",locationTags:["l3"]},{id:"a10",name:"Pinnies",locationTags:[]},
];

const DEFAULT_LIB=[
  {id:"al1",name:"Warmup",sport:"Baseball",description:"Dynamic stretching",duration:10,coachingPoints:"Energy high, get loose. Arm circles, leg swings.",equipment:[]},
  {id:"al2",name:"Hitting",sport:"Baseball",description:"Batting practice",duration:15,coachingPoints:"Short stride, stay back, hands inside the ball.",equipment:[]},
  {id:"al3",name:"Fielding",sport:"Baseball",description:"Ground and fly balls",duration:15,coachingPoints:"Field through the ball, two hands.",equipment:[]},
  {id:"al4",name:"Baserunning",sport:"Baseball",description:"Reads and reactions",duration:10,coachingPoints:"Secondary leads, first step on contact.",equipment:[]},
  {id:"al5",name:"Pitching",sport:"Baseball",description:"Bullpen mechanics",duration:15,coachingPoints:"Balance point, drive down the mound.",equipment:[]},
  {id:"al6",name:"Infield",sport:"Baseball",description:"Ground balls and double plays",duration:15,coachingPoints:"Ready position, creep on pitch.",equipment:[]},
  {id:"al7",name:"Outfield",sport:"Baseball",description:"Fly balls and routes",duration:15,coachingPoints:"First step back, read spin.",equipment:[]},
  {id:"al8",name:"Live BP",sport:"Baseball",description:"Live batting practice",duration:20,coachingPoints:"Game speed focus.",equipment:[]},
  {id:"al9",name:"Scrimmage",sport:"Baseball",description:"Live game situations",duration:25,coachingPoints:"Play like it counts.",equipment:[]},
  {id:"al10",name:"Warmup",sport:"Basketball",description:"Dynamic warmup",duration:10,coachingPoints:"Eyes up, stay low, get loose.",equipment:[]},
  {id:"al11",name:"Ball Handling",sport:"Basketball",description:"Dribbling drills",duration:12,coachingPoints:"Fingertips not palms. Eyes up.",equipment:[]},
  {id:"al12",name:"Passing",sport:"Basketball",description:"Chest, bounce, overhead passes",duration:10,coachingPoints:"Step into pass, follow through.",equipment:[]},
  {id:"al13",name:"Shooting",sport:"Basketball",description:"Form shooting and layups",duration:15,coachingPoints:"BEEF: Balance, Eyes, Elbow, Follow through.",equipment:[]},
  {id:"al14",name:"Defense",sport:"Basketball",description:"Defensive stance",duration:12,coachingPoints:"Low stance, hands active.",equipment:[]},
  {id:"al15",name:"Scrimmage",sport:"Basketball",description:"Live game play",duration:20,coachingPoints:"Play hard, communicate, have fun.",equipment:[]},
  {id:"al16",name:"Water Break",sport:"General",description:"",duration:5,coachingPoints:"",equipment:[]},
  {id:"al17",name:"Closer",sport:"General",description:"Team huddle",duration:5,coachingPoints:"End on energy.",equipment:[]},
  {id:"al18",name:"Stretching",sport:"General",description:"Static stretching",duration:8,coachingPoints:"Hold 20-30 seconds.",equipment:[]},
];

const INIT={teams:DEFAULT_TEAMS,locations:DEFAULT_LOCS,assets:DEFAULT_ASSETS,activityLibrary:DEFAULT_LIB,practices:[],templates:[],notes:[]};

function mergeDefaults(saved){
  const d=JSON.parse(JSON.stringify(saved));
  const tids=new Set(d.teams.map(t=>t.id));
  DEFAULT_TEAMS.forEach(t=>{
    if(!tids.has(t.id)){d.teams.push(t);}
    else{
      const existing=d.teams.find(et=>et.id===t.id);
      if(existing){
        const cids=new Set(existing.coaches.map(c=>c.id));
        t.coaches.forEach(c=>{if(!cids.has(c.id))existing.coaches.push(c);});
      }
    }
  });
  const lids=new Set(d.locations.map(l=>l.id));
  DEFAULT_LOCS.forEach(l=>{if(!lids.has(l.id))d.locations.push(l);});
  d.locations.forEach(loc=>{
    const def=DEFAULT_LOCS.find(dl=>dl.id===loc.id);
    if(def){const slids=new Set(loc.sublocations.map(s=>s.id));def.sublocations.forEach(sl=>{if(!slids.has(sl.id))loc.sublocations.push(sl);});}
  });
  const aids=new Set(d.assets.map(a=>a.id));
  DEFAULT_ASSETS.forEach(a=>{if(!aids.has(a.id))d.assets.push(Object.assign({},a,{locationTags:a.locationTags||[]}));});
  d.assets=d.assets.map(a=>Object.assign({},a,{locationTags:a.locationTags||[]}));
  const lbids=new Set(d.activityLibrary.map(a=>a.id));
  DEFAULT_LIB.forEach(a=>{if(!lbids.has(a.id))d.activityLibrary.push(a);});
  if(!d.notes)d.notes=[];
  if(!d.templates)d.templates=[];
  d.teams.forEach(t=>{t.players.forEach(p=>{if(!p.focusAreas)p.focusAreas=[];});});
  d.practices.forEach(p=>{(p.activities||[]).forEach(a=>{if(a.type==="station_block"&&a.rotate===undefined)a.rotate=true;});});
  d.templates.forEach(t=>{(t.activities||[]).forEach(a=>{if(a.type==="station_block"&&a.rotate===undefined)a.rotate=true;});});
  if(!d.templates.some(t=>t.id==="tpl_demo_bball")){
    d.templates.push({id:"tpl_demo_bball",name:"Demo Day - Basketball",sport:"Basketball",teamId:"team_coed78",activities:[
      {id:"tdemo_a1",type:"activity",name:"Warmup",duration:10,assignments:[],coachId:"c_jaxon1",sublocationId:"",notes:"Get loose, energy high",coachingPoints:"Eyes up, stay low, get loose."},
      {id:"tdemo_b1",type:"station_block",stationDuration:8,transitionDuration:2,stations:[
        {id:"tdemo_s1",name:"Station 1",activityName:"Ball Handling",coachId:"c_jaxon1",sublocationId:"",assignments:[],coachingPoints:"Fingertips not palms."},
        {id:"tdemo_s2",name:"Station 2",activityName:"Shooting",coachId:"",sublocationId:"",assignments:[],coachingPoints:"BEEF: Balance, Eyes, Elbow, Follow through."},
        {id:"tdemo_s3",name:"Station 3",activityName:"Defense",coachId:"",sublocationId:"",assignments:[],coachingPoints:"Low stance, hands active."},
      ]},
      {id:"tdemo_a2",type:"activity",name:"Scrimmage",duration:15,assignments:[],coachId:"c_jaxon1",sublocationId:"",notes:"",coachingPoints:"Play hard, communicate, have fun."},
      {id:"tdemo_cl",type:"checklist",name:"Closer",duration:5,assignments:[],coachId:"c_jaxon1",items:[{id:"tdemo_i1",text:"Great effort today!",done:false},{id:"tdemo_i2",text:"Next practice date",done:false},{id:"tdemo_i3",text:"Collect any equipment",done:false}],notes:"End on a high note."},
    ]});
  }
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

function CoachSelector({onSelect,onDismiss,canDismiss}){
  const [adding,setAdding]=useState(false);
  const [newName,setNewName]=useState("");
  const save=()=>{if(!newName.trim())return;onSelect("coach_"+newName.trim().toLowerCase().replace(/[^a-z0-9]/g,"_"));};
  return (<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.72)",zIndex:200,display:"flex",alignItems:"flex-end"}}>
    <div style={{background:"#fff",width:"100%",borderRadius:"20px 20px 0 0",padding:"24px 20px 48px"}}>
      <div style={{width:36,height:4,background:"var(--b)",borderRadius:2,margin:"0 auto 20px"}}/>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:26,fontWeight:900,marginBottom:4}}>Who are you?</div>
      <div style={{fontSize:14,color:"var(--td)",marginBottom:20}}>Choose your name to see your teams and practices.</div>
      {!adding&&<div>
        <button onClick={()=>onSelect("c_jaxon1")} style={{width:"100%",padding:"14px 16px",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:"var(--s1)",marginBottom:10,textAlign:"left",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:16,fontWeight:600}}>Jaxon</span>
          <span style={{color:"var(--green)",fontSize:20,fontWeight:700}}>&#8594;</span>
        </button>
        <button onClick={()=>setAdding(true)} style={{width:"100%",padding:"14px 16px",borderRadius:"var(--r)",border:"1.5px dashed var(--gb)",background:"#fff",marginBottom:10,textAlign:"left",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
          <span style={{width:28,height:28,borderRadius:"50%",background:"var(--gbg)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--green)",fontSize:20,fontWeight:700,flexShrink:0}}>+</span>
          <span style={{fontSize:16,fontWeight:600,color:"var(--green)"}}>Add New</span>
        </button>
        {canDismiss&&<button onClick={onDismiss} style={{width:"100%",padding:"12px",border:"none",background:"transparent",color:"var(--td)",fontSize:14,cursor:"pointer"}}>Cancel</button>}
      </div>}
      {adding&&<div>
        <div className="fld mb10"><label className="lbl">Your Name</label><input className="inp" autoFocus placeholder="e.g. Coach Rivera" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()}/></div>
        <div className="brow"><button className="btn ghost bmd" onClick={()=>setAdding(false)}>Back</button><button className="btn primary bmd" onClick={save} disabled={!newName.trim()}>Start Coaching</button></div>
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
  return (<div style={{padding:"0 0 calc(var(--tab) + 20px)"}}>
    <div style={{padding:"20px 16px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:26,fontWeight:900,lineHeight:1}}>{greeting},</div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:26,fontWeight:900,color:"var(--green)",lineHeight:1}}>{coachName}</div>
      </div>
      <button onClick={onSwitchCoach} style={{background:"var(--s2)",border:"1.5px solid var(--b)",borderRadius:"50%",width:40,height:40,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
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
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
          {soon&&<span style={{background:"var(--green)",color:"#fff",fontFamily:"Barlow Condensed,sans-serif",fontSize:10,fontWeight:700,letterSpacing:".08em",padding:"2px 8px",borderRadius:20}}>TODAY</span>}
          <span style={{fontSize:13,color:"var(--td)",fontWeight:600}}>{timeLbl(p)}</span>
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
          <button className="btn ghost bxs" onClick={()=>setView("command")}>View</button>
        </div>);})}
      </div>}
      {recent.length>0&&<div style={{marginTop:16}}>
        <div className="sechdr" style={{marginBottom:8}}><span className="sectitle">Recent</span></div>
        {recent.map(p=>{const team=getTeam(p.teamId);const d=new Date(p.date+"T12:00:00");const dl=d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});return (<div key={p.id} className="li" style={{marginBottom:6,opacity:.7}}>
          <div className="lim"><div className="lin">{team?team.name:"Practice"}</div><div className="limt">{dl}</div></div>
        </div>);})}
      </div>}
      <div style={{marginTop:20,display:"flex",gap:8}}>
        <button className="btn outline bmd" style={{flex:1}} onClick={()=>{if(setEditPracticeId)setEditPracticeId(null);setView("builder");}}>+ Build Practice</button>
        <button className="btn ghost bmd" style={{flex:1}} onClick={()=>setView("library")}>Use Template</button>
      </div>
    </div>
  </div>);
}

export default function App(){
  const [data,setData]=useState(INIT);
  const [loaded,setLoaded]=useState(false);
  const [view,setView]=useState("today");
  const [modal,setModal]=useState(null);
  const [liveId,setLiveId]=useState(null);
  const [editPracticeId,setEditPracticeId]=useState(null);
  const [coachId,setCoachId]=useState(null);
  const [showCoachSelect,setShowCoachSelect]=useState(false);
  const update=useCallback(fn=>{setData(d=>{const nx=fn(JSON.parse(JSON.stringify(d)));saveData(nx);return nx;});},[]);
  useEffect(()=>{if(coachId)setCoachKey(coachId);loadData().then(d=>{setData(mergeDefaults(d||INIT));setLoaded(true);});},[]);
  const openModal=(t,p)=>setModal({type:t,payload:p||{}});
  const closeModal=()=>setModal(null);
  const launchRun=id=>{if(id)setLiveId(id);setView("command");};
  useEffect(()=>{window.__cbSetView=setView;return()=>{delete window.__cbSetView;};},[]);
  const TABS=[
    {id:"today",label:"Today",I:Ic.Home},
    {id:"teams",label:"Teams",I:Ic.Build},
    {id:"library",label:"Library",I:Ic.Run},
  ];
  const needsCoach=loaded&&!coachId;
  const selectCoach=(id)=>{setCoachKey(id);setCoachId(id);setShowCoachSelect(false);setLoaded(false);loadData().then(d=>{setData(mergeDefaults(d||INIT));setLoaded(true);});};
  const coachName=coachId==="c_jaxon1"?"Jaxon":(typeof window!=="undefined"&&window.localStorage&&localStorage.getItem("rop_coach_name"))||"Coach";
  const liveMatch=window.location.pathname.match(/^\/live\/([a-z0-9]+)$/i);
  if(liveMatch)return (<HelperView sessionId={liveMatch[1]}/>);
  if(!loaded)return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f7f8f6",color:"#2d6a4f",fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:700}}>
      <style>{CSS}</style>LOADING...
    </div>
  );
  return (<div style={{display:"contents"}}><style>{CSS}</style>
    <div className="app">
      <div className="screen">
        {view==="today"&&<TodayScreen data={data} update={update} setView={setView} setLiveId={setLiveId} coachId={coachId} coachName={coachName} onSwitchCoach={()=>setShowCoachSelect(true)} setEditPracticeId={setEditPracticeId}/>}
        {view==="teams"&&<TeamsScreen data={data} update={update} setView={setView} setLiveId={setLiveId} coachId={coachId} openModal={openModal}/>}
        {view==="library"&&<NewLibraryScreen data={data} update={update} openModal={openModal} setView={setView} setLiveId={setLiveId} launchRun={launchRun}/>}
        {view==="builder"&&<BuilderScreen data={data} update={update} openModal={openModal} launchRun={launchRun} editPracticeId={editPracticeId} setEditPracticeId={setEditPracticeId}/>}
                {view==="command"&&<CommandScreen data={data} update={update} liveId={liveId} setLiveId={setLiveId} coachId={coachId}/>}
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
    {(needsCoach||showCoachSelect)&&<CoachSelector onSelect={selectCoach} onDismiss={()=>setShowCoachSelect(false)} canDismiss={!!coachId}/>}
    </div>
  );
}

function QuickNoteEntry({data,update}){
  const [txt,setTxt]=useState("");
  const [ctx,setCtx]=useState("");
  const [saved,setSaved]=useState(false);
  const save=()=>{
    if(!txt.trim())return;
    update(d=>{d.notes.push({id:uid(),text:txt,context:ctx,date:new Date().toISOString()});return d;});
    setTxt("");setCtx("");setSaved(true);setTimeout(()=>setSaved(false),1500);
  };
  return (<div className="card">
      <div className="clbl mb8">Quick Note</div>
      <div className="fld"><label className="lbl">Context (player, drill, etc.)</label><input className="inp" placeholder="e.g. Weston, Shooting" value={ctx} onChange={e=>setCtx(e.target.value)}/></div>
      <div className="fld"><textarea className="ta" placeholder="What did you observe?" value={txt} onChange={e=>setTxt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&e.metaKey&&save()}/></div>
      <button className="btn primary bsm bfull" onClick={save} disabled={!txt.trim()}>{saved?"Saved":"Save Note"}</button>
    </div>
  );
}


function HomeScreen({data,update,openModal,setView,setLiveId,launchRun}){
  const [homeView,setHomeView]=useState("dashboard");
  const [viewTeamId,setViewTeamId]=useState(null);
  const [manageView,setManageView]=useState(null);
  if(homeView==="roster"&&viewTeamId)return(<div style={{paddingBottom:80}}>
      <div className="row mb10"><button className="btn ghost bxs" onClick={()=>{setHomeView("dashboard");setViewTeamId(null);}}>Back</button><div className="ptitle" style={{fontSize:20}}>{(data.teams.find(t=>t.id===viewTeamId)||{name:""}).name}</div></div>
      <RostersTab data={data} update={update} openModal={openModal} fixedTeamId={viewTeamId}/>
    </div>
  );
  if(homeView==="locations")return(<div style={{paddingBottom:80}}>
      <div className="row mb10"><button className="btn ghost bxs" onClick={()=>setHomeView("dashboard")}>Back</button><div className="ptitle" style={{fontSize:20}}>Locations</div></div>
      <LocationsTab data={data} update={update} openModal={openModal}/>
    </div>
  );
  if(homeView==="equipment")return(<div style={{paddingBottom:80}}>
      <div className="row mb10"><button className="btn ghost bxs" onClick={()=>setHomeView("dashboard")}>Back</button><div className="ptitle" style={{fontSize:20}}>Equipment</div></div>
      <EquipmentTab data={data} update={update} openModal={openModal}/>
    </div>
  );
  if(homeView==="library")return(<div style={{paddingBottom:80}}>
      <div className="row mb10"><button className="btn ghost bxs" onClick={()=>setHomeView("dashboard")}>Back</button><div className="ptitle" style={{fontSize:20}}>Activity Library</div></div>
      <LibraryScreen data={data} update={update} openModal={openModal}/>
    </div>
  );
  if(homeView==="notes")return(<div style={{paddingBottom:80}}>
      <div className="row mb10"><button className="btn ghost bxs" onClick={()=>setHomeView("dashboard")}>Back</button><div className="ptitle" style={{fontSize:20}}>Practice Log</div></div>
      <PracticeLog data={data} update={update} launchRun={launchRun}/>
    </div>
  );
  return (<div style={{paddingBottom:80}}>
      <div className="phdr"><div className="ptitle">Home</div></div>
      <div className="card mb10">
        <div className="sechdr mb8">
          <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700}}>Teams</span>
          <button className="btn primary bxs" onClick={()=>openModal("addTeam")}>+ Team</button>
        </div>
        {!data.teams.length&&<div className="empty" style={{padding:"12px 0"}}><div className="emtx">No teams yet</div></div>}
        {data.teams.map(t=>(<div key={t.id} className="li tap" onClick={()=>{setViewTeamId(t.id);setHomeView("roster");}}>
            <div className="lim">
              <div className="lin">{t.name}</div>
              <div className="limt">{t.sport} - {t.players.length} players - {t.coaches.length} coaches</div>
            </div>
            <span style={{color:"var(--green)",fontSize:13,fontWeight:600,flexShrink:0}}>View &gt;</span>
          </div>
        ))}
      </div>
      <div className="g2" style={{marginBottom:10}}>
        <div className="card tap" style={{cursor:"pointer",marginBottom:0}} onClick={()=>setHomeView("locations")}>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,marginBottom:4}}>Locations</div>
          <div className="limt">{data.locations.length} locations</div>
          <div style={{color:"var(--green)",fontSize:12,fontWeight:600,marginTop:6}}>Manage &gt;</div>
        </div>
        <div className="card tap" style={{cursor:"pointer",marginBottom:0}} onClick={()=>setHomeView("equipment")}>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,marginBottom:4}}>Equipment</div>
          <div className="limt">{data.assets.length} items</div>
          <div style={{color:"var(--green)",fontSize:12,fontWeight:600,marginTop:6}}>Manage &gt;</div>
        </div>
      </div>
      <div className="g2" style={{marginBottom:10}}>
        <div className="card tap" style={{cursor:"pointer",marginBottom:0}} onClick={()=>setHomeView("library")}>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,marginBottom:4}}>Library</div>
          <div className="limt">{data.activityLibrary.length} activities</div>
          <div style={{color:"var(--green)",fontSize:12,fontWeight:600,marginTop:6}}>Manage &gt;</div>
        </div>
        <div className="card tap" style={{cursor:"pointer",marginBottom:0}} onClick={()=>setHomeView("notes")}>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700,marginBottom:4}}>Practice Log</div>
          <div className="limt">{data.notes.length} note{data.notes.length!==1?"s":""} - {data.practices.length} session{data.practices.length!==1?"s":""}</div>
          <div style={{color:"var(--green)",fontSize:12,fontWeight:600,marginTop:6}}>View &gt;</div>
        </div>
      </div>
      <QuickNoteEntry data={data} update={update}/>
    </div>
  );
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

function BuilderScreen({data,update,openModal,launchRun}){
  const [teamId,setTeamId]=useState(data.teams[0]?data.teams[0].id:"");
  const [locId,setLocId]=useState(data.locations[0]?data.locations[0].id:"");
  const [acts,setActs]=useState([]);
  const [expandedId,setExpandedId]=useState(null);
  const [savedTpl,setSavedTpl]=useState(false);
  const [bottomMode,setBottomMode]=useState(null);
  const [schedDate,setSchedDate]=useState(new Date().toISOString().slice(0,10));
  const [schedTime,setSchedTime]=useState("16:00");
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
      update(d=>{const p=d.practices.find(p=>p.id===existingId);if(p){p.teamId=teamId;p.locationId=locId;p.activities=acts;p.durMin=totalMins;if(practiceDate)p.date=practiceDate;if(practiceTime)p.startTime=practiceTime;}return d;});
      if(setEditPracticeId)setEditPracticeId(null);
    }else{
      const now=new Date();const newId=uid();
      update(d=>{d.practices.push({id:newId,teamId,locationId:locId,date:practiceDate||now.toISOString().slice(0,10),startTime:practiceTime||now.toTimeString().slice(0,5),durMin:totalMins,activities:acts});return d;});
    }
  };
  const handleRun=()=>{
    if(existingId){
      update(d=>{const p=d.practices.find(p=>p.id===existingId);if(p){p.teamId=teamId;p.locationId=locId;p.activities=acts;p.durMin=totalMins;}return d;});
      launchRun(existingId);
    }else{
      const now=new Date();const newId=uid();
      update(d=>{d.practices.push({id:newId,teamId,locationId:locId,date:practiceDate||now.toISOString().slice(0,10),startTime:practiceTime||now.toTimeString().slice(0,5),durMin:totalMins,activities:acts});return d;});
      launchRun(newId);
    }
  };
  return (<div style={{paddingBottom:80}}>
      <div className="card mb10">
        <div className="clbl">Practice Setup</div>
        <div className="fld"><label className="lbl">Team</label>
          <select className="sel" value={teamId} onChange={e=>setTeamId(e.target.value)}>
            {!data.teams.length&&<option value="">-- Add a team first --</option>}
            {data.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="fld"><label className="lbl">Location</label>
          <select className="sel" value={locId} onChange={e=>setLocId(e.target.value)}>
            {data.locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="g2 mb8">
          <div className="fld"><label className="lbl">Date</label><input className="inp" type="date" value={practiceDate} onChange={e=>setPracticeDate(e.target.value)}/></div>
          <div className="fld"><label className="lbl">Time</label><input className="inp" type="time" value={practiceTime} onChange={e=>setPracticeTime(e.target.value)}/></div>
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
      {acts.map((act,i)=>(<div key={act.id} draggable onDragStart={e=>onDS(e,i)} onDragOver={onDO} onDrop={e=>onDrop(e,i)} onDragEnd={onDE}>
          <div className="ablk">
            <div className="abhdr" onClick={()=>setExpandedId(expandedId===act.id?null:act.id)}>
              <span className="dh"><Ic.Dots/></span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{font:"700 14px Barlow Condensed,sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {act.type==="station_block"?"Station Block":act.name}
                </div>
                {act.type==="station_block"?<div className="limt">{act.stations.map(s=>s.activityName||s.name).join(" / ")} - {act.stationDuration}m x{act.stations.length} + {act.transitionDuration}m trans = {act.stations.length*act.stationDuration+Math.max(0,act.stations.length-1)*act.transitionDuration}m</div>:<div className="limt">{act.duration}min</div>}
              </div>
              <div className="row">
                {act.type!=="station_block"&&<span className="bdg bp">{act.duration}m</span>}
                <button className="btn danger bxs" onClick={e=>{e.stopPropagation();remAct(act.id);}}>x</button>
              </div>
            </div>
            {expandedId===act.id&&(<div className="abbody">
                {act.type==="activity"&&<ActConfig act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
                {act.type==="checklist"&&<ChecklistConfig act={act} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
                {act.type==="station_block"&&<StationConfig act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)}/>}
              </div>
            )}
          </div>
        </div>
      ))}
      <div style={{borderTop:"1px solid var(--b)",paddingTop:14}}>
        <div className="sechdr mb8"><span className="sectitle">Add to Practice</span><div className="row"><button className="btn ghost bxs" onClick={()=>openModal("addActivity")}>+ New Activity</button></div></div>
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

    {acts.length>0&&(<div className="builder-bar">
        {bottomMode==="schedule"&&<div style={{width:"100%"}}>
            <div className="g2 mb8">
              <div className="fld"><label className="lbl">Date</label><input className="inp" type="date" value={schedDate} onChange={e=>setSchedDate(e.target.value)}/></div>
              <div className="fld"><label className="lbl">Start Time</label><input className="inp" type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)}/></div>
            </div>
            <div className="fld mb8"><label className="lbl">Duration (min)</label><DurStepper value={schedDur} min={5} step={5} onChange={v=>setSchedDur(v)}/></div>
            <div className="brow">
              <button className="btn ghost bmd" onClick={()=>setBottomMode(null)}>Cancel</button>
              <button className="btn primary bmd" onClick={()=>doSchedule(schedDate,schedTime,schedDur)}>Save</button>
            </div>
          </div>}
        {bottomMode==="template"&&<div style={{width:"100%"}}>
            <div className="fld mb8"><label className="lbl">Template Name</label><input className="inp" autoFocus placeholder={"My "+teamSport+" Practice"} value={tplName} onChange={e=>setTplName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSaveTpl(tplName)}/></div>
            <div className="brow">
              <button className="btn ghost bmd" onClick={()=>setBottomMode(null)}>Cancel</button>
              <button className="btn primary bmd" onClick={()=>doSaveTpl(tplName)} disabled={!tplName.trim()}>Save</button>
            </div>
          </div>}
        {bottomMode==="done_sched"&&<div style={{width:"100%",textAlign:"center"}}>
            <span style={{color:"var(--green)",fontFamily:"Barlow Condensed,sans-serif",fontSize:15,fontWeight:700}}>Scheduled for {schedDate}!</span>
            <button className="btn ghost bxs" style={{marginLeft:10}} onClick={()=>setBottomMode(null)}>Done</button>
          </div>}
        {(!bottomMode||bottomMode==="")&&<div style={{display:"flex",gap:8,width:"100%"}}>
            <button className="btn outline blg" style={{flex:1}} onClick={handleSave}>{existingId?"Save":"Save"}</button><button className="btn primary bxl" style={{flex:2}} onClick={handleRun}>Run Now</button>
            <button className="btn outline bmd" style={{flex:1}} onClick={()=>setBottomMode("schedule")}>Schedule</button>
            <button className="btn ghost bmd" style={{flex:1}} onClick={()=>{setTplName("");setBottomMode("template");}}>Template</button>
          </div>}
      </div>
    )}
    </div>
  );
}

function ActConfig({act,team,loc,onChange,onDone}){
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
      <div className="fld mb8"><label className="lbl">Equipment</label><input className="inp" placeholder="e.g. 6 cones, 2 ball racks" value={act.equipment||""} onChange={e=>onChange({equipment:e.target.value})}/></div>
      <div className="fld mb8"><label className="lbl">Notes</label><textarea className="ta" style={{minHeight:44}} value={act.notes||""} placeholder="Notes for this activity..." onChange={e=>onChange({notes:e.target.value})}/></div>
      {team&&(<div className="mb8">
          <label className="lbl">Players ({act.assignments?act.assignments.length:0}/{team.players.length})</label>
          <div className="cgrid">
            {team.players.map(p=>(<div key={p.id} className={"chip "+(act.assignments&&act.assignments.includes(p.id)?"on":"")} onClick={()=>tog(p.id)}>
                <div className="cn">{p.jersey?"#"+p.jersey:p.firstName.slice(0,2)}</div>
                <div className="cf">{p.firstName}</div>
              </div>
            ))}
          </div>
          <div className="row mt6">
            <button className="btn ghost bxs" onClick={()=>onChange({assignments:team.players.map(p=>p.id)})}>All</button>
            <button className="btn ghost bxs" onClick={()=>onChange({assignments:[]})}>None</button>
          </div>
        </div>
      )}
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

function StationConfig({act,team,loc,onChange,onSt,onDone}){
  const [exSt,setExSt]=useState(null);
  const [randGroups,setRandGroups]=useState(null);
  const addSt=()=>onChange({stations:[...act.stations,{id:uid(),name:"Station "+(act.stations.length+1),activityName:"",coachId:"",sublocationId:"",assignments:[],coachingPoints:""}]});
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
        <div className="fld"><label className="lbl">Total</label><div style={{padding:"10px 0",fontSize:14,fontFamily:"DM Mono,monospace",fontWeight:600}}>{blockMins}m</div></div>
      </div>
      <div className="row mb8"><button className="btn ghost bxs" onClick={addSt}>+ Station</button>{team&&act.stations.length>0&&<button className="btn outline bxs" onClick={genRand}>Random Groups</button>}</div>
      {act.stations.map(st=>(<div key={st.id} style={{border:"1px solid var(--b)",borderRadius:"var(--rs)",marginBottom:8,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",padding:"9px 11px",background:"var(--bg)",cursor:"pointer",gap:8}} onClick={()=>setExSt(exSt===st.id?null:st.id)}>
            <span style={{font:"700 13px Barlow Condensed,sans-serif",flex:1}}>{st.name}{st.activityName?": "+st.activityName:""}</span>
            <span className="td" style={{fontSize:11}}>{st.assignments?st.assignments.length:0}p</span>
            <button className="btn danger bxs" onClick={e=>{e.stopPropagation();remSt(st.id);}}>x</button>
          </div>
          {exSt===st.id&&(<div style={{padding:"10px 11px",background:"var(--s2)",borderTop:"1px solid var(--b)"}}>
              <div className="g2 mb8">
                <div className="fld"><label className="lbl">Activity</label><input className="inp" placeholder="e.g. Shooting" value={st.activityName||""} onChange={e=>onSt(st.id,{activityName:e.target.value})}/></div>
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
              <div className="fld mb8"><label className="lbl">Coaching Points</label><input className="inp" placeholder="Key cue..." value={st.coachingPoints||""} onChange={e=>onSt(st.id,{coachingPoints:e.target.value})}/></div>
              {team&&(<div>
                  <label className="lbl">Players ({st.assignments?st.assignments.length:0})</label>
                  <div className="cgrid">
                    {team.players.map(p=>(<div key={p.id} className={"chip "+(st.assignments&&st.assignments.includes(p.id)?"on":"")} onClick={()=>togSt(st.id,p.id)}>
                        <div className="cn">{p.jersey?"#"+p.jersey:p.firstName.slice(0,2)}</div><div className="cf">{p.firstName}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      <button className="btn primary bsm bfull mt8" onClick={onDone}>Done</button>
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
              {act.type==="activity"&&<ActConfig act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
              {act.type==="checklist"&&<ChecklistConfig act={act} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
              {act.type==="station_block"&&<StationConfig act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)}/>}
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
      {acts.map((act,i)=>(<div key={act.id} draggable onDragStart={e=>onDS(e,i)} onDragOver={onDO} onDrop={e=>onDrop(e,i)}>
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
                {act.type==="activity"&&<ActConfig act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
                {act.type==="checklist"&&<ChecklistConfig act={act} onChange={ch=>updAct(act.id,ch)} onDone={()=>setExpandedId(null)}/>}
                {act.type==="station_block"&&<StationConfig act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>setExpandedId(null)}/>}
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

  if(loading)return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,background:"#0d1512"}}><style>{CSS}</style><div style={{color:"#52b788",fontFamily:"Barlow Condensed,sans-serif",fontSize:16,fontWeight:700,letterSpacing:".1em"}}>JOINING SESSION...</div></div>);
  if(!session)return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,background:"#0d1512",padding:"24px"}}><div style={{color:"#fff",fontFamily:"Barlow Condensed,sans-serif",fontSize:24,fontWeight:900,textAlign:"center"}}>Session not found</div><div style={{color:"#555",fontSize:14,textAlign:"center"}}>This link may be invalid or the practice has ended.</div></div>);
  if(session.ended_at)return (<div style={{height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,background:"#0d1512",padding:"24px"}}><div style={{color:"#52b788",fontFamily:"Barlow Condensed,sans-serif",fontSize:48,fontWeight:900,textAlign:"center"}}>Well Done</div><div style={{color:"#555",fontSize:14,textAlign:"center"}}>This practice session has ended.</div></div>);

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
    <style>{CSS}</style>
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

function CommandScreen({data,update,liveId,setLiveId,coachId}){
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
  const [audioOn,setAudioOn]=useState(true);
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
    import("./supabase.js").then(m=>m.updateSession(sessionRef.current,newState));
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

  const beep=useCallback(()=>{try{const ctx=new(window.AudioContext||window.webkitAudioContext)();const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.type="sine";o.frequency.value=880;g.gain.setValueAtTime(0.6,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.6);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.6);}catch(e){}},[]);
  const speak=useCallback(txt=>{if(!audioOn)return;try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(txt);u.rate=0.9;window.speechSynthesis.speak(u);}catch(e){};},[audioOn]);

  const applyAtt=useCallback((pIds,cIds,mode,baseActs)=>{const allPlayers=team?team.players:[];return baseActs.map(act=>{if(act.type!=="station_block")return Object.assign({},act,{assignments:(act.assignments||[]).filter(id=>pIds.has(id))});const newSt=mode==="rebalance"?rebalanceEven(act.stations,pIds,allPlayers):rebalanceKeep(act.stations,pIds);return Object.assign({},act,{stations:newSt});});},[team]);

  const handleAttConfirm=useCallback(({presentIds:pIds,coachPresentIds:cIds,balanceMode})=>{
    setPresentIds(pIds);setCoachPresentIds(cIds);
    const newActs=applyAtt(pIds,cIds,balanceMode,practice.activities);
    setLiveActs(newActs);setStage("live");setShowAtt(false);
    setPracticeStart(Date.now());setIdx(0);setStIdx(0);setInTrans(false);setElapsed(0);setRunning(true);spoken.current={};
    import("./supabase.js").then(({createSession})=>{
      createSession(coachId||"anon",liveId,{idx:0,stIdx:0,inTrans:false,elapsed:0,running:true,runningAt:Date.now(),presentIds:[...pIds],liveActs:newActs,roster:practice?data.teams.find(t=>t.id===practice.teamId)?data.teams.find(t=>t.id===practice.teamId).players:[]:[],locations:data.locations}).then(sid=>{
        if(sid){sessionRef.current=sid;setSessionId(sid);}
      });
    });
  },[practice,applyAtt,coachId,liveId]);
  const handleAttUpdate=useCallback(({presentIds:pIds,coachPresentIds:cIds})=>{setPresentIds(pIds);setCoachPresentIds(cIds);setLiveActs(prev=>applyAtt(pIds,cIds,"keep",prev));setShowAtt(false);},[applyAtt]);

  const advance=useCallback(()=>{
    if(!cur)return;
    const base={liveActs,presentIds:[...presentIds],running:true,runningAt:Date.now(),elapsed:0,roster:practice?data.teams.find(t=>t.id===practice.teamId)?data.teams.find(t=>t.id===practice.teamId).players:[]:[],locations:data.locations};
    if(isBlock){
      if(blockRotate&&!inTrans&&cur.transitionDuration>0){
        setInTrans(true);setElapsed(0);spoken.current={};setRunning(true);
        writeSession({...base,idx,stIdx,inTrans:true});
      }else if(blockRotate&&stIdx<cur.stations.length-1){
        const ns=stIdx+1;setStIdx(ns);setInTrans(false);setElapsed(0);spoken.current={};setRunning(true);setFocusSt(null);
        writeSession({...base,idx,stIdx:ns,inTrans:false});
      }else if(idx<liveActs.length-1){
        const ni=idx+1;setIdx(ni);setStIdx(0);setInTrans(false);setElapsed(0);spoken.current={};setRunning(true);setFocusSt(null);
        writeSession({...base,idx:ni,stIdx:0,inTrans:false});
      }else{setStage("end");setRunning(false);writeSession({...base,idx,stIdx,inTrans,running:false,runningAt:null});}
    }else{
      if(idx<liveActs.length-1){
        const ni=idx+1;setIdx(ni);setElapsed(0);spoken.current={};setRunning(true);
        writeSession({...base,idx:ni,stIdx:0,inTrans:false});
      }else{setStage("end");setRunning(false);writeSession({...base,idx,stIdx,inTrans,running:false,runningAt:null});}
    }
  },[cur,isBlock,blockRotate,inTrans,stIdx,idx,liveActs,presentIds,writeSession]);
  const goBack=useCallback(()=>{if(isBlock){if(inTrans){setInTrans(false);setElapsed(0);spoken.current={};setRunning(false);}else if(stIdx>0){setStIdx(i=>i-1);setElapsed(0);spoken.current={};setRunning(false);}else if(idx>0){setIdx(i=>i-1);setStIdx(0);setInTrans(false);setElapsed(0);spoken.current={};setRunning(false);}}else{if(idx>0){setIdx(i=>i-1);setElapsed(0);spoken.current={};setRunning(false);}}},[isBlock,inTrans,stIdx,idx]);

  const startedAtRef=useRef(null);
  const baseElapsedRef=useRef(0);
  useEffect(()=>{
    if(running){
      startedAtRef.current=Date.now();
      baseElapsedRef.current=elapsed;
      iref.current=setInterval(()=>{
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
  if(stage==="pick")return (<div className="screen" style={{padding:"14px 14px calc(var(--tab) + 40px)"}}><PracticePicker data={data} update={update} onSelect={id=>{setLiveId(id);setLivePracticeOverride(null);setStage("attend");}} onSelectTemplate={tpl=>setTplPractice(tpl)} onViewHistory={p=>setHistPractice(p)}/></div>);
  if(stage==="attend"||showAtt){const attendPractice=livePracticeOverride||(liveId?data.practices.find(p=>p.id===liveId):null);const attendTeam=attendPractice?data.teams.find(t=>t.id===attendPractice.teamId):null;const attBack=()=>{if(showAtt)setShowAtt(false);else{setLiveId(null);setLivePracticeOverride(null);setStage("pick");}};return (<AttendanceScreen key={showAtt?"upd":"init"} practice={attendPractice} team={attendTeam} isUpdate={showAtt} initialPresent={showAtt?[...presentIds]:null} initialCoachPresent={showAtt?[...coachPresentIds]:null} onConfirm={showAtt?handleAttUpdate:handleAttConfirm} onBack={attBack}/>);}
  if(stage==="end")return (<div className="ccs"><div className="cc-end"><div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:48,fontWeight:900,color:"var(--green)",marginBottom:8}}>Well Done!</div><div style={{fontSize:16,color:"var(--tm)",marginBottom:24,lineHeight:1.5}}>{team&&team.name} practice complete.</div><div style={{width:"100%",marginBottom:16}}><label className="lbl">End of Practice Notes</label><textarea className="ta" style={{minHeight:80}} value={noteText} placeholder="Observations for next time..." onChange={e=>setNoteText(e.target.value)}/><button className="btn primary bsm bfull mt6" onClick={()=>{if(noteText.trim()){update(d=>{d.notes.push({id:uid(),text:noteText,context:"End of Practice",date:new Date().toISOString(),practiceId:liveId});return d;});setNoteText("");}}} >Save Note</button></div><button className="btn ghost bmd bfull" onClick={()=>{setLiveId(null);setStage("pick");}}>Back to Practices</button></div></div>);

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
          <div style={{position:"relative"}}>
            <button className="ell-btn" onClick={()=>setShowEllipsis(s=>!s)}><span/><span/><span/></button>
            {showEllipsis&&<div className="mini-menu" style={{right:0,minWidth:160}}>
              <button className="mm-item" onClick={()=>{setShowEllipsis(false);setAudioOn(a=>!a);}}>{audioOn?"Mute Audio":"Enable Audio"}</button>
              {sessionId&&<button className="mm-item" onClick={()=>{setShowEllipsis(false);setShowShare(true);}}>Share Live View</button>}
              <button className="mm-item" onClick={()=>{setShowEllipsis(false);setStage("end");setRunning(false);if(sessionRef.current){import("./supabase.js").then(({endSession})=>endSession(sessionRef.current));sessionRef.current=null;setSessionId(null);}}}>End Practice</button>
              <button className="mm-item" onClick={()=>{setShowEllipsis(false);setIdx(0);setStIdx(0);setInTrans(false);setElapsed(0);setRunning(false);spoken.current={};setStage("attend");}}>Restart Practice</button>
            </div>}
          </div>
        </div>
      </div>
      {showROS&&<div style={{background:"var(--s1)",borderBottom:"1px solid var(--b)",maxHeight:200,overflowY:"auto",flexShrink:0}}>
        {liveActs.map((a,i)=>(<div key={a.id} style={{display:"flex",alignItems:"center",padding:"8px 14px",borderBottom:"1px solid var(--b)",background:i===idx?"var(--gbg)":"#fff",cursor:"pointer",opacity:i<idx?0.5:1}} onClick={()=>{setIdx(i);setStIdx(0);setInTrans(false);setElapsed(0);spoken.current={};setRunning(false);setShowROS(false);}}>
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
        <button className="btn ghost bsm" style={{flex:1}} onClick={()=>setElapsed(e=>Math.max(0,e-60))}>+1m</button>
        <button className="btn ghost bsm" style={{flex:1}} onClick={()=>setElapsed(e=>e+60)}>-1m</button>
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
            <div style={{fontSize:12,color:"var(--td)",marginBottom:3}}>From {st.name}</div>
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
                  <button className="ell-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu===c.id?null:c.id);}}><span/><span/><span/></button>
                  {openMenu===c.id&&<div className="mini-menu"><button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);delC(c.id);}}>Remove</button></div>}
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
    if(activity)return{name:activity.name,sport:activity.sport||"General",duration:activity.duration,description:activity.description||"",coachingPoints:activity.coachingPoints||""};
    if(location)return{name:location.name};
    if(asset)return{name:asset.name,locationTags:asset.locationTags||[]};
    if(template)return{name:template.name,sport:template.sport||"General"};
    if(editTeamData)return{name:editTeamData.name,sport:editTeamData.sport||"Basketball"};
    return{};
  });
  const set=(k,v)=>setF(p=>Object.assign({},p,{[k]:v}));
  const togTag=lid=>setF(p=>Object.assign({},p,{locationTags:p.locationTags&&p.locationTags.includes(lid)?p.locationTags.filter(x=>x!==lid):[...(p.locationTags||[]),lid]}));
  const SPORTS=["General","Baseball","Basketball","Football","Soccer","Softball","Volleyball","Other"];
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
    if(t==="addActivity"){if(!f.name)return;update(d=>{d.activityLibrary.push({id:uid(),name:f.name,sport:f.sport||"General",description:f.description||"",duration:+(f.duration||10),coachingPoints:f.coachingPoints||"",equipment:[]});return d;});}
    if(t==="editActivity"){if(!f.name)return;update(d=>{const a=d.activityLibrary.find(a=>a.id===p.activity.id);if(a){a.name=f.name;a.sport=f.sport||"General";a.duration=+(f.duration||10);a.description=f.description||"";a.coachingPoints=f.coachingPoints||"";}return d;});}
    if(t==="editTemplate"){if(!f.name)return;update(d=>{const tpl=d.templates.find(t=>t.id===p.template.id);if(tpl){tpl.name=f.name;tpl.sport=f.sport||"General";}return d;});}
    if(t==="editTeam"){if(!f.name)return;update(d=>{const tm=d.teams.find(tm=>tm.id===p.team.id);if(tm){tm.name=f.name;tm.sport=f.sport||"Basketball";}return d;});}
    closeModal();
  };
  const TITLES={addTemplate:"New Template",editTemplate:"Edit Template",addTeam:"New Team",editTeam:"Edit Team",addPlayer:"Add Player",editPlayer:"Edit Player",addCoach:"Add Coach",addLocation:"Add Location",editLocation:"Edit Location",addSublocation:"Add Area",addAsset:"Add Equipment",editAsset:"Edit Equipment",addActivity:"New Activity",editActivity:"Edit Activity"};
  return (<div className="movly" onClick={e=>{if(e.target===e.currentTarget)closeModal();}}>
      <div className="modal">
        <div className="mhandle"/>
        <div className="mtitle">{TITLES[modal.type]||"Add"}</div>
        {modal.type==="addTeam"&&(<div><div className="fld"><label className="lbl">Team Name</label><input className="inp" autoFocus placeholder="e.g. Peoria Eagles 10U" onChange={e=>set("name",e.target.value)}/></div>
          <div className="fld"><label className="lbl">Sport</label><select className="sel" onChange={e=>set("sport",e.target.value)}>{SPORTS.map(s=><option key={s}>{s}</option>)}</select></div></div>
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
            <div className="fld"><label className="lbl">Coaching Points</label><textarea className="ta" style={{minHeight:50}} value={f.coachingPoints||""} onChange={e=>set("coachingPoints",e.target.value)}/></div>
          </div>
        )}
        <div className="mfooter"><button className="btn ghost bmd" onClick={closeModal}>Cancel</button><button className="btn primary bmd" onClick={save}>Save</button></div>
      </div>
    </div>
  );
}