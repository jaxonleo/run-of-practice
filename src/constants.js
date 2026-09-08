// ── Utility helpers ──────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { teamLocalToScheduledAt } from "./supabase.js";
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
// Direct feedback: an "Equipment Needed" list (Practice Setup, the pre-live
// Preview link, and the PDF export all had their own copy of this) used to
// just dedupe equipment by name across the whole practice, with no sense of
// which drill/station it actually belonged to -- a coach glancing at "Cones"
// had no way to tell who's expected to bring them or where. `items` is
// [{equipment:[{name,acquired}]|[string], coachName, locationName}], one
// entry per drill/station; returns one row per equipment name with every
// distinct (coach, location) combination that needs it, deduped, so the
// same pair isn't listed twice for two drills at the same spot.
export function buildEquipmentNeeded(items){
  const byName=new Map();
  (items||[]).forEach(it=>{
    const hasCtx=!!(it.coachName||it.locationName);
    const ctxKey=(it.coachName||"")+"@@"+(it.locationName||"");
    (it.equipment||[]).forEach(e=>{
      const name=typeof e==="string"?e:e&&e.name;
      if(!name)return;
      const acquired=typeof e==="string"?true:!(e&&e.acquired===false);
      let entry=byName.get(name);
      if(!entry){entry={name,acquired:true,ctxSet:new Set(),contexts:[]};byName.set(name,entry);}
      if(!acquired)entry.acquired=false;
      if(hasCtx&&!entry.ctxSet.has(ctxKey)){entry.ctxSet.add(ctxKey);entry.contexts.push({coachName:it.coachName||null,locationName:it.locationName||null});}
    });
  });
  return [...byName.values()].map(({name,acquired,contexts})=>({name,acquired,contexts}));
}
// Practice Setup's Equipment Needed, grouped by Area instead of listing a
// coach name next to each item -- direct feedback: the coach name added
// noise a solo/small-staff team doesn't need, and grouping by where
// equipment actually needs to be tells a coach getting the gym ready what
// to grab for each spot in one glance. `items` is the same shape
// buildEquipmentNeeded takes; groups preserve the order areas first appear
// in the practice, with anything lacking an Area (no sublocationId on its
// drill/station) collected into a trailing "Other" group rather than
// dropped.
export function groupEquipmentByArea(items){
  const order=[];
  const byArea=new Map();
  (items||[]).forEach(it=>{
    const area=it.locationName||"";
    (it.equipment||[]).forEach(e=>{
      const name=typeof e==="string"?e:e&&e.name;
      if(!name)return;
      const acquired=typeof e==="string"?true:!(e&&e.acquired===false);
      let areaMap=byArea.get(area);
      if(!areaMap){areaMap=new Map();byArea.set(area,areaMap);order.push(area);}
      let entry=areaMap.get(name);
      if(!entry){entry={name,acquired:true};areaMap.set(name,entry);}
      if(!acquired)entry.acquired=false;
    });
  });
  const named=order.filter(a=>a).map(area=>({area,items:[...byArea.get(area).values()]}));
  const blank=byArea.has("")?[{area:"Other",items:[...byArea.get("").values()]}]:[];
  return [...named,...blank];
}
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
// Real bug fix: a plain (non-station) drill's live groups used to be
// discarded and fully re-randomized every time this drill became current
// or attendance changed at all, throwing away whatever the coach actually
// set up (Builder's manual assignment, or edits made in Practice Setup's
// own groupings dialog). This is the minimal-disruption alternative --
// keeps every existing pairing intact, only drops anyone now absent, and
// places anyone newly present who isn't in any group yet into whichever
// group is currently smallest, rather than reshuffling everyone.
export function reconcileGroups(groups,presentIds){
  const kept=(groups||[]).map(g=>(g||[]).filter(id=>presentIds.has(id)));
  const alreadyAssigned=new Set(kept.flat());
  const unassigned=[...presentIds].filter(id=>!alreadyAssigned.has(id));
  unassigned.forEach(id=>{
    let idx=0;
    for(let i=1;i<kept.length;i++)if(kept[i].length<kept[idx].length)idx=i;
    kept[idx].push(id);
  });
  return kept;
}
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
// Direct feedback: default voice for a live practice should read as male
// (Daniel, the same curated option Settings itself offers) instead of
// whatever the browser happens to pick on its own. Used whenever no
// explicit per-coach voiceURI preference is saved, or the saved one no
// longer resolves on this device -- and always for HelperView, which has
// no Settings screen or saved preference of its own to fall back to.
export function resolveDefaultVoice(){
  try{
    const voices=(window.speechSynthesis&&window.speechSynthesis.getVoices())||[];
    return voices.find(v=>v.name.trim().toLowerCase()==="daniel")||null;
  }catch(e){return null;}
}

// ── Getting Started card dismissal ──────────────────────────────────────────
// Per-device, per-coach ("hide this on my phone" isn't a server-side
// preference any more than the audio prefs above are). Keyed by coachId so a
// shared device signed into different accounts doesn't leak one coach's
// dismissal onto another's. Read synchronously at mount (no async round
// trip) so the card never flashes on screen before disappearing.
const GETTING_STARTED_HIDDEN_KEY="rop_getting_started_hidden";
export function getGettingStartedHidden(coachId){
  try{return localStorage.getItem(GETTING_STARTED_HIDDEN_KEY+"_"+coachId)==="1";}catch(e){return false;}
}
export function setGettingStartedHidden(coachId,hidden){
  try{
    if(hidden)localStorage.setItem(GETTING_STARTED_HIDDEN_KEY+"_"+coachId,"1");
    else localStorage.removeItem(GETTING_STARTED_HIDDEN_KEY+"_"+coachId);
  }catch(e){}
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
  // Baseball/softball only -- Builder hides this tile for every other sport
  // (see getVisibleComponentTypes callers / BuilderScreen's sport check).
  // `kind:"scrimmage"` gets its own act shape (a scrimmage_config jsonb, a
  // generated scrimmage_rounds board), not a checklist.
  {key:"scrimmage",label:"Scrimmage",kind:"scrimmage",description:"Everyone rotates positions and at-bats. No second team needed.",defaultOn:false},
  {key:"other",label:"Other",kind:"checklist",defaultName:"Other",defaultDuration:5,description:"For anything that doesn't fit the categories above, like a guest speaker or a team photo. Name it once it's added -- it's a one-off, not saved to your library.",defaultOn:false},
];
// Which sports the Scrimmage tile is offered for. Softball is treated
// identically to baseball (same nine positions, same P/C eligibility) even
// though it has no skill categories yet.
export const SCRIMMAGE_SPORTS=["Baseball","Softball"];
export function sportSupportsScrimmage(sport){return SCRIMMAGE_SPORTS.includes(sport);}
const PRACTICE_COMPONENT_TYPES_KEY="rop_practice_component_types";
// Which of the types above show as one-tap tiles in Builder -- per-coach,
// per-device (same rationale as the audio prefs above: a lightweight UI
// preference, not data worth syncing through the database). Falls back to
// today's existing set (Intro/Closer/Station Block) so nobody's Builder
// changes shape until they actually open the picker and choose otherwise --
// plus Scrimmage when the build is for a baseball/softball team, since that
// tile is only ever offered for those sports anyway. Once the coach edits
// the tile set (which writes a saved preference), that preference is
// returned verbatim and this sport-aware default no longer applies.
export function getVisibleComponentTypes(supportsScrimmage){
  try{
    const raw=JSON.parse(localStorage.getItem(PRACTICE_COMPONENT_TYPES_KEY)||"null");
    if(Array.isArray(raw)&&raw.length)return raw.filter(k=>PRACTICE_COMPONENT_TYPES.some(t=>t.key===k));
  }catch(e){}
  const keys=PRACTICE_COMPONENT_TYPES.filter(t=>t.defaultOn).map(t=>t.key);
  if(supportsScrimmage&&!keys.includes("scrimmage"))keys.push("scrimmage");
  return keys;
}
// True once the coach has explicitly chosen a tile set via the picker.
// Callers use this to know whether the sport-aware default above still
// applies (it does not once a real preference exists).
export function hasVisibleComponentTypesPref(){
  try{
    const raw=JSON.parse(localStorage.getItem(PRACTICE_COMPONENT_TYPES_KEY)||"null");
    return Array.isArray(raw)&&raw.length>0;
  }catch(e){}
  return false;
}
export function setVisibleComponentTypes(keys){
  try{localStorage.setItem(PRACTICE_COMPONENT_TYPES_KEY,JSON.stringify(keys));}catch(e){}
}

// Shared by every ".mini-menu" ellipsis/dropdown across the app: that
// class always opens downward (top:calc(100% - 4px)), which clips against
// the viewport edge/fixed bottom tab bar for a row near the bottom of a
// scrollable list. Callers measure the trigger's own rect at open time
// (a click handler's e.currentTarget, or a ref for a keystroke-driven
// popup like an @mention picker) and flip to open upward when there isn't
// enough room below for the menu's own worst-case height.
export function menuNeedsToOpenUpward(rect,thresholdPx){
  return (window.innerHeight-rect.bottom)<(thresholdPx||260);
}

// Big-browser (BB) layout pass (forty-ninth session): the single source of
// truth for "is this a wide-enough browser to show the desktop arrangement."
// Every BB conditional in the app derives from this one hook -- never sniff
// user agent, never check window.innerWidth ad hoc in an individual
// component, so there is exactly one breakpoint to reason about and change.
// matchMedia's own change listener (not a resize listener) keeps this
// correct across a live window resize without a debounce, and without
// re-running on every pixel of an unrelated height-only resize.
const BB_QUERY = "(min-width: 1024px)";
export function useBigBrowser(){
  const [isBB, setIsBB] = useState(() => typeof window !== "undefined" && window.matchMedia && window.matchMedia(BB_QUERY).matches);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(BB_QUERY);
    const onChange = e => setIsBB(e.matches);
    mql.addEventListener("change", onChange);
    setIsBB(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isBB;
}

// "Has this station actually been planned" -- shared between Builder's own
// per-station/per-block indicators (ActivityConfigs.jsx) and App.jsx's
// block-level "N of M stations planned" summary, so the two never drift
// out of sync. Deliberately not a bare non-empty-name check: addStation
// seeds every new station's own `name` with a placeholder ("Station 2"),
// and saveActivityTree persists that same placeholder as the real DB
// value for a station nobody ever touched (there's only one `name`
// column -- the activityName/name split that distinguishes "real" from
// "default" doesn't survive a save). A station counts as planned if it
// has a real drill identity (library pick, or a name that isn't just the
// untouched placeholder) or any other real content, or has ever been
// saved through the delegate's own update_station_content RPC
// (stationUpdatedAt) even if only equipment/notes changed.
export function stationIsPlanned(st){
  const nm=(st.activityName||st.name||"").trim();
  return !!(st.libraryId||st.stationUpdatedAt||(st.description||"").trim()||(st.coachingPoints||"").trim()||(st.equipment||[]).length||(nm&&!/^Station \d+$/.test(nm)));
}

// Shared between Builder's own "Plan This Station" status (ActivityConfigs.jsx)
// and MyStationBuilder.jsx's own last-saved lines.
export function timeAgo(iso){
  if(!iso)return"";
  const ms=Date.now()-new Date(iso).getTime();
  const mins=Math.floor(ms/60000);
  if(mins<1)return"just now";
  if(mins<60)return mins+(mins===1?" minute ago":" minutes ago");
  const hrs=Math.floor(mins/60);
  if(hrs<24)return hrs+(hrs===1?" hour ago":" hours ago");
  const days=Math.floor(hrs/24);
  return days+(days===1?" day ago":" days ago");
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

// A practice's real scheduled instant, team-timezone-correct -- used to
// decide whether starting it counts as "early" (direct feedback: starting a
// practice scheduled more than 2 hours out used to just silently run that
// exact practice, which is what produced a real reported bug -- a practice
// scheduled for the next day got started a day early and its own scheduled
// slot silently read as already completed instead of staying untouched).
// Shared by Home's hero and Practice Detail's own Run Now so both apply the
// exact same 2-hour rule rather than each re-deriving it slightly
// differently. Uses supabase.js's teamLocalToScheduledAt (the one canonical
// team-local-to-instant conversion in this app) rather than a second,
// duplicated date-math implementation here.
export const TWO_HOURS_MS=2*60*60*1000;
export function practiceScheduledMs(practice,team){
  if(!practice||!practice.date)return null;
  const iso=teamLocalToScheduledAt(practice.date,practice.startTime||"00:00",team&&team.timezone);
  return iso?new Date(iso).getTime():null;
}
export function isMoreThanTwoHoursAway(practice,team){
  const ms=practiceScheduledMs(practice,team);
  return ms!==null&&ms-Date.now()>TWO_HOURS_MS;
}

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
    // 'break' and 'checklist' (Intro/Closer/Water Break/Stretch/Checklist/
    // Other -- the non-station "Practice Components", never real library
    // drills) are both excluded from the denominator entirely, same as
    // server-side -- these are administrative/structural time, not a
    // category a coach could ever tag, so counting them would both inflate
    // "untagged" and understate every real category's percentage.
    if(act.type==="break"||act.type==="checklist")return;
    if(act.type==="station_block"){
      const dur=act.stationDuration||0;
      (act.stations||[]).forEach(st=>{
        totalMinutes+=dur;
        addTaggedMinutes(st.libraryId,dur,byCategory,activityLibraryById,skillTagsById);
      });
      return;
    }
    if(act.type==="scrimmage"){
      // Not a library drill -- its tags live on the config, and (section 8)
      // it counts toward the denominator like any timed activity.
      const dur=act.duration||0;
      totalMinutes+=dur;
      const tagIds=(act.scrimmageConfig&&act.scrimmageConfig.skillTagIds)||[];
      if(tagIds.length){
        const perTag=dur/tagIds.length;
        tagIds.forEach(tagId=>{
          const catId=skillTagsById[tagId]&&skillTagsById[tagId].categoryId;
          if(catId)byCategory[catId]=(byCategory[catId]||0)+perTag;
        });
      }
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

// ── Development Pulse (Home widget) ──────────────────────────────────────────
// Named thresholds per the spec, tunable in one place. Confirmed against
// real production data during live verification rather than picked blind.
export const DEVELOPMENT_PULSE_MIN_COMPLETED_SESSIONS=2;
export const DEVELOPMENT_PULSE_MATERIAL_GAP_PTS=3;
export const DEVELOPMENT_PULSE_BALANCED_TOLERANCE_PTS=3;
export const DEVELOPMENT_PULSE_MATERIAL_IMPROVEMENT_PTS=2;
export const DEVELOPMENT_PULSE_MAX_UNTAGGED_PCT=25;
export const DEVELOPMENT_PULSE_MIN_ACTION_MINUTES=3;

// Focus-team priority order (spec): the next-practice hero's own team when
// one exists; otherwise the visible Coach-mode team with the most recently
// completed session; otherwise the first visible team; otherwise none.
// `recentSessionByTeamId` may be null/undefined before that batch fetch
// resolves -- this stays pure and synchronous either way, since falling
// back to homeTeams[0] first and correcting once real data arrives is
// preferable to the caller blocking Home on this lookup.
export function resolveDevelopmentPulseFocusTeamId({nextPractice,homeTeams,recentSessionByTeamId}){
  if(nextPractice)return nextPractice.teamId;
  if(!homeTeams||!homeTeams.length)return null;
  if(recentSessionByTeamId){
    let bestId=null,bestDate=null;
    homeTeams.forEach(t=>{
      const d=recentSessionByTeamId[t.id];
      if(d&&(!bestDate||d>bestDate)){bestDate=d;bestId=t.id;}
    });
    if(bestId)return bestId;
  }
  return homeTeams[0].id;
}

// The dynamic-state engine. Presentation-neutral: returns facts, not copy
// -- DevelopmentPulseCard.jsx owns headline/CTA-label text per state (spec:
// "The UI component should translate this result into copy and
// rendering"). Deliberately reuses calculateGoalGapGuidance/
// calculateProjectedGoalImpact/categoryMinutesForPracticeActivities as-is
// rather than a sixth reimplementation of the same math.
//
// `report` is the raw get_team_goal_report(teamId) response (already
// carries usable_actual_session_count as of 20260804000000). `nextPractice`
// is the same practice object Home's own hero already resolved (or null),
// with `.activities` loaded; pass null here (not the practice) when a
// session for it is currently live -- projecting a stale plan against a
// run already in progress is explicitly out of scope, so the caller simply
// withholds it and the resolver falls through to the no-plan-impact path,
// same as an unplanned practice would.
export function resolveDevelopmentPulseState({team,report,nextPractice,activityLibraryById,skillTagsById,hasSportCategories,allDrillsTagged}){
  if(!hasSportCategories)return {state:"no_categories_for_sport",teamId:team.id,teamName:team.name};

  const configured=(report.skills||[]).filter(s=>s.target_pct!=null);
  if(!configured.length)return {state:"goals_not_configured",teamId:team.id,teamName:team.name};

  const usableSessionCount=(report.practices||{}).usable_actual_session_count||0;
  if(usableSessionCount<DEVELOPMENT_PULSE_MIN_COMPLETED_SESSIONS){
    const hasPlannedFallback=(report.denominators||{}).planned_minutes_total>0;
    const nextPracticePlanned=!!(nextPractice&&(nextPractice.activities||[]).length);
    return {
      state:"insufficient_history",teamId:team.id,teamName:team.name,
      usableSessionCount,remaining:DEVELOPMENT_PULSE_MIN_COMPLETED_SESSIONS-usableSessionCount,
      hasPlannedFallback,nextPracticePlanned,
      practiceId:nextPractice?nextPractice.id:null,
    };
  }

  // Direct feedback: this fired even when every drill in the coach's
  // library was already tagged -- "untagged" time here also used to
  // include non-station Practice Components (Intro/Closer/Checklist/Water
  // Break/Stretch/Other), which are administrative and never taggable in
  // the first place (now excluded from the denominator server-side, see
  // the shared attribution helpers). Even with that fixed, some genuine
  // untagged time can remain from activities typed straight into a
  // practice rather than added from the library -- same case GlanceView's
  // own "all tagged" message already carves out -- so this state is
  // skipped whenever there's nothing left in the library to actually tag,
  // falling through to a real category recommendation instead of a false
  // data-quality complaint.
  const untaggedPct=(report.untagged||{}).actual_pct||0;
  if(untaggedPct>=DEVELOPMENT_PULSE_MAX_UNTAGGED_PCT&&!allDrillsTagged){
    return {state:"data_quality",teamId:team.id,teamName:team.name,untaggedPct};
  }

  const categories=configured.map(s=>({
    skillCategoryId:s.skill_category_id,name:s.name,targetPct:s.target_pct,
    currentPct:s.actual_pct,currentMinutes:s.actual_minutes,
    historicalTotalMinutes:(report.denominators||{}).actual_minutes_total,
  }));

  // Draft mix for the next practice, when one exists with real content --
  // same pure helper Builder Goal Guidance already uses against unsaved
  // state, here against whatever's already saved for that practice.
  const hasDraft=!!(nextPractice&&(nextPractice.activities||[]).length);
  const draft=hasDraft?categoryMinutesForPracticeActivities(nextPractice.activities,activityLibraryById,skillTagsById):null;
  const draftHasMinutes=!!(draft&&draft.totalMinutes>0);

  const guidance=calculateGoalGapGuidance(categories,nextPractice?nextPractice.scheduledDurationMinutes:null);
  const below=guidance.filter(g=>!g.atOrAboveGoal&&g.gapPts>=DEVELOPMENT_PULSE_MATERIAL_GAP_PTS)
    .sort((a,b)=>b.gapPts-a.gapPts); // stable sort -- ties keep the configured category order

  const aligned=categories.every(c=>Math.abs((c.currentPct||0)-c.targetPct)<DEVELOPMENT_PULSE_BALANCED_TOLERANCE_PTS);

  // State 7's own override: even when every category is currently aligned,
  // don't hide a next-plan draft that would materially move one away from
  // goal -- surface that as a gap forming instead of a false all-clear.
  let movingAwayCategory=null;
  if(aligned&&draftHasMinutes){
    const baseline={historicalTotalMinutes:(report.denominators||{}).actual_minutes_total,categories};
    const impact=calculateProjectedGoalImpact(baseline,draft);
    movingAwayCategory=impact.find(i=>i.result==="Farther from goal"&&Math.abs(i.projectedPct-i.currentPct)>=DEVELOPMENT_PULSE_MATERIAL_IMPROVEMENT_PTS)||null;
  }

  if(aligned&&!movingAwayCategory){
    const largestVariance=categories.slice().sort((a,b)=>Math.abs((b.currentPct||0)-b.targetPct)-Math.abs((a.currentPct||0)-a.targetPct))[0];
    return {state:"aligned",teamId:team.id,teamName:team.name,categories,largestVarianceCategory:largestVariance||null};
  }

  if(!below.length&&!movingAwayCategory){
    // Shouldn't really happen (aligned would have caught it), but resolve
    // to aligned defensively rather than render nothing.
    return {state:"aligned",teamId:team.id,teamName:team.name,categories,largestVarianceCategory:null};
  }

  const top=below.length?below[0]:null;
  const topCategoryId=top?top.skillCategoryId:(movingAwayCategory?movingAwayCategory.skillCategoryId:null);
  const topCategoryName=top?top.name:(movingAwayCategory?movingAwayCategory.name:null);
  const topPlannedMinutes=draft?(draft.byCategory[topCategoryId]||0):0;

  const base={
    teamId:team.id,teamName:team.name,categoryId:topCategoryId,categoryName:topCategoryName,
    currentPct:top?top.currentPct:null,targetPct:top?top.targetPct:null,gapPct:top?top.gapPts:null,
    goalMixMinutes:top?top.goalMixMinutes:null,suggestedMinutes:top?top.minutesNeeded:null,
    closable:top?top.closable:null,basis:"actual",
    practiceId:nextPractice?nextPractice.id:null,
    practiceDurationMinutes:nextPractice?nextPractice.scheduledDurationMinutes:null,
  };

  if(top&&nextPractice&&draftHasMinutes&&topPlannedMinutes===0){
    return {...base,state:"missing_from_next_plan"};
  }

  if(top&&nextPractice&&draftHasMinutes){
    const baseline={historicalTotalMinutes:(report.denominators||{}).actual_minutes_total,categories};
    const impact=calculateProjectedGoalImpact(baseline,draft);
    const topImpact=impact.find(i=>i.skillCategoryId===topCategoryId);
    if(topImpact&&topImpact.result==="Closer to goal"&&Math.abs(topImpact.projectedPct-topImpact.currentPct)>=DEVELOPMENT_PULSE_MATERIAL_IMPROVEMENT_PTS){
      return {...base,state:"plan_improves_gap",projectedPct:topImpact.projectedPct};
    }
  }

  if(movingAwayCategory&&!top){
    return {...base,categoryId:movingAwayCategory.skillCategoryId,categoryName:movingAwayCategory.name,
      currentPct:movingAwayCategory.currentPct,targetPct:movingAwayCategory.targetPct,
      state:"meaningful_gap",projectedPct:movingAwayCategory.projectedPct};
  }

  return {...base,state:"meaningful_gap"};
}

// ── Scrimmage: Everyone Rotates (ROP-Scrimmage-Handoff.md sections 4, 8) ─────
// Pure functions: no network, no React. Two entry points,
// generateScrimmageBoard(input) and repairScrimmageBoard(input, existingBoard),
// plus small helpers the Builder/live board use to summarize a board.
//
// The board is an array of rounds. Each round is { slots: { <SLOT>: assignee
// | null } }, where a fielding SLOT is one of P C 1B 2B 3B SS LF CF RF and a
// hitter SLOT is H1, H2, ...  An assignee is exactly one of
// { player_id } | { team_staff_id } | { helper_name } -- the generator only
// ever produces { player_id } or null; repair preserves any staff/helper
// assignee it finds untouched (the generator never places staff, section 3.6).

export const SCRIMMAGE_FIELD_SLOTS=["P","C","1B","2B","3B","SS","LF","CF","RF"];
// Priority order for keeping a fielding slot filled when players are scarce
// (section 4.1): drop from the end (RF first), keep from the front (P last to
// go). This is the reverse of the spec's stated drop order.
const SCRIMMAGE_SLOT_KEEP_PRIORITY=["P","C","SS","2B","3B","1B","LF","CF","RF"];
const SCRIMMAGE_OF_SLOTS=["LF","CF","RF"];

// Per-half-inning minutes the duration<->count link preserves once a coach
// edits either field directly (section 3.2). 60 / 6 = 10 half-innings.
export const SCRIMMAGE_DEFAULT_ROUND_MINUTES=6;

export function buildDefaultScrimmageConfig(durationMinutes,perRoundMinutes,skillTagIds){
  const dur=durationMinutes||60;
  const per=perRoundMinutes||SCRIMMAGE_DEFAULT_ROUND_MINUTES;
  return {
    format:"everyone_rotates",
    rounds:Math.max(1,Math.round(dur/per)),
    roundLabel:"Round",
    slots:[...SCRIMMAGE_FIELD_SLOTS],
    hittersPerRound:"auto",
    absPerHitter:2,
    catcherHold:2,
    pitcherRoundsMax:1,
    perRoundTimer:false,
    coachRoles:[],
    locks:{},
    skillTagIds:skillTagIds||[],
    seed:uid(),
  };
}

// section 8: a scrimmage "counts a little toward every area". Default tag
// selection is the first tag alphabetically (scope='global') in every
// category for the team's sport, so the even-split covers hitting,
// fielding, pitching, base running, and so on. Softball has no categories
// today -> returns [] and the block stays untagged (the existing untagged
// path handles it). `skillCategories` / `skillTags` come straight from
// `data`; each category is { id, name, sport }, each tag { id, name,
// categoryId, scope }.
export function defaultScrimmageTagIds(skillCategories,skillTags,sport){
  const cats=(skillCategories||[]).filter(c=>c.sport===sport);
  const out=[];
  cats.forEach(cat=>{
    const inCat=(skillTags||[])
      .filter(t=>t.categoryId===cat.id&&(t.scope==null||t.scope==="global"))
      .sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    if(inCat.length)out.push(inCat[0].id);
  });
  return out;
}

// Small deterministic string-seeded PRNG (FNV-1a hash -> mulberry32) so the
// same input reproduces the same board and the tests are stable.
function scrimmageHash(s){let h=2166136261>>>0;const str=String(s);for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function scrimmageRng(seed){
  let a=scrimmageHash(seed);
  return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}

function scrimmagePlayerById(players,id){return players.find(p=>p.id===id)||null;}

// Max bipartite matching (Kuhn's augmenting paths) between a set of players
// and a set of fielding slots, edge = player eligible for slot. Small n (a
// roster and <=9 slots), so the simple O(V*E) form is fine.
// scrimmageMatchAssign returns { slotIndex: playerIndex } for a maximum
// matching; scrimmageMaxMatch is just its size.
function scrimmageMatchAssign(playerList,slots){
  const slotOf={}; // playerIndex -> slotIndex
  const tryKuhn=(slotIdx,visited)=>{
    for(let pi=0;pi<playerList.length;pi++){
      if(visited.has(pi))continue;
      if(!scrimmageEligibleForSlot(playerList[pi],slots[slotIdx]))continue;
      visited.add(pi);
      if(slotOf[pi]===undefined||tryKuhn(slotOf[pi],visited)){slotOf[pi]=slotIdx;return true;}
    }
    return false;
  };
  for(let si=0;si<slots.length;si++)tryKuhn(si,new Set());
  const bySlot={};
  Object.keys(slotOf).forEach(pi=>{bySlot[slotOf[pi]]=Number(pi);});
  return bySlot;
}
function scrimmageMaxMatch(playerList,slots){
  return Object.keys(scrimmageMatchAssign(playerList,slots)).length;
}

// Eligibility from the profile's position chips (section 3.3):
//   P -> can pitch, C -> can catch, 1B/2B/3B/SS literal, IF -> any infield,
//   OF -> LF/CF/RF. A player with no positions set is eligible for every slot
//   except P and C. Locks are absolute: locked-to-position fills only that
//   slot; Never-X removes P/C/hitter eligibility; sitOut removes everything.
export function scrimmageEligibleForSlot(player,slot){
  const locks=(player&&player.locks)||{};
  if(locks.sitOut)return false;
  if(locks.position)return locks.position===slot;
  const pos=(player&&player.positions)||[];
  if(slot==="P")return !locks.noPitch&&pos.includes("P");
  if(slot==="C")return !locks.noCatch&&pos.includes("C");
  if(pos.length===0)return true; // any non-P/C slot
  if(SCRIMMAGE_OF_SLOTS.includes(slot))return pos.includes("OF")||pos.includes(slot);
  return pos.includes(slot)||pos.includes("IF");
}
function scrimmageHasRealPositions(p){return !!((p.positions||[]).length);}

// hittersPerRound: 'auto' (or null) resolves to max(1, players - fielding
// slots) so with a full roster nobody sits and everyone bats. A pinned
// number is used as-is (extras sit that round).
function resolveScrimmageHitters(hittersPerRound,playerCount,slotCount){
  if(hittersPerRound==null||hittersPerRound==="auto")return Math.max(1,playerCount-slotCount);
  return Math.max(1,Math.round(hittersPerRound));
}

// Builds one candidate board with a given RNG. Greedy per round: locked
// players, then the catcher (continue an active hold or start a new one),
// then the pitcher, then the remaining fielding slots by a fairness score,
// then the leftover players bat.
function scrimmageBuildBoard(cfg){
  const {rounds,fieldSlots,players,catcherHold,pitcherRoundsMax,autoHitters,pinnedHitters,rand}=cfg;
  const hasP=fieldSlots.includes("P");
  const hasC=fieldSlots.includes("C");
  const board=[];

  const hitCount={},pitchCount={},catchCount={},slotCount={},lastHitRound={};
  players.forEach(p=>{hitCount[p.id]=0;pitchCount[p.id]=0;catchCount[p.id]=0;lastHitRound[p.id]=-99;});

  const eligPitchers=players.filter(p=>scrimmageEligibleForSlot(p,"P"));
  const eligCatchers=players.filter(p=>scrimmageEligibleForSlot(p,"C"));
  const pitcherCanExceed=hasP&&eligPitchers.length>0&&eligPitchers.length*pitcherRoundsMax<rounds;

  let activeCatcher=null; // { id, roundsLeft }
  let prevRoundSlot={};   // player id -> slot they held last round

  for(let r=0;r<rounds;r++){
    const round={slots:{}};
    const used=new Set();
    const thisRoundSlot={};

    // 1. locked-to-position
    players.forEach(p=>{
      const lp=p.locks&&p.locks.position;
      if(lp&&fieldSlots.includes(lp)&&!(lp in round.slots)&&!used.has(p.id)){
        round.slots[lp]={player_id:p.id};
        used.add(p.id);thisRoundSlot[p.id]=lp;
        slotCount[p.id+"|"+lp]=(slotCount[p.id+"|"+lp]||0)+1;
      }
    });

    // 2. catcher
    if(hasC&&!("C" in round.slots)){
      const holdOpen=activeCatcher&&activeCatcher.roundsLeft>0;
      const holdPlayer=holdOpen?scrimmagePlayerById(players,activeCatcher.id):null;
      if(holdOpen&&holdPlayer&&!used.has(holdPlayer.id)&&scrimmageEligibleForSlot(holdPlayer,"C")){
        round.slots.C={player_id:holdPlayer.id};
        used.add(holdPlayer.id);thisRoundSlot[holdPlayer.id]="C";
        catchCount[holdPlayer.id]++;
        activeCatcher.roundsLeft--;
      }else{
        const cands=eligCatchers.filter(p=>!used.has(p.id)&&!(p.locks&&p.locks.position));
        if(cands.length){
          cands.sort((a,b)=>(catchCount[a.id]-catchCount[b.id])||(rand()-0.5));
          const chosen=cands[0];
          round.slots.C={player_id:chosen.id};
          used.add(chosen.id);thisRoundSlot[chosen.id]="C";
          catchCount[chosen.id]++;
          activeCatcher={id:chosen.id,roundsLeft:catcherHold-1};
        }else{
          round.slots.C=null;
        }
      }
      if(activeCatcher&&activeCatcher.roundsLeft<=0)activeCatcher=null;
    }

    // 3. pitcher
    if(hasP&&!("P" in round.slots)){
      let cands=eligPitchers.filter(p=>!used.has(p.id)&&!(p.locks&&p.locks.position));
      const withinMax=cands.filter(p=>pitchCount[p.id]<pitcherRoundsMax);
      const pool=(!pitcherCanExceed&&withinMax.length)?withinMax:cands;
      if(pool.length){
        pool.sort((a,b)=>(pitchCount[a.id]-pitchCount[b.id])||(rand()-0.5));
        const chosen=pool[0];
        round.slots.P={player_id:chosen.id};
        used.add(chosen.id);thisRoundSlot[chosen.id]="P";
        pitchCount[chosen.id]++;
      }else{
        round.slots.P=null;
      }
    }

    // 4. Decide who bats this round BEFORE filling the field. Batting
    //    fairness (section 4.2 rule 3, Strong) is the constraint that
    //    matters most to a coach ("everyone bats the same number of
    //    times"), and it is far easier to enforce by choosing the
    //    fewest-batted players to bat than to recover it after a greedy
    //    field fill has already handed every at-bat to whoever happened to
    //    be least versatile. A player is only skipped as a batter if
    //    removing them from the fielding pool would leave a fielding slot
    //    with no eligible player at all.
    const openFieldSlots=fieldSlots.filter(s=>s!=="P"&&s!=="C"&&!(s in round.slots));
    const fieldPool=players.filter(p=>!used.has(p.id));
    const targetHitters=autoHitters
      ? Math.max(0,fieldPool.length-openFieldSlots.length)
      : Math.min(pinnedHitters,Math.max(0,fieldPool.length-openFieldSlots.length));
    const batOrder=fieldPool.slice().sort((a,b)=>
      (hitCount[a.id]-hitCount[b.id])||(lastHitRound[a.id]-lastHitRound[b.id])||(rand()-0.5));
    const batters=[];
    const batterIds=new Set();
    // A batter can only be taken out of the fielding pool if the remaining
    // fielders can still cover every open field slot with a distinct player
    // (a real bipartite matching, not just "some eligible player exists for
    // each slot" -- that weaker check let two outfielders both bat and
    // leave RF Open even on a full roster).
    for(const p of batOrder){
      if(batters.length>=targetHitters)break;
      if(p.locks&&p.locks.noHit)continue;
      const remainingFielders=fieldPool.filter(x=>x.id!==p.id&&!batterIds.has(x.id));
      const cover=scrimmageMaxMatch(remainingFielders,openFieldSlots);
      if(cover>=Math.min(openFieldSlots.length,remainingFielders.length)){
        batters.push(p);batterIds.add(p.id);
      }
    }

    // 5. fill fielding slots from the non-batters via a real max bipartite
    //    matching, so a slot never goes Open while a valid distinct-player
    //    assignment exists. The fielder list is seeded-shuffled AND then
    //    ordered by the fairness score for each slot's most-constrained
    //    resolution, so different rounds/retries produce different valid
    //    assignments and a player does not sit in one position every round
    //    (position-spread variance is also one of the retry-loop's ranking
    //    keys). Nothing here can create an Open slot the matching could
    //    have avoided.
    const fielders=fieldPool.filter(p=>!batterIds.has(p.id))
      .map(p=>[p,scrimmageFieldScore(p,"1B",slotCount,hitCount,prevRoundSlot,rand)+rand()])
      .sort((a,b)=>a[1]-b[1]).map(x=>x[0]);
    const bySlot=scrimmageMatchAssign(fielders,openFieldSlots);
    openFieldSlots.forEach((s,k)=>{
      const fi=bySlot[k];
      if(fi==null||fielders[fi]==null){round.slots[s]=null;return;}
      const chosen=fielders[fi];
      round.slots[s]={player_id:chosen.id};
      used.add(chosen.id);thisRoundSlot[chosen.id]=s;
      slotCount[chosen.id+"|"+s]=(slotCount[chosen.id+"|"+s]||0)+1;
    });

    // 6. assign the batters. In auto mode, a non-batter left unused because
    //    a field slot went Open (no eligible player) bats instead of
    //    sitting -- only a pinned hitter cap is allowed to leave players
    //    sitting.
    const finalBatters=batters.slice();
    if(autoHitters){
      fielders.forEach(p=>{if(!used.has(p.id)&&!(p.locks&&p.locks.noHit))finalBatters.push(p);});
    }
    finalBatters.forEach((p,i)=>{
      round.slots["H"+(i+1)]={player_id:p.id};
      hitCount[p.id]++;lastHitRound[p.id]=r;
      used.add(p.id);thisRoundSlot[p.id]="H";
    });

    board.push(round);
    prevRoundSlot=thisRoundSlot;
  }
  return board;
}

// Lower score = more likely to be placed in this fielding slot this round.
//  - times already in THIS slot, x3: spreads a player across positions.
//  - a player who has batted more so far is nudged into the field (negative
//    term) so batting stays even -- this is the fairness lever, backed by
//    the retry loop below. (The spec's prose describes the sign the other
//    way; that reading works against "everyone bats the same", so the
//    fairness-preserving sign is used and the retry loop is the real
//    guarantee.)
//  - a small penalty for a player with no positions set where a real
//    eligible player exists (prefer real eligibility).
//  - a small penalty for the same slot two rounds running (soft, section 4.2 #8).
//  - a seeded jitter so retries actually explore.
function scrimmageFieldScore(p,slot,slotCount,hitCount,prevRoundSlot,rand){
  const inSlot=slotCount[p.id+"|"+slot]||0;
  const noPos=scrimmageHasRealPositions(p)?0:5;
  const sameAsLast=prevRoundSlot[p.id]===slot?2:0;
  const batBias=-(hitCount[p.id]||0)*2;
  return inSlot*3+noPos+sameAsLast+batBias+rand()*0.5;
}

function scrimmageHitCounts(board,players){
  const c={};players.forEach(p=>c[p.id]=0);
  board.forEach(rd=>Object.keys(rd.slots).forEach(s=>{
    if(/^H\d+$/.test(s)){const a=rd.slots[s];if(a&&a.player_id&&a.player_id in c)c[a.player_id]++;}
  }));
  return c;
}
function scrimmageSlotCounts(board){
  const c={}; // `${pid}|${slot}` -> n
  board.forEach(rd=>Object.keys(rd.slots).forEach(s=>{
    if(/^H\d+$/.test(s))return;
    const a=rd.slots[s];if(a&&a.player_id)c[a.player_id+"|"+s]=(c[a.player_id+"|"+s]||0)+1;
  }));
  return c;
}
function scrimmageRoleCounts(board,slot){
  const c={};
  board.forEach(rd=>{const a=rd.slots[slot];if(a&&a.player_id)c[a.player_id]=(c[a.player_id]||0)+1;});
  return c;
}

function scrimmageScoreBoard(board,players,fieldSlots,catcherHold,pitcherRoundsMax){
  const hits=scrimmageHitCounts(board,players);
  const hv=players.map(p=>hits[p.id]);
  const hitSpread=hv.length?Math.max(...hv)-Math.min(...hv):0;

  const pitchC=scrimmageRoleCountsSafe(board,"P");
  const nPitchers=Object.keys(pitchC).length||1;
  const pitchAllowance=Math.max(pitcherRoundsMax,Math.ceil(board.length/nPitchers));
  let pitcherViolations=0;Object.values(pitchC).forEach(n=>{if(n>pitchAllowance)pitcherViolations+=n-pitchAllowance;});

  // catcher runs: each catcher's rounds should be one contiguous run of
  // length catcherHold (the final run in the block may be shorter).
  const catRounds={};
  board.forEach((rd,ri)=>{const a=rd.slots.C;if(a&&a.player_id)(catRounds[a.player_id]||(catRounds[a.player_id]=[])).push(ri);});
  let catcherRunViolations=0;
  Object.values(catRounds).forEach(list=>{
    list.sort((a,b)=>a-b);
    let runStart=list[0],prev=list[0];
    for(let i=1;i<list.length;i++){
      if(list[i]===prev+1){prev=list[i];continue;}
      const len=prev-runStart+1;
      if(len>catcherHold)catcherRunViolations+=len-catcherHold;
      else if(len<catcherHold&&prev<board.length-1)catcherRunViolations+=catcherHold-len;
      runStart=list[i];prev=list[i];
    }
    const len=prev-runStart+1;
    if(len>catcherHold)catcherRunViolations+=len-catcherHold;
    else if(len<catcherHold&&prev<board.length-1)catcherRunViolations+=catcherHold-len;
  });

  // position spread: sum of per-player variance of their fielding-slot counts
  const slotC=scrimmageSlotCounts(board);
  let positionSpreadVariance=0;
  players.forEach(p=>{
    const counts=fieldSlots.filter(s=>s!=="P"&&s!=="C").map(s=>slotC[p.id+"|"+s]||0).filter(n=>n>0);
    if(counts.length<2)return;
    const mean=counts.reduce((a,b)=>a+b,0)/counts.length;
    positionSpreadVariance+=counts.reduce((a,b)=>a+(b-mean)*(b-mean),0)/counts.length;
  });

  return {hitSpread,pitcherViolations,catcherRunViolations,positionSpreadVariance};
}
function scrimmageRoleCountsSafe(board,slot){return scrimmageRoleCounts(board,slot);}

function scrimmageBetterScore(a,b){
  if(a.hitSpread!==b.hitSpread)return a.hitSpread<b.hitSpread;
  if(a.pitcherViolations!==b.pitcherViolations)return a.pitcherViolations<b.pitcherViolations;
  if(a.catcherRunViolations!==b.catcherRunViolations)return a.catcherRunViolations<b.catcherRunViolations;
  return a.positionSpreadVariance<b.positionSpreadVariance;
}

function scrimmageWarnings(players,rounds,fieldSlots,catcherHold,pitcherRoundsMax,board,roundLabel){
  const w=[];
  const unit=(roundLabel||"round").toLowerCase();
  const units=unit+"s";
  const hasP=fieldSlots.includes("P"),hasC=fieldSlots.includes("C");
  const eligP=players.filter(p=>scrimmageEligibleForSlot(p,"P"));
  const eligC=players.filter(p=>scrimmageEligibleForSlot(p,"C"));

  if(hasP&&eligP.length===0){
    w.push("No players are set as pitchers. The pitcher spot stays Open every "+unit+". Turn the pitcher off in Round rules for coach pitch, or set a pitcher on a player's profile.");
  }else if(hasP&&eligP.length*pitcherRoundsMax<rounds){
    w.push("Only "+eligP.length+" "+(eligP.length===1?"pitcher":"pitchers")+" for "+rounds+" "+units+". Some will pitch more than once.");
  }

  if(hasC&&eligC.length===0){
    w.push("No players are set as catchers. The catcher spot stays Open every "+unit+". Turn the catcher off in Round rules, or set a catcher on a player's profile.");
  }else if(hasC){
    const turns=Math.ceil(rounds/catcherHold);
    if(eligC.length<turns)w.push("Only "+eligC.length+" "+(eligC.length===1?"catcher":"catchers")+" for "+turns+" catching turns. Some will catch more than once.");
  }

  fieldSlots.forEach(s=>{
    if(s==="P"||s==="C")return;
    if(!players.some(p=>scrimmageEligibleForSlot(p,s)))w.push("No players are eligible for "+s+". It stays Open. Turn "+s+" off in Round rules, or fill it with a coach or helper.");
  });

  const noPos=players.filter(p=>!scrimmageHasRealPositions(p)&&!(p.locks&&p.locks.sitOut));
  if(noPos.length)w.push(noPos.length+" "+(noPos.length===1?"player has":"players have")+" no positions set. They'll be placed anywhere except pitcher and catcher.");

  players.forEach(p=>{
    const lp=p.locks&&p.locks.position;
    if(lp&&!fieldSlots.includes(lp))w.push((p.name||"A player")+" is locked to "+lp+", which is turned off. They will only bat.");
  });

  if(board){
    const hits=scrimmageHitCounts(board,players);
    const present=players.filter(p=>!(p.locks&&p.locks.sitOut));
    const hv=present.map(p=>hits[p.id]);
    if(hv.length){
      const spread=Math.max(...hv)-Math.min(...hv);
      if(spread>1){
        const min=Math.min(...hv);
        const low=present.filter(p=>hits[p.id]===min).map(p=>p.name||p.id);
        w.push("Batting is uneven: "+low.join(", ")+" "+(low.length===1?"bats":"bat")+" "+min+" "+(min===1?"time":"times")+" while others bat "+Math.max(...hv)+".");
      }
    }
  }
  return w;
}

// section 4: generate a fair board from scratch.
export function generateScrimmageBoard(input){
  const rounds=Math.max(1,Math.round(input.rounds||1));
  const fieldSlots=(input.slots&&input.slots.length)?input.slots.slice():[...SCRIMMAGE_FIELD_SLOTS];
  const players=(input.players||[]).filter(p=>!(p.locks&&p.locks.sitOut));
  const catcherHold=Math.max(1,Math.min(input.catcherHold||2,rounds));
  const pitcherRoundsMax=Math.max(1,input.pitcherRoundsMax||1);
  const autoHitters=input.hittersPerRound==null||input.hittersPerRound==="auto";
  const pinnedHitters=autoHitters?0:resolveScrimmageHitters(input.hittersPerRound,players.length,fieldSlots.length);
  const seed=input.seed||"scrimmage";

  if(!players.length){
    return {board:Array.from({length:rounds},()=>({slots:{}})),warnings:["No players available. Take attendance or add players to the roster."]};
  }

  let best=null;
  const RETRIES=30;
  for(let attempt=0;attempt<RETRIES;attempt++){
    const rand=scrimmageRng(seed+"::"+attempt);
    const board=scrimmageBuildBoard({rounds,fieldSlots,players,catcherHold,pitcherRoundsMax,autoHitters,pinnedHitters,rand});
    const score=scrimmageScoreBoard(board,players,fieldSlots,catcherHold,pitcherRoundsMax);
    if(!best||scrimmageBetterScore(score,best.score))best={board,score};
  }

  // If the greedy passes never fully evened batting (a tightly-constrained
  // roster), take the best board and swap over-batted fielders for
  // under-batted ones until the spread is 1 or no legal swap is left.
  if(best.score.hitSpread>1){
    const hc=scrimmageHitCounts(best.board,players);
    const lockedPos={};players.forEach(p=>{if(p.locks&&p.locks.position)lockedPos[p.id]=p.locks.position;});
    scrimmageRebalanceHits(best.board,players,fieldSlots,hc,lockedPos,scrimmageRng(seed+"::rebalance"));
    best.board.forEach(scrimmageCompactHitters);
  }

  const warnings=scrimmageWarnings(input.players||[],rounds,fieldSlots,catcherHold,pitcherRoundsMax,best.board,input.roundLabel);
  return {board:best.board,warnings};
}

// section 4.4: fill only the holes in an existing board with the fewest
// changes. `existingBoard` is the current board (may contain team_staff /
// helper assignees, which are left untouched -- the generator never places
// staff). Departed players are removed; now-empty player slots are refilled,
// preferring a player already batting in that same round; newly-present
// players are inserted as hitters; then, only if batting spread exceeds 1,
// hitter/fielder pairs are swapped in the fewest rounds needed.
export function repairScrimmageBoard(input,existingBoard){
  const fieldSlots=(input.slots&&input.slots.length)?input.slots.slice():[...SCRIMMAGE_FIELD_SLOTS];
  const players=(input.players||[]).filter(p=>!(p.locks&&p.locks.sitOut));
  const catcherHold=Math.max(1,Math.min(input.catcherHold||2,Math.max(1,(existingBoard||[]).length)));
  const pitcherRoundsMax=Math.max(1,input.pitcherRoundsMax||1);
  const autoHitters=input.hittersPerRound==null||input.hittersPerRound==="auto";
  const pinnedHitters=autoHitters?0:resolveScrimmageHitters(input.hittersPerRound,players.length,fieldSlots.length);
  const seed=(input.seed||"scrimmage")+"::repair";
  const rand=scrimmageRng(seed);

  const presentIds=new Set(players.map(p=>p.id));
  const lockedPos={}; // playerId -> slot
  players.forEach(p=>{if(p.locks&&p.locks.position)lockedPos[p.id]=p.locks.position;});

  // deep clone
  const board=(existingBoard||[]).map(rd=>({slots:Object.assign({},rd.slots)}));
  const rounds=board.length;

  // 1. strip departed players (player assignees only; leave staff/helpers)
  board.forEach(rd=>{
    Object.keys(rd.slots).forEach(s=>{
      const a=rd.slots[s];
      if(a&&a.player_id&&!presentIds.has(a.player_id))rd.slots[s]=/^H\d+$/.test(s)?undefined:null;
    });
    // compact hitter slots so H1..Hk stay contiguous
    scrimmageCompactHitters(rd);
  });

  // running counts from what's left
  const hitCount=scrimmageHitCounts(board,players);
  const slotCount=scrimmageSlotCounts(board);
  const pitchCount=scrimmageRoleCounts(board,"P");
  const catchCount=scrimmageRoleCounts(board,"C");
  players.forEach(p=>{if(!(p.id in hitCount))hitCount[p.id]=0;if(!(p.id in pitchCount))pitchCount[p.id]=0;if(!(p.id in catchCount))catchCount[p.id]=0;});

  const usedInRound=ri=>{
    const set=new Set();
    Object.keys(board[ri].slots).forEach(s=>{const a=board[ri].slots[s];if(a&&a.player_id)set.add(a.player_id);});
    return set;
  };
  const battersInRound=ri=>Object.keys(board[ri].slots).filter(s=>/^H\d+$/.test(s)).map(s=>board[ri].slots[s]).filter(a=>a&&a.player_id).map(a=>a.player_id);

  // 2. fill now-empty fielding slots, round order, preferring a current batter
  for(let ri=0;ri<rounds;ri++){
    const emptyFieldSlots=fieldSlots.filter(s=>(s in board[ri].slots)&&board[ri].slots[s]===null);
    // also treat slots the plan never had a key for as fillable
    fieldSlots.forEach(s=>{if(!(s in board[ri].slots))emptyFieldSlots.push(s);});
    emptyFieldSlots.sort((a,b)=>SCRIMMAGE_SLOT_KEEP_PRIORITY.indexOf(a)-SCRIMMAGE_SLOT_KEEP_PRIORITY.indexOf(b));
    for(const s of emptyFieldSlots){
      // A player already fielding a (non-P/C-or-any) slot this round can't
      // take another; a player who is only batting CAN move to the field
      // (their hitter slot is freed below) -- that's the natural minimal
      // fill, so batters are candidates here, not excluded.
      const fielding=new Set(Object.keys(board[ri].slots).filter(k=>!/^H\d+$/.test(k)).map(k=>board[ri].slots[k]).filter(a=>a&&a.player_id).map(a=>a.player_id));
      const batters=battersInRound(ri);
      let cands=players.filter(p=>!fielding.has(p.id)&&scrimmageEligibleForSlot(p,s)&&(!lockedPos[p.id]||lockedPos[p.id]===s));
      if(!cands.length){board[ri].slots[s]=null;continue;}
      // prefer a player currently batting this round (natural swap), then
      // the same fairness score as generate
      cands.sort((a,b)=>{
        const ab=batters.includes(a.id)?0:1,bb=batters.includes(b.id)?0:1;
        if(ab!==bb)return ab-bb;
        return scrimmageFieldScore(a,s,slotCount,hitCount,{},rand)-scrimmageFieldScore(b,s,slotCount,hitCount,{},rand);
      });
      const chosen=cands[0];
      // if they were batting this round, free that hitter slot
      const hs=Object.keys(board[ri].slots).find(k=>/^H\d+$/.test(k)&&board[ri].slots[k]&&board[ri].slots[k].player_id===chosen.id);
      if(hs){board[ri].slots[hs]=undefined;hitCount[chosen.id]=Math.max(0,(hitCount[chosen.id]||0)-1);}
      board[ri].slots[s]={player_id:chosen.id};
      if(s==="P")pitchCount[chosen.id]=(pitchCount[chosen.id]||0)+1;
      else if(s==="C")catchCount[chosen.id]=(catchCount[chosen.id]||0)+1;
      else slotCount[chosen.id+"|"+s]=(slotCount[chosen.id+"|"+s]||0)+1;
      scrimmageCompactHitters(board[ri]);
    }
  }

  // 3. Rebuild the batting for every round WITHOUT touching the fielding
  //    board at all -- for auto mode, each round's batters are exactly the
  //    present players not fielding that round (so nobody is dropped or
  //    double-counted), sat-out / never-hits players excluded. Because the
  //    fielding rotation was already even and step 2 only nudged it, this
  //    lands batting within an at-bat or two with zero extra fielding
  //    churn. A pinned hitter count keeps the N fewest-batted eligible
  //    non-fielders and the rest sit that round.
  const present=players.filter(p=>!(p.locks&&(p.locks.sitOut||p.locks.noHit)));
  const totalHit={};present.forEach(p=>{totalHit[p.id]=0;});
  for(let ri=0;ri<rounds;ri++){
    const rd=board[ri].slots;
    Object.keys(rd).filter(k=>/^H\d+$/.test(k)).forEach(k=>{delete rd[k];});
    const fieldingHere=new Set(Object.keys(rd).map(k=>rd[k]).filter(a=>a&&a.player_id).map(a=>a.player_id));
    let batters=present.filter(p=>!fieldingHere.has(p.id));
    batters.sort((a,b)=>(totalHit[a.id]-totalHit[b.id])||(rand()-0.5));
    if(!autoHitters)batters=batters.slice(0,Math.max(0,pinnedHitters));
    batters.forEach((p,i)=>{rd["H"+(i+1)]={player_id:p.id};totalHit[p.id]++;});
  }

  board.forEach(scrimmageCompactHitters);

  // 4. Low-churn batting rebalance: single hitter<->fielder swaps (one
  //    field-slot change each), never a whole-round reshuffle. Stops as
  //    soon as the spread is <=1 or no simple legal swap is left.
  const lockedRepair={};present.forEach(p=>{if(p.locks&&p.locks.position)lockedRepair[p.id]=p.locks.position;});
  for(let guard=0;guard<60;guard++){
    const hc=scrimmageHitCounts(board,present);
    const hv=present.map(p=>hc[p.id]||0);
    if(!hv.length)break;
    const hi=Math.max(...hv),lo=Math.min(...hv);
    if(hi-lo<=1)break;
    // over = batted the most (move one of their at-bats into the field);
    // under = batted the least (they field a lot -- move one field slot to
    // a bat). One field-slot change per swap.
    const over=present.filter(p=>(hc[p.id]||0)===hi&&!lockedRepair[p.id]&&!(p.locks&&p.locks.noHit));
    const under=present.filter(p=>(hc[p.id]||0)===lo&&!lockedRepair[p.id]);
    let did=false;
    for(const o of over){
      for(let ri=0;ri<rounds&&!did;ri++){
        const rd=board[ri].slots;
        const oHit=Object.keys(rd).find(k=>/^H\d+$/.test(k)&&rd[k]&&rd[k].player_id===o.id);
        if(!oHit)continue;
        for(const u of under){
          const uSlot=Object.keys(rd).find(k=>!/^H\d+$/.test(k)&&k!=="C"&&k!=="P"&&rd[k]&&rd[k].player_id===u.id);
          if(!uSlot)continue;
          if(!scrimmageEligibleForSlot(o,uSlot))continue;
          rd[uSlot]={player_id:o.id};rd[oHit]={player_id:u.id};
          did=true;break;
        }
      }
      if(did)break;
    }
    if(!did)break;
  }
  board.forEach(scrimmageCompactHitters);

  const warnings=scrimmageWarnings(input.players||[],rounds,fieldSlots,catcherHold,pitcherRoundsMax,board,input.roundLabel);
  return {board,warnings};
}

function scrimmageNextHitterKey(round){
  let i=1;while(("H"+i) in round.slots&&round.slots["H"+i]!==undefined&&round.slots["H"+i]!==null)i++;
  return "H"+i;
}
function scrimmageCompactHitters(round){
  const hs=Object.keys(round.slots).filter(k=>/^H\d+$/.test(k)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)));
  const kept=hs.map(k=>round.slots[k]).filter(a=>a&&a.player_id);
  hs.forEach(k=>{delete round.slots[k];});
  kept.forEach((a,i)=>{round.slots["H"+(i+1)]=a;});
}
function scrimmageRebalanceHits(board,players,fieldSlots,hitCount,lockedPos,rand){
  // A Never-hits player legitimately bats zero times -- keep them out of the
  // spread math entirely so the loop doesn't chase an impossible target.
  const byId=Object.fromEntries(players.map(p=>[p.id,p]));
  const nonHitField=["1B","2B","3B","SS","LF","CF","RF"]; // swap-in slots (not P/C)
  for(let guard=0;guard<120;guard++){
    const present=players.filter(p=>!(p.locks&&(p.locks.sitOut||p.locks.noHit)));
    const hv=present.map(p=>hitCount[p.id]||0);
    if(!hv.length)return;
    const hi=Math.max(...hv),lo=Math.min(...hv);
    if(hi-lo<=1)return;
    const over=present.filter(p=>(hitCount[p.id]||0)===hi&&!lockedPos[p.id]);
    const under=present.filter(p=>(hitCount[p.id]||0)===lo&&!lockedPos[p.id]);
    let done=false;
    // Directly target an under-batted player: find a round where U fields a
    // non-P/C slot and an over-batted O bats. If the round's other non-P/C
    // fielders plus O can still cover every non-P/C slot without U, then O
    // fields and U bats.
    for(const u of under){
      for(let ri=0;ri<board.length&&!done;ri++){
        const rd=board[ri].slots;
        const uSlot=nonHitField.find(s=>rd[s]&&rd[s].player_id===u.id);
        if(!uSlot)continue;
        for(const o of over){
          const oHits=Object.keys(rd).find(k=>/^H\d+$/.test(k)&&rd[k]&&rd[k].player_id===o.id);
          if(!oHits)continue;
          const rSlots=nonHitField.filter(s=>rd[s]&&rd[s].player_id);
          const otherFielders=rSlots.map(s=>byId[rd[s].player_id]).filter(p=>p&&p.id!==u.id&&!lockedPos[p.id]);
          if(otherFielders.length!==rSlots.length-1)continue; // a locked fielder here
          const cand=[o,...otherFielders];
          const bySlot=scrimmageMatchAssign(cand,rSlots);
          if(Object.keys(bySlot).length!==rSlots.length)continue; // can't cover without u
          rSlots.forEach((s,si)=>{const ci=bySlot[si];if(ci!=null)rd[s]={player_id:cand[ci].id};});
          rd[oHits]={player_id:u.id};
          hitCount[o.id]--;hitCount[u.id]++;
          done=true;break;
        }
      }
      if(done)break;
    }
    if(!done)return; // no improving move anywhere
  }
}

// section 3.4 fairness badges. Pure summary of a board for the UI.
export function summarizeScrimmageFairness(board,players){
  const present=(players||[]);
  const hits=scrimmageHitCounts(board||[],present);
  const hv=present.map(p=>hits[p.id]||0);
  const hitEven=hv.length?(Math.max(...hv)-Math.min(...hv)<=1):true;
  const lowNames=(()=>{
    if(hitEven||!hv.length)return[];
    const min=Math.min(...hv);
    return present.filter(p=>(hits[p.id]||0)===min).map(p=>p.name||p.id);
  })();
  const pitchC=scrimmageRoleCounts(board||[],"P");
  const catchC=scrimmageRoleCounts(board||[],"C");
  const eligP=present.filter(p=>scrimmageEligibleForSlot(p,"P")).length;
  const catchRuns=Object.values(catchC);
  return {
    hits:{even:hitEven,counts:hits,lowNames,max:hv.length?Math.max(...hv):0,min:hv.length?Math.min(...hv):0},
    pitch:{used:Object.keys(pitchC).length,eligible:eligP},
    catch:{count:Object.keys(catchC).length,roundsEach:catchRuns.length?Math.round(catchRuns.reduce((a,b)=>a+b,0)/catchRuns.length):0},
  };
}

// One player's rotation across the board (section 3.5). Returns
// { timeline:[{round, slot}], counts:{SLOT:n, Hit:n}, holds:[[startRound,endRound]] }
export function scrimmagePlayerRotation(board,playerId){
  const timeline=[];const counts={};const holds=[];
  (board||[]).forEach((rd,ri)=>{
    let where=null;
    Object.keys(rd.slots).forEach(s=>{
      const a=rd.slots[s];
      if(a&&a.player_id===playerId)where=/^H\d+$/.test(s)?"Hit":s;
    });
    timeline.push({round:ri,slot:where});
    if(where)counts[where]=(counts[where]||0)+1;
  });
  let run=null;
  timeline.forEach(t=>{
    if(t.slot&&run&&run.slot===t.slot){run.end=t.round;}
    else{if(run&&run.end>run.start)holds.push([run.start,run.end]);run=t.slot?{slot:t.slot,start:t.round,end:t.round}:null;}
  });
  if(run&&run.end>run.start)holds.push([run.start,run.end]);
  return {timeline,counts,holds};
}
