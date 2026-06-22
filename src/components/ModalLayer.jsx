import React, { useState, useRef } from "react";
import { uid } from "../constants.js";

const SPORTS=["Basketball","Soccer","Baseball","Lacrosse","Football","Softball","Volleyball","Hockey","Tennis","Swimming","General","Other"];

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

const Ic_Check=()=><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="2 7 6 11 12 3"/></svg>;

export default function ModalLayer({modal,data,update,closeModal}){
  const defaultSport=()=>{
    const lib=data.activityLibrary||[];
    if(lib.length>0)return lib[lib.length-1].sport||"Basketball";
    const sports=[...new Set((data.teams||[]).map(t=>t.sport).filter(Boolean))];
    if(sports.length===1)return sports[0];
    return "Basketball";
  };
  const lastSportRef=useRef(defaultSport());
  const player=modal.type==="editPlayer"?modal.payload.player:null;
  const activity=modal.type==="editActivity"?modal.payload.activity:null;
  const location=modal.type==="editLocation"?modal.payload.location:null;
  const editTeamData=modal.type==="editTeam"?modal.payload.team:null;
  const asset=modal.type==="editAsset"?modal.payload.asset:null;
  const coach=modal.type==="editCoach"?modal.payload.coach:null;
  const template=modal.type==="editTemplate"?modal.payload.template:null;
  const [f,setF]=useState(()=>{
    if(player)return{firstName:player.firstName,lastName:player.lastName,jersey:player.jersey,notes:player.notes||""};
    if(activity){
      lastSportRef.current=activity.sport||"Basketball";
      return{
        name:activity.name,
        sport:activity.sport||"Basketball",
        duration:activity.duration,
        description:activity.description||"",
        coachingPoints:activity.coachingPoints||"",
        equipment:Array.isArray(activity.equipment)?activity.equipment:[],
        playerGear:activity.playerGear||"",
        grouping:activity.grouping||"whole",
        numGroups:activity.numGroups||2,
      };
    }
    if(location)return{name:location.name};
    if(asset)return{name:asset.name,locationTags:asset.locationTags||[]};
    if(coach)return{name:coach.name,role:coach.role||""};
    if(template)return{name:template.name,sport:template.sport||"General"};
    if(editTeamData)return{name:editTeamData.name,sport:editTeamData.sport||"Basketball"};
    return{sport:lastSportRef.current||"Basketball"};
  });
  const set=(k,v)=>setF(p=>Object.assign({},p,{[k]:v}));
  const togTag=lid=>setF(p=>Object.assign({},p,{locationTags:p.locationTags&&p.locationTags.includes(lid)?p.locationTags.filter(x=>x!==lid):[...(p.locationTags||[]),lid]}));
  const save=()=>{
    const t=modal.type,p=modal.payload;
    if(t==="addTeam"){if(!f.name)return;update(d=>{d.teams.push({id:uid(),name:f.name,sport:f.sport||"Basketball",players:[],coaches:[]});return d;});}
    if(t==="addPlayer"){if(!f.firstName)return;update(d=>{const tm=d.teams.find(tm=>tm.id===p.teamId);if(tm)tm.players.push({id:uid(),firstName:f.firstName,lastName:f.lastName||"",jersey:f.jersey||"",notes:f.notes||"",focusAreas:[]});return d;});}
    if(t==="editPlayer"){if(!f.firstName)return;update(d=>{const tm=d.teams.find(tm=>tm.id===p.teamId);if(tm){const pl=tm.players.find(pl=>pl.id===p.player.id);if(pl){pl.firstName=f.firstName;pl.lastName=f.lastName||"";pl.jersey=f.jersey||"";pl.notes=f.notes||"";}}return d;});}
    if(t==="addCoach"){if(!f.name)return;update(d=>{const tm=d.teams.find(tm=>tm.id===p.teamId);if(tm)tm.coaches.push({id:uid(),name:f.name,role:f.role||"Assistant",notes:""});return d;});}
    if(t==="editCoach"){if(!f.name)return;update(d=>{const tm=d.teams.find(tm=>tm.id===p.teamId);if(tm){const c=tm.coaches.find(c=>c.id===p.coach.id);if(c){c.name=f.name;c.role=f.role||"Assistant";}}return d;});}
    if(t==="addLocation"){if(!f.name)return;update(d=>{d.locations.push({id:uid(),name:f.name,sublocations:[]});return d;});}
    if(t==="editLocation"){if(!f.name)return;update(d=>{const l=d.locations.find(l=>l.id===p.location.id);if(l)l.name=f.name;return d;});}
    if(t==="addSublocation"){if(!f.name)return;update(d=>{const l=d.locations.find(l=>l.id===p.locationId);if(l)l.sublocations.push({id:uid(),name:f.name});return d;});}
    if(t==="addAsset"){if(!f.name)return;update(d=>{d.assets.push({id:uid(),name:f.name,locationTags:f.locationTags||[]});return d;});}
    if(t==="editAsset"){if(!f.name)return;update(d=>{const a=d.assets.find(a=>a.id===p.asset.id);if(a){a.name=f.name;a.locationTags=f.locationTags||[];}return d;});}
    if(t==="addActivity"){
      if(!f.name)return;
      update(d=>{
        d.activityLibrary.push({
          id:uid(),name:f.name,sport:f.sport||"General",
          description:f.description||"",duration:+(f.duration||10),
          coachingPoints:f.coachingPoints||"",
          equipment:f.equipment||[],
          playerGear:f.playerGear||"",
          grouping:f.grouping||"whole",
          numGroups:f.numGroups||2,
        });
        return d;
      });
    }
    if(t==="editActivity"){
      if(!f.name)return;
      update(d=>{
        const a=d.activityLibrary.find(a=>a.id===p.activity.id);
        if(a){
          // BUG FIX: was missing equipment, playerGear, grouping, numGroups
          a.name=f.name;
          a.sport=f.sport||"General";
          a.duration=+(f.duration||10);
          a.description=f.description||"";
          a.coachingPoints=f.coachingPoints||"";
          a.equipment=f.equipment||[];
          a.playerGear=f.playerGear||"";
          a.grouping=f.grouping||"whole";
          a.numGroups=f.numGroups||2;
        }
        return d;
      });
    }
    if(t==="editTemplate"){if(!f.name)return;update(d=>{const tpl=d.templates.find(t=>t.id===p.template.id);if(tpl){tpl.name=f.name;tpl.sport=f.sport||"General";}return d;});}
    if(t==="editTeam"){if(!f.name)return;update(d=>{const tm=d.teams.find(tm=>tm.id===p.team.id);if(tm){tm.name=f.name;tm.sport=f.sport||"Basketball";}return d;});}
    closeModal();
  };
  const TITLES={addTemplate:"New Template",editTemplate:"Edit Template",addTeam:"New Team",editTeam:"Edit Team",addPlayer:"Add Player",editPlayer:"Edit Player",addCoach:"Add Coach",editCoach:"Edit Coach",addLocation:"Add Location",editLocation:"Edit Location",addSublocation:"Add Area",addAsset:"Add Equipment",editAsset:"Edit Equipment",addActivity:"New Drill",editActivity:"Edit Drill"};
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
        {modal.type==="editCoach"&&(<div><div className="fld"><label className="lbl">Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div><div className="fld"><label className="lbl">Role</label><input className="inp" value={f.role||""} placeholder="Assistant" onChange={e=>set("role",e.target.value)}/></div></div>
        )}
        {(modal.type==="addLocation"||modal.type==="editLocation"||modal.type==="addSublocation")&&(<div className="fld"><label className="lbl">Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
        )}
        {(modal.type==="addAsset"||modal.type==="editAsset")&&(<div>
            <div className="fld"><label className="lbl">Equipment Name</label><input className="inp" autoFocus value={f.name||""} onChange={e=>set("name",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Tag Locations (leave empty for all)</label>
              {data.locations.map(l=>(<div key={l.id} className="row" style={{marginBottom:8}}>
                  <div onClick={()=>togTag(l.id)} style={{width:22,height:22,borderRadius:4,border:"1.5px solid",borderColor:f.locationTags&&f.locationTags.includes(l.id)?"var(--green)":"var(--b)",background:f.locationTags&&f.locationTags.includes(l.id)?"var(--green)":"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                    {f.locationTags&&f.locationTags.includes(l.id)&&<Ic_Check/>}
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
            <div className="g2">
              <div className="fld"><label className="lbl">Sport</label><select className="sel" value={f.sport||"General"} onChange={e=>set("sport",e.target.value)}>{SPORTS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
              <div className="fld"><label className="lbl">Default Duration (min)</label><DurStepper value={f.duration||10} min={1} onChange={v=>set("duration",v)}/></div>
            </div>
            <div className="fld"><label className="lbl">Description</label><textarea className="ta" style={{minHeight:50}} value={f.description||""} onChange={e=>set("description",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Player Grouping</label>
              <div style={{display:"flex",gap:6}}>
                {[{v:"whole",l:"Whole Team",sub:"All players together"},{v:"partners",l:"Partners",sub:"Paired in groups of 2"},{v:"groups",l:"Groups",sub:"Split into groups"}].map(({v,l,sub})=>(
                  <button key={v} type="button" onClick={()=>set("grouping",v)} style={{flex:1,padding:"8px 4px",borderRadius:"var(--r)",border:"1.5px solid var(--b)",background:(f.grouping||"whole")===v?"var(--green)":"var(--s1)",color:(f.grouping||"whole")===v?"#fff":"var(--black)",fontSize:13,cursor:"pointer",lineHeight:1.3}}>
                    <div style={{fontWeight:700}}>{l}</div>
                    {(f.grouping||"whole")===v&&<div style={{fontSize:10,opacity:.8,marginTop:2}}>{sub}</div>}
                  </button>
                ))}
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
