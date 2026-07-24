// ── Utility helpers ──────────────────────────────────────────────────────────
export const uid=()=>Math.random().toString(36).slice(2,9);
// "Today" must be the viewer's *local calendar day*, not UTC. `toISOString()`
// converts to UTC first, so anywhere west of Greenwich (e.g. Phoenix, UTC-7)
// rolls over to "tomorrow" hours before local midnight -- a coach checking
// practices at 8:46pm Saturday saw Sunday's date as "today" and Monday's
// practices mislabeled "Tomorrow". Use local Date getters instead.
export const localDateStr=(d=new Date())=>{const dt=d instanceof Date?d:new Date(d);return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0");};
// Regenerates every id in a copied activity tree (station/checklist-item ids
// too) so "Run Again" from history creates a fresh practice_activities tree
// server-side instead of colliding with the archived original's rows.
export function stripIdsForCopy(acts){
  return JSON.parse(JSON.stringify(acts||[])).map(a=>{
    a.id=uid();
    if(a.type==="station_block"&&Array.isArray(a.stations))a.stations=a.stations.map(s=>Object.assign({},s,{id:uid()}));
    if(a.type==="checklist"&&Array.isArray(a.items))a.items=a.items.map(it=>Object.assign({},it,{id:uid()}));
    return a;
  });
}
export const fmt12=(t)=>{if(!t)return"";const[h,m]=t.split(":").map(Number);const ampm=h>=12?"PM":"AM";const h12=h%12||12;return h12+":"+(m<10?"0":"")+m+" "+ampm;};
export const fmt=(s)=>{const neg=s<0;const abs=Math.abs(s);const m=Math.floor(abs/60),sec=abs%60;return(neg?"-":"")+String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0");};
export const actSecs=(a)=>{if(a.type==="station_block"){const n=(a.stations?a.stations.length:0);return(n*(a.stationDuration||0)+Math.max(0,n-1)*(a.transitionDuration||0))*60;}return(a.duration||0)*60;};
export const sumMins=(acts)=>Math.round(acts.reduce((s,a)=>s+actSecs(a),0)/60);
// Testing-round-1 addendum §1: planning-depth indicators, derived only,
// never stored. Only meaningful for a practice that already has a plan and
// a scheduled duration -- an empty plan stays "unplanned", not "partial".
export function planningState(practice){
  const acts=practice.activities||[];
  if(!acts.length||!practice.scheduledDurationMinutes)return null;
  const total=sumMins(acts);
  const target=practice.scheduledDurationMinutes;
  const tolerance=Math.max(10,target*0.15);
  if(total<target-tolerance)return "partial";
  if(total>target+5)return "overplanned";
  return "complete";
}
// §3: assistants/helpers view + run live but don't edit. Falls back to
// Head Coach when ownerUserId matches but no team_staff row exists yet
// (shouldn't happen post-backfill, but the owner already has power via
// RLS regardless). Per-team, not global -- a user can be head coach on
// one team and assistant on another.
export function myTeamRole(team,coachId){
  if(!team||!coachId)return null;
  const mine=(team.coaches||[]).find(c=>c.userId===coachId);
  if(mine)return mine.role;
  if(team.ownerUserId===coachId)return "Head Coach";
  return null;
}
export function isHeadCoach(team,coachId){return myTeamRole(team,coachId)==="Head Coach";}

// Coach/Org mode scoping (Org Experience follow-up, per-device toggle):
// Coach mode = teams this person personally coaches (has a team_staff row
// or owns), regardless of which org they belong to. Org mode = every team
// in the org being viewed, regardless of whether this director personally
// coaches each one -- that's the whole point of the distinction, oversight
// vs. personal responsibilities.
export function teamsForMode(teams,mode,coachId){
  const all=teams||[];
  if(mode&&mode.type==="org")return all.filter(t=>t.organizationId===mode.orgId);
  return all.filter(t=>myTeamRole(t,coachId)!==null);
}
// Home's agenda specifically (not the Teams tab, which should still list
// every team teamsForMode returns regardless of this preference) -- a coach
// can opt a team out of their own Home snapshot/agenda without leaving it,
// via team_staff.show_on_home (see My Team Assignments in Settings). Org
// mode is deliberately exempt: the whole point of Org mode is oversight of
// every team in the org, so a personal per-coach preference shouldn't hide
// one from the director viewing it there.
export function homeTeamsForMode(teams,mode,coachId){
  const scoped=teamsForMode(teams,mode,coachId);
  if(mode&&mode.type==="org")return scoped;
  return scoped.filter(t=>{
    const mine=(t.coaches||[]).find(c=>c.userId===coachId);
    return !mine||mine.showOnHome!==false;
  });
}
// "Can manage" for UI-gating purposes (show +Add Coach/Player, Plan
// Practice, etc.), mode-aware: in Org mode a director can manage every team
// in that org regardless of personal team_staff role, matching what RLS
// (can_manage_team's is_org_admin branch) already allows server-side --
// this just teaches the client-side check the same thing for org-scoped
// screens. In Coach mode, unchanged: only personal head-coach role counts.
export function canManageTeamInMode(team,coachId,mode){
  if(mode&&mode.type==="org")return !!(team&&team.organizationId===mode.orgId);
  return isHeadCoach(team,coachId);
}
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

// ── Positions & handedness ──────────────────────────────────────────────────
// Sport-conditional: a football roster has no use for "Bats", a swim roster
// has no use for positions at all. Empty list/array = that field doesn't
// show for that sport (falls back to a freeform text input for positions).
export const POSITIONS_BY_SPORT={
  Baseball:["P","C","1B","2B","3B","SS","LF","CF","RF","OF","IF","DH"],
  Softball:["P","C","1B","2B","3B","SS","LF","CF","RF","OF","IF","DH"],
  Basketball:["PG","SG","SF","PF","C"],
  Soccer:["GK","CB","LB","RB","CDM","CM","CAM","LW","RW","ST"],
  Football:["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"],
  Lacrosse:["Attack","Midfield","Defense","Goalie","LSM","FOGO"],
  Hockey:["G","D","LW","RW","C"],
  Volleyball:["Setter","Outside Hitter","Middle Blocker","Opposite","Libero","DS"],
};
// Which handedness fields apply for a sport, and how to label them. Only
// bat-and-ball sports get "Bats"; throwing motion matters more broadly.
export const HAND_FIELDS_BY_SPORT={
  Baseball:[{key:"bats",label:"Bats",options:["L","R","S"]},{key:"throws",label:"Throws",options:["L","R"]}],
  Softball:[{key:"bats",label:"Bats",options:["L","R","S"]},{key:"throws",label:"Throws",options:["L","R"]}],
  Football:[{key:"throws",label:"Throws",options:["L","R"]}],
  Lacrosse:[{key:"throws",label:"Throws",options:["L","R"]}],
  Hockey:[{key:"throws",label:"Shoots",options:["L","R"]}],
  // Reuses the generic `throws` column (no schema change needed -- it's
  // already sport-agnostic L/R) as "Dominant Hand": which hand a player
  // favors for dribbling/shooting, useful for spotting why one kid struggles
  // with an off-hand dribble drill while the rest look fine.
  Basketball:[{key:"throws",label:"Dominant Hand",options:["L","R"]}],
};
export const HAND_LABELS={L:"Left",R:"Right",S:"Switch"};

// Buckets players by an attribute value (first position, bats, throws, ...)
// and greedily bin-packs whole buckets into `n` groups so players who share
// a value land together -- e.g. all catchers at one station -- rather than
// getting scattered the way a plain round-robin shuffle would. Players
// with no value for the attribute are spread round-robin across whatever's
// left, last, so they don't all pile onto one group.
// Also tracks which attribute value(s) landed in each group so the caller
// can label it (e.g. "Lefties") -- a group only gets a label when every
// player in it shares the exact same value; a group stitched together from
// two half-empty buckets, or padded out with "none" players, doesn't get
// one, since there's no single clean word for it.
export function groupByAttribute(players,n,getValue,getLabel){
  const groups=Array.from({length:n},()=>[]);
  const groupValues=Array.from({length:n},()=>new Set());
  const buckets={};
  const none=[];
  players.forEach(p=>{
    const v=getValue(p);
    if(!v){none.push(p);return;}
    (buckets[v]||(buckets[v]=[])).push(p);
  });
  const ordered=Object.entries(buckets).sort((a,b)=>b[1].length-a[1].length);
  ordered.forEach(([value,bucket])=>{
    let idx=0;
    for(let i=1;i<n;i++)if(groups[i].length<groups[idx].length)idx=i;
    groups[idx].push(...bucket);
    groupValues[idx].add(value);
  });
  none.forEach((p,i)=>{
    let idx=0;
    for(let j=1;j<n;j++)if(groups[j].length<groups[idx].length)idx=j;
    groups[idx].push(p);
  });
  return groups.map((g,i)=>({
    ids:g.map(p=>p.id),
    label:(groupValues[i].size===1&&getLabel)?getLabel([...groupValues[i]][0]):"",
  }));
}

// ── Constants ────────────────────────────────────────────────────────────────
export const SPORTS=["Basketball","Soccer","Baseball","Lacrosse","Football","Softball","Volleyball","Hockey","Tennis","Swimming","General","Other"];
export function articleFor(word){ return /^[aeiou]/i.test(word) ? "an" : "a"; }
// Curated, contrast-safe team palette -- each color must work as a dot, as
// a badge background with white text, and as an accent on a white card.
export const TEAM_COLORS=["#2563EB","#DC2626","#16A34A","#D97706","#7C3AED","#0891B2","#DB2777","#65A30D","#EA580C","#4338CA","#0D9488","#9333EA","#B91C1C","#0369A1","#A16207","#BE185D","#111827","#4B5563"];
export function nextTeamColor(existingTeams){
  const used=new Set((existingTeams||[]).map(t=>t.colorPrimary).filter(Boolean));
  return TEAM_COLORS.find(c=>!used.has(c))||TEAM_COLORS[Math.floor(Math.random()*TEAM_COLORS.length)];
}
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
    date:localDateStr(),
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
        if(a.description===undefined)a.description="";
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
