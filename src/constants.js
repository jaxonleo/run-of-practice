// ── Utility helpers ──────────────────────────────────────────────────────────
export const uid=()=>Math.random().toString(36).slice(2,9);
export const fmt12=(t)=>{if(!t)return"";const[h,m]=t.split(":").map(Number);const ampm=h>=12?"PM":"AM";const h12=h%12||12;return h12+":"+(m<10?"0":"")+m+" "+ampm;};
export const fmt=(s)=>{const neg=s<0;const abs=Math.abs(s);const m=Math.floor(abs/60),sec=abs%60;return(neg?"-":"")+String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0");};
export const actSecs=(a)=>{if(a.type==="station_block"){const n=(a.stations?a.stations.length:0);return(n*(a.stationDuration||0)+Math.max(0,n-1)*(a.transitionDuration||0))*60;}return(a.duration||0)*60;};
export const sumMins=(acts)=>Math.round(acts.reduce((s,a)=>s+actSecs(a),0)/60);
export const shuffle=(arr)=>[...arr].sort(()=>Math.random()-.5);
export function mkGroups(ids,n){const s=shuffle(ids),g=Array.from({length:n},()=>[]);s.forEach((id,i)=>g[i%n].push(id));return g;}
export function rebalanceKeep(stations,presentIds){return stations.map(st=>Object.assign({},st,{assignments:(st.assignments||[]).filter(id=>presentIds.has(id))}));}
export function rebalanceEven(stations,presentIds,allPlayers){const present=allPlayers.filter(p=>presentIds.has(p.id));const n=stations.length;const s=shuffle(present);const g=Array.from({length:n},()=>[]);s.forEach((p,i)=>g[i%n].push(p.id));return stations.map((st,i)=>Object.assign({},st,{assignments:g[i]||[]}));}
export function assignGroups(players,grouping,numGroups){
  const arr=[...players].sort(()=>Math.random()-0.5);
  if(grouping==="partners"){const g=[];for(let i=0;i<arr.length;i+=2)g.push(arr.slice(i,i+2));return g;}
  if(grouping==="groups"){const n=numGroups||2;const g=Array.from({length:n},()=>[]);arr.forEach((p,i)=>g[i%n].push(p));return g.filter(x=>x.length>0);}
  return [arr];
}

// ── Constants ────────────────────────────────────────────────────────────────
export const SPORTS=["Basketball","Soccer","Baseball","Lacrosse","Football","Softball","Volleyball","Hockey","Tennis","Swimming","General","Other"];
export const INIT={
  teams:[],
  locations:[],
  assets:[],
  activityLibrary:[],
  practices:[],
  templates:[],
  notes:[],
};

// ── Demo seed data — only used for the "demo" coach ──────────────────────────
export const DEMO_INIT={
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
    {id:"dl1",name:"Ball Handling",sport:"Basketball",description:"Dribbling fundamentals",coachingPoints:"Eyes up, stay low",duration:10,equipment:[],grouping:"whole",numGroups:2,playerGear:""},
    {id:"dl2",name:"Passing",sport:"Basketball",description:"Chest pass and bounce pass technique",coachingPoints:"Step into the pass",duration:10,equipment:[],grouping:"whole",numGroups:2,playerGear:""},
    {id:"dl3",name:"Shooting Form",sport:"Basketball",description:"Form shooting from close range",coachingPoints:"BEEF - Balance, Eyes, Elbow, Follow through",duration:12,equipment:[],grouping:"whole",numGroups:2,playerGear:""},
    {id:"dl4",name:"Defensive Slides",sport:"Basketball",description:"Lateral defensive movement",coachingPoints:"Low stance, never cross feet",duration:8,equipment:[],grouping:"whole",numGroups:2,playerGear:""},
    {id:"dl5",name:"Layups",sport:"Basketball",description:"Right and left hand layups",coachingPoints:"Use the backboard",duration:10,equipment:[],grouping:"whole",numGroups:2,playerGear:""},
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

// ── Schema migration — never adds/removes records, only patches missing fields ─
export function migrateData(d){
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
  // Patch assets with type and sport fields
  (d.assets||[]).forEach(a=>{
    if(!a.type)a.type="team";
    if(!a.sport)a.sport="General";
    if(!a.locationTags)a.locationTags=[];
  });
  d.practices.forEach(p=>{
    (p.activities||[]).forEach(a=>{
      if(a.type==="station_block"&&a.rotate===undefined)a.rotate=true;
      if(a.type==="station_block")(a.stations||[]).forEach(s=>{
        if(!s.equipment)s.equipment=[];
        if(!Array.isArray(s.equipment))s.equipment=[];
        if(!s.playerGear)s.playerGear="";
        if(!s.coachingPoints)s.coachingPoints="";
        if(!s.assignments)s.assignments=[];
      });
      // Patch grouping fields on non-station activities too
      if(a.type==="activity"){
        if(!a.grouping)a.grouping="whole";
        if(!a.numGroups)a.numGroups=2;
        if(!a.playerGear)a.playerGear="";
        if(!Array.isArray(a.equipment))a.equipment=[];
      }
    });
  });
  d.templates.forEach(t=>{
    (t.activities||[]).forEach(a=>{
      if(a.type==="station_block"&&a.rotate===undefined)a.rotate=true;
    });
  });
  return d;
}
