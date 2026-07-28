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
// Testing-round-1 addendum §1, revised: planned-vs-scheduled indicator,
// derived only, never stored. Shows for any practice with a scheduled
// duration, planned or not (0/60 min is exactly the signal an unplanned
// practice should show). Anything under 90% planned reads as under-planned
// so it stands out; there's no separate "overplanned" state.
export function planningState(practice){
  const target=practice.scheduledDurationMinutes;
  if(!target)return null;
  const total=sumMins(practice.activities||[]);
  return total<target*0.9?"under":"onTrack";
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
