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
// so it stands out.
// Direct feedback (twenty-sixth session continued): a third state --
// "exceeds", when the planned drills actually add up to *more* than the
// scheduled duration -- catches a coach's eye separately from the
// under-planned case, since running long is a different, equally real
// problem worth flagging before the practice starts, not after.
export function planningState(practice){
  const target=practice.scheduledDurationMinutes;
  if(!target)return null;
  const total=sumMins(practice.activities||[]);
  if(total>target)return "exceeds";
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

// ── Live practice audio prefs ─────────────────────────────────────────────────
// Coach-selectable time's-up cue + announcer voice (Settings -> Live
// Practice Audio). Stored in localStorage, not the database -- both are
// inherently per-device preferences (available speechSynthesis voices
// differ by browser/OS entirely, so a voice chosen on one device may not
// exist on another; re-resolving at speak-time on whichever device is
// playing is simpler and more correct than trying to sync a specific
// voice across devices).
export const AUDIO_CUES=[
  {id:"whistle",label:"Whistle",file:"/audio/whistle.wav"},
  {id:"buzzer",label:"Buzzer",file:"/audio/gym-buzzer.wav"},
  {id:"ding",label:"Ding",file:"/audio/ding.wav"},
  {id:"beep",label:"Beep",file:"/audio/beep.wav"},
];
const AUDIO_CUE_KEY="rop_audio_cue_pref";
const VOICE_URI_KEY="rop_voice_uri_pref";
export function getAudioCuePref(){
  try{const v=localStorage.getItem(AUDIO_CUE_KEY);return AUDIO_CUES.some(c=>c.id===v)?v:"whistle";}catch(e){return "whistle";}
}
export function setAudioCuePref(id){try{localStorage.setItem(AUDIO_CUE_KEY,id);}catch(e){}}
// A first pass at this picked "male" or "female" via a name-based
// heuristic (the Web Speech API has no real gender metadata) and just
// grabbed the first match -- on a real device that surfaced a legacy,
// dated-sounding voice ("Daniel") ahead of much better ones the hint
// list didn't know about, since there's no way to infer voice *quality*
// from a name at all. Replaced with a real picker instead: list every
// voice actually installed on this device, let the coach preview and
// choose whichever one sounds best to them, and remember that exact
// voice by its voiceURI (stable per-device identifier).
export function getVoiceURIPref(){
  try{return localStorage.getItem(VOICE_URI_KEY)||"";}catch(e){return "";}
}
export function setVoiceURIPref(uri){try{if(uri)localStorage.setItem(VOICE_URI_KEY,uri);else localStorage.removeItem(VOICE_URI_KEY);}catch(e){}}
// getVoices() can return [] until the browser's async voice list finishes
// loading (fires 'voiceschanged' once ready) -- most callers just want the
// list right now for a dropdown, so this resolves once voices exist or a
// short timeout elapses, whichever comes first, rather than the caller
// having to juggle the event itself.
export function loadVoices(){
  return new Promise(resolve=>{
    try{
      const existing=window.speechSynthesis.getVoices();
      if(existing&&existing.length)return resolve(existing);
      const done=()=>resolve(window.speechSynthesis.getVoices()||[]);
      window.speechSynthesis.onvoiceschanged=done;
      setTimeout(done,600);
    }catch(e){resolve([]);}
  });
}
export function resolveVoiceByURI(uri){
  if(!uri)return null;
  try{
    const voices=(window.speechSynthesis&&window.speechSynthesis.getVoices())||[];
    return voices.find(v=>v.voiceURI===uri)||null;
  }catch(e){return null;}
}

// ── Builder: Practice Components ──────────────────────────────────────────────
// The full menu of quick-add types Builder's "Practice Components" section
// can offer. `kind` drives which shape gets appended to `acts` -- every
// entry except station_block is a plain checklist activity (same shape as
// today's Intro/Closer) with a different starting name/duration, reusing
// ChecklistConfig/live-run/PDF-export/Goals bucketing as-is rather than
// introducing a new `act.type` that'd need updating everywhere those already
// switch on type. `description` is shown in the long-press preview and in
// the Add/Remove picker -- natural voice, no em dashes, matching the rest of
// this app's copy conventions.
export const PRACTICE_COMPONENT_TYPES=[
  {key:"intro",label:"Intro",kind:"checklist",defaultName:"Intro",defaultDuration:5,description:"A quick check-in to start practice. Cover today's plan, reminders, or a light warm-up.",defaultOn:true},
  {key:"closer",label:"Closer",kind:"checklist",defaultName:"Closer",defaultDuration:5,description:"Wrap up practice with a recap, announcements, or a short cool-down.",defaultOn:true},
  {key:"checklist",label:"Checklist",kind:"checklist",defaultName:"Checklist",defaultDuration:5,description:"A blank checklist for tracking anything step by step during practice.",defaultOn:false},
  {key:"water_break",label:"Water Break",kind:"checklist",defaultName:"Water Break",defaultDuration:2,description:"A short pause for players to hydrate before continuing.",defaultOn:false},
  {key:"stretch",label:"Stretch",kind:"checklist",defaultName:"Stretch",defaultDuration:5,description:"Time set aside for warming up or cooling down.",defaultOn:false},
  {key:"station_block",label:"Station Block",kind:"station_block",description:"Multiple stations players rotate through, each with its own drill, coach, and equipment.",defaultOn:true},
  {key:"other",label:"Other",kind:"checklist",defaultName:"Other",defaultDuration:5,description:"For anything that doesn't fit the categories above, like a guest speaker or a team photo. Name it once it's added -- it's a one-off, not saved to your library.",defaultOn:false},
];
const PRACTICE_COMPONENT_TYPES_KEY="rop_practice_component_types";
// Which of the types above show as one-tap tiles in Builder -- per-coach,
// per-device (same rationale as the audio prefs above: a lightweight UI
// preference, not data worth syncing through the database). Falls back to
// today's existing set (Intro/Closer/Station Block) so nobody's Builder
// changes shape until they actually open the picker and choose otherwise.
export function getVisibleComponentTypes(){
  try{
    const raw=JSON.parse(localStorage.getItem(PRACTICE_COMPONENT_TYPES_KEY)||"null");
    if(Array.isArray(raw)&&raw.length)return raw.filter(k=>PRACTICE_COMPONENT_TYPES.some(t=>t.key===k));
  }catch(e){}
  return PRACTICE_COMPONENT_TYPES.filter(t=>t.defaultOn).map(t=>t.key);
}
export function setVisibleComponentTypes(keys){
  try{localStorage.setItem(PRACTICE_COMPONENT_TYPES_KEY,JSON.stringify(keys));}catch(e){}
}

// ── Goals & Insights: shared attribution/guidance math ──────────────────────
// These mirror the exact rules the live get_team_goal_report/
// get_team_goal_trends RPCs already use (see
// supabase/migrations/20260802000000_goal_attribution_shared_helpers.sql):
// a multi-tag drill's minutes split evenly across its tags, a station's full
// stationDuration counted per-station (not divided -- stations run in
// parallel), 'break'-type activities excluded from the denominator
// entirely. Kept here as pure JS specifically so Builder can project an
// *unsaved* draft locally without a round trip per keystroke.

// Same >=3-point convention GoalsScreen's SkillRow already uses for "is this
// gap real" (delta chips only show at 3+ points off).
export const GOAL_PROXIMITY_TOLERANCE_PTS=3;
export const TREND_FLAT_THRESHOLD_PCT=2;
export const TREND_MIN_USABLE_WEEKS=3;
export const TREND_EXECUTION_GAP_PTS=5;
export const ON_PLAN_TOLERANCE_SECONDS=60;

// Converts a practice's (possibly unsaved) activity tree into per-category
// planned minutes, using the same allocation rules as
// practice_activity_planned_minutes()+category_minutes_from_rows() server-
// side. `activityLibraryById`/`skillTagsById` come straight from `data`
// (data.activityLibrary keyed by id, data.skillTags keyed by id) -- no new
// fetch, since Builder already has both loaded.
export function categoryMinutesForPracticeActivities(activities,activityLibraryById,skillTagsById){
  const byCategory={};
  let totalMinutes=0;
  (activities||[]).forEach(act=>{
    if(act.type==="break")return; // excluded from the denominator, same as server-side
    if(act.type==="station_block"){
      const dur=act.stationDuration||0;
      (act.stations||[]).forEach(st=>{
        totalMinutes+=dur;
        addTaggedMinutes(st.libraryId,dur,byCategory,activityLibraryById,skillTagsById);
      });
      return;
    }
    const dur=act.duration||0;
    totalMinutes+=dur;
    addTaggedMinutes(act.libraryId,dur,byCategory,activityLibraryById,skillTagsById);
  });
  const taggedTotal=Object.values(byCategory).reduce((s,v)=>s+v,0);
  return {byCategory,totalMinutes,untaggedMinutes:Math.max(0,totalMinutes-taggedTotal)};
}
function addTaggedMinutes(libraryId,minutes,byCategory,activityLibraryById,skillTagsById){
  if(!libraryId||!minutes)return;
  const drill=activityLibraryById[libraryId];
  const tagIds=drill&&drill.skillTagIds||[];
  if(!tagIds.length)return; // untagged -- no category credit, same as server-side
  const perTag=minutes/tagIds.length;
  tagIds.forEach(tagId=>{
    const catId=skillTagsById[tagId]&&skillTagsById[tagId].categoryId;
    if(!catId)return;
    byCategory[catId]=(byCategory[catId]||0)+perTag;
  });
}

// Enhancement 2/3, Part 1 ("current priorities"). One category's worth of
// gap math: how many minutes of the next practice would land on this
// category if it followed the goal mix exactly (goalMixMinutes), and how
// many minutes it would take in the next practice to fully close the
// current rolling gap (minutesNeeded), reusing the exact
// share-of-cumulative-total formula the spec calls out rather than
// inventing a new one. `category` is one row of the resolved baseline:
// {skillCategoryId,name,targetPct,currentPct,currentMinutes,
// historicalTotalMinutes}; currentMinutes/historicalTotalMinutes may be
// null when there's no usable history yet (goal-mix-only state).
export function calculateGoalGapGuidance(categories,nextPracticeDurationMinutes){
  return (categories||[]).map(cat=>{
    const targetPct=cat.targetPct||0;
    const currentPct=cat.currentPct||0;
    const gapPts=Math.round((targetPct-currentPct)*10)/10;
    const atOrAboveGoal=gapPts<=0;
    const goalMixMinutes=nextPracticeDurationMinutes!=null?Math.round(nextPracticeDurationMinutes*targetPct/100):null;
    let minutesNeeded=null,closable=null;
    if(!atOrAboveGoal&&nextPracticeDurationMinutes!=null&&cat.historicalTotalMinutes!=null&&cat.currentMinutes!=null){
      const targetShare=targetPct/100;
      const raw=targetShare*(cat.historicalTotalMinutes+nextPracticeDurationMinutes)-cat.currentMinutes;
      minutesNeeded=Math.max(0,Math.round(raw));
      closable=minutesNeeded<=nextPracticeDurationMinutes;
    }
    return {skillCategoryId:cat.skillCategoryId,name:cat.name,targetPct,currentPct,gapPts,atOrAboveGoal,goalMixMinutes,minutesNeeded,closable};
  });
}

// Enhancement 3, Part 3 ("projected rolling impact"). Combines a fetched
// rolling baseline (Actual history, or Planned when no usable Actual exists
// yet -- the fallback is decided by the caller, not here) with the
// Builder draft's own category minutes (always Planned, since the practice
// hasn't run) to project a post-practice percentage per category.
export function calculateProjectedGoalImpact(baseline,draftCategoryMinutes){
  const draftTotal=(draftCategoryMinutes&&draftCategoryMinutes.totalMinutes)||0;
  const draftByCategory=(draftCategoryMinutes&&draftCategoryMinutes.byCategory)||{};
  const historicalTotal=baseline.historicalTotalMinutes||0;
  const projectedTotal=historicalTotal+draftTotal;
  return (baseline.categories||[]).map(cat=>{
    const historicalMinutes=cat.currentMinutes||0;
    const draftMinutes=draftByCategory[cat.skillCategoryId]||0;
    const currentPct=historicalTotal>0?(historicalMinutes/historicalTotal*100):0;
    const projectedPct=projectedTotal>0?((historicalMinutes+draftMinutes)/projectedTotal*100):0;
    const targetPct=cat.targetPct||0;
    let result;
    if(Math.abs(projectedPct-targetPct)<GOAL_PROXIMITY_TOLERANCE_PTS)result="At goal";
    else if(Math.abs(projectedPct-currentPct)<TREND_FLAT_THRESHOLD_PCT)result="No change";
    else if(Math.abs(projectedPct-targetPct)<Math.abs(currentPct-targetPct))result="Closer to goal";
    else result="Farther from goal";
    return {skillCategoryId:cat.skillCategoryId,name:cat.name,targetPct,currentPct:Math.round(currentPct*10)/10,projectedPct:Math.round(projectedPct*10)/10,result};
  });
}

// Enhancement 5/6's shared on-plan tolerance (spec: "the same 60-second
// on-plan tolerance as Practice Execution unless the project establishes a
// shared different constant" -- ON_PLAN_TOLERANCE_SECONDS above is that
// shared constant).
export function classifyDurationVariance(plannedSeconds,actualSeconds,toleranceSeconds=ON_PLAN_TOLERANCE_SECONDS){
  if(plannedSeconds==null||actualSeconds==null)return null;
  const diff=actualSeconds-plannedSeconds;
  if(Math.abs(diff)<=toleranceSeconds)return "on_plan";
  return diff>0?"extended":"shortened";
}

// Enhancement 1's trend-summary rules, kept deterministic per the spec
// ("keep v1 deterministic and easy to explain"), applied in priority order:
// 1. Not enough usable weeks -> say so plainly, no trend claimed.
// 2. Three consecutive usable weeks moving the same direction -> call out
//    the streak directly (the clearest, most literal signal).
// 3. Otherwise compare the latest usable week with the earliest: a move
//    under TREND_FLAT_THRESHOLD_PCT reads as flat, in which case a real gap
//    between planned and actual (rule 5) is surfaced instead if there is
//    one; a real move is described relative to the target.
export function summarizeCategoryTrend(weeks,targetPct){
  const usable=(weeks||[]).filter(w=>w.has_usable_actual_time&&w.actual_pct!=null);
  if(usable.length<TREND_MIN_USABLE_WEEKS)return "Not enough completed practice data to establish a trend.";

  let streakDir=null,streakLen=1;
  for(let i=1;i<usable.length;i++){
    const d=usable[i].actual_pct-usable[i-1].actual_pct;
    const dir=Math.abs(d)<TREND_FLAT_THRESHOLD_PCT?null:(d>0?"up":"down");
    if(dir&&dir===streakDir)streakLen++;
    else{streakDir=dir;streakLen=dir?2:1;}
    if(streakLen>=3)return "Actual time has "+(streakDir==="down"?"declined":"increased")+" for three consecutive active weeks.";
  }

  const first=usable[0],last=usable[usable.length-1];
  const delta=last.actual_pct-first.actual_pct;
  if(Math.abs(delta)<TREND_FLAT_THRESHOLD_PCT){
    if(targetPct!=null){
      const plannedVals=usable.filter(w=>w.planned_pct!=null).map(w=>w.planned_pct);
      if(plannedVals.length){
        const avgPlanned=plannedVals.reduce((s,v)=>s+v,0)/plannedVals.length;
        const avgActual=usable.reduce((s,w)=>s+w.actual_pct,0)/usable.length;
        if(Math.abs(avgPlanned-targetPct)<GOAL_PROXIMITY_TOLERANCE_PTS&&(avgPlanned-avgActual)>=TREND_EXECUTION_GAP_PTS){
          return "Planned time is near goal, but actual time is averaging "+Math.round(avgPlanned-avgActual)+" points lower.";
        }
      }
    }
    return "Actual time is holding steady, without a clear trend toward or away from goal.";
  }
  if(targetPct==null)return delta>0?"Actual time has been increasing.":"Actual time has been decreasing.";
  const movingToward=Math.abs(last.actual_pct-targetPct)<Math.abs(first.actual_pct-targetPct);
  return movingToward?("Actual time is moving closer to the "+targetPct+"% goal."):("Actual time is moving away from the "+targetPct+"% goal.");
}

// Enhancement 6's fixed heat tiers (trailing-12-month completed uses).
// Thresholds kept in one place, per the spec, so they can be tuned later
// without touching UI logic in multiple files.
export const DRILL_HEAT_TIERS=[
  {min:21,id:"very_hot",label:"Very frequently used",color:"var(--red)"},
  {min:11,id:"hot",label:"Frequently used",color:"#EA580C"},
  {min:6,id:"active",label:"Actively used",color:"#D97706"},
  {min:3,id:"warming",label:"Occasionally used",color:"#0891B2"},
  {min:1,id:"cold",label:"Rarely used",color:"#2563EB"},
];
export function drillUsageHeatTier(completedUsesTrailing12Months){
  const n=completedUsesTrailing12Months||0;
  if(n<=0)return null;
  return DRILL_HEAT_TIERS.find(t=>n>=t.min)||null;
}
