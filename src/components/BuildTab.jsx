import React, { useState } from "react";
import { uid } from "../constants.js";
import { archiveDrill, archiveTemplate } from "../supabase.js";
import { TemplateWorkspace } from "./NewLibraryScreen.jsx";

// Build tab -- team-scoped drill/template access, reached via the team
// workspace's top tab bar (/team/:teamId/build). Formerly PlanScreen.jsx's
// "Build" half of a Build/Goals & Insights toggle (nav restructure round 2,
// 2026-07-15); the flattened top-tabs redesign (2026-07-2x) gave Goals &
// Insights its own route (GoalsScreen, rendered directly) and promoted this
// to a standalone top-bar destination too, so the outer toggle container is
// gone -- this file now holds nothing but BuildTab itself. Skill Tags (the
// toggle container's other former sub-section) stays reachable via
// Settings > Skill Tags, which was always the same underlying screen, not
// team-specific data.
//
// Build tab upgrade (2026-07-20): used to show a read-only preview of
// drills/templates (plain, non-tappable rows, capped at 12 drills, "+N more
// in Library" for the rest). The team-scoped tab bar has no way back to the
// global Library tab without detouring through Teams/Home first, so that
// preview was effectively a dead end. This now reuses the real library
// interactions (edit, delete, skill tags, template editing) scoped to this
// team's sport, so a coach never has to leave the team to manage what they
// see here.
export function BuildTab({data,team,coachId,goToBuilder,goToRun,openModal,refreshLibrary,refreshPlanning}){
  const teamSport=team.sport||"General";
  const templates=(data.templates||[]).filter(t=>(t.sport||"General")===teamSport);
  const defaultTpl=templates.find(t=>t.defaultTeamId===team.id);
  const otherTpls=templates.filter(t=>t.id!==(defaultTpl&&defaultTpl.id));
  const drills=(data.activityLibrary||[]).filter(a=>a.ownerUserId===coachId&&((a.sport||"General")===teamSport||(a.sport||"General")==="General"));
  const skillTagsById=Object.fromEntries((data.skillTags||[]).map(t=>[t.id,t]));
  const tagNames=ids=>(ids||[]).map(id=>skillTagsById[id]?skillTagsById[id].name:null).filter(Boolean);
  const [drillMenu,setDrillMenu]=useState(null);
  const [tplMenu,setTplMenu]=useState(null);
  const [editingTpl,setEditingTpl]=useState(null);
  const [newTplPrompt,setNewTplPrompt]=useState(false);
  const [newTplNameDraft,setNewTplNameDraft]=useState("");
  const [confirmDelTpl,setConfirmDelTpl]=useState(null);

  if(editingTpl)return(<TemplateWorkspace data={data} template={editingTpl} openModal={openModal} coachId={coachId} refreshLibrary={refreshLibrary} refreshPlanning={refreshPlanning} onBack={()=>setEditingTpl(null)} onStartFromTemplate={tplId=>goToBuilder(null,tplId,team.id)} onRunNow={goToRun}/>);

  const createNewTpl=()=>{
    if(!newTplNameDraft.trim())return;
    setEditingTpl({id:uid(),name:newTplNameDraft.trim(),sport:teamSport,defaultTeamId:team.id,activities:[],durMin:0});
    setNewTplPrompt(false);
  };
  const delTpl=async id=>{await archiveTemplate(id);await refreshPlanning();setConfirmDelTpl(null);};
  const delDrill=async id=>{await archiveDrill(id);await refreshLibrary();};

  return (<div style={{paddingBottom:"calc(var(--tab) + 20px)"}} onClick={()=>{setDrillMenu(null);setTplMenu(null);}}>
    <button className="btn primary bmd bfull" style={{marginBottom:14}} onClick={()=>goToBuilder(null,null,team.id)}>+ Build a Practice</button>

    {defaultTpl&&<div className="card mb10" style={{borderColor:"var(--gb)",background:"var(--gbg)"}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"var(--green)",marginBottom:4}}>Default Template</div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:900,marginBottom:8}}>{defaultTpl.name}</div>
      <button className="btn primary bsm bfull" onClick={()=>goToBuilder(null,defaultTpl.id,team.id)}>Start from Template</button>
    </div>}

    <div className="sechdr mb8">
      <span className="sectitle">{teamSport} Templates</span>
      <button className="btn ghost bxs" onClick={e=>{e.stopPropagation();setNewTplNameDraft("");setNewTplPrompt(true);}}>+ New Template</button>
    </div>
    {newTplPrompt&&<div className="movly" onClick={()=>setNewTplPrompt(false)}><div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="mtitle">Name your template</div>
      <div className="fld"><label className="lbl">Template Name</label><input className="inp" autoFocus placeholder="e.g. Tuesday Skills Day" value={newTplNameDraft} onChange={e=>setNewTplNameDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createNewTpl()}/></div>
      <div className="brow"><button className="btn ghost bmd" onClick={()=>setNewTplPrompt(false)}>Cancel</button><button className="btn primary bmd" disabled={!newTplNameDraft.trim()} onClick={createNewTpl}>Create</button></div>
    </div></div>}
    {otherTpls.map(t=>(<div key={t.id} className="li" style={{marginBottom:6,position:"relative"}}>
      <div className="lim" style={{flex:1,cursor:"pointer"}} onClick={()=>goToBuilder(null,t.id,team.id)}>
        <div className="lin">{t.name}</div><div className="limt">{(t.activities||[]).length} activities · {t.durMin||0}min</div>
      </div>
      <button className="ell-btn" onClick={e=>{e.stopPropagation();setTplMenu(tplMenu===t.id?null:t.id);}}><span/><span/><span/></button>
      {tplMenu===t.id&&<div className="mini-menu" style={{right:0}}>
        <button className="mm-item" onClick={e=>{e.stopPropagation();setEditingTpl(t);setTplMenu(null);}}>Edit</button>
        <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setConfirmDelTpl(t.id);setTplMenu(null);}}>Delete</button>
      </div>}
    </div>))}
    {confirmDelTpl&&<div className="movly" onClick={()=>setConfirmDelTpl(null)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="mtitle">Delete template?</div><div style={{fontSize:14,color:"var(--td)",marginBottom:16}}>This cannot be undone.</div><div className="brow"><button className="btn ghost bmd" onClick={()=>setConfirmDelTpl(null)}>Cancel</button><button className="btn primary bmd" onClick={()=>delTpl(confirmDelTpl)}>Delete</button></div></div></div>}
    {templates.length===0&&<div style={{fontSize:13,color:"var(--td)",marginBottom:12}}>No {teamSport} templates yet -- save one from Builder.</div>}

    <div className="sechdr mb8">
      <span className="sectitle">{teamSport} Drills</span>
      <button className="btn ghost bxs" onClick={e=>{e.stopPropagation();openModal("addActivity");}}>+ Add Drill</button>
    </div>
    {drills.length===0&&<div style={{fontSize:13,color:"var(--td)"}}>No drills for {teamSport} yet.</div>}
    {drills.map(d=>(<div key={d.id} className="li" style={{marginBottom:6,position:"relative"}}>
      <div className="lim">
        <div className="lin">{d.name}</div>
        <div className="limt">{d.duration}min{d.description?" · "+d.description:""}</div>
        {d.skillTagIds&&d.skillTagIds.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
          {tagNames(d.skillTagIds).map(name=>(<span key={name} className="bdg bs" style={{fontSize:10}}>{name}</span>))}
        </div>}
      </div>
      <button className="ell-btn" onClick={e=>{e.stopPropagation();setDrillMenu(drillMenu===d.id?null:d.id);}}><span/><span/><span/></button>
      {drillMenu===d.id&&<div className="mini-menu" style={{right:0}}>
        <button className="mm-item" onClick={e=>{e.stopPropagation();setDrillMenu(null);openModal("editActivity",{activity:d});}}>Edit</button>
        <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setDrillMenu(null);delDrill(d.id);}}>Delete</button>
      </div>}
    </div>))}
  </div>);
}
