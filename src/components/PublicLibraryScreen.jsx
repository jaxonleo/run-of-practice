import React, { useState } from "react";
import { archiveCatalogDrill } from "../supabase.js";

// Wraps the substring of `text` that matches `query` (case-insensitive) in a
// <mark> -- a small, standard content-search touch that makes scanning a
// filtered list faster than re-reading every title.
function highlightMatch(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (<>{text.slice(0, idx)}<mark style={{background: "var(--green)", color: "#fff", padding: "0 1px", borderRadius: 2}}>{text.slice(idx, idx + query.length)}</mark>{text.slice(idx + query.length)}</>);
}

// Public Library browser -- search-first by design (2026-07-19, Jax's call):
// initial state is just "pick a sport," never a dump of every drill. Source/
// Publisher filters are built as real, working facets even though today
// there's exactly one of each per sport (one system catalog, publisher
// "Run of Practice") -- they're future-proofing for org libraries and
// multi-coach club catalogs, not dead UI, so they only render once there's
// more than one option to narrow (no point showing a dropdown with one
// choice). Manual drag-reorder from the old shelf view is intentionally
// dropped here -- a search/filter result set is sorted by relevance/name,
// not hand-curated order; the founder-admin's add/edit/archive affordances
// are preserved, just relocated into this flow.
export function PublicLibraryScreen({data, isAdmin, refreshLibrary, openModal, doCopy, copyingId}) {
  const [selectedSport, setSelectedSport] = useState(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState(null);
  const [publisherFilter, setPublisherFilter] = useState(null);
  const [tagFilter, setTagFilter] = useState([]);
  const [showFilter, setShowFilter] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [drillMenu, setDrillMenu] = useState(null);

  const catalogs = (data.catalogs || []).filter(c => c.visibility === "public");
  const catalogsById = Object.fromEntries(catalogs.map(c => [c.id, c]));
  const allPublicDrills = (data.activityLibrary || []).filter(a => a.sourceCatalogId);
  const sportsAvailable = [...new Set(catalogs.map(c => c.sport))].sort();
  const sportCounts = Object.fromEntries(sportsAvailable.map(s => [s, allPublicDrills.filter(a => a.sport === s).length]));

  const backToSports = () => {
    setSelectedSport(null); setSearch(""); setSourceFilter(null); setPublisherFilter(null);
    setTagFilter([]); setExpandedId(null); setDrillMenu(null);
  };

  if (!selectedSport) {
    return (<div>
      <div className="clbl mb8">Choose a sport to browse</div>
      {sportsAvailable.length === 0 && <div className="empty"><div className="emtx">No public libraries yet.</div></div>}
      {sportsAvailable.map(s => (
        <div key={s} className="li tap" onClick={() => setSelectedSport(s)}>
          <div className="lim"><div className="lin">{s}</div><div className="limt">{sportCounts[s]} drill{sportCounts[s] !== 1 ? "s" : ""}</div></div>
          <span style={{color: "var(--td)", fontSize: 18}}>&#8250;</span>
        </div>
      ))}
    </div>);
  }

  const sportCatalogs = catalogs.filter(c => c.sport === selectedSport);
  const publishers = [...new Set(sportCatalogs.map(c => c.publisherName))];
  let drills = allPublicDrills.filter(a => a.sport === selectedSport);
  if (sourceFilter) drills = drills.filter(a => a.sourceCatalogId === sourceFilter);
  if (publisherFilter) drills = drills.filter(a => catalogsById[a.sourceCatalogId] && catalogsById[a.sourceCatalogId].publisherName === publisherFilter);

  const skillTagsById = Object.fromEntries((data.skillTags || []).map(t => [t.id, t]));
  const tagCounts = {};
  drills.forEach(a => (a.skillTagIds || []).forEach(id => { tagCounts[id] = (tagCounts[id] || 0) + 1; }));
  const availableTags = Object.keys(tagCounts).map(id => skillTagsById[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  if (tagFilter.length) drills = drills.filter(a => (a.skillTagIds || []).some(id => tagFilter.includes(id)));

  const q = search.trim().toLowerCase();
  if (q) drills = drills.filter(a => a.name.toLowerCase().includes(q));
  drills = drills.slice().sort((a, b) => a.name.localeCompare(b.name));

  const assetsById = Object.fromEntries((data.assets || []).map(a => [a.id, a]));
  const equipNames = ids => (ids || []).map(id => assetsById[id] ? assetsById[id].name : null).filter(Boolean);
  const tagNames = ids => (ids || []).map(id => skillTagsById[id] ? skillTagsById[id].name : null).filter(Boolean);
  const hasActiveFilters = sourceFilter || publisherFilter || tagFilter.length > 0;
  const activeFilterCount = (sourceFilter ? 1 : 0) + (publisherFilter ? 1 : 0) + tagFilter.length;
  const clearFilters = () => { setSourceFilter(null); setPublisherFilter(null); setTagFilter([]); };

  return (<div onClick={() => setDrillMenu(null)}>
    <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10}}>
      <button className="btn ghost bxs" onClick={backToSports}>&#8249; {selectedSport}</button>
      {isAdmin && <button className="btn primary bsm" onClick={() => openModal("addActivity", {isPublicLibrary: true})}>+ Add Drill</button>}
    </div>
    <input className="inp" placeholder={"Search " + selectedSport + " drills..."} value={search} onChange={e => setSearch(e.target.value)} style={{marginBottom: 10}}/>
    <div style={{display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12}} onClick={e => e.stopPropagation()}>
      <button className="btn ghost bsm" onClick={() => setShowFilter(true)}>Filter{activeFilterCount > 0 ? " (" + activeFilterCount + ")" : ""}</button>
      {hasActiveFilters && <button className="btn ghost bsm" onClick={clearFilters}>Clear Filters</button>}
    </div>
    {showFilter && <div className="movly" style={{zIndex: 300}} onClick={e => { if (e.target === e.currentTarget) setShowFilter(false); }}>
      <div className="modal">
        <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12}}>
          <div style={{fontFamily: "Barlow Condensed,sans-serif", fontSize: 18, fontWeight: 900}}>Filter</div>
          <button type="button" className="btn ghost bxs" onClick={() => setShowFilter(false)}>Done</button>
        </div>
        {sportCatalogs.length > 1 && (<div className="fld"><label className="lbl">Library Source</label>
          <select className="sel" value={sourceFilter || ""} onChange={e => setSourceFilter(e.target.value || null)}>
            <option value="">All Sources</option>
            {sportCatalogs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>)}
        {publishers.length > 1 && (<div className="fld"><label className="lbl">Publisher</label>
          <select className="sel" value={publisherFilter || ""} onChange={e => setPublisherFilter(e.target.value || null)}>
            <option value="">All Publishers</option>
            {publishers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>)}
        <div className="clbl mb8">Skill Tags</div>
        <div style={{display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10}}>
          {availableTags.map(t => (<button key={t.id} type="button" onClick={() => setTagFilter(p => p.includes(t.id) ? p.filter(x => x !== t.id) : [...p, t.id])} style={{padding: "4px 10px", borderRadius: 20, border: "1.5px solid var(--b)", background: tagFilter.includes(t.id) ? "var(--green)" : "var(--s1)", color: tagFilter.includes(t.id) ? "#fff" : "var(--black)", fontSize: 13, cursor: "pointer"}}>{t.name} <span style={{opacity: .7}}>{tagCounts[t.id]}</span></button>))}
          {availableTags.length === 0 && <span style={{fontSize: 13, color: "var(--td)"}}>No skill tags on these drills.</span>}
        </div>
        {hasActiveFilters && <button type="button" className="btn ghost bxs" onClick={clearFilters}>Clear all filters</button>}
        <button type="button" className="btn primary bmd bfull" style={{marginTop: 14}} onClick={() => setShowFilter(false)}>Done</button>
      </div>
    </div>}
    {drills.length === 0 && <div style={{padding: "40px 0", textAlign: "center", color: "var(--td)", fontSize: 14}}>No drills match{q ? " \"" + search + "\"" : ""}{hasActiveFilters ? " with these filters" : ""}.</div>}
    {drills.map(d => {
      const catalog = catalogsById[d.sourceCatalogId];
      const expanded = expandedId === d.id;
      return (<div key={d.id} className="li" style={{flexDirection: "column", alignItems: "stretch", cursor: "pointer"}} onClick={() => setExpandedId(expanded ? null : d.id)}>
        <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start"}}>
          <div className="lim">
            <div className="lin">{highlightMatch(d.name, q)}</div>
            <div className="limt" style={{color: "var(--green2)"}}>Published by {(catalog && catalog.publisherName) || "Jaxon Leo"}</div>
          </div>
          {isAdmin && <div style={{position: "relative", flexShrink: 0}}>
            <button className="ell-btn" onClick={e => { e.stopPropagation(); setDrillMenu(drillMenu === d.id ? null : d.id); }}><span/><span/><span/></button>
            {drillMenu === d.id && <div className="mini-menu" style={{right: 0}} onClick={e => e.stopPropagation()}>
              <button className="mm-item" onClick={() => { setDrillMenu(null); openModal("editActivity", {activity: d}); }}>Edit</button>
              <button className="mm-item mm-danger" onClick={async () => { setDrillMenu(null); await archiveCatalogDrill(d.id); await refreshLibrary(); }}>Delete</button>
            </div>}
          </div>}
        </div>
        {expanded && <div onClick={e => e.stopPropagation()} style={{marginTop: 8}}>
          {d.description && <div style={{fontSize: 12, color: "var(--td)", marginBottom: 4, lineHeight: 1.4}}>{d.description}</div>}
          {d.coachingPoints && <div style={{fontSize: 12, color: "var(--td)", marginBottom: 4}}>{d.coachingPoints}</div>}
          {d.equipment && d.equipment.length > 0 && <div style={{fontSize: 11, color: "var(--td)", marginTop: 2}}>Needs: {equipNames(d.equipment).join(", ")}</div>}
          {d.grouping && d.grouping !== "whole" && <div style={{fontSize: 11, color: "var(--td)", marginTop: 2}}>{d.grouping === "partners" ? "Partners" : d.numGroups + " groups"}</div>}
          {d.skillTagIds && d.skillTagIds.length > 0 && <div style={{display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4}}>
            {tagNames(d.skillTagIds).map(name => (<span key={name} className="bdg bs" style={{fontSize: 10}}>{name}</span>))}
          </div>}
          <button className="btn outline bxs" style={{marginTop: 8}} onClick={() => doCopy(d)} disabled={copyingId === d.id}>{copyingId === d.id ? "Copying..." : "Copy to My Library"}</button>
        </div>}
      </div>);
    })}
  </div>);
}
