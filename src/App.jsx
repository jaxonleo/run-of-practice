import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext, Suspense } from "react";
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider, Navigate, Outlet, useNavigate, useParams, useBlocker, useSearchParams, useLocation } from "react-router-dom";
import { Analytics } from '@vercel/analytics/react';
import Layout from "./Layout.jsx";
import GoalsScreen from "./components/GoalsScreen.jsx";
import TeamsListScreen from "./components/TeamsListScreen.jsx";
import SettingsScreen from "./components/SettingsScreen.jsx";
import { Ic } from "./icons.jsx";
import { sendEmailOtp, verifyEmailOtp, getCurrentSession, onAuthStateChange, signOut, fetchMyTeams, archivePlayer, archiveStaff, archiveTeam, updatePlayer, setPlayerCategoryNote, fetchLibraryData, fetchLocations, fetchPracticesFull, fetchTemplatesFull, archiveTemplate, savePracticeTree, deactivateOwnAccount, checkDeactivated, reactivateAccount, ensureDefaultSkillTags, fetchOwnProfile, updateOwnProfile, fetchPlannedAbsences, checkIsAdmin, fetchNotesForPlayer, archiveNote, inviteTeamStaff, cancelTeamInvite, findMissingEquipment, resolveDrillEquipmentForCoach, findActiveLiveSession } from "./supabase.js";
import { uid, fmt12, fmt, actSecs, sumMins, shuffle, mkGroups, rebalanceKeep, rebalanceEven, SPORTS, isHeadCoach, canManageTeamInMode, localDateStr, stripIdsForCopy, POSITIONS_BY_SPORT, HAND_FIELDS_BY_SPORT, HAND_LABELS, teamsForMode, homeTeamsForMode, PRACTICE_COMPONENT_TYPES, getVisibleComponentTypes, setVisibleComponentTypes, menuNeedsToOpenUpward, stationIsPlanned, useBigBrowser } from "./constants.js";
import { TwoPane } from "./components/BBShells.jsx";
import ModalLayer, { PositionPicker, HandednessPicker } from "./components/ModalLayer.jsx";
import NewLibraryScreen, { EquipmentTab, AddLocationDialog } from "./components/NewLibraryScreen.jsx";
import { ActConfig, ChecklistConfig, StationConfig, useActivityDnd, ActivityDndContext, SortableActivityRow } from "./components/ActivityConfigs.jsx";
import CommandScreen, { HelperView, HistoryViewer, PreviewView, usePracticePresence, PresenceBadge } from "./components/CommandScreen.jsx";
import MyStationBuilderScreen, { StationPresenceIndicator } from "./components/MyStationBuilder.jsx";
import HomeScreen from "./components/HomeScreen.jsx";
import ScheduleScreen from "./components/ScheduleScreen.jsx";
import AbsencePicker from "./components/AbsencePicker.jsx";
import PermissionsModal from "./components/PermissionsModal.jsx";
import EquipmentMismatchDialog from "./components/EquipmentMismatchDialog.jsx";
import BuilderGoalGuidance from "./components/BuilderGoalGuidance.jsx";
import LandingPage from "./components/LandingPage.jsx";
import { TermsPage, PrivacyPage, FAQPage } from "./components/LegalPages.jsx";
import PricingPage from "./components/PricingPage.jsx";
// Lazy: recharts + its d3-* subpackages are the single largest dependency
// in this app (~9MB unminified) and this is the only screen that uses
// them, gated to founder-admins only -- everyone else was downloading that
// whole payload on first load for a screen they'd never reach. A dynamic
// import means it's only fetched once FounderAdminRoute's own isAdmin
// check has already confirmed this visitor can actually see it.
const FounderMetricsScreen = React.lazy(() => import("./components/FounderMetricsScreen.jsx"));


// "Run Again" copies a past practice's activities into a brand-new one --
// every nested id (activity, station) must be regenerated as a fresh local
// id first, or savePracticeTree's isDbId check would treat them as
// already-saved rows belonging to the OLD practice and silently reparent
// (steal) them instead of inserting real copies. (stripIdsForCopy lives in
// constants.js so ScheduleScreen's own History routing can reuse it too.)

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
.app-content{flex:1;min-width:0;display:flex;flex-direction:column;height:100%;overflow:hidden;}
.screen{flex:1;overflow-y:auto;overflow-x:hidden;padding:14px 14px calc(var(--tab)+80px);scrollbar-width:none;}
.screen::-webkit-scrollbar{display:none;}
.tabbar{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;height:var(--tab);background:var(--s1);border-top:1px solid var(--b);display:flex;z-index:100;padding-bottom:env(safe-area-inset-bottom,0);}
.live-resume{position:fixed;bottom:var(--tab);left:50%;transform:translateX(-50%);width:100%;max-width:480px;z-index:99;background:var(--green);color:#fff;display:flex;align-items:center;justify-content:center;gap:8px;padding:9px 14px;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border:none;border-top:1px solid rgba(255,255,255,.15);}
.ti{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:none;border:none;cursor:pointer;color:var(--td);font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:4px 2px;position:relative;}
.ti.on{color:var(--green);}.ti svg{width:20px;height:20px;stroke-width:1.8;stroke:var(--td);}.ti.on svg{stroke:var(--green);}
/* Active-tab underline: color alone (the icon/label turning green) wasn't
   clear enough per direct feedback -- this makes it unambiguous which of
   the three sections you're actually in, same idea as the team-workspace
   top row's own active underline just below the color strip. */
.ti.on::after{content:"";position:absolute;bottom:0;left:10%;right:10%;height:3px;background:var(--green);border-radius:1px;}
/* Org mode (per-device Coach/Organization toggle): same three tabs, solid
   green bar as the persistent visual cue -- color alone isn't enough for
   accessibility, so Layout.jsx also shows the org name near the top in
   this mode, this is just the tab bar's own look. */
.tabbar.org{background:var(--green);border-top-color:var(--green);}
.tabbar.org .ti{color:rgba(255,255,255,.65);}
.tabbar.org .ti.on{color:#fff;}
.tabbar.org .ti svg{stroke:rgba(255,255,255,.65);}
.tabbar.org .ti.on svg{stroke:#fff;}
.tabbar.org .ti.on::after{background:#fff;}
.phdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.ptitle{font-size:26px;font-weight:900;letter-spacing:.02em;font-family:'Barlow Condensed',sans-serif;}
.card{background:var(--s1);border:1px solid var(--b);border-radius:var(--r);padding:14px;margin-bottom:10px;}
.clbl{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--td);margin-bottom:8px;}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:none;border-radius:var(--rs);cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;transition:opacity .12s;}
/* Real gap found live: every color variant (.primary/.outline/...) sets its
   own solid background/color with no disabled override, so a disabled
   button (e.g. Goals' Save, gated on totals summing to exactly 100%) was
   functionally inert but looked completely identical to an enabled one --
   a coach could tap it, see nothing happen, and have no visual cue why. */
.btn:disabled{opacity:.4;cursor:not-allowed;}
.btn:active{opacity:.7;}
.bxs{padding:4px 10px;font-size:11px;min-height:28px;}.bsm{padding:7px 14px;font-size:13px;min-height:34px;}.bmd{padding:10px 18px;font-size:15px;min-height:40px;}.blg{padding:14px 20px;font-size:17px;min-height:50px;}
/* Real gap found live: referenced by Home's hero CTAs (Plan/Review/Start
   Practice) and a few other primary actions, but never actually defined --
   .btn's base rules have no padding at all, so every "bxl" button silently
   fell back to exactly text-sized with zero padding. One size up from
   .blg, matching the same padding/font-size/min-height progression. */
.bxl{padding:16px 22px;font-size:18px;min-height:54px;}
.primary{background:var(--green);color:#fff;}.primary:active{background:var(--green2);}
.ghost{background:var(--s2);color:var(--black2);border:1px solid var(--b);}.ghost:active{background:var(--s3);}
.danger{background:var(--rbg);color:var(--red);border:1px solid var(--rb);}
.success{background:var(--gbg);color:var(--green);border:1px solid var(--gb);}
.outline{background:#fff;color:var(--green);border:1.5px solid var(--green);}.outline:active{background:var(--gbg);}
.warn{background:var(--ambg);color:var(--amber);border:1px solid var(--ambb);}
.brow{display:flex;gap:8px;}.brow .btn{flex:1;}.bfull{width:100%;}
.fld{margin-bottom:10px;}
.lbl{display:block;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--td);margin-bottom:4px;}
.inp,.sel,.ta{width:100%;background:#fff;border:1.5px solid var(--b);border-radius:var(--rs);color:var(--black);padding:10px 12px;font-family:'Barlow',sans-serif;font-size:16px;-webkit-appearance:none;}
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
.pill.exceeds{background:var(--ambg);border-color:var(--ambb);color:var(--amber);}
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
.live{display:inline-block;width:7px;height:7px;min-width:7px;flex-shrink:0;border-radius:50%;background:var(--green);animation:pulse 1.5s infinite;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.loadmark-hand{transform-origin:50px 50px;animation:tick 1.2s linear infinite;}
@keyframes tick{to{transform:rotate(360deg)}}
.row{display:flex;align-items:center;gap:8px;}
.mt6{margin-top:6px;}.mt8{margin-top:8px;}.mb8{margin-bottom:8px;}.mb10{margin-bottom:10px;}
.td{color:var(--td);}.tm{color:var(--tm);}.tg{color:var(--green);}
.att-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;}
.att-btn{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid var(--b);border-radius:8px;cursor:pointer;background:var(--s2);text-align:left;width:100%;}
.att-btn.on{background:var(--gbg);border-color:var(--green);}
.att-btn-dark{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.15);}
.att-btn-dark.on{background:rgba(82,183,136,.18);border-color:#52b788;}
/* Direct feedback (Practice Setup): the normal 10px/12px tiles only fit a
   handful of names per screen -- a compact variant with tighter padding and
   a smaller circle so more of a full roster is visible at once without
   scrolling as much. */
.att-btn-compact{padding:6px 10px;gap:8px;}
.att-circle-sm{width:20px;height:20px;}
/* Real bug found live ("unselected circle disappears instead of showing
   blank"): the unchecked state's background referenced --b2, a CSS custom
   property never actually defined anywhere in :root -- an undefined var()
   with no fallback resets the background to transparent, so the circle
   rendered fully invisible (not merely unstyled) against any background,
   light or dark, rather than a visibly "blank/empty" circle. */
.att-circle{width:26px;height:26px;border-radius:50%;background:var(--s3);border:1.5px solid var(--b);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-sizing:border-box;}
.att-circle.on{background:var(--green);border-color:var(--green);}
.att-circle-dark{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.25);}
.att-circle-dark.on{background:#52b788;border-color:#52b788;}
.ccs{display:flex;flex-direction:column;height:100%;overflow:hidden;padding-bottom:0;}
.cc-header{padding:8px 14px;background:var(--s1);border-bottom:1px solid var(--b);display:flex;flex-direction:column;align-items:stretch;flex-shrink:0;}
.cc-header-top{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.cc-act-name{font-family:'Barlow Condensed',sans-serif;font-size:34px;font-weight:900;line-height:1;margin:6px 0 2px;width:100%;}
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
/* Direct feedback: Up Next used to just be another card in the same
   flex-gap stack as the current drill's own content, easy to read as a
   continuation of it rather than a preview of something different. A
   labeled divider above (cc-queue-hdr, in the eyebrow-header/thin-line
   pattern used for section breaks elsewhere) plus a real border on the
   card itself gives it its own visual identity. */
.cc-queue-hdr{display:flex;align-items:center;gap:8px;margin-top:6px;}
.cc-queue-hdr-label{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green);flex-shrink:0;}
.cc-queue-hdr-line{flex:1;height:1px;background:var(--b);}
.cc-queue{background:var(--s1);border:1.5px solid var(--b);border-radius:var(--r);overflow:hidden;margin-top:8px;}
.cc-queue-item{padding:10px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--b);}
.cc-queue-item:last-child{border-bottom:none;}
.cc-note-bar{padding:6px 14px;display:flex;gap:7px;flex-shrink:0;background:var(--s1);border-top:1px solid var(--b);}
.cc-end{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;text-align:center;flex:1;}
.cl-item{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid var(--b);cursor:pointer;}
.cl-item:last-child{border-bottom:none;}
.cl-check{width:26px;height:26px;border-radius:50%;border:2px solid var(--b);background:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
.cl-check.done{background:var(--green);border-color:var(--green);}
.cl-text{font-size:16px;line-height:1.5;flex:1;}.cl-text.done{text-decoration:line-through;color:var(--td);}
/* Practice plan PDF export (PracticePlanPrint.jsx): print only that one
   subtree, regardless of what else is mounted in the SPA at the time --
   simplest robust way to get a clean, selectable-text "PDF" out of a
   React app is the browser's own Print to PDF, not a client-side PDF
   library. .no-print elements (the toolbar) never print even though
   they're inside the print root. */
@media print{
  body *{visibility:hidden!important;}
  #rop-print-root,#rop-print-root *{visibility:visible!important;}
  #rop-print-root{position:absolute;top:0;left:0;width:100%;margin:0;padding:0;}
  #rop-print-root .no-print{display:none!important;}
  @page{margin:0.5in;}
}

/* ── Big Browser (BB) layouts (forty-ninth session) ───────────────────────
   Scoped entirely under .bb (set on .app by Layout.jsx via useBigBrowser(),
   constants.js) or the new .bb-* shell classes (BBShells.jsx). Nothing
   above this line is ever edited for BB reasons -- see BUILD-STATUS.md's
   Working Conventions for why (it's the single most effective guard
   against a mobile regression from this pass). */
.bb.app{max-width:none;flex-direction:row;}
.bb .screen{padding:20px 28px 28px;}
/* Rail replaces the bottom tab bar at BB: same GLOBAL_TABS array and same
   active-state checks as the mobile bar (Layout.jsx), just a fixed-width
   column instead of a fixed-position bottom row. A normal flex child here,
   not position:fixed -- .app already clips overflow at a fixed 100dvh
   height, so nothing needs to be pulled out of flow to stay visible. */
.bb .tabbar{position:static;left:auto;bottom:auto;transform:none;width:88px;max-width:88px;height:100%;flex-direction:column;justify-content:flex-start;align-items:stretch;gap:6px;padding:20px 0 12px;border-top:none;border-right:1px solid var(--b);flex-shrink:0;}
.bb .ti{flex:0 0 auto;padding:10px 4px;}
.bb .ti.on::after{content:"";position:absolute;left:0;right:auto;top:14%;bottom:14%;width:3px;height:auto;background:var(--green);border-radius:0 2px 2px 0;}
.bb .rail-gear{margin-top:auto;}
/* Live-resume and the join bar must stay reachable at BB, not hidden under
   the rail or squeezed to a fixed 480px width -- normal content-column
   children instead of viewport-fixed overlays. */
.bb .live-resume{position:static;left:auto;bottom:auto;transform:none;width:100%;max-width:none;flex-shrink:0;}
/* Bottom-sheet overlays (SkillTagPicker, move-pickers, PermissionsModal,
   etc.) become centered dialogs at BB -- same .movly/.modal components,
   same open/close state and tryClose guards, style only. */
.bb .movly{align-items:center;padding:24px;}
.bb .modal{border-radius:16px;max-width:560px;max-height:82dvh;}

/* Shared shells (BBShells.jsx) -- layout only, no state/logic. */
.bb-two-pane{display:flex;gap:18px;height:100%;min-height:0;}
.bb-pane{flex:1;min-width:0;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.bb-centered-page{max-width:820px;margin:0 auto;width:100%;}
/* Opt-in per screen when it adopts TwoPane at BB, so the screen's own outer
   container fills .screen's height instead of growing with content -- that
   is what lets each pane's own overflow-y:auto actually engage instead of
   .screen scrolling the whole thing as one column. */
.bb-fill-height{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;}
/* Teams list at BB: same .li/.lin/.limt cards, arranged as a reflowing
   grid (2-3 columns depending on width) instead of one narrow column. */
.bb-teams-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;}
.bb-teams-grid .li{margin-bottom:0;}
/* Goals & Insights Trends at BB: GoalTrendCards in a fixed 2-up grid
   (not auto-fill -- the handoff's own spec calls for exactly 2 columns). */
.bb-trend-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.bb-trend-grid .card{margin-bottom:0;}
`;

// Shared app state (data, coachId, navigation helpers, etc.) for every route
// wrapper below Layout -- the router is created once via useMemo (recreating
// it on every render would reset navigation state), so route elements can't
// close over fresh render-time values directly. Route wrapper components
// read this instead of receiving props from a re-rendered parent.
export const AppCtx=createContext(null);
export const useAppCtx=()=>useContext(AppCtx);

// Small header repeated at the top of the Roster and Equipment routes --
// team name/sport/player-count with the same colored-left-border "themed"
// treatment TeamsListScreen and the old ManageScreen both already used.
// Layout.jsx's own team-name header (above the new top tab row) is a
// smaller, secondary label; this bigger one is the actual page identity for
// these two routes, same as it always was under the old Team tab.
function AuthScreen({onBack}){
  const [email,setEmail]=useState("");
  const [code,setCode]=useState("");
  const [sent,setSent]=useState(false);
  const [sending,setSending]=useState(false);
  const [verifying,setVerifying]=useState(false);
  const [error,setError]=useState("");
  const send=async()=>{
    if(!email.trim()||sending)return;
    setSending(true);setError("");
    const { error }=await sendEmailOtp(email.trim());
    setSending(false);
    if(error){setError(error.message||"Something went wrong. Try again.");return;}
    setSent(true);
  };
  const verify=async()=>{
    if(!code.trim()||verifying)return;
    setVerifying(true);setError("");
    let { error }=await verifyEmailOtp(email.trim(),code.trim());
    if(error){
      // Observed in the wild: the very first verify of an otherwise-correct
      // code fails, and resubmitting the identical code immediately after
      // succeeds -- a transient hiccup on that first call, not a wrong or
      // stale code (same string both times). One silent retry means the
      // coach never has to notice or resubmit by hand.
      await new Promise(r=>setTimeout(r,800));
      ({ error }=await verifyEmailOtp(email.trim(),code.trim()));
    }
    setVerifying(false);
    if(error){
      // If the first attempt actually succeeded server-side and only the
      // response was lost, the retry above would fail with "already used"
      // even though we're signed in -- don't show an error in that case.
      const existing=await getCurrentSession();
      if(existing)return;
      setError(error.message||"That code didn't work. Check it and try again.");
      return;
    }
    // onAuthStateChange picks up the new session automatically.
  };
  return (<div style={{height:"100dvh",display:"flex",flexDirection:"column",background:"var(--black)",overflowY:"auto"}}>
    {onBack&&<button onClick={onBack} style={{position:"absolute",top:16,left:16,background:"rgba(255,255,255,.08)",border:"none",borderRadius:"50%",width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#fff",fontSize:18,zIndex:10}}>&#8249;</button>}
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px 24px"}}>
      <div style={{width:96,height:96,borderRadius:22,overflow:"hidden",marginBottom:20,boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}>
        <img src="/apple-touch-icon.png" style={{width:"100%",height:"100%",objectFit:"cover"}} alt="Run of Practice"/>
      </div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:38,fontWeight:900,color:"#fff",letterSpacing:"-.01em",lineHeight:1,marginBottom:6,textAlign:"center"}}>Run of Practice</div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:14,fontWeight:600,letterSpacing:".12em",textTransform:"uppercase",color:"var(--green)",textAlign:"center"}}>Organize. Execute. Elevate.</div>
    </div>
    <div style={{background:"#fff",borderRadius:"24px 24px 0 0",padding:"28px 20px 48px"}}>
      <div style={{width:36,height:4,background:"var(--b)",borderRadius:2,margin:"0 auto 24px"}}/>
      {!sent&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,marginBottom:4}}>Welcome, Coach</div>
        <div style={{fontSize:14,color:"var(--td)",marginBottom:20}}>Enter your email. We'll send you a sign-in code.</div>
        <div className="fld mb10">
          <label className="lbl">Email</label>
          <input className="inp" autoFocus type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")send();}}/>
        </div>
        {error&&<div style={{fontSize:13,color:"var(--red)",marginBottom:10}}>{error}</div>}
        <button className="btn primary bmd bfull" onClick={send} disabled={!email.trim()||sending}>{sending?"Sending...":"Send Code"}</button>
        <div style={{fontSize:11,color:"var(--td)",marginTop:12,textAlign:"center",lineHeight:1.5}}>By continuing you agree to our <a href="/terms" style={{color:"var(--green)"}}>Terms</a> and <a href="/privacy" style={{color:"var(--green)"}}>Privacy Policy</a>.</div>
      </div>}
      {sent&&<div>
        <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900,marginBottom:4}}>Enter your code</div>
        <div style={{fontSize:14,color:"var(--td)",marginBottom:20,lineHeight:1.5}}>We sent a code to <strong>{email}</strong>. Enter the full code exactly as it appears in the email.</div>
        <div className="fld mb10">
          <label className="lbl">Code</label>
          <input className="inp" autoFocus type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="Enter code" value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")verify();}}/>
        </div>
        {error&&<div style={{fontSize:13,color:"var(--red)",marginBottom:10}}>{error}</div>}
        <button className="btn primary bmd bfull" onClick={verify} disabled={!code.trim()||verifying} style={{marginBottom:10}}>{verifying?"Verifying...":"Verify & Sign In"}</button>
        <button className="btn ghost bmd bfull" onClick={()=>{setSent(false);setCode("");setError("");}}>Use a different email</button>
      </div>}
    </div>
  </div>);
}
function NameScreen({onSave}){
  const [firstName,setFirstName]=useState("");
  const [lastName,setLastName]=useState("");
  const [saving,setSaving]=useState(false);
  const save=async()=>{
    if(!firstName.trim()||saving)return;
    setSaving(true);
    await onSave(firstName.trim(),lastName.trim());
    setSaving(false);
  };
  return (<div style={{height:"100dvh",display:"flex",flexDirection:"column",background:"var(--black)",overflowY:"auto"}}>
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px 24px"}}>
      <div style={{width:96,height:96,borderRadius:22,overflow:"hidden",marginBottom:20,boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}>
        <img src="/apple-touch-icon.png" style={{width:"100%",height:"100%",objectFit:"cover"}} alt="Run of Practice"/>
      </div>
      <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:28,fontWeight:900,color:"#fff",letterSpacing:"-.01em",lineHeight:1,marginBottom:6,textAlign:"center"}}>What should we call you?</div>
    </div>
    <div style={{background:"#fff",borderRadius:"24px 24px 0 0",padding:"28px 20px 48px"}}>
      <div style={{width:36,height:4,background:"var(--b)",borderRadius:2,margin:"0 auto 24px"}}/>
      <div className="fld mb10">
        <label className="lbl">First name*</label>
        <input className="inp" autoFocus type="text" placeholder="Alex" value={firstName} onChange={e=>setFirstName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")save();}}/>
      </div>
      <div className="fld mb10">
        <label className="lbl">Last name</label>
        <input className="inp" type="text" placeholder="Rivera" value={lastName} onChange={e=>setLastName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")save();}}/>
      </div>
      <div style={{fontSize:12,color:"var(--td)",marginBottom:16}}>* required</div>
      <button className="btn primary bmd bfull" onClick={save} disabled={!firstName.trim()||saving}>{saving?"Saving...":"Continue"}</button>
    </div>
  </div>);
}
// Shown on sign-in for an account that deactivated itself last time --
// replaces the old silent auto-reactivate (see checkDeactivated/
// reactivateAccount in supabase.js). "Exit" signs back out rather than
// leaving the coach stuck looking at a screen with only one working
// button; nothing changes server-side unless Reactivate is actually tapped.
function ReactivatePrompt({onReactivate,onExit,busy}){
  return (<div style={{height:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"var(--black)",padding:"24px"}}>
    <div style={{width:96,height:96,borderRadius:22,overflow:"hidden",marginBottom:20,boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}>
      <img src="/apple-touch-icon.png" style={{width:"100%",height:"100%",objectFit:"cover"}} alt="Run of Practice"/>
    </div>
    <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:24,fontWeight:900,color:"#fff",textAlign:"center",marginBottom:8}}>Reactivate your account?</div>
    <div style={{fontSize:14,color:"var(--td)",textAlign:"center",lineHeight:1.5,marginBottom:24,maxWidth:340}}>Your account is currently deactivated. Reactivating brings you back onto your teammates' rosters and picks up right where you left off.</div>
    <button className="btn primary bmd bfull" style={{maxWidth:340,marginBottom:10}} onClick={onReactivate} disabled={busy}>{busy?"Reactivating...":"Reactivate My Account"}</button>
    <button className="btn ghost bmd bfull" style={{maxWidth:340,color:"#fff",borderColor:"rgba(255,255,255,.25)"}} onClick={onExit} disabled={busy}>Exit Without Reactivating</button>
  </div>);
}
export default function App(){
  useEffect(()=>{let el=document.getElementById('rop-css');if(!el){el=document.createElement('style');el.id='rop-css';document.head.appendChild(el);}el.textContent=CSS;},[]);
  const [loaded,setLoaded]=useState(false);
  const [modal,setModal]=useState(null);
  const [liveId,setLiveId]=useState(null);
  const [editPracticeId,setEditPracticeId]=useState(null);
  const [startTemplateId,setStartTemplateId]=useState(null);
  const [session,setSession]=useState(undefined); // undefined=loading, null=signed out, object=signed in
  const [wantsAuth,setWantsAuth]=useState(false);
  useEffect(()=>{
    getCurrentSession().then(setSession);
    const sub=onAuthStateChange(s=>setSession(s));
    return ()=>sub.unsubscribe();
  },[]);
  const coachId=session?session.user.id:null;
  // Real-usage feedback: silently clearing deactivated_at on sign-in (no
  // prompt at all) was surprising -- a coach signed back in, went to check
  // something else, and only later realized their account had quietly come
  // back to life. null=not checked yet, true=deactivated (show the prompt
  // below), false=not deactivated (or already reactivated this session).
  const [needsReactivationCheck,setNeedsReactivationCheck]=useState(null);
  useEffect(()=>{
    if(!coachId){setNeedsReactivationCheck(null);return;}
    checkDeactivated(coachId).then(setNeedsReactivationCheck);
  },[coachId]);
  const [reactivating,setReactivating]=useState(false);
  const doReactivate=useCallback(async()=>{
    setReactivating(true);
    await reactivateAccount(coachId);
    setReactivating(false);
    setNeedsReactivationCheck(false);
  },[coachId]);
  // Idempotent server-side, so re-running on every sign-in is cheap and
  // means a coach picks up starter skill tags for any sport/category added
  // after their account was first created, not just at signup.
  useEffect(()=>{if(coachId)ensureDefaultSkillTags(coachId);},[coachId]);
  const [profile,setProfile]=useState(null);
  useEffect(()=>{
    if(!coachId){setProfile(null);return;}
    fetchOwnProfile(coachId).then(setProfile);
  },[coachId]);
  const saveName=useCallback(async(firstName,lastName)=>{
    await updateOwnProfile(coachId,{firstName,lastName});
    setProfile(p=>Object.assign({},p,{first_name:firstName,last_name:lastName||null}));
  },[coachId]);
  const handleDeactivate=useCallback(async()=>{
    await deactivateOwnAccount(coachId);
    await signOut();
  },[coachId]);
  const [teams,setTeams]=useState([]);
  const refreshTeams=useCallback(async()=>{
    if(!coachId)return;
    setTeams(await fetchMyTeams());
  },[coachId]);
  const [library,setLibrary]=useState({assets:[],skillCategories:[],skillTags:[],activityLibrary:[],myOrgs:[],pendingOrgInvites:[],pendingTeamDepartures:[],pendingTeamInvites:[],profilesById:{}});
  const refreshLibrary=useCallback(async()=>{
    if(!coachId)return;
    setLibrary(await fetchLibraryData());
  },[coachId]);
  const [planning,setPlanning]=useState({locations:[],practices:[],templates:[]});
  const refreshPlanning=useCallback(async()=>{
    if(!coachId)return;
    const [locations,practices,templates]=await Promise.all([fetchLocations(),fetchPracticesFull(),fetchTemplatesFull()]);
    setPlanning({locations,practices,templates});
  },[coachId]);
  // Single combined load gate -- `loaded` used to flip once the (now-removed)
  // legacy app_data blob resolved; teams/library/planning are the real data
  // sources, so it waits on all three instead. allSettled, not all -- a
  // rejection in any one of these must never hang the loading screen forever
  // (the old app_data-based gate was fully decoupled from these fetches, so
  // this failure mode didn't exist before; each fetch already handles its
  // own query-level errors internally and returns a safe empty default).
  useEffect(()=>{
    if(!coachId){setLoaded(false);return;}
    setLoaded(false);
    Promise.allSettled([refreshTeams(),refreshLibrary(),refreshPlanning()]).then(results=>{
      results.forEach((r,i)=>{if(r.status==="rejected")console.error(["refreshTeams","refreshLibrary","refreshPlanning"][i]+" failed:",r.reason);});
      setLoaded(true);
    });
  },[coachId,refreshTeams,refreshLibrary,refreshPlanning]);
  // Real bug (direct feedback): a head coach already signed in and sitting
  // on Home never learned an assistant had accepted their invite -- teams/
  // library are fetched once at login and never refetched in response to
  // someone else's write (no realtime subscription on team_staff/team_
  // invites/team_join_notices), so the "X accepted your invite" card and
  // any updated permission a coach granted elsewhere just sat stale until
  // the coach manually reloaded or fully quit and reopened the app (a fresh
  // mount is the only thing that re-fetches). Cheaper than standing up a
  // realtime channel for every table this could touch: refetch teams+
  // library whenever the tab regains the foreground (covers both
  // "backgrounded, then came back" and literally reopening the app) plus a
  // periodic fallback for a tab that's stayed open and foregrounded a
  // while, so notices and permission changes surface without a manual
  // reload either way.
  useEffect(()=>{
    if(!coachId)return;
    const refreshIfVisible=()=>{if(document.visibilityState==="visible"){refreshTeams();refreshLibrary();}};
    document.addEventListener("visibilitychange",refreshIfVisible);
    const iv=setInterval(refreshIfVisible,60000);
    return()=>{document.removeEventListener("visibilitychange",refreshIfVisible);clearInterval(iv);};
  },[coachId,refreshTeams,refreshLibrary]);
  const data=useMemo(()=>Object.assign({teams},library,planning),[teams,library,planning]);

  // Coach vs Organization mode (persisted per device -- a director doing
  // org work daily shouldn't have to re-toggle every launch). {type:'coach'}
  // or {type:'org',orgId} rather than a plain boolean, since a director can
  // belong to more than one org (the whole reason org_staff/multi-org drill
  // sharing exist) -- this shape extends to an org picker without rework.
  const [mode,setMode]=useState(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem("rop_mode")||"null");
      if(saved&&saved.type==="org"&&saved.orgId)return saved;
    }catch(e){}
    return {type:"coach"};
  });
  useEffect(()=>{try{localStorage.setItem("rop_mode",JSON.stringify(mode));}catch(e){}},[mode]);
  // Guard against a persisted org the coach is no longer a director of
  // (left, or it was archived) -- falls back to Coach mode instead of
  // showing a broken/empty org view. Gated on `loaded`, not just the
  // presence of `library.myOrgs` -- that array starts as `[]` (its useState
  // default) well before the real fetch resolves, and `[]&&![].some(...)`
  // is trivially true, so this used to fire on every fresh page load and
  // wrongly reset a real, valid Org mode selection back to Coach mode
  // before refreshLibrary() had a chance to populate the real list. Real
  // bug, found live: reloading while in Org mode silently dropped back to
  // Coach mode every time.
  useEffect(()=>{
    if(loaded&&mode.type==="org"&&library.myOrgs&&!library.myOrgs.some(o=>o.id===mode.orgId))setMode({type:"coach"});
  },[loaded,library.myOrgs]);
  const openModal=(t,p)=>setModal({type:t,payload:p||{}});
  const closeModal=()=>setModal(null);
  const coachName=profile&&profile.first_name?profile.first_name:(session?(session.user.email||"Coach"):"Coach");
  const coachEmailStr=profile&&profile.email?profile.email:(session?session.user.email:"");

  // Router is created once (empty deps) -- recreating it on every render
  // would reset in-flight navigation/blocker state. Route elements read
  // current data/callbacks from AppCtx instead of closing over this render's
  // values. /live/:token, /preview/:token, /terms, /privacy are top-level
  // siblings of the authed shell (not nested under it) so they render
  // regardless of auth/loading state, exactly like the old regex checks did.
  const router=useMemo(()=>createBrowserRouter(createRoutesFromElements(
    <>
      <Route path="/live/:token" element={<HelperViewRoute/>}/>
      <Route path="/preview/:token" element={<PreviewViewRoute/>}/>
      <Route path="/terms" element={<TermsPage/>}/>
      <Route path="/privacy" element={<PrivacyPage/>}/>
      <Route path="/faq" element={<FAQPage/>}/>
      {/* Not linked from anywhere yet (landing page, footer, nav) -- Jax
          wants the URL to exist for direct review before it's promoted.
          Same top-level-sibling pattern as /terms|/privacy|/faq: renders
          regardless of auth/loading state. */}
      <Route path="/pricing" element={<PricingPage/>}/>
      <Route path="/*" element={<AuthedShell/>}>
        <Route path="admin/metrics" element={<FounderAdminRoute/>}/>
        <Route element={<LayoutRoute/>}>
          <Route index element={<HomeRoute/>}/>
          <Route path="library" element={<LibraryRoute/>}/>
          <Route path="teams" element={<TeamsRoute/>}/>
          <Route path="settings" element={<SettingsRoute/>}/>
          <Route path="builder/:practiceId" element={<BuilderRoute/>}/>
          <Route path="run/:practiceId" element={<RunRoute/>}/>
          {/* Step-3 bridge only: the old cross-team Schedule screen, reachable
              until step 4 (Snapshot/handoff §4.4) folds it into
              /team/:teamId/schedule and Home's own agenda. Not in the
              handoff's §4.1 route list -- remove once step 4 lands. */}
          <Route path="schedule" element={<ScheduleLegacyRoute/>}/>
          <Route path="team/:teamId" element={<TeamIndexRedirect/>}/>
          <Route path="team/:teamId/schedule" element={<TeamScheduleRoute/>}/>
          <Route path="team/:teamId/roster" element={<TeamRosterRoute/>}/>
          <Route path="team/:teamId/equipment" element={<TeamEquipmentRoute/>}/>
          <Route path="team/:teamId/goals" element={<TeamGoalsRoute/>}/>
        </Route>
      </Route>
    </>
  )),[]);

  const ctxValue=useMemo(()=>({
    data,coachId,profile,coachName,coachEmail:coachEmailStr,
    session,wantsAuth,setWantsAuth,loaded,
    openModal,closeModal,modal,
    refreshTeams,refreshLibrary,refreshPlanning,
    saveName,onSignOut:signOut,onDeactivate:handleDeactivate,
    mode,setMode,
    needsReactivationCheck,doReactivate,reactivating,
  }),[data,coachId,profile,coachName,coachEmailStr,session,wantsAuth,loaded,modal,refreshTeams,refreshLibrary,refreshPlanning,saveName,handleDeactivate,mode,needsReactivationCheck,doReactivate,reactivating]);

  return (<AppCtx.Provider value={ctxValue}>
    <RouterProvider router={router}/>
    <Analytics />
  </AppCtx.Provider>);
}

// Shared full-screen loading mark -- there are three separate "we don't
// know yet" gates before the app can render anything (is there a session
// at all? is this user an admin? has their team/library/planning data come
// back?), and they used to look different from each other (a bare "Loading..."
// vs. this ticking-mark one) purely because the graphic was added to only
// one of them at first. Same mark, same message style, everywhere now.
function LoadingScreen({message}){
  return (<div style={{height:"100dvh",display:"flex",flexDirection:"column",gap:18,alignItems:"center",justifyContent:"center",background:"var(--black)"}}>
    <svg width="72" height="72" viewBox="0 0 100 100">
      <rect x="42" y="0" width="16" height="10" rx="5" fill="#fff" opacity=".85"/>
      <rect x="68" y="6" width="16" height="9" rx="4.5" fill="#fff" opacity=".85" transform="rotate(35 76 10)"/>
      <circle cx="50" cy="50" r="40" fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="5"/>
      <path d="M 78 76 A 40 40 0 0 0 90 50" fill="none" stroke="var(--green2)" strokeWidth="5" strokeLinecap="round"/>
      <g className="loadmark-hand">
        <line x1="50" y1="50" x2="50" y2="20" stroke="var(--green)" strokeWidth="6" strokeLinecap="round"/>
      </g>
      <circle cx="50" cy="50" r="5" fill="var(--green)"/>
    </svg>
    <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:18,fontWeight:700,color:"var(--green)"}}>{message}</div>
  </div>);
}

// ── Route wrappers ───────────────────────────────────────────────────────────
// Thin components so the router config above can stay a stable, one-time
// tree while still reading live data via AppCtx. None of the screens they
// render (HomeScreen, ScheduleScreen, etc.) had their own internals touched
// beyond swapping setView/setLiveId/setEditPracticeId navigation call sites
// for goToBuilder/goToRun/goHome (handoff §4, "ship with existing screens
// mounted before touching their internals").

function AuthedShell(){
  const ctx=useAppCtx();
  const {session,wantsAuth,setWantsAuth,profile,saveName,loaded,needsReactivationCheck,doReactivate,reactivating,onSignOut}=ctx;
  const [liveId,setLiveId]=useState(null);
  const [editPracticeId,setEditPracticeId]=useState(null);
  const [startTemplateId,setStartTemplateId]=useState(null);
  const [presetTeamId,setPresetTeamId]=useState(null);
  // Nav restructure round 3: a sub-view drilled into from a team-workspace
  // tab (Practice Detail, History, Session History, Player Profile) no
  // longer renders its own Back button inline -- that put it below the
  // team-name bar and workspace tabs, buried under chrome that doesn't
  // change when you drill in. Whichever sub-view is currently showing
  // registers {onBack} here; Layout.jsx renders it in the colored bar
  // instead. null when nothing's registered (default rendering resumes).
  const [subViewBack,setSubViewBack]=useState(null);
  const navigate=useNavigate();
  const [searchParams]=useSearchParams();
  // Email CTAs (org invite, staff-added) link to "/?signin=1" so a signed-out
  // recipient lands straight on the sign-in form instead of the marketing
  // landing page they'd otherwise have to click through first.
  useEffect(()=>{if(searchParams.get("signin"))setWantsAuth(true);},[searchParams,setWantsAuth]);
  // presetTeamId (nav restructure round 2): Plan's Build tab already knows
  // which team it's for -- without this, a new practice defaults to
  // data.teams[0], which is wrong the moment a coach has more than one team
  // and starts from a team's own Plan tab instead of the old flat Manage
  // team-picker.
  // navState (Development Pulse's deep link into an already-expanded Goal
  // Guidance section) is forwarded to navigate()'s own location.state --
  // separate from setEditPracticeId/etc. above, which prime BuilderScreen's
  // own state synchronously before it ever mounts, per this function's
  // whole reason for existing (see BuilderRoute's comment: routing straight
  // through react-router's navigate() with only URL params, skipping this,
  // is what left BuilderScreen's useState initializers seeing a stale null
  // editPracticeId on first render).
  const goToBuilder=useCallback((practiceId,templateId,teamId,navState)=>{
    setEditPracticeId(practiceId||null);
    setStartTemplateId(templateId||null);
    setPresetTeamId(practiceId?null:(teamId||null));
    navigate("/builder/"+(practiceId||"new"),navState?{state:navState}:undefined);
  },[navigate]);
  const goToRun=useCallback(practiceId=>{
    setLiveId(practiceId||null);
    navigate("/run/"+(practiceId||"new"));
  },[navigate]);
  const goHome=useCallback(()=>navigate("/"),[navigate]);
  // Step-3 bridge only (see the /schedule route comment above) -- retire
  // once step 4 folds Schedule into /team/:teamId/schedule.
  const goToSchedule=useCallback(()=>navigate("/schedule"),[navigate]);
  const goToTeam=useCallback(teamId=>navigate("/team/"+teamId+"/schedule"),[navigate]);
  const goToSettings=useCallback(()=>navigate("/settings"),[navigate]);

  // Loading initial session
  if(session===undefined)return <LoadingScreen message="Loading..."/>;
  // Landing-page addendum §1: "/" is adaptive on session state -- an
  // installed PWA icon's start_url stays "/" and keeps launching straight
  // into the app for a signed-in user, while a signed-out visitor sees the
  // marketing pitch instead of a dead-end sign-in form. Both CTAs on the
  // landing page lead to the same AuthScreen (wantsAuth), just weighted
  // differently.
  if(!session)return wantsAuth?(<AuthScreen onBack={()=>setWantsAuth(false)}/>):(<LandingPage onGetStarted={()=>setWantsAuth(true)}/>);
  // Deactivated-account prompt: checkDeactivated hasn't resolved yet
  // (null) reads the same as the initial session-loading gate above; a
  // real "yes, deactivated" (true) blocks everything else until the coach
  // actually decides, rather than silently reactivating for them.
  if(needsReactivationCheck===null)return <LoadingScreen message="Loading..."/>;
  if(needsReactivationCheck)return <ReactivatePrompt onReactivate={doReactivate} onExit={onSignOut} busy={reactivating}/>;
  // One-time name prompt -- covers both fresh signups and pre-existing
  // accounts created before name collection existed.
  if(profile&&!profile.first_name)return (<NameScreen onSave={saveName}/>);
  // Show data loading spinner after auth but before data loaded
  if(!loaded)return <LoadingScreen message="Loading your data..."/>;

  return (<AppCtx.Provider value={{...ctx,liveId,setLiveId,editPracticeId,setEditPracticeId,startTemplateId,setStartTemplateId,presetTeamId,setPresetTeamId,subViewBack,setSubViewBack,goToBuilder,goToRun,goHome,goToSchedule,goToTeam,goToSettings}}>
    <Outlet/>
    {ctx.modal&&<ModalLayer modal={ctx.modal} data={ctx.data} closeModal={ctx.closeModal} refreshTeams={ctx.refreshTeams} refreshLibrary={ctx.refreshLibrary} refreshPlanning={ctx.refreshPlanning} coachId={ctx.coachId}/>}
  </AppCtx.Provider>);
}

function LayoutRoute(){
  const {data,liveId,goToRun,mode,openModal,subViewBack,coachId}=useAppCtx();
  return <Layout data={data} liveId={liveId} goToRun={goToRun} mode={mode} openModal={openModal} subViewBack={subViewBack} coachId={coachId}/>;
}

// Founder-only gate. Settings shows a "Founder Metrics" row only when
// checkIsAdmin() resolves true, so this is otherwise unreachable via nav.
// The real enforcement is server-side (is_admin() inside every
// admin_metrics_* RPC); this redirect is UX only, and deliberately gives
// no "admin exists" hint to a non-founder who lands here.
function FounderAdminRoute(){
  const [isAdmin,setIsAdmin]=useState(null);
  useEffect(()=>{checkIsAdmin().then(setIsAdmin);},[]);
  if(isAdmin===null)return <LoadingScreen message="Loading..."/>;
  if(!isAdmin)return <Navigate to="/" replace/>;
  return <Suspense fallback={<LoadingScreen message="Loading..."/>}><FounderMetricsScreen/></Suspense>;
}

function HelperViewRoute(){ const {token}=useParams(); return <HelperView token={token}/>; }
function PreviewViewRoute(){ const {token}=useParams(); return <PreviewView token={token}/>; }

function HomeRoute(){
  const {data,goToBuilder,goToRun,goToSchedule,goToTeam,goToSettings,coachId,coachName,coachEmail,refreshPlanning,refreshTeams,refreshLibrary,mode,setMode,liveId}=useAppCtx();
  // Coach mode: teams I personally coach, across any org. Org mode: every
  // team in the org being viewed, regardless of my personal involvement --
  // the whole point of the two modes. Scoped once here so HomeScreen's own
  // internals (already all keyed off data.teams/data.practices) need no
  // changes at all.
  const scopedTeams=homeTeamsForMode(data.teams,mode,coachId);
  const scopedTeamIds=new Set(scopedTeams.map(t=>t.id));
  const scopedData=useMemo(()=>Object.assign({},data,{
    teams:scopedTeams,
    practices:(data.practices||[]).filter(p=>scopedTeamIds.has(p.teamId)),
  }),[data,mode,coachId]);
  // allTeams (unscoped by show_on_home) passed separately -- the live-
  // practice join bar below deliberately needs to look up a team's name
  // even when that team is toggled off Home's own agenda, since a coach
  // still needs to know a practice is actually running to go join it.
  return <HomeScreen data={scopedData} allTeams={data.teams} liveId={liveId} goToBuilder={goToBuilder} goToRun={goToRun} goToSchedule={goToSchedule} goToTeam={goToTeam} goToSettings={goToSettings} coachId={coachId} coachName={coachName} coachEmail={coachEmail} refreshPlanning={refreshPlanning} refreshTeams={refreshTeams} refreshLibrary={refreshLibrary} mode={mode} setMode={setMode}/>;
}

function LibraryRoute(){
  const {data,openModal,goToBuilder,goToRun,refreshLibrary,coachId,refreshPlanning,mode}=useAppCtx();
  return <NewLibraryScreen data={data} openModal={openModal} goToBuilder={goToBuilder} goToRun={goToRun} refreshLibrary={refreshLibrary} refreshPlanning={refreshPlanning} coachId={coachId} mode={mode}/>;
}

function TeamsRoute(){
  const {data,goToTeam,openModal,coachId,mode,refreshLibrary}=useAppCtx();
  const scopedTeams=teamsForMode(data.teams,mode,coachId);
  const scopedData=useMemo(()=>Object.assign({},data,{teams:scopedTeams}),[data,mode,coachId]);
  return <TeamsListScreen data={scopedData} goToTeam={goToTeam} openModal={openModal} mode={mode} refreshLibrary={refreshLibrary} coachId={coachId}/>;
}

function SettingsRoute(){
  const {data,coachId,refreshLibrary,refreshTeams,profile,coachEmail,saveName,onSignOut,onDeactivate,setMode}=useAppCtx();
  return <SettingsScreen data={data} coachId={coachId} refreshLibrary={refreshLibrary} refreshTeams={refreshTeams} profile={profile} coachEmail={coachEmail} saveName={saveName} onSignOut={onSignOut} onDeactivate={onDeactivate} setMode={setMode}/>;
}

// step-3 bridge -- see the router config comment above.
// Scoped the same way HomeRoute/TeamsRoute already are (teamsForMode, not
// homeTeamsForMode -- Schedule should list every team you're actually on,
// not hide ones opted out of Home's own agenda via show_on_home). Real bug
// this fixed: a team a coach had genuinely left (their own team_staff row
// archived) stayed visible here as a filterable option and kept showing
// its practices, because can_access_team's RLS also grants access via org
// membership independent of that row -- unscoped data.teams still included
// it even though Home/Teams already correctly dropped it.
function ScheduleLegacyRoute(){
  const {data,goToBuilder,goToRun,coachId,refreshPlanning,mode,openModal}=useAppCtx();
  const scopedTeams=teamsForMode(data.teams,mode,coachId);
  const scopedTeamIds=new Set(scopedTeams.map(t=>t.id));
  const scopedData=useMemo(()=>Object.assign({},data,{
    teams:scopedTeams,
    practices:(data.practices||[]).filter(p=>scopedTeamIds.has(p.teamId)),
  }),[data,mode,coachId]);
  return <ScheduleScreen data={scopedData} goToBuilder={goToBuilder} goToRun={goToRun} coachId={coachId} refreshPlanning={refreshPlanning} openModal={openModal} mode={mode}/>;
}

// Team-scoped Schedule (handoff §4.4). Fetches practices scoped to this one
// team (fetchPracticesFull(teamId)) rather than reusing the app-wide
// unbounded fetch -- a separate local fetch/state from App's own
// `planning.practices`, since Home/My Week still needs the cross-team
// unscoped list. refreshPlanning here refreshes both this team's scoped
// list (immediate) and the global one (so Home stays in sync after a
// mutation made from inside a team's Schedule tab).
function TeamScheduleRoute(){
  const {teamId}=useParams();
  const {data,goToBuilder,goToRun,coachId,refreshPlanning:refreshGlobalPlanning,setSubViewBack,mode}=useAppCtx();
  const [teamPractices,setTeamPractices]=useState(null);
  const refreshTeamPractices=useCallback(()=>{
    fetchPracticesFull(teamId).then(setTeamPractices);
  },[teamId]);
  useEffect(()=>{refreshTeamPractices();},[refreshTeamPractices]);
  const refreshBoth=useCallback(async()=>{
    await Promise.all([refreshTeamPractices(),refreshGlobalPlanning()]);
  },[refreshTeamPractices,refreshGlobalPlanning]);
  if(teamPractices===null)return (<div style={{padding:"40px 0",textAlign:"center",color:"var(--td)",fontSize:14}}>Loading...</div>);
  const scopedData=Object.assign({},data,{practices:teamPractices});
  return <ScheduleScreen data={scopedData} goToBuilder={goToBuilder} goToRun={goToRun} coachId={coachId} refreshPlanning={refreshBoth} fixedTeamId={teamId} setSubViewBack={setSubViewBack} mode={mode}/>;
}

function TeamIndexRedirect(){
  const {teamId}=useParams();
  return <Navigate to={"/team/"+teamId+"/schedule"} replace/>;
}

function TeamRosterRoute(){
  const {teamId}=useParams();
  const navigate=useNavigate();
  const {data,coachId,openModal,refreshTeams,refreshLibrary,mode}=useAppCtx();
  const team=data.teams.find(t=>t.id===teamId);
  // Team was just deleted (e.g. via this same tab's Delete Team) and this
  // route's teamId no longer resolves -- leave for the Teams list instead
  // of rendering blank, same guard the old ManageScreen had.
  useEffect(()=>{if(!team)navigate("/teams");},[team,navigate]);
  if(!team)return null;
  return (<div style={{padding:"16px 16px calc(var(--tab) + 20px)"}}>
    <RostersTab data={data} openModal={openModal} fixedTeamId={teamId} refreshTeams={refreshTeams} coachId={coachId} refreshLibrary={refreshLibrary} mode={mode}/>
  </div>);
}

function TeamEquipmentRoute(){
  const {teamId}=useParams();
  const navigate=useNavigate();
  const {data,coachId,openModal,refreshLibrary,mode}=useAppCtx();
  const team=data.teams.find(t=>t.id===teamId);
  const isOrgMode=mode&&mode.type==="org";
  // BB layout pass: a width cap on this route's own wrapper, same
  // .bb-centered-page treatment as Library's Equipment tab -- EquipmentTab
  // itself is a shared component (reused by both call sites) and manages
  // no outer wrapper of its own, so the cap is applied here at the route
  // level rather than inside the shared component.
  const isBB=useBigBrowser();
  // Per-team Equipment tab is Coach-mode only now -- Org mode manages
  // equipment centrally from Club Library's own Equipment tab instead (see
  // Layout.jsx's teamWorkspaceTabs). A direct link/back-nav into this route
  // while in Org mode has nowhere useful to land, so bounce to Schedule.
  useEffect(()=>{if(!team||isOrgMode)navigate(isOrgMode?`/team/${teamId}/schedule`:"/teams");},[team,isOrgMode,teamId,navigate]);
  if(!team||isOrgMode)return null;
  return (<div className={isBB?"bb-centered-page":undefined} style={{padding:"16px 16px calc(var(--tab) + 20px)"}}>
    <EquipmentTab data={data} coachId={coachId} refreshLibrary={refreshLibrary} openModal={openModal} sportFilter={team.sport} mode={mode}/>
  </div>);
}

function TeamGoalsRoute(){
  const {teamId}=useParams();
  const navigate=useNavigate();
  const {data,coachId,setSubViewBack,mode,refreshTeams,goToRun,refreshPlanning}=useAppCtx();
  const team=data.teams.find(t=>t.id===teamId);
  useEffect(()=>{if(!team)navigate("/teams");},[team,navigate]);
  if(!team)return null;
  return (<div style={{padding:"16px 16px calc(var(--tab) + 20px)"}}>
    <GoalsScreen data={data} teamId={teamId} coachId={coachId} setSubViewBack={setSubViewBack} mode={mode} refreshTeams={refreshTeams} goToRun={goToRun} refreshPlanning={refreshPlanning}/>
  </div>);
}

function BuilderRoute(){
  const {practiceId}=useParams();
  const {data,openModal,goToRun,editPracticeId,setEditPracticeId,startTemplateId,setStartTemplateId,presetTeamId,coachId,coachName,refreshPlanning,refreshLibrary,mode,goHome}=useAppCtx();
  // Restores state from the URL on a fresh mount (direct link / refresh) --
  // navigation via goToBuilder() already set this state before navigating,
  // so this is a no-op in the normal in-app flow.
  useEffect(()=>{
    const wanted=practiceId&&practiceId!=="new"?practiceId:null;
    if(wanted!==editPracticeId)setEditPracticeId(wanted);
  },[practiceId]);

  // Multi-Coach Builder: an already-saved practice whose viewer neither
  // manages the team nor is a full skeleton-editing delegate, but has been
  // delegated at least one station (stations.delegated_to -- distinct from
  // team_staff_id, which is only ever the *live* leader and carries no
  // editing implication, direct feedback), lands on the restricted
  // single-station screen instead of the normal full BuilderScreen --
  // never both, and never a grayed-out version of the same screen (matches
  // this app's existing "hidden entirely, not disabled" convention). A
  // full delegate (can_build_practices) with no station specifically
  // delegated to them still gets the normal full BuilderScreen, unchanged.
  const editP=editPracticeId?data.practices.find(p=>p.id===editPracticeId):null;
  const teamForEditP=editP?data.teams.find(t=>t.id===editP.teamId):null;
  const canManageThisTeam=teamForEditP?canManageTeamInMode(teamForEditP,coachId,mode):false;
  const myCoachForEditP=teamForEditP?(teamForEditP.coaches||[]).find(c=>c.userId===coachId):null;
  const myTeamStaffId=myCoachForEditP?myCoachForEditP.id:null;
  // canBuildPractices required here too, not just a delegated_to match --
  // update_station_content itself requires it, so routing a coach into
  // this screen without the same check would land them somewhere every
  // Save silently fails (shouldn't be reachable in practice, since
  // Builder's own Delegate picker already only offers eligible coaches --
  // this is defense in depth, not the primary gate).
  const hasStationAssignment=!!(editP&&myTeamStaffId&&myCoachForEditP.canBuildPractices&&(editP.activities||[]).some(a=>a.type==="station_block"&&(a.stations||[]).some(st=>st.delegatedTo===myTeamStaffId)));

  if(editP&&teamForEditP&&!canManageThisTeam&&hasStationAssignment){
    return <MyStationBuilderScreen practice={editP} team={teamForEditP} data={data} coachId={coachId} coachLabel={coachName||"Coach"} refreshPlanning={refreshPlanning} refreshLibrary={refreshLibrary} goHome={goHome}/>;
  }

  return <BuilderScreen data={data} openModal={openModal} launchRun={goToRun} editPracticeId={editPracticeId} setEditPracticeId={setEditPracticeId} startTemplateId={startTemplateId} setStartTemplateId={setStartTemplateId} presetTeamId={presetTeamId} coachId={coachId} refreshPlanning={refreshPlanning} refreshLibrary={refreshLibrary}/>;
}

function RunRoute(){
  const {practiceId}=useParams();
  const {data,liveId,setLiveId,coachId,goHome,refreshPlanning,refreshLibrary}=useAppCtx();
  useEffect(()=>{
    const wanted=practiceId&&practiceId!=="new"?practiceId:null;
    if(wanted!==liveId)setLiveId(wanted);
  },[practiceId]);
  return <CommandScreen data={data} liveId={liveId} setLiveId={setLiveId} coachId={coachId} goHome={goHome} refreshPlanning={refreshPlanning} refreshLibrary={refreshLibrary}/>;
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

// Same stopwatch mark as LoadingScreen (the app's own loading-screen logo),
// but the hand's rotation is controlled here rather than an infinite CSS
// animation -- Builder spins it exactly once per activity added (forward)
// or removed (backward), via a CSS transition on the `rotation` prop rather
// than a keyframe loop. White throughout (not LoadingScreen's black-bg
// palette) since it sits on the Run of Practice section's solid green.
function RunOfPracticeMark({rotation}){
  return (<svg width="30" height="30" viewBox="0 0 100 100" style={{flexShrink:0}}>
    <rect x="42" y="0" width="16" height="10" rx="5" fill="#fff" opacity=".85"/>
    <rect x="68" y="6" width="16" height="9" rx="4.5" fill="#fff" opacity=".85" transform="rotate(35 76 10)"/>
    <circle cx="50" cy="50" r="40" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="6"/>
    <g style={{transformOrigin:"50px 50px",transform:"rotate("+rotation+"deg)",transition:"transform .6s cubic-bezier(.4,0,.2,1)"}}>
      <line x1="50" y1="50" x2="50" y2="20" stroke="#fff" strokeWidth="7" strokeLinecap="round"/>
    </g>
    <circle cx="50" cy="50" r="6" fill="#fff"/>
  </svg>);
}

function BuilderScreen({data,openModal,launchRun,editPracticeId,setEditPracticeId,startTemplateId,setStartTemplateId,presetTeamId,coachId,refreshPlanning,refreshLibrary}){
  const navigate=useNavigate();
  // BB layout pass (forty-ninth session): run of practice left, library
  // right, as two independently-scrolling panes -- see the TwoPane usage
  // and stickyBarContent/leftPaneContent/rightPaneContent split below in
  // this same component's return. Every ref/handler here is unchanged and
  // shared between both arrangements; only which container each piece
  // renders into differs.
  const isBB=useBigBrowser();
  // Development Pulse deep-link (Home widget spec): arriving here via its
  // "Plan N minutes"/"Review Practice Impact" CTA carries
  // location.state.openGoalGuidance -- read once on mount, same one-time
  // location.state convention already used for Settings' Terms/Privacy
  // back button and the join-notice-to-Permissions deep link. Consumed
  // immediately into local state so it doesn't linger and re-trigger the
  // one-time highlight if the coach navigates within Builder afterward.
  const location=useLocation();
  const [goalGuidanceStartOpen]=useState(()=>!!(location.state&&location.state.openGoalGuidance));
  const [highlightedSkillCategoryId,setHighlightedSkillCategoryId]=useState(()=>(location.state&&location.state.highlightedSkillCategoryId)||null);
  const editP=editPracticeId?data.practices.find(p=>p.id===editPracticeId):null;
  // "Start from Template" seeds a brand-new (not editP) practice from a
  // saved template's contents -- distinct from editing an already-scheduled
  // practice, so it still gets the full Team/Schedule/Template/Run Now bar.
  const startTpl=(!editP&&startTemplateId)?(data.templates||[]).find(t=>t.id===startTemplateId):null;
  // Consume the intent once on mount so leaving and returning to Builder
  // later (e.g. to edit a different practice) doesn't silently re-seed it.
  useEffect(()=>{if(startTemplateId&&setStartTemplateId)setStartTemplateId(null);},[]);
  const [existingId,setExistingId]=useState(editP?editP.id:null);
  const [runError,setRunError]=useState("");
  const [teamId,setTeamId]=useState(editP?editP.teamId:(presetTeamId||(startTpl&&startTpl.defaultTeamId)||(data.teams[0]?data.teams[0].id:"")));
  // Real bug found live ("Run Now doesn't work, at least for an unscheduled
  // practice"): for a team with no prior practice yet, this fell back to
  // `data.locations[0]` -- the first location in the coach's entire
  // (unscoped, cross-team) location list, by pure array order, with no
  // regard for whether that location has anything to do with this team.
  // Saving/Running then failed RLS's practices_insert_manage/update_manage
  // location check for any team whose own real location wasn't coincidentally
  // first in that array -- exactly the shape of "works sometimes, silently
  // doesn't for other teams." Prefer a location this coach actually owns
  // (always independently accessible/usable, per can_access_location's own
  // simplest branch) over an arbitrary one that might belong to someone else
  // entirely; only fall further back to data.locations[0] if the coach owns
  // none at all (matches the prior behavior for that edge case, unchanged).
  const lastLocForTeam=(tid)=>{
    const tps=data.practices.filter(p=>p.teamId===tid&&p.locationId).sort((a,b)=>b.date>a.date?1:-1);
    if(tps.length)return tps[0].locationId;
    const ownLoc=data.locations.find(l=>l.ownerUserId===coachId);
    return ownLoc?ownLoc.id:(data.locations[0]?data.locations[0].id:"");
  };
  const [locId,setLocId]=useState(editP?editP.locationId:((startTpl&&startTpl.locationId)||lastLocForTeam(editP?editP.teamId:(data.teams[0]?data.teams[0].id:""))));
  const [acts,setActs]=useState(editP?JSON.parse(JSON.stringify(editP.activities)):(startTpl?stripIdsForCopy(startTpl.activities):[]));
  const [expandedId,setExpandedId]=useState(null);
  const [savedTpl,setSavedTpl]=useState(false);
  const [bottomMode,setBottomMode]=useState(null);
  const [schedDate,setSchedDate]=useState(editP?(editP.date||localDateStr()):localDateStr());
  const [schedTime,setSchedTime]=useState(editP?(editP.startTime||"16:00"):"16:00");
  // Target/planned duration -- drives the "35/60 min" progress pill.
  // Real bug found while wiring this up: savePracticeTree does a full
  // column update, and handleSave/handleRun never included this field, so
  // saving an already-scheduled practice from Builder was silently
  // resetting scheduled_duration_minutes to null every time. Threading it
  // through as real state (rather than reading editP directly) fixes that
  // and lets the pill react live as the coach edits it.
  const [schedDuration,setSchedDuration]=useState(editP?(editP.scheduledDurationMinutes||""):"");
  // Pre-Practice Warmup: always present at the top of Builder now (direct
  // feedback: it shouldn't be an opt-in "component" a coach has to remember
  // to add) -- just a plain string, empty when there's nothing written yet.
  // Not an activity -- see the pre_practice_notes migration comment -- so
  // this is the one piece of Builder state with no counterpart in `acts`.
  const [prePracticeNotes,setPrePracticeNotes]=useState(editP?(editP.prePracticeNotes||""):(startTpl?(startTpl.prePracticeNotes||""):""));
  // Collapsed by default -- most practices won't need this every time, and
  // a coach who wants it expands it themselves. Not persisted; a coach who
  // already wrote something still starts collapsed on a fresh Builder visit,
  // same as any other already-filled-in section here.
  const [warmupOpen,setWarmupOpen]=useState(false);
  // Direct feedback: the Run of Practice pill only ever showed "35/60 min" --
  // tapping it now toggles to a plainer "needs N more minutes" readout
  // (or "N min over"/"Fully planned" once there's nothing left to close),
  // tapping again switches back. Purely a display preference, not
  // persisted -- resets to the default X/Y view on a fresh Builder mount.
  const [pillShowRemaining,setPillShowRemaining]=useState(false);
  const [tplName,setTplName]=useState("");
  const [showScheduleModal,setShowScheduleModal]=useState(false);
  const [schedSuccess,setSchedSuccess]=useState(false);
  const [showTplPicker,setShowTplPicker]=useState(false);
  const [showAddLocation,setShowAddLocation]=useState(false);
  // Practice Details collapses by default for an already-scheduled
  // practice -- Team/Location/Date/etc. matter most on first open (or when
  // something's actually wrong), not on every glance back at this screen.
  // A fresh/unscheduled build is the opposite: those fields are the first
  // thing that needs deciding, so it starts expanded instead.
  const [detailsOpen,setDetailsOpen]=useState(()=>!editP);
  // Which of PRACTICE_COMPONENT_TYPES show as one-tap tiles -- per-coach
  // preference (see getVisibleComponentTypes), editable via the "..." menu.
  const [visibleTypeKeys,setVisibleTypeKeysState]=useState(()=>getVisibleComponentTypes());
  const [componentsOpen,setComponentsOpen]=useState(true);
  const [myDrillsOpen,setMyDrillsOpen]=useState(true);
  // Direct feedback: Builder's own library section had no sort/filter at
  // all, unlike the main Library screen -- same Alphabetical/Group-by-Skill
  // modes here (Most Used/Suggested skipped for now, since those need
  // insight-summary/goal-report data this screen doesn't already load, and
  // adding a second fetch just for this felt like scope creep beyond what
  // was asked). Filter is a simple skill-tag multi-select, same idea as
  // Library's own Filter modal, scoped to whichever source/sport is
  // currently showing.
  const [builderDrillSort,setBuilderDrillSort]=useState("custom");
  const [builderTagFilter,setBuilderTagFilter]=useState([]);
  const [showBuilderFilter,setShowBuilderFilter]=useState(false);
  const [showComponentsPicker,setShowComponentsPicker]=useState(false);
  const toggleComponentType=key=>{
    setVisibleTypeKeysState(prev=>{
      const next=prev.includes(key)?prev.filter(k=>k!==key):[...prev,key];
      setVisibleComponentTypes(next);
      return next;
    });
  };
  // Rotates the Run of Practice header mark: +360 per add, -360 per remove.
  // CSS transition on the mark itself animates the change; this is just the
  // running total driving it.
  const [handRotation,setHandRotation]=useState(0);
  // Real element per activity row, so a row that was just collapsed (Done
  // tapped inside its config) can be scrolled back into view at the top of
  // the screen instead of leaving scroll position wherever it happened to
  // land -- previously that was often halfway down the drill library below.
  const rowRefs=useRef({});
  // Green backdrop for the Run of Practice header + rows, measured rather
  // than a real wrapping box. Real bug found live: position:sticky can
  // never move an element past its own DOM parent's bottom edge -- wrapping
  // the rows in a div sized to just fit them (the green box, added when
  // this section's redesign first landed) leaves only a few px of "room"
  // below the last row for it to stick within, nowhere near enough to stay
  // pinned while scrolling through the drill library further down the
  // page. This is why the coach reported the "just added, stays pinned"
  // behavior broken -- not something that session's changes caused, but
  // the real root cause of it. Fix: the header/empty-state/rows render as
  // normal children of the *same* tall padding:"0 14px" wrapper Practice
  // Components/My Drill Library already live in (ample sticky room), and
  // this absolutely-positioned div paints the green behind just that
  // portion, sized via runOfPracticeEndRef's measured position rather than
  // by actually containing the rows.
  // The backdrop is anchored to runOfPracticeStartRef itself (not the
  // outer padded wrapper) specifically so it inherits that wrapper's 14px
  // padding correctly -- an absolutely positioned element is placed
  // relative to its containing block's *padding* edge, which ignores that
  // same padding entirely, so anchoring straight to the padded wrapper
  // made the green run 14px wider than Practice Components/My Drill
  // Library on each side (a real regression, found live). The sentinel is
  // itself a normal-flow child of the padded wrapper, so it's already
  // correctly inset -- anchoring to it (a zero-padding box) lets left:0/
  // right:0 mean what they look like they mean.
  const runOfPracticeOuterRef=useRef(null);
  const runOfPracticeStartRef=useRef(null);
  const runOfPracticeEndRef=useRef(null);
  const [runOfPracticeH,setRunOfPracticeH]=useState(0);
  const recomputeRunOfPracticeH=useCallback(()=>{
    const start=runOfPracticeStartRef.current;
    const end=runOfPracticeEndRef.current;
    if(!start||!end)return;
    const sRect=start.getBoundingClientRect();
    const eRect=end.getBoundingClientRect();
    setRunOfPracticeH(Math.max(0,eRect.bottom-sRect.top));
  },[]);
  useEffect(()=>{
    const outer=runOfPracticeOuterRef.current;
    if(!outer)return;
    recomputeRunOfPracticeH();
    const ro=new ResizeObserver(recomputeRunOfPracticeH);
    ro.observe(outer);
    return()=>ro.disconnect();
  },[recomputeRunOfPracticeH]);
  // BB bug found live (Jax, post-ship): at BB, runOfPracticeOuterRef is the
  // flex-constrained wrapper around the whole TwoPane (flex:1, overflow:
  // hidden) so it fills its own parent's fixed height and never resizes on
  // its own as drills are added inside the independently-scrolling left
  // pane -- the ResizeObserver above only ever fires once, at mount, and
  // the green backdrop height then goes stale. Mobile never hit this: its
  // outer wrapper is a normal block that grows with content in-flow, so
  // the same observer already recomputes correctly there. Recomputing
  // whenever the practice's own content-affecting state changes covers BB
  // without touching mobile's existing resize-driven path at all.
  useEffect(()=>{recomputeRunOfPracticeH();},[acts,expandedId,recomputeRunOfPracticeH]);
  // Direct feedback, two rounds: a prior session added an actual
  // scrollIntoView() here to fix "the last-added drill should be frozen at
  // the top" -- but forcing the whole page to jump back up to the Run of
  // Practice section every single time turned out to be worse than the
  // original complaint: a coach adding several drills in a row from deep in
  // their library kept getting yanked away from where they were browsing,
  // needing to re-scroll and reorient every time. The real ask is just to
  // *see* that the add landed (the green sticky margin) without being
  // moved -- SortableActivityRow's own `sticky` prop (keyed off
  // lastAddedId) already does exactly that via plain CSS position:sticky,
  // no scroll call needed or wanted: as the coach's own scroll position
  // naturally passes the newly-added row's spot, it pins to the top of the
  // screen on its own and stays put while they keep browsing/adding further
  // down in the library, with zero forced movement.
  const collapseAndScroll=id=>{
    setExpandedId(null);
    // Direct feedback: Done on a long station block sometimes left the
    // coach scrolled somewhere past the collapsed row instead of back at
    // it. Root cause: collapsing a very tall block changes this section's
    // total height, which the ResizeObserver above (runOfPracticeH, for the
    // green backdrop) reacts to with its own layout pass -- scrolling on
    // the very next frame could still be racing that reflow, so the smooth
    // scroll's target position was computed against a not-yet-settled
    // layout and could overshoot well past the actual row. A second rAF
    // lets that follow-up layout pass finish first.
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        const el=rowRefs.current[id];
        if(el)el.scrollIntoView({behavior:"smooth",block:"start"});
      });
    });
  };
  // Clicking away from the expanded row collapses it (no forced scroll --
  // unlike Done, this is incidental, not a confirm action). Only two early
  // exits are needed rather than trying to enumerate every button that has
  // its own expandedId-setting logic (a Practice Component tile, another
  // row's own header, ...): a click inside the currently-expanded row
  // itself, or inside an open overlay (.movly -- e.g. the skill-tag
  // picker), never collapses. Everything else uses functional setState
  // updaters that only null out the id if it's *still* the same one this
  // effect was attached for -- if some other same-tick handler (adding a
  // new activity, switching to a different row) already changed it, the
  // functional check naturally no-ops instead of clobbering that update,
  // regardless of which handler happened to run first in the click's
  // bubble order.
  useEffect(()=>{
    if(!expandedId)return;
    const idAtAttach=expandedId;
    // Real bug found live (direct feedback: picking "Group by...Dominant
    // Hand," and separately picking a drill from a station's library
    // picker, both booted the coach straight out of the expanded station
    // block). Root cause: those options live inside their own inline
    // dropdown (groupByOpen / libraryPickerIdx), and selecting one calls
    // setGroupByOpen(false)/setLibraryPickerIdx(null) in the same click --
    // React removes that dropdown (and the very button just clicked) from
    // the DOM before this native document-level listener runs later in the
    // same click's bubble phase. `target.closest()`/`el.contains(target)`
    // both walk the *current* (already-mutated) tree, so a now-detached
    // target always reads as "outside," collapsing the row it was clicked
    // inside of. `composedPath()` is captured at dispatch time, before any
    // handler runs, so it still lists every ancestor the target actually
    // had at the moment of the click, mutation or not.
    const handler=e=>{
      const path=typeof e.composedPath==="function"?e.composedPath():[e.target];
      if(path.some(n=>n.classList&&n.classList.contains("movly")))return;
      const el=rowRefs.current[idAtAttach];
      if(el&&path.includes(el))return;
      setExpandedId(prev=>prev===idAtAttach?null:prev);
      setLastAddedId(prev=>prev===idAtAttach?null:prev);
    };
    document.addEventListener("click",handler);
    return()=>document.removeEventListener("click",handler);
  },[expandedId]);
  // The sticky just-added-drill row also anchors to the top of the scroll
  // container -- but Builder already has its own sticky Save/Run Now bar
  // pinned at top:0 above it. Both stuck at the same top:0 meant the drill
  // row was rendering directly underneath that bar (lower z-index), fully
  // hidden. Measuring the bar's actual height (it varies with editP/
  // startTpl/bottomMode) and offsetting the drill row by that amount keeps
  // it visible just below the bar instead of behind it.
  const stickyHeaderRef=useRef(null);
  const [stickyHeaderH,setStickyHeaderH]=useState(0);
  useEffect(()=>{
    const el=stickyHeaderRef.current;
    if(!el)return;
    const ro=new ResizeObserver(()=>setStickyHeaderH(el.offsetHeight));
    ro.observe(el);
    return()=>ro.disconnect();
  },[]);
  // Direct feedback, second round on the same request: the coach wants "The
  // Run of Practice" title itself pinned too, not just the last-added row --
  // and wants it to actually stay *green* once scrolled past its natural
  // spot, not fall onto the white page background the way the lone sticky
  // row used to (the shared backdrop below is only as tall as the section's
  // natural, unscrolled height -- position:sticky content that pins past
  // that point has nothing green left behind it). Same ResizeObserver
  // pattern as stickyHeaderH above, measuring this section's own title bar
  // so the last-row's own stickyTop can stack correctly beneath both the
  // Save/Run Now bar *and* this header rather than overlapping either.
  const ropHeaderRef=useRef(null);
  const [ropHeaderH,setRopHeaderH]=useState(0);
  useEffect(()=>{
    const el=ropHeaderRef.current;
    if(!el)return;
    const ro=new ResizeObserver(()=>setRopHeaderH(el.offsetHeight));
    ro.observe(el);
    return()=>ro.disconnect();
  },[]);
  // The always-last-positional-drill sticky spacer's own height (the "torn
  // edge" strip below, present only when there's more than one activity --
  // with exactly one, there's nothing that could ever be hidden between the
  // header and "the last drill," so no strip/zigzag makes sense at all).
  const ropZigzagH=acts.length>1?16:0;
  const ropStickyTop=stickyHeaderH+ropHeaderH;
  const ropLastId=acts.length>0?acts[acts.length-1].id:null;
  // Whether any activity between the header and the pinned last row is
  // currently scrolled out of view -- drives the torn/zigzag edge on the
  // spacer strip between them. Watches the *first* row specifically: since
  // rows scroll away top-to-bottom under the sticky header, the first row
  // is always the first thing to disappear, and by the time it's gone the
  // header is necessarily already pinned (it sits above every row in
  // document order) -- one observer target is enough, no need to watch
  // every row in between. rootMargin shrinks the effective viewport by the
  // sticky stack's own height, so "visible" means "visible in the actual
  // remaining scroll area," not just "touches the literal top of the
  // browser window" (which the sticky bar/header/strip already cover).
  const [ropContentHidden,setRopContentHidden]=useState(false);
  useEffect(()=>{
    if(acts.length<=1){setRopContentHidden(false);return;}
    const firstEl=rowRefs.current[acts[0].id];
    if(!firstEl)return;
    const topOffset=ropStickyTop+ropZigzagH;
    const io=new IntersectionObserver(([entry])=>{setRopContentHidden(!entry.isIntersecting);},{rootMargin:(-topOffset)+"px 0px 0px 0px",threshold:0});
    io.observe(firstEl);
    return()=>io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[acts.length&&acts[0].id,ropStickyTop,ropZigzagH]);
  // Snapshot of what's actually persisted, so the router blocker (and the
  // beforeunload guard below) can warn before discarding edits that only
  // exist in this component's state. Replaces the old App-level
  // guardedSetView/builderDirtyRef/priorView mechanism (handoff §4.2) --
  // useBlocker replaces client-side-nav guarding, beforeunload covers a hard
  // refresh/tab close, which the old mechanism never actually protected
  // against either (it only guarded App.jsx's own setView calls).
  const savedSnapshotRef=useRef();
  if(savedSnapshotRef.current===undefined)savedSnapshotRef.current=JSON.stringify({teamId,locId,acts});
  const [dirty,setDirty]=useState(false);
  const markSaved=()=>{savedSnapshotRef.current=JSON.stringify({teamId,locId,acts});setDirty(false);};
  useEffect(()=>{
    setDirty(JSON.stringify({teamId,locId,acts})!==savedSnapshotRef.current);
  },[teamId,locId,acts]);
  useEffect(()=>{
    if(!dirty)return;
    const onBeforeUnload=e=>{e.preventDefault();e.returnValue="";};
    window.addEventListener("beforeunload",onBeforeUnload);
    return()=>window.removeEventListener("beforeunload",onBeforeUnload);
  },[dirty]);
  const blocker=useBlocker(useCallback(({currentLocation,nextLocation})=>dirty&&currentLocation.pathname!==nextLocation.pathname,[dirty]));
  useEffect(()=>{
    if(blocker.state!=="blocked")return;
    if(window.confirm("You have unsaved changes to this practice. Leave without saving?"))blocker.proceed();
    else blocker.reset();
  },[blocker]);
  const team=data.teams.find(t=>t.id===teamId)||null;
  const loc=data.locations.find(l=>l.id===locId)||null;
  const teamSport=(team&&team.sport)||"General";
  // No locationIds set for the team = no restriction configured yet, shows
  // every location (today's behavior, unchanged). The currently selected
  // location is always kept in the option list even if it falls outside the
  // team's set -- e.g. an already-scheduled practice booked before the
  // team's locations were narrowed -- so the picker never silently hides
  // the value it's currently showing.
  const teamLocations=(!team||!team.locationIds||!team.locationIds.length)
    ?data.locations
    :data.locations.filter(l=>team.locationIds.includes(l.id)||l.id===locId);
  // Excludes Public Library (catalog) drills, matching the station-block
  // picker's own filter (ActivityConfigs.jsx) -- data.activityLibrary is
  // RLS-scoped, not client-filtered, so it also contains public-catalog
  // and org-shared drills alongside the coach's own; this list was
  // showing all of them mixed together with no way to tell them apart.
  // Catalog (public-library) rows are no longer excluded up front -- they're
  // only shown when the coach has actually picked "Public Library" as the
  // source below (sourceFilteredLib), same as every other source.
  const filteredLib=data.activityLibrary.filter(a=>(a.sport||"General")===teamSport||(a.sport||"General")==="General");
  // Direct feedback: this used to show every accessible drill merged
  // together (own + org + any peer sharing with the coach) with no way to
  // tell them apart, which read as "I can see my assistant's whole
  // library" even though nothing was actually copied in. Defaults to just
  // the coach's own library now, with a switcher for the other libraries
  // this specific team can actually reach -- the team's own org (if any)
  // and each peer currently sharing with the coach on this team (both
  // already correctly RLS-scoped in data.activityLibrary; this just groups
  // what's already there, same technique NewLibraryScreen's own
  // exploreShelves uses).
  // Direct feedback: a peer source used to fall back to the generic "A
  // coach's Library" the moment that peer wasn't personally rostered on
  // *this* team (e.g. they share their library from a different team they
  // co-coach with this coach on) -- team.coaches.find(...) only ever
  // checked this one team's own roster. Same fix NewLibraryScreen's own
  // Explore shelves already needed for the identical gap: resolve a name
  // across *every* team the coach can see (coachNameByUserId), preferring
  // a real resolved profile name first, only falling back to "A coach" if
  // truly nothing is known about them.
  const coachNameByUserId=useMemo(()=>{
    const m={};
    (data.teams||[]).forEach(t=>(t.coaches||[]).forEach(c=>{if(c.userId&&!m[c.userId])m[c.userId]=c.name;}));
    return m;
  },[data.teams]);
  const coachDisplayName=userId=>(data.profilesById&&data.profilesById[userId]&&data.profilesById[userId].name)||coachNameByUserId[userId]||"A coach";
  const librarySources=useMemo(()=>{
    const sources=[{key:"mine",label:"My Library"}];
    if(team&&team.organizationId){
      const org=(data.myOrgs||[]).find(o=>o.id===team.organizationId);
      sources.push({key:"org",label:(org?org.name:"Org")+" Library"});
    }
    const peerIds=[...new Set(data.activityLibrary.filter(a=>a.ownerUserId&&a.ownerUserId!==coachId&&!a.organizationId&&!a.sourceCatalogId).map(a=>a.ownerUserId))];
    peerIds.forEach(pid=>{
      sources.push({key:"peer:"+pid,label:coachDisplayName(pid)+"'s Library"});
    });
    // Direct feedback: Public Library wasn't offered as a source here at
    // all (filteredLib used to drop every catalog row before this switcher
    // even ran) -- catalog rows are already loaded in data.activityLibrary
    // exactly like everything else, just tagged with sourceCatalogId, so
    // this only needed a real option to select them, not a new fetch.
    if(data.activityLibrary.some(a=>a.sourceCatalogId&&(a.sport||"General")===teamSport))sources.push({key:"public",label:"Public Library"});
    return sources;
  },[team,data.activityLibrary,data.myOrgs,coachId,teamSport,coachNameByUserId,data.profilesById]);
  const [libSource,setLibSource]=useState("mine");
  // Reset back to "mine" on a team switch -- the other team's org/peers
  // rarely apply to the new one, and silently browsing a stale source
  // would be confusing.
  useEffect(()=>{setLibSource("mine");},[teamId]);
  const sourceFilteredLib=filteredLib.filter(a=>{
    if(libSource==="mine")return a.ownerUserId===coachId&&!a.sourceCatalogId;
    if(libSource==="org")return a.organizationId===(team&&team.organizationId)&&!a.sourceCatalogId;
    if(libSource==="public")return !!a.sourceCatalogId;
    if(libSource.startsWith("peer:"))return a.ownerUserId===libSource.slice(5)&&!a.sourceCatalogId;
    return !a.sourceCatalogId;
  });
  const teamTemplates=(data.templates||[]).filter(t=>(t.sport||"General")===teamSport||(t.sport||"General")==="General");
  const skillTagsById=Object.fromEntries((data.skillTags||[]).map(t=>[t.id,t]));
  const tagNames=ids=>(ids||[]).map(id=>skillTagsById[id]?skillTagsById[id].name:null).filter(Boolean);
  // Same drift check as TemplateWorkspace -- a fresh single-drill add always
  // matches the library (nothing to flag), but stripIdsForCopy(startTpl.
  // activities)/applyTemplate below copy a template's activities exactly as
  // they were saved, so a practice built from a stale template inherits the
  // same drift the coach never got a chance to see/refresh in the template.
  const drillById=Object.fromEntries((data.activityLibrary||[]).map(d=>[d.id,d]));
  const idsEqual=(a,b)=>{const sa=[...(a||[])].sort(),sb=[...(b||[])].sort();return sa.length===sb.length&&sa.every((v,i)=>v===sb[i]);};
  // Duration is deliberately excluded -- coaches shorten/lengthen a drill
  // per-instance often enough that comparing it against the library
  // default would flag practically every activity, drowning out the
  // signal for fields that actually mean the drill itself changed.
  const isStale=act=>{
    if(act.type!=="activity"||!act.libraryId)return false;
    const d=drillById[act.libraryId];
    if(!d)return false;
    return act.name!==d.name||(act.description||"")!==(d.description||"")||(act.coachingPoints||"")!==(d.coachingPoints||"")||(act.grouping||"whole")!==(d.grouping||"whole")||(act.numGroups||2)!==(d.numGroups||2)||(act.playerGear||"")!==(d.playerGear||"")||!idsEqual(act.equipment,d.equipment);
  };
  const refreshFromLibrary=act=>{
    const d=drillById[act.libraryId];
    if(!d)return;
    updAct(act.id,{name:d.name,description:d.description||"",coachingPoints:d.coachingPoints||"",grouping:d.grouping||"whole",numGroups:d.numGroups||2,playerGear:d.playerGear||"",equipment:Array.isArray(d.equipment)?d.equipment:[]});
    setStaleMenuId(null);
  };
  const [staleMenuId,setStaleMenuId]=useState(null);
  const [staleMenuUp,setStaleMenuUp]=useState(false);
  // Appends rather than replaces -- safe to offer regardless of whether acts
  // is already empty (a fresh/unplanned build) or has drills in it (editing
  // an already-scheduled practice and wanting to pull in a template on top).
  const applyTemplate=tpl=>{setActs(p=>[...p,...stripIdsForCopy(tpl.activities)]);setShowTplPicker(false);};
  const headCoach=(team&&(team.coaches.find(c=>c.role==="Head Coach")||team.coaches[0]))||null;
  const headCoachId=(headCoach&&headCoach.id)||"";
  const allPlayerIds=team?team.players.map(p=>p.id):[];
  const [absentPlayerIds,setAbsentPlayerIds]=useState(new Set());
  useEffect(()=>{
    if(!existingId){setAbsentPlayerIds(new Set());return;}
    fetchPlannedAbsences([existingId]).then(rows=>setAbsentPlayerIds(new Set(rows.map(r=>r.player_id))));
  },[existingId]);
  // Default assignment for newly-added activities excludes players marked
  // out in advance -- the coach can still tap them back in per-activity.
  const defaultAssignIds=allPlayerIds.filter(id=>!absentPlayerIds.has(id));
  const totalMins=sumMins(acts);
  // Tracks the single most-recently-added row so it can be pinned to the
  // top of the screen (SortableActivityRow's `sticky` prop) as tap
  // feedback -- a coach deep in the library list below otherwise adds a
  // drill with no visual confirmation it landed, since the activities list
  // it was appended to has long since scrolled out of view above.
  const [lastAddedId,setLastAddedId]=useState(null);
  // equipmentOverride lets the mismatch-dialog flow below substitute
  // resolved (coach-owned) asset ids in place of lib.equipment's raw ones
  // -- see addActChecked.
  const addAct=(lib,equipmentOverride)=>{
    const id=uid();
    setActs(p=>[...p,{id,type:"activity",libraryId:lib.id,name:lib.name,duration:lib.duration,assignments:defaultAssignIds,coachId:headCoachId,sublocationId:"",notes:"",description:lib.description||"",coachingPoints:lib.coachingPoints||"",grouping:lib.grouping||"whole",numGroups:lib.numGroups||2,playerGear:lib.playerGear||"",equipment:equipmentOverride!==undefined?equipmentOverride:(Array.isArray(lib.equipment)?lib.equipment:[])}]);
    setExpandedId(id);
    setLastAddedId(id);
    setHandRotation(r=>r+360);
  };
  // Equipment-mismatch check before adding a drill straight into a practice
  // (2026-08-01): a drill from Explore (org-shared, peer-shared) may
  // reference equipment ids the coach doesn't own -- addAct used to copy
  // those raw ids verbatim, which practice_activity_equipment's RLS then
  // silently rejected at save time (the insert's own error was never even
  // checked). Always resolves against the coach's own personal pool only
  // -- BuilderScreen has no Coach/Org mode awareness today, and a coach's
  // own equipment already satisfies the RLS for any team they can build
  // for, so this doesn't need mode-awareness to be correct.
  const assetsById=Object.fromEntries((data.assets||[]).map(a=>[a.id,a]));
  const ownAssetPool=(data.assets||[]).filter(a=>a.ownerUserId===coachId);
  const [equipmentDialogLib,setEquipmentDialogLib]=useState(null);
  const addActChecked=lib=>{
    const missing=findMissingEquipment(lib.equipment,assetsById,ownAssetPool);
    if(missing.length===0){addAct(lib);return;}
    setEquipmentDialogLib(lib);
  };
  const resolveAndAdd=async(lib,createMissingEquipment)=>{
    const resolvedIds=await resolveDrillEquipmentForCoach(coachId,lib.equipment,assetsById,ownAssetPool,createMissingEquipment);
    addAct(lib,resolvedIds);
    setEquipmentDialogLib(null);
    if(createMissingEquipment)await refreshLibrary();
  };
  // Direct feedback: a new station block used to immediately split every
  // present player into its stations (and defaulted Station 1's own coach
  // to the head coach) -- both are gone now. Stations start with no player
  // assignments at all until the coach explicitly taps Generate Random,
  // manually assigns someone, or picks a grouping; a coach assigned here is
  // now genuinely optional (the live session auto-fills any station still
  // empty once attendance is actually known -- see handleAttConfirm).
  const addBlock=()=>{
    const b={id:uid(),type:"station_block",rotate:true,stationDuration:10,transitionDuration:2,stations:[
      {id:uid(),name:"Station 1",activityName:"",coachId:"",sublocationId:"",assignments:[],coachingPoints:"",equipment:[],playerGear:""},
      {id:uid(),name:"Station 2",activityName:"",coachId:"",sublocationId:"",assignments:[],coachingPoints:"",equipment:[],playerGear:""},
    ]};
    setActs(p=>[...p,b]);setExpandedId(b.id);setLastAddedId(b.id);
    setHandRotation(r=>r+360);
  };
  // Replaces the old fixed addChecklist(isClose) -- Intro/Closer are now
  // just two of PRACTICE_COMPONENT_TYPES, all sharing this one path.
  // station_block is the one non-checklist kind, so it just delegates to
  // addBlock (which already handles its own hand-rotation bump).
  const addComponentType=key=>{
    const type=PRACTICE_COMPONENT_TYPES.find(t=>t.key===key);
    if(!type)return;
    if(type.kind==="station_block"){addBlock();return;}
    const a={id:uid(),type:"checklist",name:type.defaultName,duration:type.defaultDuration,assignments:defaultAssignIds,coachId:headCoachId,items:[],notes:""};
    setActs(p=>[...p,a]);setExpandedId(a.id);setLastAddedId(a.id);
    setHandRotation(r=>r+360);
  };
  const remAct=id=>{setActs(p=>p.filter(a=>a.id!==id));if(lastAddedId===id)setLastAddedId(null);setHandRotation(r=>r-360);};
  const updAct=(id,ch)=>setActs(p=>p.map(a=>a.id===id?Object.assign({},a,ch):a));
  const updSt=(aid,sid,ch)=>setActs(p=>p.map(a=>a.id===aid?Object.assign({},a,{stations:a.stations.map(s=>s.id===sid?Object.assign({},s,ch):s)}):a));
  const {sensors:dndSensors,onDragEnd:onActDragEnd}=useActivityDnd(setActs);
  const doSchedule=async(dateVal,timeVal)=>{
    if(!dateVal)return;
    const {data:saved}=await savePracticeTree(existingId,{teamId,locationId:locId,date:dateVal,startTime:timeVal||"",timezone:team&&team.timezone,scheduledDurationMinutes:schedDuration||null,prePracticeNotes,activities:acts,coachId});
    if(saved){setExistingId(saved.id);markSaved();}
    await refreshPlanning();
    setSchedSuccess(true);
  };
  const doSaveTpl=async(tname)=>{
    if(!tname.trim())return;
    await saveTemplateTree(coachId,null,{name:tname,sport:teamSport,locationId:locId,prePracticeNotes,activities:acts});
    await refreshPlanning();
    setBottomMode("done_tpl");
    setTimeout(()=>setBottomMode(null),2000);
  };
  const handleSave=async()=>{
    const {data:saved}=await savePracticeTree(existingId,{teamId,locationId:locId,date:schedDate,startTime:schedTime,timezone:team&&team.timezone,scheduledDurationMinutes:schedDuration||null,prePracticeNotes,activities:acts,coachId});
    if(saved){setExistingId(saved.id);markSaved();}
    await refreshPlanning();
    // Saving an already-scheduled practice's plan is a "make this edit and
    // leave" action, not a "keep working here" one -- return to wherever
    // the coach opened Builder from (Home, Schedule, PracticeDetail...),
    // same destination the Back button already resolves via history.
    if(editP){
      if(setEditPracticeId)setEditPracticeId(null);
      navigate(-1);
    }
  };
  const handleRun=async()=>{
    setRunError("");
    const {data:saved,error}=await savePracticeTree(existingId,{teamId,locationId:locId,date:schedDate,startTime:schedTime,timezone:team&&team.timezone,scheduledDurationMinutes:schedDuration||null,prePracticeNotes,activities:acts,coachId});
    if(saved)markSaved();
    await refreshPlanning();
    if(saved)launchRun(saved.id);
    // Real bug found live ("Run Now doesn't work"): a save failure (e.g. an
    // RLS rejection) left this button looking like it just did nothing at
    // all -- data was always destructured alone, never error, so a coach
    // had zero signal that anything had even gone wrong versus just being
    // slow. Surfaced now so a genuine failure is at least visible instead
    // of silent.
    else if(error)setRunError("Couldn't start practice. Check the location and try again.");
  };
  // Direct feedback: Run Now shouldn't be available when a scheduled
  // practice is still far off -- it's for "happening now or very soon,"
  // not a way to skip straight past the plan into a live session hours
  // early. Only gates an already-scheduled practice (editP); a brand-new
  // unscheduled build's date/time fields are just today's placeholder
  // defaults, not a real commitment, so Run Now stays available there
  // regardless of what they happen to show.
  const scheduledMoment=editP&&schedDate&&schedTime?new Date(schedDate+"T"+schedTime+":00"):null;
  const runTooFarAway=!!(scheduledMoment&&scheduledMoment.getTime()-Date.now()>3600000);
  // Direct feedback: relabel to "Join Practice" the moment this practice
  // already has an active session -- and skip the >1hr-away gate in that
  // case, since joining an already-started practice should never be
  // blocked by how far off its original scheduled time was.
  const [isSessionLive,setIsSessionLive]=useState(false);
  useEffect(()=>{
    if(!editP){setIsSessionLive(false);return;}
    let cancelled=false;
    findActiveLiveSession(editP.id).then(s=>{if(!cancelled)setIsSessionLive(!!s);});
    return()=>{cancelled=true;};
  },[editP&&editP.id]);
  // BB layout pass: the Save/Run Now bar renders once, at the top of the
  // page at mobile (unchanged) or at the top of the left pane at BB (per
  // the handoff's own recommendation) -- same ref, same handlers, same
  // JSX either way, just placed differently below.
  const stickyBarContent=(<div ref={stickyHeaderRef} style={{position:"sticky",top:0,zIndex:10,background:"#fff",borderBottom:"1px solid var(--b)"}}>
      {/* Back-button audit (2026-07-15): was a hardcoded navigate("/") --
          always dropped you on Home regardless of where you actually came
          from (a team's Plan tab, Schedule, Library...). navigate(-1)
          returns to wherever that was; the useBlocker guard above already
          intercepts this exact navigation when there are unsaved edits.
          Save/Run Now now share this same row -- the two actions a coach
          reaches for most -- instead of living in a separate bar below an
          isolated Back button. */}
      <div style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:8}}>
        <button className="btn ghost bxs" onClick={()=>navigate(-1)}>Back</button>
        <div style={{flex:1}}/>
        {/* For an unscheduled build, Save no longer saves silently with no
            visible outcome -- it opens a choice between the two things a
            coach would actually want to do with it (see the savechoice
            row below). An already-scheduled practice's Save still saves
            directly, unchanged. */}
        {(!bottomMode||bottomMode==="")&&<><button className="btn outline bsm" onClick={editP?handleSave:()=>setBottomMode("savechoice")}>Save</button>
        <button className="btn primary bsm" onClick={handleRun} disabled={!isSessionLive&&runTooFarAway} title={!isSessionLive&&runTooFarAway?"Run Now unlocks within 1 hour of the scheduled time":""}>{isSessionLive?"Join Practice":"Run Now"}</button></>}
      </div>
      {runError&&<div style={{padding:"0 14px 8px",fontSize:12,color:"var(--red)"}}>{runError}</div>}
      {editP&&<div style={{padding:"0 14px 8px",display:"flex",alignItems:"baseline",gap:8}}>
        <span style={{fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"var(--green)",flexShrink:0}}>Editing</span>
        <span style={{fontSize:13,fontWeight:700,color:"var(--black)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{team?team.name:"Practice"} · {schedDate?new Date(schedDate+"T12:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}):"No date"}{schedTime?" · "+fmt12(schedTime):""}</span>
      </div>}
      {!editP&&startTpl&&<div style={{padding:"0 14px 8px",display:"flex",alignItems:"baseline",gap:8}}>
        <span style={{fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"var(--green)",flexShrink:0}}>From Template</span>
        <span style={{fontSize:13,fontWeight:700,color:"var(--black)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{startTpl.name}</span>
      </div>}
      {!editP&&bottomMode==="savechoice"&&<div style={{padding:"0 14px 10px"}}>
        <div style={{fontSize:12,color:"var(--td)",marginBottom:8}}>Save this practice as...</div>
        <div className="brow">
          <button className="btn ghost bsm" onClick={()=>setBottomMode(null)}>Cancel</button>
          <button className="btn outline bsm" style={{flex:1}} onClick={()=>{setTplName("");setBottomMode("template");}}>Template</button>
          <button className="btn primary bsm" style={{flex:1}} onClick={()=>{setBottomMode(null);setSchedSuccess(false);setShowScheduleModal(true);}}>Add to Schedule</button>
        </div>
      </div>}
      {bottomMode==="template"&&<div style={{padding:"0 14px 10px"}}>
        <div className="fld mb6"><input className="inp" autoFocus placeholder="Template name..." value={tplName} onChange={e=>setTplName(e.target.value)}/></div>
        <div className="brow">
          <button className="btn ghost bsm" onClick={()=>setBottomMode(null)}>Cancel</button>
          <button className="btn primary bsm" onClick={()=>doSaveTpl(tplName)} disabled={!tplName.trim()}>Save Template</button>
        </div>
      </div>}
      </div>);
  return (<div className={isBB?"bb-fill-height":undefined} style={isBB?undefined:{paddingBottom:80}}>
      {!isBB&&stickyBarContent}
      {showScheduleModal&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setShowScheduleModal(false);}}>
        <div className="modal">
          {!schedSuccess?<>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,marginBottom:4}}>Schedule this practice</div>
            <div style={{fontSize:13,color:"var(--td)",marginBottom:16}}>Sets the date and time this practice runs. You can still change the plan afterward.</div>
            <div className="g2 mb10">
              <div className="fld"><label className="lbl">Date</label><input className="inp" type="date" value={schedDate} onChange={e=>setSchedDate(e.target.value)}/></div>
              <div className="fld"><label className="lbl">Time</label><input className="inp" type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)}/></div>
            </div>
            <div className="fld mb10"><label className="lbl">Duration (min) <span style={{color:"var(--td)",fontWeight:400}}>(optional)</span></label><input className="inp" type="number" min="1" placeholder="e.g. 60" value={schedDuration} onChange={e=>{const v=e.target.value;setSchedDuration(v===""?"":+v);}}/></div>
            <div className="brow"><button className="btn ghost bsm" onClick={()=>setShowScheduleModal(false)}>Cancel</button><button className="btn primary bsm" style={{flex:1}} onClick={()=>doSchedule(schedDate,schedTime)} disabled={!schedDate}>Schedule Practice</button></div>
          </>:<>
            <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,marginBottom:4}}>Practice scheduled</div>
            <div style={{fontSize:13,color:"var(--td)",marginBottom:16}}>{team?team.name:"Practice"} · {new Date(schedDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}{schedTime?" · "+fmt12(schedTime):""}</div>
            <button className="btn primary bmd bfull" onClick={()=>{setShowScheduleModal(false);navigate(-1);}}>Done</button>
          </>}
        </div>
      </div>}
      {showAddLocation&&<AddLocationDialog coachId={coachId} orgId={team&&team.organizationId} onClose={()=>setShowAddLocation(false)} onCreated={async(loc)=>{await refreshPlanning();setLocId(loc.id);}}/>}
      {showTplPicker&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setShowTplPicker(false);}}>
        <div className="modal">
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,marginBottom:12}}>Start with a template</div>
          {teamTemplates.length===0&&<div style={{fontSize:13,color:"var(--td)",marginBottom:12}}>No templates saved yet for {teamSport}.</div>}
          {teamTemplates.map(tpl=>(<div key={tpl.id} className="li tap" onClick={()=>applyTemplate(tpl)}>
            <div className="lim"><div className="lin">{tpl.name}</div><div className="limt">{(tpl.activities||[]).length} activities · {tpl.durMin||0}min</div></div>
            <span style={{color:"var(--green)",fontSize:20,fontWeight:700,flexShrink:0}}>+</span>
          </div>))}
          <button className="btn ghost bmd bfull mt10" onClick={()=>setShowTplPicker(false)}>Cancel</button>
        </div>
      </div>}
      {/* Add/Remove Practice Components -- which of the 7 types show as
          one-tap tiles in the section above. Persisted per coach/device
          (getVisibleComponentTypes), so today's Intro/Closer/Station Block
          set keeps working unchanged until a coach actually opens this. */}
      {showComponentsPicker&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setShowComponentsPicker(false);}}>
        <div className="modal">
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,marginBottom:4}}>Add/Remove Practice Components</div>
          <div style={{fontSize:13,color:"var(--td)",marginBottom:14}}>Choose which of these show as one-tap buttons below. You can change this anytime.</div>
          {PRACTICE_COMPONENT_TYPES.map(t=>{
            const on=visibleTypeKeys.includes(t.key);
            return (<div key={t.key} className="li tap" style={{marginBottom:8}} onClick={()=>toggleComponentType(t.key)}>
              <div className="lim">
                <div className="lin">{t.label}</div>
                <div className="limt">{t.kind==="station_block"?"2+ stations":t.defaultDuration+" min"}</div>
              </div>
              <span style={{width:22,height:22,borderRadius:"50%",border:"2px solid "+(on?"var(--green)":"var(--b)"),background:on?"var(--green)":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{on&&<Ic.Check/>}</span>
            </div>);
          })}
          <button className="btn primary bmd bfull mt10" onClick={()=>setShowComponentsPicker(false)}>Done</button>
        </div>
      </div>}
      {/* Real gap found live: the sticky action bar above (border-bottom,
          no margin of its own) sat flush against this card's own top edge
          with zero space between them, every time Builder is opened
          regardless of entry path -- editP's "Editing" banner row and the
          full 4-button bar both end in the same bare border, and neither
          the sticky wrapper nor .card added any breathing room after it.
          This whole section (Practice Details through the drill library)
          shares one padding:"0 14px" wrapper -- .screen already gives the
          route 14px of horizontal inset, and this adds the matching 14px
          every section here relies on for its outer edge. Practice Details
          used to sit *outside* this wrapper, back when it still had its
          own 14px of inner .card padding to make up the difference --
          once that became a padding:0 black-bar header instead, its outer
          box was 28px wider than every section below it. Moving it inside
          fixes that instead of re-adding padding that would fight the
          black bar's own edge-to-edge look. */}
      {(()=>{
      // BB layout pass: everything from here through the end of My Drill
      // Library below is unchanged JSX/state/handlers -- only the wrapper
      // differs. At mobile it renders as one column, exactly as before.
      // At BB it splits into TwoPane's left/right props (run of practice
      // left, library right), each independently scrollable.
      const leftPaneContent=(<>
      {isBB&&stickyBarContent}
      {/* Black header bar, matching Practice Components/My Drill Library
          below -- defaults to collapsed since Team/Location/Start Time
          matter most on first open (or when something's actually wrong),
          not on every glance back at this screen while building out the
          run of practice. The collapsed state still shows a one-line
          summary so a coach isn't left with zero context. */}
      <div className="card mb10" style={{marginTop:10,padding:0,overflow:"hidden"}}>
        {/* Solid black, matching Practice Components/My Drill Library --
            a full-width team-color fill read as too loud; the team still
            shows up here, just as a subtle stripe on the left instead. */}
        <div onClick={()=>setDetailsOpen(o=>!o)} style={{position:"relative",background:"var(--black)",color:"#fff",padding:"9px 12px",display:"flex",alignItems:"center",gap:8,cursor:"pointer",overflow:"hidden"}}>
          {team&&team.colorPrimary&&<span style={{position:"absolute",top:0,left:0,bottom:0,width:6,background:team.colorPrimary}}/>}
          <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:900,letterSpacing:".08em",textTransform:"uppercase",flexShrink:0,marginLeft:team&&team.colorPrimary?6:0}}>Practice Details</span>
          {!detailsOpen&&<span style={{fontSize:12,color:"rgba(255,255,255,.65)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{team?team.name:"No team selected"}{loc?" · "+loc.name:""}</span>}
          {detailsOpen&&<span style={{flex:1}}/>}
          <span style={{color:"#fff",display:"flex",flexShrink:0}}><Ic.Chev up={detailsOpen}/></span>
        </div>
        {/* Field order is deliberately "when, then where/how long":
            Date+Start Time paired first (only meaningful once a practice
            is actually scheduled), then Location+Duration paired below.
            Team stays its own row above both, only shown for a fresh
            build -- an already-scheduled practice's team isn't editable
            here. */}
        {detailsOpen&&<div style={{padding:14}}>
          {!editP&&<div className="fld"><label className="lbl">Team</label>
            <select className="sel" value={teamId} onChange={e=>{const tid=e.target.value;setTeamId(tid);setLocId(lastLocForTeam(tid));}}>
              {!data.teams.length&&<option value="">-- Add a team first --</option>}
              {data.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>}
          {editP&&<div className="g2">
            <div className="fld"><label className="lbl">Date</label>
              <input className="inp" type="date" value={schedDate} onChange={e=>setSchedDate(e.target.value)}/>
            </div>
            <div className="fld"><label className="lbl">Start Time</label>
              <input className="inp" type="time" value={schedTime} onChange={e=>setSchedTime(e.target.value)}/>
            </div>
          </div>}
          <div className={editP?"g2":undefined}>
            <div className="fld"><label className="lbl">Location</label>
              {teamLocations.length>0?(
                // "+ Add New Location..." is a real option in the dropdown
                // itself, not just a fallback for the zero-locations case --
                // a coach editing an already-scheduled practice whose actual
                // location isn't in their list yet shouldn't have to leave
                // Builder to add it first.
                <select className="sel" value={locId} onChange={e=>{const v=e.target.value;if(v==="__add_new__"){setShowAddLocation(true);return;}setLocId(v);}}>
                  {teamLocations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
                  <option value="__add_new__">+ Add New Location...</option>
                </select>
              ):(
                // No locations exist yet anywhere -- the select would otherwise
                // render with zero options and no way out. A coach stuck here
                // had no inline way to add one before; this is the same
                // add-a-location flow SchedulePracticeModal now offers too.
                <button type="button" className="btn outline bsm bfull" onClick={()=>setShowAddLocation(true)}>+ Add a Location</button>
              )}
            </div>
            {/* Real bug found wiring this up: Builder's own save calls
                never included scheduledDurationMinutes at all, so saving
                an already-scheduled practice from here silently reset its
                target duration to null every time -- this field, and
                threading schedDuration through handleSave/handleRun, is
                also the fix for that, not just new UI. */}
            {editP&&<div className="fld"><label className="lbl">Duration (min)</label>
              <input className="inp" type="number" min="1" placeholder="e.g. 60" value={schedDuration} onChange={e=>{const v=e.target.value;setSchedDuration(v===""?"":+v);}}/>
            </div>}
          </div>
        </div>}
      </div>
      {/* Goal Guidance (Enhancement 3): its own sibling section, never
          inside Practice Details' own body, so the coach can keep Practice
          Details collapsed while selectively opening this. Starts
          collapsed on every Builder entry path. */}
      <BuilderGoalGuidance team={team} teamId={teamId} data={data} coachId={coachId} acts={acts} schedDuration={schedDuration} startOpen={goalGuidanceStartOpen} highlightedSkillCategoryId={highlightedSkillCategoryId} onHighlightConsumed={()=>setHighlightedSkillCategoryId(null)} />
      {/* The Run of Practice: solid dark-green backdrop behind the header
          and whatever's inside it (empty message or the real list) -- this
          is the app's own brand color and this is its moment, per direct
          feedback. Header always renders, even with nothing added yet, so
          it's clear from the first tap that this is where the practice
          gets built.
          The backdrop itself is an absolutely-positioned div (see
          runOfPracticeH/the ResizeObserver effect above), NOT a real
          wrapping box around the header/rows -- see that effect's comment
          for why: a real wrapping box constrains position:sticky rows to
          barely any "room" to actually stay pinned while scrolling. The
          header, empty-state, and each row are instead normal children of
          the same tall padding:"0 14px" wrapper Practice Components/My
          Drill Library already live in, each carrying its own 10px
          inset (padding or margin) to match the backdrop's old uniform
          padding:10 look.
          Direct feedback, a second round on top of the below: browsing the
          Library with the practice already scrolled past meant losing
          sight of "the Run of Practice" entirely -- no header, no sense
          the green section still existed above. The header (and, further
          below, the last-added drill) are now both position:sticky,
          stacked directly beneath the Save/Run Now bar (stickyHeaderH),
          each carrying its own solid green background rather than relying
          on this backdrop -- which only covers this section's natural,
          unscrolled height and would otherwise leave pinned content
          sitting on the plain white page background the moment it's
          scrolled past that point. */}
      <div ref={runOfPracticeStartRef} style={{position:"relative"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:runOfPracticeH,background:"var(--green)",borderRadius:"var(--r)",pointerEvents:"none",zIndex:0}}/>
      </div>
      <div ref={ropHeaderRef} style={{position:"sticky",top:stickyHeaderH,zIndex:9,background:"var(--green)",borderRadius:"var(--r) var(--r) 0 0",display:"flex",alignItems:"center",gap:10,padding:"10px 10px 8px"}}>
        <RunOfPracticeMark rotation={handRotation}/>
        <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:20,fontWeight:900,color:"#fff",letterSpacing:".01em",flex:1,lineHeight:1.1}}>The Run of Practice</span>
        {(()=>{
          // Reads the live schedDuration state, not editP directly, so
          // the pill updates immediately as the coach edits Duration in
          // Practice Details rather than only after a save/reload.
          const over=editP&&schedDuration&&totalMins<schedDuration*0.9;
          // Direct feedback: a practice whose drills add up to *more* than
          // the scheduled duration deserves its own warning too, distinct
          // from the under-planned case -- amber, not red, since running
          // long isn't the same problem as not having enough planned yet.
          const exceeds=editP&&schedDuration&&totalMins>schedDuration;
          const warn=over?" over":exceeds?" exceeds":"";
          // White-on-green for the normal case -- the pill's own default
          // (light green bg, green text) would nearly disappear against
          // this section's solid green. Either warning state already reads
          // fine here (red/amber against green), so it keeps its own
          // .pill.over/.pill.exceeds styling untouched rather than being
          // forced white too, which would hide the warning entirely.
          const hasTarget=!!(editP&&schedDuration);
          const remaining=hasTarget?schedDuration-totalMins:0;
          const remainingLabel=remaining>0?"Needs "+remaining+" more min":remaining<0?(-remaining)+" min over":"Fully planned";
          const label=hasTarget?(totalMins+"/"+schedDuration+" min"):(totalMins+"m");
          const display=hasTarget&&pillShowRemaining?remainingLabel:label;
          const pillStyle=warn?{flexShrink:0}:{background:"#fff",borderColor:"#fff",flexShrink:0};
          if(!(acts.length>0||hasTarget))return null;
          // Only meaningful to toggle when there's a real target to measure
          // "more needed" against -- an unscheduled build's plain totalMins
          // pill stays a static span, same as before.
          return hasTarget
            ?<button type="button" className={"pill"+warn} style={Object.assign({cursor:"pointer"},pillStyle)} onClick={()=>setPillShowRemaining(v=>!v)}>{display}</button>
            :<span className={"pill"+warn} style={pillStyle}>{display}</span>;
        })()}
      </div>
      {/* Pre-Practice Warmup: not a real activity (see the
          pre_practice_notes migration comment) -- rendered here, above
          every real row, so it's always first regardless of how the coach
          reorders the rest of the plan, and outside ActivityDndContext so
          it can never be dragged into the middle of it. Always present now
          (direct feedback: shouldn't be an opt-in component a coach has to
          remember to add), collapsed by default so it doesn't take up room
          on the common case of a practice that doesn't need one. Dashed
          border + light green fill against the solid green backdrop is the
          "visual distinction from the rest of the practice plan" asked for. */}
      <div style={{position:"relative",zIndex:1,marginLeft:10,marginRight:10,marginBottom:9,background:"var(--gbg)",border:"2px dashed var(--green2)",borderRadius:"var(--r)",padding:"11px 12px"}}>
        <button type="button" onClick={()=>setWarmupOpen(o=>!o)} style={{display:"flex",alignItems:"center",width:"100%",background:"none",border:"none",padding:0,cursor:"pointer",gap:8,textAlign:"left"}}>
          <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:900,letterSpacing:".05em",textTransform:"uppercase",color:"var(--green)",flex:1}}>Pre-Practice Warmup</span>
          {!warmupOpen&&prePracticeNotes&&<span style={{fontSize:11,color:"var(--td)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:140}}>{prePracticeNotes}</span>}
          <Ic.Chev up={warmupOpen}/>
        </button>
        {warmupOpen&&<>
          <div style={{fontSize:12,color:"var(--td)",margin:"8px 0"}}>What should players do if they arrive before practice starts (grab a ball, start stretching, etc.)? Shown on the Practice Setup screen. Leave this blank if you'd rather not give arrival guidance.</div>
          <textarea className="ta" value={prePracticeNotes} onChange={e=>setPrePracticeNotes(e.target.value)} placeholder="e.g. Grab a ball and start dribbling." style={{minHeight:64}}/>
        </>}
      </div>
      {acts.length===0&&(<div style={{position:"relative",zIndex:1,textAlign:"center",padding:"8px 22px 18px"}}>
          <div style={{fontSize:13,color:"rgba(255,255,255,.9)",lineHeight:1.7,marginBottom:teamTemplates.length?10:0}}>Nothing added yet.<br/>Add activities below to begin building your Run of Practice.</div>
          {teamTemplates.length>0&&<button className="btn bsm" style={{background:"#fff",color:"var(--green)"}} onClick={()=>setShowTplPicker(true)}>Start with a Template</button>}
        </div>
      )}
      {/* The "torn edge" strip: a sticky spacer sandwiched between the
          header above and the always-last-drill row below, present
          whenever there's more than one activity (with exactly one, first
          === last and nothing could ever be hidden between them). Went
          through two visuals before this one, both corrected from direct
          feedback on a live screenshot: a 4-gradient CSS tile that read as
          crosses, then a continuous mountain-range clip-path zigzag that
          was the right *technique* but the wrong *shape* -- "a heartbeat
          line that flattens after the first 1/5th," not a repeating wave.
          An actual EKG trace is a real stroked line (a pulse then a flat
          baseline), not a two-tone fill/cut boundary, so this is a plain
          SVG polyline instead of a clip-path -- white, matching the
          header's own white text/icon for contrast against the solid
          green, `vectorEffect="non-scaling-stroke"` so the line stays a
          crisp constant width regardless of how wide this stretches.
          Opacity-toggled (not clip-path-toggled) by ropContentHidden --
          invisible at 0 (flush green, matching the header/backdrop) the
          moment the IntersectionObserver above reports the first activity
          has scrolled back into view, fully visible the moment it's
          scrolled out. */}
      {acts.length>1&&(<div style={{position:"sticky",top:ropStickyTop,zIndex:8,height:ropZigzagH,background:"var(--green)",overflow:"hidden"}}>
        <svg viewBox={"0 0 100 "+ropZigzagH} preserveAspectRatio="none" style={{width:"100%",height:"100%",display:"block"}}>
          <polyline points={"0,"+(ropZigzagH/2)+" 6,"+(ropZigzagH/2)+" 7.5,"+(ropZigzagH*0.6)+" 9,"+(ropZigzagH*0.03)+" 10.5,"+(ropZigzagH*0.97)+" 12,"+(ropZigzagH*0.4)+" 13.5,"+(ropZigzagH/2)+" 100,"+(ropZigzagH/2)} fill="none" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{opacity:ropContentHidden?1:0,transition:"opacity .2s ease"}}/>
        </svg>
      </div>)}
      {acts.length>0&&(<ActivityDndContext sensors={dndSensors} onDragEnd={onActDragEnd} items={acts.map(a=>a.id)}>
      {acts.map((act)=>{const isLast=act.id===ropLastId;
        // Real bug found live (direct feedback: building a station block,
        // "unable to scroll down far enough to see the bottom options"):
        // sticky was keyed on isLast alone, with no regard for whether the
        // row was currently expanded. A position:sticky element, once
        // stuck, never reveals more of its own overflowing content by
        // scrolling further -- scrolling only moves whatever comes after
        // it in the document, not the stuck element itself -- so a tall
        // expanded row (a multi-station block with rotate/static controls,
        // time-at-station/transition steppers, generate-random, group-by,
        // every station's own equipment/player pickers) pinned this way
        // permanently clips its own lower half, unreachable no matter how
        // far the coach scrolls. This project's own prior assumption
        // ("per-station collapse keeps even a multi-station block short")
        // didn't hold -- the block-level controls alone, always visible
        // whenever the block is expanded regardless of per-station
        // collapse, are tall enough to trigger this on a phone viewport.
        // Only the collapsed (single-line) case is ever safe to pin.
        const stickyNow=isLast&&expandedId!==act.id;
        return (<SortableActivityRow key={act.id} id={act.id} sticky={stickyNow} stickyTop={ropStickyTop+ropZigzagH} stickyBg={stickyNow?"var(--green)":undefined}>{dragHandle=>(<div>
            <div className="ablk" style={{marginLeft:10,marginRight:10}} ref={el=>{if(el)rowRefs.current[act.id]=el;else delete rowRefs.current[act.id];}}>
              {/* A newly-added row auto-expands (see addAct/addBlock/
                  addComponentType) so the coach sees its content
                  immediately without an extra tap. Staying pinned to the
                  top while scrolling, on the other hand, is tied to being
                  both positionally last (isLast, above) *and* currently
                  collapsed (stickyNow) -- an expanded row is never sticky,
                  precisely to avoid the scroll trap described above; it
                  only starts pinning once collapsed again, whether that's
                  this same row or a later one added after it. Tapping this
                  header (to expand or collapse) still clears lastAddedId --
                  once the coach has interacted with the row directly, it's
                  done being "the one that just got added" for auto-expand
                  purposes, independent of whether it's still pinned.
                  Clicking away from it (see the click-away effect above)
                  collapses it the same way. */}
              <div className="abhdr" style={{position:"relative"}} onClick={()=>{const willExpand=expandedId!==act.id;setExpandedId(willExpand?act.id:null);if(act.id===lastAddedId)setLastAddedId(null);}}>
                {dragHandle}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{font:"700 14px Barlow Condensed,sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {act.type==="station_block"?(act.name||"Station Block"):act.name}
                    {/* Direct feedback: a coach should be able to tell at a
                        glance who's leading a drill without expanding it --
                        same coach-or-typed-helper-name label the Practice
                        Setup screen already shows, just inline in the title
                        row here instead of its own section. */}
                    {act.type==="activity"&&<span style={{fontWeight:400,color:"var(--td)"}}> · {act.coachId?((team&&team.coaches.find(c=>c.id===act.coachId))||{}).name||"Unassigned":(act.helperName||"Unassigned")}</span>}
                  </div>
                  {act.type==="station_block"?<div className="limt">{act.stations.map(s=>s.activityName||s.name).join(" / ")} - {act.stationDuration}m x{act.stations.length} + {act.transitionDuration}m trans = {act.stations.length*act.stationDuration+Math.max(0,act.stations.length-1)*act.transitionDuration}m
                    {/* Only shown once this block actually has a station
                        delegated to someone -- pure noise for the far more
                        common single-owner block, where "planned" isn't a
                        meaningful question (the head coach fills in
                        everything themselves, in one pass, same as
                        always). Counts only delegated stations, not every
                        station in the block -- a station nobody delegated
                        is the head coach's own to fill in whenever, not
                        something to flag as "not planned yet." */}
                    {act.stations.some(s=>s.delegatedTo)&&<span> · {act.stations.filter(s=>s.delegatedTo&&stationIsPlanned(s)).length} of {act.stations.filter(s=>s.delegatedTo).length} delegated stations planned</span>}
                  </div>:
                  // Direct feedback: duration's already in the green badge
                  // to the right -- this line's job is letting a coach spot
                  // a forgotten grouping/area/equipment setup without
                  // expanding the row, so it swaps duration out for those
                  // instead.
                  <div className="limt">{(()=>{
                    const g=act.grouping||"whole";
                    const groupingText=g==="whole"?"Whole Team":g==="partners"?"Partners":(act.numGroups||2)+" Groups";
                    const areaText=loc&&act.sublocationId?(loc.sublocations.find(s=>s.id===act.sublocationId)||{}).name:null;
                    const equipText=(Array.isArray(act.equipment)?act.equipment:[]).map(id=>{const a=(data.assets||[]).find(a=>a.id===id);return a?a.name:null;}).filter(Boolean).join(", ");
                    return [groupingText,areaText,equipText].filter(Boolean).join(" · ");
                  })()}</div>}
                </div>
                <div className="row">
                  {act.type==="activity"&&isStale(act)&&<div style={{position:"relative"}}>
                    <button type="button" onClick={e=>{
                      e.stopPropagation();
                      if(staleMenuId===act.id){setStaleMenuId(null);return;}
                      setStaleMenuUp(menuNeedsToOpenUpward(e.currentTarget.getBoundingClientRect(),160));
                      setStaleMenuId(act.id);
                    }} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 2px",display:"flex",alignItems:"center"}} aria-label="Drill updated since added" title="This drill has changed in your library since it was added here">
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 2L18.5 17H1.5L10 2Z" fill="#f59e0b" stroke="#b45309" strokeWidth="1" strokeLinejoin="round"/><rect x="9.1" y="7.5" width="1.8" height="5" rx="0.9" fill="#fff"/><rect x="9.1" y="13.3" width="1.8" height="1.8" rx="0.9" fill="#fff"/></svg>
                    </button>
                    {staleMenuId===act.id&&<div className="mini-menu" style={staleMenuUp?{right:0,minWidth:220,padding:10,top:"auto",bottom:"calc(100% - 4px)"}:{right:0,minWidth:220,padding:10}} onClick={e=>e.stopPropagation()}>
                      <div style={{fontSize:12,color:"var(--td)",marginBottom:8,lineHeight:1.4}}>This drill has changed in your library since it was added here.</div>
                      <button type="button" className="btn primary bxs bfull" style={{marginBottom:6}} onClick={()=>refreshFromLibrary(act)}>Refresh to Latest</button>
                      <button type="button" className="btn ghost bxs bfull" onClick={()=>setStaleMenuId(null)}>Keep This Version</button>
                    </div>}
                  </div>}
                  {/* Chevron now sits to the left of the duration badge
                      (was between duration and the red X) -- direct
                      feedback was that having it right next to delete
                      risked an accidental removal tap. */}
                  <span style={{color:"var(--td)",display:"flex"}}><Ic.Chev up={expandedId===act.id}/></span>
                  {act.type!=="station_block"&&<span className="bdg bp">{act.duration}m</span>}
                  {act.type==="station_block"&&<span className="bdg bp">{act.stations.length*act.stationDuration+(act.rotate!==false?Math.max(0,act.stations.length-1)*act.transitionDuration:0)}m</span>}
                  <button className="btn danger bxs" onClick={e=>{e.stopPropagation();remAct(act.id);}}>x</button>
                </div>
              </div>
              {expandedId===act.id&&(<div className="abbody">
                  {act.type==="activity"&&<ActConfig assets={data.assets} coachId={coachId} refreshLibrary={refreshLibrary} act={act} team={team} loc={loc} sport={teamSport} onChange={ch=>updAct(act.id,ch)} onDone={()=>collapseAndScroll(act.id)} libraryDrills={data.activityLibrary} skillTags={data.skillTags}/>}
                  {act.type==="checklist"&&<ChecklistConfig act={act} onChange={ch=>updAct(act.id,ch)} onDone={()=>collapseAndScroll(act.id)}/>}
                  {act.type==="station_block"&&act.stations.some(s=>s.delegatedTo)&&<div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:8}}>
                    {act.stations.filter(s=>s.delegatedTo).map(s=><StationPresenceIndicator key={s.id} stationId={s.id}/>)}
                  </div>}
                  {act.type==="station_block"&&<StationConfig assets={data.assets} coachId={coachId} refreshLibrary={refreshLibrary} act={act} team={team} loc={loc} onChange={ch=>updAct(act.id,ch)} onSt={(sid,ch)=>updSt(act.id,sid,ch)} onDone={()=>collapseAndScroll(act.id)} teamSport={teamSport} libraryDrills={sourceFilteredLib} librarySources={librarySources} libSource={libSource} setLibSource={setLibSource} skillTags={data.skillTags} absentPlayerIds={absentPlayerIds}/>}
                </div>
              )}
            </div>
          </div>)}</SortableActivityRow>
      );})}
      </ActivityDndContext>)}
      <div ref={runOfPracticeEndRef} style={{height:14}}/>
      </>);
      const rightPaneContent=(<>
      {/* Practice Components -- black bar (matches Practice Details/My
          Drill Library), a caret to collapse the tile row, and a "..."
          that opens the Add/Remove picker for which of
          PRACTICE_COMPONENT_TYPES show as one-tap tiles here.
          marginTop here is a real gap from the green section above, not
          just the sentinel's internal bottom padding -- runOfPracticeH is
          measured off runOfPracticeEndRef's own bottom edge, so anything
          added to *this* bar's spacing (instead of the sentinel's height)
          shows up as visible space rather than more green. */}
      <div style={{display:"flex",alignItems:"center",gap:4,background:"var(--black)",color:"#fff",padding:"9px 12px",borderRadius:"var(--r)",marginTop:14,marginBottom:8,minHeight:40}}>
        <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:900,letterSpacing:".08em",textTransform:"uppercase",flex:1}}>Practice Components</span>
        {/* A literal horizontal ellipsis, not the vertical 3-dot kebab used
            elsewhere in the app (.ell-btn) -- asked for specifically, and
            visually distinct from a "more options" menu trigger since this
            opens a whole picker, not a small dropdown. */}
        <button type="button" onClick={()=>setShowComponentsPicker(true)} aria-label="Add or remove practice components" style={{background:"none",border:"none",color:"#fff",cursor:"pointer",padding:"0 6px",fontSize:22,fontWeight:900,lineHeight:1,display:"flex",alignItems:"center"}}>⋯</button>
        <button type="button" onClick={()=>setComponentsOpen(o=>!o)} aria-label={componentsOpen?"Collapse Practice Components":"Expand Practice Components"} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",padding:6,display:"flex",alignItems:"center"}}><Ic.Chev up={componentsOpen}/></button>
      </div>
      {componentsOpen&&(<>
        {visibleTypeKeys.length===0&&<div style={{fontSize:13,color:"var(--td)",textAlign:"center",padding:"12px 0",marginBottom:8}}>No quick-add types selected. Tap the ⋯ above to choose some.</div>}
        {visibleTypeKeys.length>0&&<div className="g2" style={{marginBottom:14}}>
          {PRACTICE_COMPONENT_TYPES.filter(t=>visibleTypeKeys.includes(t.key)).map(t=>(
            <div key={t.key} className="li tap" style={{marginBottom:0}} onClick={()=>addComponentType(t.key)}>
              <div className="lim"><div className="lin">{t.label}</div><div className="limt">{t.kind==="station_block"?"2+ stations":t.defaultDuration+" min"}</div></div>
              <span style={{color:"var(--green)",fontSize:18,fontWeight:700,flexShrink:0}}>+</span>
            </div>
          ))}
          {/* Direct feedback: an odd number of tiles always leaves one grid
              cell blank in this 2-column layout -- fill it with a real
              pointer to the ellipsis menu instead of leaving dead space.
              Reactive off visibleTypeKeys itself, so this comes back on its
              own any time editing the picker leaves an odd count again,
              never something that has to be dismissed once and remembered. */}
          {visibleTypeKeys.length%2===1&&<div className="li tap" style={{marginBottom:0,background:"var(--gbg)",border:"1px dashed var(--gb)"}} onClick={()=>setShowComponentsPicker(true)}>
            <div className="lim"><div className="limt" style={{color:"var(--green2)",lineHeight:1.4}}>Tap ⋯ above to add or remove your default practice components.</div></div>
          </div>}
        </div>}
      </>)}
      {/* My Drill Library -- same black bar treatment/thickness as
          Practice Components above, with its own collapse caret too
          (defaults open). */}
      <div style={{display:"flex",alignItems:"center",gap:8,background:"var(--black)",color:"#fff",padding:"9px 12px",borderRadius:"var(--r)",marginBottom:8,minHeight:40}}>
        {librarySources.length>1?(
          <select value={libSource} onChange={e=>setLibSource(e.target.value)} onClick={e=>e.stopPropagation()} style={{flex:1,background:"rgba(255,255,255,.12)",color:"#fff",border:"1px solid rgba(255,255,255,.3)",borderRadius:6,padding:"5px 6px",fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:900,letterSpacing:".04em",textTransform:"uppercase"}}>
            {librarySources.map(s=>(<option key={s.key} value={s.key} style={{color:"#000"}}>{s.label}</option>))}
          </select>
        ):(
          <span style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:13,fontWeight:900,letterSpacing:".08em",textTransform:"uppercase",flex:1}}>My Library</span>
        )}
        {libSource==="mine"&&<button className="btn bxs" style={{background:"rgba(255,255,255,.16)",color:"#fff"}} onClick={()=>openModal("addActivity")}>+ New Activity</button>}
        <button type="button" onClick={()=>setMyDrillsOpen(o=>!o)} aria-label={myDrillsOpen?"Collapse My Drill Library":"Expand My Drill Library"} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",padding:6,display:"flex",alignItems:"center"}}><Ic.Chev up={myDrillsOpen}/></button>
      </div>
      {myDrillsOpen&&(<>
      {team&&<div className="clbl" style={{marginBottom:8}}>{teamSport} + General</div>}
      {(()=>{
        const builderAvailableTags=[...new Set(sourceFilteredLib.flatMap(a=>a.skillTagIds||[]))].map(id=>skillTagsById[id]).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name));
        const builderFilteredLib=builderTagFilter.length?sourceFilteredLib.filter(a=>(a.skillTagIds||[]).some(id=>builderTagFilter.includes(id))):sourceFilteredLib;
        const LibRow=({lib})=>(
          <div key={lib.id} className="li tap" onClick={()=>addActChecked(lib)}>
            <div className="lim">
              <div className="lin">{lib.name}</div>
              {lib.description&&<div className="limt">{lib.description}</div>}
              {lib.coachingPoints&&<div style={{fontSize:11,color:"var(--green2)",marginTop:2}}>{lib.coachingPoints}</div>}
              {lib.skillTagIds&&lib.skillTagIds.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
                {tagNames(lib.skillTagIds).map(name=>(<span key={name} className="bdg bs" style={{fontSize:10}}>{name}</span>))}
              </div>}
            </div>
            <div className="lir"><span className="bdg bp">{lib.duration}m</span><span style={{color:"var(--green)",fontSize:20,fontWeight:700,marginLeft:4}}>+</span></div>
          </div>
        );
        return (<>
          <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
            <select className="btn ghost bxs" value={builderDrillSort} onChange={e=>setBuilderDrillSort(e.target.value)}>
              <option value="custom">Sort: Custom</option>
              <option value="alpha">Sort: Alphabetical</option>
              <option value="byskill">Group by Skill</option>
            </select>
            {builderAvailableTags.length>0&&<button type="button" className="btn ghost bxs" onClick={()=>setShowBuilderFilter(s=>!s)}>{builderTagFilter.length?"Filter ("+builderTagFilter.length+")":"Filter"}</button>}
          </div>
          {showBuilderFilter&&<div className="card" style={{marginBottom:10,padding:10}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:builderTagFilter.length?8:0}}>
              {builderAvailableTags.map(t=>(<button key={t.id} type="button" onClick={()=>setBuilderTagFilter(f=>f.includes(t.id)?f.filter(id=>id!==t.id):[...f,t.id])} style={{padding:"4px 10px",borderRadius:20,border:"1.5px solid var(--b)",background:builderTagFilter.includes(t.id)?"var(--green)":"var(--s1)",color:builderTagFilter.includes(t.id)?"#fff":"var(--black)",fontSize:12,cursor:"pointer"}}>{t.name}</button>))}
            </div>
            {builderTagFilter.length>0&&<button type="button" className="btn ghost bxs" onClick={()=>setBuilderTagFilter([])}>Clear filter</button>}
          </div>}
          {builderFilteredLib.length===0&&<div style={{fontSize:12,color:"var(--td)",marginBottom:8}}>No drills here yet.</div>}
          {builderDrillSort==="byskill"?(()=>{
            const byTag={};const untagged=[];
            builderFilteredLib.forEach(lib=>{
              if(!lib.skillTagIds||!lib.skillTagIds.length){untagged.push(lib);return;}
              lib.skillTagIds.forEach(tid=>{(byTag[tid]=byTag[tid]||[]).push(lib);});
            });
            const tagIds=Object.keys(byTag).sort((a,b)=>((skillTagsById[a]&&skillTagsById[a].name)||"").localeCompare((skillTagsById[b]&&skillTagsById[b].name)||""));
            return (<>
              {tagIds.map(tid=>(<div key={tid} style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--green)",textTransform:"uppercase",letterSpacing:".05em",padding:"6px 12px",background:"var(--gbg)"}}>{(skillTagsById[tid]&&skillTagsById[tid].name)||"Tag"} ({byTag[tid].length})</div>
                {byTag[tid].map(lib=>(<LibRow key={lib.id} lib={lib}/>))}
              </div>))}
              {untagged.length>0&&<div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--td)",textTransform:"uppercase",letterSpacing:".05em",padding:"6px 12px",background:"var(--s2)"}}>Untagged ({untagged.length})</div>
                {untagged.map(lib=>(<LibRow key={lib.id} lib={lib}/>))}
              </div>}
            </>);
          })():(builderDrillSort==="alpha"?builderFilteredLib.slice().sort((a,b)=>a.name.localeCompare(b.name)):builderFilteredLib).map(lib=>(<LibRow key={lib.id} lib={lib}/>))}
        </>);
      })()}
      </>)}
      </>);
      // Builder's own dirty-tracking/sticky-machinery state (acts, expandedId,
      // stickyHeaderH, ropHeaderH, the IntersectionObserver, dnd-kit) all
      // lives in this same component instance regardless of which branch
      // below renders -- a live window resize across the breakpoint only
      // changes which JSX shape wraps leftPaneContent/rightPaneContent, it
      // never remounts BuilderScreen itself, so no draft is ever lost.
      return isBB?(
        <div className="bb-fill-height" style={{padding:"0 14px",position:"relative",flex:1,minHeight:0,overflow:"hidden"}} ref={runOfPracticeOuterRef}>
          <TwoPane left={leftPaneContent} right={rightPaneContent}/>
        </div>
      ):(
        <div style={{padding:"0 14px",position:"relative"}} ref={runOfPracticeOuterRef}>
          {leftPaneContent}
          {rightPaneContent}
        </div>
      );
      })()}

      {equipmentDialogLib&&<EquipmentMismatchDialog drillName={equipmentDialogLib.name} missing={findMissingEquipment(equipmentDialogLib.equipment,assetsById,ownAssetPool)} context="practice" onAddWithEquipment={()=>resolveAndAdd(equipmentDialogLib,true)} onAddAnyway={()=>resolveAndAdd(equipmentDialogLib,false)} onCancel={()=>setEquipmentDialogLib(null)}/>}
    </div>
  );
}

// View and edit live in the same screen -- there's no separate "Edit
// Player" modal anymore. Tapping Edit swaps the relevant cards to their
// input form in place; everything else (skill notes, Mark Out) stays live
// underneath since those already save as you go.
function PlayerProfile({player:playerInit,team:teamInit,data,refreshTeams,coachId,canManage,onBack}){
  // BB layout pass: a width cap on this full-screen detail view -- just a
  // plain className on the root div below. This hook is unconditional and
  // has no dependency on anything else in this component, so it can't
  // interact with the useBlocker/setSubViewBack effects further down
  // already documented as infinite-loop-risky in BUILD-STATUS.md's own
  // Gotchas -- nothing about them changes here.
  const isBB=useBigBrowser();
  const team=data.teams.find(t=>t.id===teamInit.id)||teamInit;
  const player=team.players.find(p=>p.id===playerInit.id)||playerInit;
  const [markingOut,setMarkingOut]=useState(false);
  const [saving,setSaving]=useState(false);
  const blankForm=()=>({firstName:player.firstName,lastName:player.lastName,jersey:player.jersey||"",positions:player.positions||[],bats:player.bats||"",throws:player.throws||"",notes:player.notes||""});
  // Every field is directly editable the moment you open the profile -- no
  // separate Edit-mode toggle -- so "unsaved changes" is tracked as a dirty
  // check against the last-saved snapshot instead of an editing/not-editing
  // flag. savedSnapshot only moves on a successful save, never from
  // refreshTeams() re-renders, so an in-progress edit here can't get
  // clobbered by an unrelated save elsewhere on the page (e.g. a skill note).
  const [f,setF]=useState(blankForm);
  const [savedSnapshot,setSavedSnapshot]=useState(blankForm);
  const setFld=(k,v)=>setF(p=>Object.assign({},p,{[k]:v}));
  const isDirty=canManage&&JSON.stringify(f)!==JSON.stringify(savedSnapshot);
  const discardEdits=()=>setF(savedSnapshot);
  const saveEdit=async()=>{
    if(!f.firstName.trim())return;
    setSaving(true);
    await updatePlayer(player.id,{firstName:f.firstName,lastName:f.lastName||"",jersey:f.jersey||"",positions:f.positions||[],bats:f.bats||"",throws:f.throws||"",notes:f.notes||""});
    await refreshTeams();
    setSavedSnapshot(f);
    setSaving(false);
  };
  // Direct feedback: a plain "leave without saving?" confirm only offered
  // leave-or-stay, no way to actually save from the prompt itself. Replaced
  // with a real three-way choice (Save & Leave / Discard / Cancel), and
  // widened to cover every way off this screen, not just its own Back
  // button -- bottom-tab and workspace-tab taps navigate via the router
  // directly, bypassing a component-local Back handler entirely. useBlocker
  // is the same guard BuilderScreen/GoalsScreen already use for their own
  // unsaved-changes cases; pendingBack covers this screen's own Back
  // button, which un-drills a view rather than changing the route.
  useEffect(()=>{
    if(!isDirty)return;
    const onBeforeUnload=e=>{e.preventDefault();e.returnValue="";};
    window.addEventListener("beforeunload",onBeforeUnload);
    return()=>window.removeEventListener("beforeunload",onBeforeUnload);
  },[isDirty]);
  const blocker=useBlocker(useCallback(({currentLocation,nextLocation})=>isDirty&&currentLocation.pathname!==nextLocation.pathname,[isDirty]));
  const [pendingBack,setPendingBack]=useState(false);
  const showLeavePrompt=blocker.state==="blocked"||pendingBack;
  const resolveLeave=()=>{
    if(blocker.state==="blocked")blocker.proceed();
    if(pendingBack){setPendingBack(false);onBack();}
  };
  const cancelLeave=()=>{
    if(blocker.state==="blocked")blocker.reset();
    setPendingBack(false);
  };
  const saveAndLeave=async()=>{await saveEdit();resolveLeave();};
  const discardAndLeave=()=>{discardEdits();resolveLeave();};
  const handleBack=()=>{
    if(isDirty){setPendingBack(true);return;}
    onBack();
  };
  // Nav restructure round 3: registers with Layout's colored bar instead of
  // rendering its own inline Back button. Registers once (a ref keeps the
  // callback seeing the latest isDirty/handleBack without needing to
  // re-register) -- re-registering on every render, as this used to, formed
  // a real infinite render loop once useBlocker was added above: blocker's
  // own re-render on every parent render kept re-triggering this effect,
  // whose setSubViewBack call itself triggers a re-render via AppCtx,
  // feeding back into the same cycle. Found live (React's "Maximum update
  // depth exceeded" warning, reproduced fresh in a clean tab) after last
  // session's leave-prompt work shipped.
  const {setSubViewBack}=useAppCtx();
  const handleBackRef=useRef(handleBack);
  handleBackRef.current=handleBack;
  useEffect(()=>{
    setSubViewBack({onBack:()=>handleBackRef.current()});
    return ()=>setSubViewBack(null);
  },[setSubViewBack]);

  // Assistant-coach handoff §2.4: reverse-chron read of every session/
  // practice note this player was @mentioned in, across any team practice
  // -- a new read path (fetchNotesForPlayer), not a new write path; no RLS
  // beyond "can the viewer already see this team's data," same as
  // everything else on this screen.
  const [playerNotes,setPlayerNotes]=useState([]);
  useEffect(()=>{fetchNotesForPlayer(player.id).then(setPlayerNotes);},[player.id]);
  const playerNoteAuthor=n=>{
    if(n.authorKind==="anonymous")return (n.authorLabel||"A helper")+" · Helper";
    const c=team.coaches.find(c=>c.userId===n.createdBy);
    return (c?c.name:"A coach")+(c?" · "+c.role:"");
  };
  // Direct feedback: head coaches should be able to delete a note from
  // any screen where notes tied to a player show up, not just the new
  // live-attendance player card -- same isHeadCoach gate, same
  // archiveNote call.
  const amHeadCoach=isHeadCoach(team,coachId);
  const [deletingNoteId,setDeletingNoteId]=useState(null);
  const deletePlayerNote=async id=>{
    setDeletingNoteId(id);
    await archiveNote(id);
    setPlayerNotes(ns=>ns.filter(n=>n.id!==id));
    setDeletingNoteId(null);
  };
  const areas=player.focusAreas||[];
  const areaFor=categoryId=>areas.find(a=>a.categoryId===categoryId);
  const categories=(data.skillCategories||[]).filter(c=>c.sport===team.sport).sort((a,b)=>a.sort_order-b.sort_order);
  // Text fields save on blur, not on every keystroke -- `drafts` holds
  // in-progress edits so a re-render from an unrelated field's save
  // doesn't clobber what the coach is mid-typing in this one. One note
  // per category, not per tag underneath it -- Shooting gets one field,
  // not four.
  const [drafts,setDrafts]=useState({});
  const [savingCategoryId,setSavingCategoryId]=useState(null);
  const draftFor=categoryId=>{const a=areaFor(categoryId);return drafts[categoryId]!==undefined?drafts[categoryId]:(a?a.note||"":"");};
  const setDraft=(categoryId,v)=>setDrafts(p=>Object.assign({},p,{[categoryId]:v}));
  const commitNote=async categoryId=>{
    if(drafts[categoryId]===undefined)return;
    const existing=areaFor(categoryId);
    const current=existing?existing.note||"":"";
    if(drafts[categoryId].trim()===current)return;
    setSavingCategoryId(categoryId);
    await setPlayerCategoryNote(player.id,categoryId,drafts[categoryId],coachId,existing?existing.id:null);
    await refreshTeams();
    setSavingCategoryId(null);
  };
  const throwsLabel=((HAND_FIELDS_BY_SPORT[team.sport]||[]).find(hf=>hf.key==="throws")||{}).label||"Throws";

  return (<div className={isBB?"bb-centered-page":undefined} style={{paddingBottom:80}}>
    <div className="row mb10" style={{justifyContent:"space-between",alignItems:"flex-start"}}>
      <div style={{flex:1,minWidth:0}}>
        {!canManage?(<>
          <div style={{fontFamily:"Barlow Condensed,sans-serif",fontSize:22,fontWeight:900}}>{player.firstName} {player.lastName}</div>
          <div className="td" style={{fontSize:12}}>{team.name}{player.jersey?" · #"+player.jersey:""}</div>
        </>):(
          <div className="g2">
            <div className="fld"><label className="lbl">First Name</label><input className="inp" value={f.firstName} onChange={e=>setFld("firstName",e.target.value)}/></div>
            <div className="fld"><label className="lbl">Last Name</label><input className="inp" value={f.lastName} onChange={e=>setFld("lastName",e.target.value)}/></div>
          </div>
        )}
      </div>
    </div>
    <button className="btn outline bsm bfull" style={{marginBottom:10}} onClick={()=>setMarkingOut(true)}>Mark Out For...</button>
    {markingOut&&<AbsencePicker data={data} coachId={coachId} mode="pickPlayerThenPractices" presetPlayer={Object.assign({},player,{teamId:team.id})} onClose={()=>setMarkingOut(false)}/>}

    <div className="card mb10">
      <div className="clbl mb8">Basic Info</div>
      {canManage?<div className="fld" style={{marginBottom:0}}><label className="lbl">Jersey #</label><input className="inp" type="number" inputMode="numeric" value={f.jersey} onChange={e=>setFld("jersey",e.target.value)}/></div>
        :<div style={{fontSize:14,color:"var(--black)"}}>{player.jersey?"Jersey #"+player.jersey:"No jersey number set"}</div>}
    </div>

    <div className="card mb10">
      <div className="clbl mb8">Positions &amp; Handedness</div>
      {canManage?(<>
        <PositionPicker sport={team.sport} value={f.positions} onChange={v=>setFld("positions",v)}/>
        <HandednessPicker sport={team.sport} value={f} onChange={(k,v)=>setFld(k,v)}/>
      </>):(<>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:(player.bats||player.throws)?10:0}}>
          {(player.positions||[]).map(pos=>(<span key={pos} className="bdg bs">{pos}</span>))}
          {!(player.positions&&player.positions.length)&&<div style={{fontSize:13,color:"var(--td)"}}>No positions set</div>}
        </div>
        {(player.bats||player.throws)&&<div style={{display:"flex",gap:18}}>
          {player.bats&&<div><div style={{fontSize:10,color:"var(--td)",textTransform:"uppercase",letterSpacing:".06em"}}>Bats</div><div style={{fontSize:14,fontWeight:700}}>{HAND_LABELS[player.bats]||player.bats}</div></div>}
          {player.throws&&<div><div style={{fontSize:10,color:"var(--td)",textTransform:"uppercase",letterSpacing:".06em"}}>{throwsLabel}</div><div style={{fontSize:14,fontWeight:700}}>{HAND_LABELS[player.throws]||player.throws}</div></div>}
        </div>}
      </>)}
    </div>

    <div className="card">
      <div className="clbl mb6">General Notes</div>
      {canManage?<textarea className="ta" value={f.notes} onChange={e=>setFld("notes",e.target.value)}/>
        :(player.notes?<div style={{fontSize:14,color:"var(--black)",lineHeight:1.6}}>{player.notes}</div>:<div style={{fontSize:13,color:"var(--td)"}}>No notes yet.</div>)}
    </div>

    {/* Save now always present (not just once dirty) -- direct feedback:
        a button that appears/disappears as you type made it easy to lose
        track of where it'd be. Discard stays conditional since there's
        nothing to discard until something's actually changed. */}
    {canManage&&<div className="brow mt10 mb10">
      {isDirty&&<button className="btn ghost bmd" style={{flex:1}} onClick={discardEdits} disabled={saving}>Discard Changes</button>}
      <button className="btn primary bmd" style={{flex:1}} onClick={saveEdit} disabled={saving||!isDirty||!f.firstName.trim()}>{saving?"Saving...":"Save"}</button>
    </div>}
    {showLeavePrompt&&<div className="confirm-box mb10">
      <div className="confirm-title">Unsaved Changes</div>
      <div className="confirm-body">You have unsaved changes to this player. Would you like to save before leaving?</div>
      <div className="brow" style={{marginBottom:8}}>
        <button className="btn ghost bsm" onClick={cancelLeave} disabled={saving}>Cancel</button>
        <button className="btn outline bsm" style={{flex:1}} onClick={discardAndLeave} disabled={saving}>Leave Without Saving</button>
      </div>
      <button className="btn primary bsm bfull" onClick={saveAndLeave} disabled={saving||!f.firstName.trim()}>{saving?"Saving...":"Save & Leave"}</button>
    </div>}

    <div className="clbl mb8" style={{marginTop:16}}>Player Focus</div>
    {!categories.length&&<div className="card mb10"><div style={{fontSize:13,color:"var(--td)"}}>No skill categories set up yet for {team.sport}.</div></div>}
    {categories.length>0&&<div className="card mb10">
      {categories.map(cat=>(<div key={cat.id} style={{marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--black2)",marginBottom:3}}>{cat.name}</div>
        <input className="inp" placeholder="What's this player working on..." value={draftFor(cat.id)} onChange={e=>setDraft(cat.id,e.target.value)} onBlur={()=>commitNote(cat.id)} disabled={!canManage||savingCategoryId===cat.id}/>
      </div>))}
    </div>}

    {playerNotes.length>0&&<div>
      <div className="clbl mb8">Practice Notes</div>
      <div className="card mb10">
        {playerNotes.map(n=>(<div key={n.id} style={{marginBottom:10,paddingBottom:10,borderBottom:"1px solid var(--b)"}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
            <div style={{fontSize:11,color:"var(--td)",marginBottom:2}}>{playerNoteAuthor(n)} · {new Date(n.createdAt).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</div>
            {amHeadCoach&&<button type="button" disabled={deletingNoteId===n.id} onClick={()=>deletePlayerNote(n.id)} style={{background:"none",border:"none",padding:0,fontSize:11,color:"var(--red)",cursor:"pointer",flexShrink:0}}>{deletingNoteId===n.id?"Deleting...":"Delete"}</button>}
          </div>
          <div style={{fontSize:14}}>{n.text}</div>
        </div>))}
      </div>
    </div>}
  </div>);
}

function RostersTab({data,openModal,fixedTeamId,refreshTeams,coachId,refreshLibrary,mode}){
  // BB layout pass: a width cap (CenteredPage's own .bb-centered-page
  // class) on the list, same treatment as PlayerProfile below -- no
  // permission-toggle/deep-link/staleness logic touched.
  const isBB=useBigBrowser();
  const [teamId,setTeamId]=useState(fixedTeamId||(data.teams[0]?data.teams[0].id:""));
  useEffect(()=>{
    if(fixedTeamId){if(teamId!==fixedTeamId)setTeamId(fixedTeamId);return;}
    if(!data.teams.some(t=>t.id===teamId))setTeamId(data.teams[0]?data.teams[0].id:"");
  },[data.teams,fixedTeamId]);
  // Deep-link from Home's "a coach accepted your invite" notification
  // (direct feedback) -- same location.state convention Settings' Terms/
  // Privacy back button already established. Read once on mount; cleared
  // after use (via the pending-id going null) so switching teams or
  // re-rendering doesn't keep reopening it.
  const location=useLocation();
  const [pendingPermissionsUserId,setPendingPermissionsUserId]=useState(()=>(location.state&&location.state.openPermissionsForUserId)||null);
  // Real bug: team_staff/team_invites have no realtime subscription and
  // `data.teams` is loaded once at login, so a coach who accepted an
  // invite on their own device left the inviter's already-open session
  // showing the old pending row indefinitely. Refetching whenever this
  // screen mounts means opening Coaches always reflects the real state,
  // not just whichever moment the app happened to last load.
  useEffect(()=>{if(refreshTeams)refreshTeams();},[]);
  const [tab,setTab]=useState(pendingPermissionsUserId?"coaches":"players");
  const [openMenu,setOpenMenu]=useState(null);
  const [openMenuUp,setOpenMenuUp]=useState(false);
  const [sort,setSort]=useState({by:"firstName",dir:"asc"});
  const [viewPlayer,setViewPlayer]=useState(null);
  const [confirmRemovePlayer,setConfirmRemovePlayer]=useState(null);
  // Direct feedback: removing an assistant/helper from the roster used to
  // happen immediately on tap, no confirmation -- same "Cannot be undone"
  // confirm step confirmRemovePlayer already has below.
  const [confirmRemoveCoach,setConfirmRemoveCoach]=useState(null);
  // Direct feedback: PermissionsModal's toggles weren't visually reflecting
  // a tap until the coach closed and reopened it. Root cause -- this used to
  // hold the whole coach *object*, snapshotted at the moment the row was
  // clicked; refreshTeams() after a toggle updates data.teams with a brand
  // new coach object, but this state var kept pointing at the stale one
  // since nothing ever reassigned it. Holding just the id and re-deriving
  // the live object from `team.coaches` below means every render (including
  // the one right after refreshTeams() resolves) reflects the real value.
  const [permissionsCoachId,setPermissionsCoachId]=useState(null);
  const team=data.teams.find(t=>t.id===teamId)||null;
  const permissionsCoach=permissionsCoachId?(team&&team.coaches||[]).find(c=>c.id===permissionsCoachId)||null:null;
  useEffect(()=>{
    if(!pendingPermissionsUserId||!team)return;
    const c=(team.coaches||[]).find(c=>c.userId===pendingPermissionsUserId);
    if(c)setPermissionsCoachId(c.id);
    setPendingPermissionsUserId(null);
  },[pendingPermissionsUserId,team]);
  // canManageTeamInMode, not bare isHeadCoach -- a director managing an org
  // team should be able to add/edit players and staff without needing a
  // personal team_staff row on that specific team (org_create_team no
  // longer auto-creates one; see BUILD-STATUS).
  const canManage=canManageTeamInMode(team,coachId,mode);
  const delP=async id=>{await archivePlayer(id);await refreshTeams();};
  const doRemovePlayer=async()=>{
    await delP(confirmRemovePlayer.id);
    setConfirmRemovePlayer(null);
  };
  const delC=async id=>{await archiveStaff(id);await refreshTeams();};
  const doRemoveCoach=async()=>{
    await delC(confirmRemoveCoach.id);
    setConfirmRemoveCoach(null);
  };
  // Resend reuses invite_team_staff's own upsert-by-email logic -- calling
  // it again with the same stored fields just refreshes the existing
  // pending row (or revives a declined one) rather than creating a
  // duplicate, no separate "resend" RPC needed.
  const resendInvite=async inv=>{await inviteTeamStaff(inv.teamId,{name:inv.name,role:inv.role,inviteEmail:inv.email});await refreshTeams();};
  const clearInvite=async id=>{await cancelTeamInvite(id);await refreshTeams();};
  const sorted=team?[...team.players].sort((a,b)=>{
    let av,bv;
    if(sort.by==="jersey"){av=parseInt(a.jersey)||0;bv=parseInt(b.jersey)||0;}
    else if(sort.by==="firstName"){av=(a.firstName||"").toLowerCase();bv=(b.firstName||"").toLowerCase();}
    else if(sort.by==="lastName"){av=(a.lastName||"").toLowerCase();bv=(b.lastName||"").toLowerCase();}
    else{av=(a.firstName+" "+a.lastName).toLowerCase();bv=(b.firstName+" "+b.lastName).toLowerCase();}
    return sort.dir==="asc"?(av>bv?1:av<bv?-1:0):(av<bv?1:av>bv?-1:0);
  }):[];
  if(viewPlayer)return(<PlayerProfile player={viewPlayer} team={team} data={data} refreshTeams={refreshTeams} coachId={coachId} canManage={canManage} onBack={()=>setViewPlayer(null)}/>);
  return (<div className={isBB?"bb-centered-page":undefined} style={{paddingBottom:80}} onClick={()=>setOpenMenu(null)}>
    {!fixedTeamId&&(<div className="sechdr mb8">
      <div>{data.teams.length>1&&<select className="sel" style={{maxWidth:200}} value={teamId} onChange={e=>setTeamId(e.target.value)}>{data.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>}</div>
      <button className="btn primary bsm" onClick={e=>{e.stopPropagation();openModal("addTeam");}}>+ Team</button>
    </div>)}
    {team&&(<div>
      <div className="itabs">
        <button className={"itab "+(tab==="players"?"on":"")} onClick={()=>setTab("players")}>Players ({team.players.length})</button>
        <button className={"itab "+(tab==="coaches"?"on":"")} onClick={()=>setTab("coaches")}>Coaches ({team.coaches.length})</button>
      </div>
      {tab==="players"&&(<div>
        <div className="sechdr mb8">
          <div className="row"><span className="sectitle">{team.players.length} Players</span>
            <div style={{position:"relative"}}>
              <button className="sort-btn" onClick={e=>{e.stopPropagation();setOpenMenu(openMenu==="__sort__"?null:"__sort__");}}><Ic.Sort/></button>
              {openMenu==="__sort__"&&(<div className="mini-menu" style={{left:0,minWidth:160}}>
                {[
                  {by:"firstName",dir:"asc",label:"First Name A-Z"},
                  {by:"firstName",dir:"desc",label:"First Name Z-A"},
                  {by:"lastName",dir:"asc",label:"Last Name A-Z"},
                  {by:"lastName",dir:"desc",label:"Last Name Z-A"},
                  {by:"jersey",dir:"asc",label:"# Low-High"},
                  {by:"jersey",dir:"desc",label:"# High-Low"},
                ].map(opt=>(<button key={opt.by+opt.dir} className="mm-item" onClick={e=>{e.stopPropagation();setSort({by:opt.by,dir:opt.dir});setOpenMenu(null);}}>
                  {sort.by===opt.by&&sort.dir===opt.dir?"* ":""}{opt.label}
                </button>))}
              </div>)}
            </div>
          </div>
          {canManage&&<button className="btn outline bsm" onClick={e=>{e.stopPropagation();openModal("addPlayer",{teamId});}}>+ Add</button>}
        </div>
        {sorted.map(p=>(<div key={p.id} className="li tap" style={{position:"relative"}} onClick={()=>setViewPlayer(p)}>
          <div className="lim">
            <div className="lin">{p.jersey?"#"+p.jersey+" ":""}{p.firstName} {p.lastName}{p.positions&&p.positions.length>0?" · "+p.positions.join("/"):""}</div>
            {(p.focusAreas&&p.focusAreas.length>0)&&<div className="limt">{p.focusAreas.length} focus area{p.focusAreas.length>1?"s":""}</div>}
            {(!p.focusAreas||!p.focusAreas.length)&&p.notes&&<div className="limt">{p.notes}</div>}
          </div>
          {canManage&&<button className="ell-btn" onClick={e=>{
            e.stopPropagation();
            if(openMenu===p.id){setOpenMenu(null);return;}
            setOpenMenuUp(menuNeedsToOpenUpward(e.currentTarget.getBoundingClientRect(),120));
            setOpenMenu(p.id);
          }}><span/><span/><span/></button>}
          {canManage&&openMenu===p.id&&<div className="mini-menu" style={openMenuUp?{top:"auto",bottom:"calc(100% - 4px)"}:undefined}><button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);setViewPlayer(p);}}>Player Profile</button><button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);setConfirmRemovePlayer(p);}}>Remove</button></div>}
        </div>))}
        {!team.players.length&&<div className="empty"><div className="emtx">No players yet{canManage?" -- tap + Add.":"."}</div></div>}
      </div>)}
      {tab==="coaches"&&(<div>
        <div className="sechdr mb8"><span className="sectitle">{team.coaches.length} Coaches</span>{canManage&&<button className="btn outline bsm" onClick={e=>{e.stopPropagation();openModal("addCoach",{teamId});}}>+ Add</button>}</div>
        {/* Head Coach always listed first, regardless of add/accept order
            (direct feedback) -- a stable sort so assistants/helpers below
            it keep whatever relative order the server returned them in. */}
        {[...team.coaches].sort((a,b)=>(a.role==="Head Coach"?0:1)-(b.role==="Head Coach"?0:1)).map(c=>(<div key={c.id} className="li" style={{position:"relative"}}>
          <div className="lim"><div className="lin">{c.name}</div><div className="limt">{c.role}</div></div>
          {/* Self-service entry point for an assistant/helper viewing their
              own row without manage rights -- there's no ellipsis menu for
              a non-manager otherwise, so this is a plain text button
              instead of hiding the same action inside one. */}
          {!canManage&&c.userId===coachId&&c.role!=="Head Coach"&&<button className="btn ghost bxs" onClick={e=>{e.stopPropagation();setPermissionsCoachId(c.id);}}>Permissions</button>}
          {canManage&&<button className="ell-btn" onClick={e=>{
            e.stopPropagation();
            if(openMenu==="coach_"+c.id){setOpenMenu(null);return;}
            setOpenMenuUp(menuNeedsToOpenUpward(e.currentTarget.getBoundingClientRect(),160));
            setOpenMenu("coach_"+c.id);
          }}><span/><span/><span/></button>}
          {canManage&&openMenu==="coach_"+c.id&&<div className="mini-menu" style={openMenuUp?{top:"auto",bottom:"calc(100% - 4px)"}:undefined}>
            {c.role!=="Head Coach"&&<button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);setPermissionsCoachId(c.id);}}>Permissions</button>}
            <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editCoach",{teamId,coach:c});}}>Edit</button>
            {/* A head coach removing their own row here (not the same as
                leave_team's self-service leave for assistants/helpers) used
                to be possible and would leave the team without a manager --
                real bug found live. Hidden for that one row; the server
                also refuses it now (before_team_staff_archive_block_self_
                head_coach trigger) as a second line of defense. */}
            {!(c.userId===coachId&&c.role==="Head Coach")&&<button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);setConfirmRemoveCoach(c);}}>Remove</button>}
          </div>}
        </div>))}
        {/* Sent invites still waiting on a response or already declined --
            kept visible (not folded into the roster list above, which is
            real active members only) so a head coach can tell "did they
            ever respond" at a glance, per direct feedback that a silently-
            added assistant was confusing. */}
        {(team.invites||[]).length>0&&(<div className="sechdr mb8" style={{marginTop:16}}><span className="sectitle" style={{fontSize:13,color:"var(--td)"}}>Pending Invites</span></div>)}
        {(team.invites||[]).map(inv=>(<div key={inv.id} className="li" style={{position:"relative"}}>
          <div className="lim"><div className="lin">{inv.name}</div><div className="limt">{inv.role} · {inv.status==="pending"?"Invite pending":"Declined"} ({inv.email})</div></div>
          {canManage&&<button className="ell-btn" onClick={e=>{
            e.stopPropagation();
            if(openMenu==="invite_"+inv.id){setOpenMenu(null);return;}
            setOpenMenuUp(menuNeedsToOpenUpward(e.currentTarget.getBoundingClientRect(),160));
            setOpenMenu("invite_"+inv.id);
          }}><span/><span/><span/></button>}
          {canManage&&openMenu==="invite_"+inv.id&&<div className="mini-menu" style={openMenuUp?{top:"auto",bottom:"calc(100% - 4px)"}:undefined}>
            <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);resendInvite(inv);}}>{inv.status==="pending"?"Resend":"Request Again"}</button>
            <button className="mm-item" onClick={e=>{e.stopPropagation();setOpenMenu(null);openModal("editInvite",{invite:inv});}}>Edit</button>
            <button className="mm-item mm-danger" onClick={e=>{e.stopPropagation();setOpenMenu(null);clearInvite(inv.id);}}>Clear</button>
          </div>}
        </div>))}
      </div>)}
    </div>)}
    {!team&&<div className="empty"><div className="emtx">Create a team to get started</div></div>}
    {confirmRemovePlayer&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setConfirmRemovePlayer(null);}}>
      <div className="modal">
        <div className="mtitle">Remove {confirmRemovePlayer.firstName}?</div>
        <div style={{fontSize:14,color:"var(--td)",marginBottom:16}}>This removes {confirmRemovePlayer.firstName} {confirmRemovePlayer.lastName} from the roster. Cannot be undone.</div>
        <div className="brow"><button className="btn ghost bmd" onClick={()=>setConfirmRemovePlayer(null)}>Cancel</button><button className="btn danger bmd" onClick={doRemovePlayer}>Remove</button></div>
      </div>
    </div>}
    {confirmRemoveCoach&&<div className="movly" onClick={e=>{if(e.target===e.currentTarget)setConfirmRemoveCoach(null);}}>
      <div className="modal">
        <div className="mtitle">Remove {confirmRemoveCoach.name}?</div>
        <div style={{fontSize:14,color:"var(--td)",marginBottom:16}}>This removes {confirmRemoveCoach.name} from the roster. Cannot be undone.</div>
        <div className="brow"><button className="btn ghost bmd" onClick={()=>setConfirmRemoveCoach(null)}>Cancel</button><button className="btn danger bmd" onClick={doRemoveCoach}>Remove</button></div>
      </div>
    </div>}
    {permissionsCoach&&<PermissionsModal team={team} coach={permissionsCoach} coachId={coachId} canManage={canManage} refreshTeams={refreshTeams} onClose={()=>setPermissionsCoachId(null)}/>}
  </div>);
}
