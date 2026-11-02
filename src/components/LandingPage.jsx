import React, { useState, useEffect, useRef } from "react";
import { FEATURE_FLAGS } from "../entitlements.js";

// Launch copy (Free/Pro, pricing, partners) shows once early access ends;
// see FEATURE_FLAGS in entitlements.js.
const LAUNCHED = !FEATURE_FLAGS.EARLY_ACCESS_ACTIVE;

const CONTACT_EMAIL = "contact@runofpractice.com";

// ── Live mock-card timers. One page-load timestamp anchors every clock, so
// components that need to depict "the same moment" (hero card, watch screen,
// helper detail card) just call useCountdown with the same start value --
// no shared state needed, they're all deriving from the same Date.now() math.
const PAGE_LOAD_MS = Date.now();
const CLOCK_STATION_BLOCK_START = 4 * 60 + 12; // 04:12, shared by hero/watch/helper detail
const CLOCK_LIVE_DEFAULT_START = 6 * 60 + 45; // 06:45, Live Practice View only

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener ? mql.addEventListener("change", onChange) : mql.addListener(onChange);
    return () => { mql.removeEventListener ? mql.removeEventListener("change", onChange) : mql.removeListener(onChange); };
  }, []);
  return reduced;
}

function useElapsedSeconds() {
  const reducedMotion = usePrefersReducedMotion();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (reducedMotion) return;
    const tick = () => setElapsed(Math.floor((Date.now() - PAGE_LOAD_MS) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [reducedMotion]);
  return elapsed;
}

function formatClock(totalSeconds) {
  const neg = totalSeconds < 0;
  const abs = Math.abs(totalSeconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return (neg ? "-" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// A card left open indefinitely (backgrounded tab, forgotten browser
// window...) would otherwise count into the thousands of negative minutes --
// once a countdown is 5 minutes overdue, loop back to the original start
// time instead of continuing to run away.
const LOOP_GRACE_SECONDS = 5 * 60;
function loopedRemaining(startSeconds, elapsedSeconds) {
  const cycle = Math.max(startSeconds, 0) + LOOP_GRACE_SECONDS;
  return startSeconds - (((elapsedSeconds % cycle) + cycle) % cycle);
}

function useCountdown(startSeconds) {
  const elapsed = useElapsedSeconds();
  const remaining = loopedRemaining(startSeconds, elapsed);
  const over = remaining < 0;
  return { display: formatClock(remaining), over, minutesBehind: over ? Math.ceil(Math.abs(remaining) / 60) : 0 };
}

// Click-driven step timer for the Adjustments card -- no wall-clock ticking,
// just an undo-able history of manual adjustments (this card demonstrates
// the controls, not another running clock).
function useStepTimer(initialSeconds, initialAheadMinutes) {
  const [timerSeconds, setTimerSeconds] = useState(initialSeconds);
  const [aheadMinutes, setAheadMinutes] = useState(initialAheadMinutes);
  const [history, setHistory] = useState([]);
  const [flash, setFlash] = useState(false);
  const flashTimeoutRef = useRef(null);
  useEffect(() => () => { if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current); }, []);

  const doFlash = () => {
    setFlash(true);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setFlash(false), 600);
  };

  return {
    display: formatClock(timerSeconds),
    aheadMinutes,
    over: aheadMinutes < 0,
    flash,
    bump: (deltaMinutes) => { setTimerSeconds(t => t + deltaMinutes * 60); setAheadMinutes(a => a - deltaMinutes); },
    next: () => { setHistory(h => [...h, { timerSeconds, aheadMinutes }]); setTimerSeconds(13 * 60); doFlash(); },
    prev: () => setHistory(h => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setTimerSeconds(last.timerSeconds);
      setAheadMinutes(last.aheadMinutes);
      doFlash();
      return h.slice(0, -1);
    }),
  };
}

// Scoped to this page only -- the app's own CSS (App.jsx's CSS block) is
// injected globally and already defines .btn/.card/.pill/.bdg/.cc-* etc, so
// section visuals below reuse those real component classes instead of
// inventing look-alikes. This block only adds the marketing-page-specific
// layout (header, alternating rows, responsive breakpoint) under an
// `.lp-` prefix so nothing here can collide with the app's own classes.
const LP_CSS = `
.lp{background:var(--canvas);--mock-card-primary:480px;}
.lp-header{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:10px 20px;}
.lp-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;}
.lp-brand img{width:32px;height:32px;border-radius:8px;flex-shrink:0;}
.lp-brand span{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:900;letter-spacing:-.01em;color:var(--ink);}
.lp-nav{display:flex;align-items:center;gap:14px;}
@media (min-width:860px){.lp-nav{gap:22px;}}
/* Phones: the brand name gives way before Pricing does (Pricing is the one
   menu link kept visible at every width, 2026-11-01). */
@media (max-width:400px){.lp-brand span{display:none;}}
.lp-navlink{font-size:13px;font-weight:600;color:var(--ink-soft);text-decoration:none;white-space:nowrap;}
.lp-navlink.hideonsm{display:none;}
.lp-signin{font-size:13px;font-weight:600;color:var(--ink-soft);text-decoration:underline;white-space:nowrap;background:none;border:none;cursor:pointer;}
.lp-wrap{max-width:1120px;margin:0 auto;padding:0 20px;}
.lp-section{padding:56px 0;}
.lp-section.dark{background:var(--ink);color:#fff;}
.lp-section.tight{padding:34px 0;}
.lp-eyebrow{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--field-accent);margin-bottom:8px;}
.lp-section.dark .lp-eyebrow{color:var(--field-tint-border);}
.lp-title{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;line-height:1.15;letter-spacing:-.01em;margin-bottom:14px;color:var(--ink);}
.lp-section.dark .lp-title{color:#fff;}
.lp-body{font-size:15.5px;line-height:1.65;color:var(--ink-soft);margin-bottom:12px;}
.lp-section.dark .lp-body{color:#c9d6cf;}
.lp-row{display:flex;flex-direction:column;gap:28px;align-items:center;}
.lp-copy{flex:1;min-width:0;width:100%;}
.lp-visual{flex:1;min-width:0;width:100%;display:flex;justify-content:center;}
.lp-visual-inner{width:100%;}
@media (min-width:860px){
  .lp-row{flex-direction:row;gap:56px;align-items:center;}
  .lp-row.rev{flex-direction:row-reverse;}
  .lp-navlink.hideonsm{display:inline;}
  .lp-row.wide-visual .lp-copy{flex:0 0 255px;}
  .lp-row.wide-visual .lp-visual{flex:1 1 auto;}
}
.lp-phone{background:#fff;border:1px solid var(--border);border-radius:20px;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,.14);text-align:left;color:var(--ink);width:100%;max-width:var(--mock-card-primary);margin:0 auto;}
.lp-duo-fixed{position:relative;display:flex;align-items:flex-end;justify-content:center;flex-wrap:wrap;width:100%;}
.lp-duo-fixed .lp-card-primary{flex:0 0 var(--mock-card-primary);width:var(--mock-card-primary);max-width:100%;}
.lp-duo-fixed .lp-phoneframe-wrap{flex:0 0 300px;width:300px;max-width:100%;margin-left:-32px;position:relative;z-index:2;}
@media (max-width:899px){
  .lp-duo-fixed{flex-direction:column;}
  .lp-duo-fixed .lp-card-primary{width:100%;}
  .lp-duo-fixed .lp-phoneframe-wrap{width:100%;margin-left:0;margin-top:14px;}
}
.lp-phoneframe{position:relative;width:100%;background:linear-gradient(160deg,#2b2f2b,#141714);border-radius:44px;padding:12px;box-shadow:0 24px 50px rgba(0,0,0,.28);}
.lp-phoneframe-island{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:90px;height:22px;background:#000;border-radius:14px;z-index:2;}
.lp-phoneframe-screen{position:relative;background:#fff;border-radius:34px;overflow:hidden;padding-top:34px;}
.lp-phoneframe .lp-phone{box-shadow:none;border:none;border-radius:0;max-width:none;margin:0;padding:16px 16px 24px;}
.lp-flash-green{animation:lp-flash-green .6s ease;}
@keyframes lp-flash-green{0%{border-color:var(--field);}100%{border-color:var(--border);}}
.lp-hero{background:var(--ink);padding:52px 20px 60px;text-align:center;}
.lp-hero h1{font-family:'Barlow Condensed',sans-serif;font-size:36px;font-weight:900;color:#fff;letter-spacing:-.01em;line-height:1.08;margin:14px auto 16px;max-width:640px;}
.lp-hero-sub{font-size:16px;color:var(--text-dim);line-height:1.6;max-width:520px;margin:0 auto 26px;}
@media (min-width:640px){.lp-hero h1{font-size:46px;}}
.lp-btnrow{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}
.lp-hero-mark-wrap{position:relative;display:flex;justify-content:center;align-items:center;margin-top:38px;}
.lp-hero-mark-glow{position:absolute;width:300px;height:300px;max-width:70vw;max-height:70vw;border-radius:50%;background:radial-gradient(circle,rgba(82,183,127,.32) 0%,rgba(82,183,127,0) 72%);filter:blur(6px);z-index:0;}
.lp-hero-mark{position:relative;z-index:1;width:190px;height:auto;filter:drop-shadow(0 16px 28px rgba(0,0,0,.5));}
@media (min-width:640px){.lp-hero-mark{width:220px;}}
.lp-outcome{display:grid;grid-template-columns:1fr;gap:10px;}
@media (min-width:640px){.lp-outcome{grid-template-columns:1fr 1fr;}}
.lp-outcome-item{display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px 14px;font-size:14px;color:var(--ink-soft);}
.lp-faq-q{width:100%;text-align:left;background:none;border:none;border-top:1px solid var(--border);padding:16px 0;font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:700;color:var(--ink);cursor:pointer;display:flex;justify-content:space-between;gap:12px;align-items:center;}
.lp-faq-a{font-size:14.5px;line-height:1.6;color:var(--ink-soft);padding:0 0 16px;max-width:720px;}
.lp-footer{background:var(--ink);color:#c9d6cf;padding:36px 20px 28px;}
.lp-footer a{color:#c9d6cf;}
.lp-footer-links{display:flex;flex-wrap:wrap;gap:18px;margin-top:16px;font-size:13px;}

/* ---- On Your Wrist (roadmap) ---- */
.lp-eyebrow-row{display:flex;align-items:center;gap:12px;margin-bottom:8px;}
.lp-eyebrow-row .lp-eyebrow{margin-bottom:0;}
.lp-pill-roadmap{font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--caution);background:var(--caution-tint);border:1px solid var(--caution-tint-border);border-radius:999px;padding:4px 12px;text-transform:uppercase;}
.lp-watch-stage{margin-top:32px;display:flex;justify-content:center;align-items:flex-start;gap:48px;flex-wrap:wrap;}
.lp-watch-col{display:flex;flex-direction:column;align-items:center;max-width:240px;}
.lp-watch{position:relative;width:200px;margin:40px 0 44px;filter:drop-shadow(0 20px 34px rgba(17,23,20,.22));}
.lp-watch-band{position:absolute;left:50%;transform:translateX(-50%);width:104px;height:40px;background:var(--ink-soft);z-index:0;}
.lp-watch-band.top{top:-32px;border-radius:16px 16px 5px 5px;}
.lp-watch-band.bottom{bottom:-32px;border-radius:5px 5px 16px 16px;}
.lp-watch-case{position:relative;z-index:1;background:linear-gradient(145deg,#3a3f3a,#191c19);border-radius:48px;padding:10px;}
.lp-watch-crown{position:absolute;right:-5px;top:64px;width:7px;height:30px;border-radius:4px;background:linear-gradient(90deg,#4a4f4a,#232623);}
.lp-watch-button{position:absolute;right:-4px;top:106px;width:4px;height:40px;border-radius:3px;background:#2c302c;}
.lp-watch-screen{position:relative;background:#000;border-radius:40px;overflow:hidden;aspect-ratio:4/4.9;display:flex;flex-direction:column;padding:22px 17px 17px;}
.lp-w-statusline{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
.lp-w-live{display:flex;align-items:center;gap:6px;font-family:'DM Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.1em;color:#7fd6a4;}
.lp-w-live.over{color:#ffb4a0;}
.lp-w-live .dot{width:6px;height:6px;border-radius:50%;background:#43d97d;animation:pulse 1.5s infinite;}
.lp-w-live.over .dot{background:#ff6a4d;}
.lp-w-ontime{font-family:'DM Mono',monospace;font-size:9px;font-weight:700;color:#cfe8d8;background:rgba(127,214,164,.16);border-radius:999px;padding:3px 8px;}
.lp-w-behind{font-family:'DM Mono',monospace;font-size:9px;font-weight:700;color:#f4d9a8;background:rgba(240,198,116,.18);border-radius:999px;padding:3px 8px;}
.lp-w-drill{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:19px;color:#fff;line-height:1.1;margin-bottom:2px;}
.lp-w-location{font-size:9px;color:#8b978f;margin-bottom:8px;}
.lp-w-timer{font-family:'DM Mono',monospace;font-weight:500;font-size:44px;letter-spacing:-.02em;color:#43d97d;line-height:1.05;font-variant-numeric:tabular-nums;}
.lp-w-timer.over{color:#ff6a4d;animation:pulse .8s infinite;}
.lp-w-timer-label{font-size:10px;color:#8b978f;margin-bottom:10px;}
.lp-w-upnext{background:rgba(255,255,255,.08);border-radius:12px;padding:8px 11px;margin-bottom:10px;}
.lp-w-upnext .lbl{font-family:'DM Mono',monospace;font-size:8px;font-weight:700;letter-spacing:.14em;color:#8b978f;margin-bottom:3px;}
.lp-w-upnext .name{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:600;color:#e8ede9;}
.lp-w-upnext .mins{font-family:'DM Mono',monospace;font-size:10px;color:#a9b5ad;background:rgba(255,255,255,.1);border-radius:6px;padding:2px 6px;}
.lp-w-next-btn{margin-top:auto;background:var(--field);color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:14px;letter-spacing:.05em;text-align:center;border-radius:999px;padding:11px 0;}
.lp-w-alert-screen{justify-content:flex-start;background:radial-gradient(120% 90% at 50% 0%,#3a1410 0,#000 62%);}
.lp-w-haptic{display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:12px;}
.lp-w-haptic span{width:4px;border-radius:2px;background:#ff6a4d;animation:lp-haptic 1s ease-in-out infinite;}
.lp-w-haptic span:nth-child(1){height:9px;animation-delay:0s;}
.lp-w-haptic span:nth-child(2){height:16px;animation-delay:.12s;}
.lp-w-haptic span:nth-child(3){height:23px;animation-delay:.24s;}
.lp-w-haptic span:nth-child(4){height:16px;animation-delay:.36s;}
.lp-w-haptic span:nth-child(5){height:9px;animation-delay:.48s;}
@keyframes lp-haptic{0%,100%{transform:scaleY(.5);opacity:.5}50%{transform:scaleY(1);opacity:1}}
.lp-w-rotate{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:21px;letter-spacing:.03em;color:#ff6a4d;text-align:center;margin-bottom:12px;}
.lp-w-move-card{background:rgba(255,255,255,.09);border-radius:12px;padding:10px 12px;margin-bottom:8px;}
.lp-w-move-card .who{font-size:12px;font-weight:600;color:#fff;margin-bottom:3px;}
.lp-w-move-card .to{font-size:11px;line-height:1.45;color:#c9b3ac;}
.lp-w-move-card .to strong{color:#ffd9c7;font-weight:600;}
.lp-w-done-btn{margin-top:auto;background:rgba(255,255,255,.14);color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:13px;letter-spacing:.05em;text-align:center;border-radius:999px;padding:11px 0;}
.lp-watch-caption{font-size:12.5px;line-height:1.5;color:var(--text-muted);text-align:center;max-width:210px;}
.lp-watch-caption strong{color:var(--ink);font-weight:600;}
@media (prefers-reduced-motion:reduce){.lp-w-live .dot,.lp-w-haptic span,.lp-w-timer.over,.lp-flash-green,.cc-timer.over{animation:none;}}
@media (max-width:560px){.lp-watch-stage{gap:32px;}}
`;

function Header({ onGetStarted }) {
  return (<div className="lp-header">
    <a href="#top" className="lp-brand"><img src="/apple-touch-icon.png" alt="" /><span>Run of Practice</span></a>
    <div className="lp-nav">
      <a className="lp-navlink hideonsm" href="#how-it-works">How It Works</a>
      <a className="lp-navlink hideonsm" href="#features">Features</a>
      {!LAUNCHED && <a className="lp-navlink hideonsm" href="#early-access">Early Access</a>}
      {FEATURE_FLAGS.PRICING_PAGE_PUBLIC && <a className="lp-navlink" href="/pricing">Pricing</a>}
      {LAUNCHED && <a className="lp-navlink hideonsm" href="/partners">Partners</a>}
      <button className="lp-signin" onClick={onGetStarted}>Sign In</button>
      <button className="btn primary bsm" onClick={onGetStarted}>Try It Free</button>
    </div>
  </div>);
}

// ── Small realistic product representations, built from the app's actual
// component classes (.li/.pill/.bdg/.cc-*/.card) rather than icons or
// stylized illustrations, per the addendum's "use the actual product" rule.
// These aren't screenshots -- swap in real ones whenever they're ready --
// but they render with the exact same design tokens as the live app.
// Matches ScheduleScreen.jsx's agenda rows: a team-color dot (hollow until
// the practice has a plan), the team name, then time, "Needs plan", the
// planned/scheduled minutes pill (green with a check when on track, red when
// under 90%) and how many players are out.
function ScheduleVisual() {
  const rows = [
    { day: "Today", team: "12U Red", color: "#c0392b", planned: true, time: "4:00 PM", total: 90, target: 90, out: 2 },
    { day: "Today", team: "10U Blue", color: "#2563eb", planned: false, time: "5:30 PM", total: 0, target: 60 },
    { day: "Tomorrow", team: "12U Red", color: "#c0392b", planned: true, time: "4:00 PM", total: 40, target: 90 },
  ];
  let lastDay = null;
  return (<div className="lp-phone">
    {rows.map((r, i) => {
      const onTrack = r.total >= r.target * 0.9 && r.total <= r.target;
      return (<React.Fragment key={i}>
        {r.day !== lastDay && (lastDay = r.day, <div className="clbl" style={{ marginBottom: 6, marginTop: i ? 10 : 0 }}>{r.day}</div>)}
        <div className="li" style={{ marginBottom: 6, cursor: "default" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", boxSizing: "border-box", background: r.planned ? r.color : "transparent", border: "1.5px solid " + r.color, flexShrink: 0 }} />
            <div className="lim" style={{ minWidth: 0 }}>
              <div className="lin">{r.team}</div>
              <div className="limt">{r.time}{!r.planned && " · Needs plan"} · <span style={{ color: onTrack ? "var(--field)" : "var(--danger)", fontWeight: 600, whiteSpace: "nowrap" }}>{onTrack ? "✓ " : ""}{r.total}/{r.target} min</span>{r.out > 0 && <> · <span style={{ whiteSpace: "nowrap" }}>{r.out} out</span></>}</div>
            </div>
          </div>
          <span style={{ color: "var(--text-dim)", fontSize: 18 }}>&#8250;</span>
        </div>
      </React.Fragment>);
    })}
  </div>);
}

// Two drills shown in full for the expanded sport (count + both rows
// visible, matching NewLibraryScreen.jsx's actual sport-group layout: a
// .sport-hdr card, then one .li card per drill with its drag handle, tag
// chips and options menu), then a
// second sport collapsed below it with a higher count -- exactly the state
// described for this section, not a single generic drill.
function LibraryVisual() {
  const basketballDrills = [
    { name: "Defensive Shell Drill", description: "Four defenders in a shell around the key, one ball reversed side to side.", equipment: "Cones", skills: ["Defense", "Footwork"] },
    { name: "3-on-3 Scrimmage", description: "Half-court, make it take it. Emphasize early offense.", skills: ["Game Speed"] },
  ];
  const chev = (collapsed) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "var(--ink)", transform: collapsed ? "rotate(-90deg)" : "none" }} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;
  const grip = <span aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(2,3px)", gap: 3, padding: "4px 10px 0 2px", flexShrink: 0 }}>{[0, 1, 2, 3, 4, 5].map(i => <span key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--text-dim)" }} />)}</span>;
  return (<div className="lp-phone">
    <div className="sport-hdr" style={{ cursor: "default" }}><span className="sport-name">Basketball</span><span className="sport-meta">{basketballDrills.length} drills{chev(false)}</span></div>
    {basketballDrills.map(d => (<div key={d.name} className="li" style={{ alignItems: "flex-start", cursor: "default" }}>
      {grip}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{d.name}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2, lineHeight: 1.4 }}>{d.description}</div>
        {d.equipment && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>Needs: {d.equipment}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
          {d.skills.map(s => <span key={s} className="tagchip">{s}</span>)}
        </div>
      </div>
      <span className="ell-btn" aria-hidden="true"><span /><span /><span /></span>
    </div>))}
    <div className="sport-hdr" style={{ cursor: "default", marginTop: 10 }}><span className="sport-name">Baseball</span><span className="sport-meta">14 drills{chev(true)}</span></div>
  </div>);
}

// Matches the real Builder (App.jsx BuilderScreen): the solid green "The Run
// of Practice" panel with its stopwatch mark and planned/scheduled pill (red
// once the plan is under 90% of the scheduled length -- shown 10 minutes
// short of the scheduled length so that state is visible), the dashed
// Pre-Practice Warmup row, then .ablk rows with drag handle, "grouping ·
// area · coach" subline, chevron, minutes badge and remove button. One row
// is expanded into its real ActConfig fields (ActivityConfigs.jsx): Name,
// the -/value/+ DurStepper and Player Grouping.
function BuilderVisual() {
  const rows = [
    { n: "Dynamic Warmup", d: "10", sub: "Whole Team · Infield · Coach Mike" },
    { n: "Throwing Progression", d: "10", sub: "Partners · Outfield · Coach Mike", expanded: true },
    { n: "Station Block", d: "43", sub: "Ground Ball Fundamentals / Front Toss / Fly Ball Reads - 13m x3 + 2m trans = 43m", block: true },
    { n: "Situational Scrimmage", d: "20", sub: "Whole Team · Infield · Coach Jen" },
  ];
  const totalMins = rows.reduce((s, r) => s + Number(r.d), 0);
  const objectiveMins = totalMins + 10;
  const grip = <span aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(2,3px)", gap: 3, padding: "0 4px", flexShrink: 0 }}>{[0, 1, 2, 3, 4, 5].map(i => <span key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--text-dim)" }} />)}</span>;
  const chev = (up) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" style={{ transform: up ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>;
  return (<div className="lp-phone">
    <div className="brow" style={{ justifyContent: "flex-end", marginBottom: 10 }}><button className="btn strong bsm" style={{ flex: "none" }}>Save</button><button className="btn primary bsm" style={{ flex: "none" }}>Run Now</button></div>
    <div style={{ background: "var(--field-strong)", borderRadius: "var(--radius-lg)", padding: "0 0 1px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px 8px" }}>
        <svg width="30" height="30" viewBox="0 0 100 100" aria-hidden="true" style={{ flexShrink: 0 }}><rect x="42" y="0" width="16" height="10" rx="5" fill="#fff" opacity=".85" /><rect x="68" y="6" width="16" height="9" rx="4.5" fill="#fff" opacity=".85" transform="rotate(35 76 10)" /><circle cx="50" cy="50" r="40" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="6" /><line x1="50" y1="50" x2="50" y2="20" stroke="#fff" strokeWidth="7" strokeLinecap="round" /><circle cx="50" cy="50" r="6" fill="#fff" /></svg>
        <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 900, color: "#fff", flex: 1, lineHeight: 1.1 }}>The Run of Practice</span>
        <span className={"pill" + (totalMins < objectiveMins * 0.9 ? " over" : "")} style={{ flexShrink: 0 }}>{totalMins}/{objectiveMins} min</span>
      </div>
      <div style={{ margin: "0 10px 9px", background: "var(--field-tint)", border: "2px dashed var(--field-accent)", borderRadius: "var(--radius-lg)", padding: "11px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 13, fontWeight: 900, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--field)", flex: 1 }}>Pre-Practice Warmup</span>
        <span style={{ color: "var(--ink)", display: "flex" }}>{chev(false)}</span>
      </div>
      {rows.map((r) => (<div key={r.n} className="ablk" style={{ margin: "0 10px 9px" }}>
        <div className="abhdr" style={{ cursor: "default" }}>
          {grip}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "700 14px 'Barlow Condensed',sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.n}</div>
            <div className="limt" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sub}</div>
          </div>
          <div className="row">
            <span style={{ color: "var(--text-dim)", display: "flex" }}>{chev(r.expanded)}</span>
            <span className="bdg bp">{r.d}m</span>
            <button className="btn danger bxs">x</button>
          </div>
        </div>
        {r.expanded && <div className="abbody">
          <div className="fld"><label className="lbl">Name</label><input className="inp" value={r.n} readOnly /></div>
          <div className="fld"><label className="lbl">Duration (min)</label>
            <div style={{ display: "flex", alignItems: "center", border: "1.5px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden", background: "#fff" }}>
              <span style={{ width: 48, height: 40, background: "var(--surface-soft)", color: "var(--ink-soft)", fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>-</span>
              <span style={{ flex: 1, textAlign: "center", fontFamily: "'DM Mono',monospace", fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{r.d}m</span>
              <span style={{ width: 48, height: 40, background: "var(--surface-soft)", color: "var(--ink-soft)", fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>+</span>
            </div>
          </div>
          <div className="fld" style={{ marginBottom: 0 }}><label className="lbl">Player Grouping</label>
            <div style={{ display: "flex", gap: 6 }}>
              {["Whole Team", "Partners", "Groups"].map(g => <span key={g} style={{ flex: 1, textAlign: "center", padding: "8px 4px", borderRadius: "var(--radius-lg)", border: "1.5px solid var(--border)", background: g === "Partners" ? "var(--field)" : "var(--surface)", color: g === "Partners" ? "#fff" : "var(--ink)", fontSize: 13, fontWeight: 700 }}>{g}</span>)}
            </div>
          </div>
        </div>}
      </div>))}
    </div>
  </div>);
}

// Mirrors ModalLayer.jsx's DurStepper look (-/value/+ in a bordered box) --
// static here since this mockup demonstrates the control, not another
// working stepper.
function DurStepperMock({ label, value }) {
  return (<div style={{ flex: 1 }}>
    <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>{label}</div>
    <div style={{ display: "flex", alignItems: "center", border: "1.5px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden", background: "#fff" }}>
      <span style={{ width: 32, height: 32, background: "var(--surface-soft)", color: "var(--ink-soft)", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>-</span>
      <span style={{ flex: 1, textAlign: "center", fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{value}</span>
      <span style={{ width: 32, height: 32, background: "var(--surface-soft)", color: "var(--ink-soft)", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>+</span>
    </div>
  </div>);
}

// Matches the real Station Block settings (ActivityConfigs.jsx
// StationConfig): Player Movement toggle with its hint, Time at Station /
// Transition steppers, the grouping buttons, then each station's Players
// field. Every roster player shows on every station: green "✓ here", amber
// "→ St N" when assigned elsewhere, struck through and "Out" when marked
// absent -- that last state is the "who actually showed up" story.
const STATION_ROSTER = [
  { n: "Ryker", j: 2, st: 0 }, { n: "Owen", j: 7, st: 0 }, { n: "Mason", j: 12, st: 0 },
  { n: "Ava", j: 4, st: 1 }, { n: "Jordan", j: 9, st: 1 }, { n: "Riley", j: 15, out: true },
];

function RosterChip({ p, si }) {
  const here = !p.out && p.st === si;
  const elsewhere = !p.out && !here;
  return (<span style={{ padding: "7px 12px", borderRadius: 8, border: "1.5px solid", borderColor: p.out ? "var(--border)" : here ? "var(--field)" : "#d97706", background: p.out ? "var(--surface-soft)" : here ? "var(--field)" : "#fef3c7", color: p.out ? "var(--text-dim)" : here ? "#fff" : "#92400e", fontSize: 13, display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
    <span style={{ fontWeight: 700, textDecoration: p.out ? "line-through" : "none" }}><span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, marginRight: 3 }}>#{p.j}</span>{p.n}</span>
    {p.out && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)" }}>Out</span>}
    {elsewhere && <span style={{ fontSize: 10, opacity: .85 }}>&rarr; St {p.st + 1}</span>}
    {here && <span style={{ fontSize: 10, opacity: .8 }}>✓ here</span>}
  </span>);
}

function StationsVisual() {
  const stations = [
    { label: "Station 1", drill: "Ground Ball Fundamentals" },
    { label: "Station 2", drill: "Front Toss", groupLabel: "Lefties" },
  ];
  return (<div className="lp-phone">
    <div className="fld"><label className="lbl">Player Movement</label>
      <div style={{ display: "flex", borderRadius: "var(--radius-lg)", overflow: "hidden", border: "1.5px solid var(--border)" }}>
        <div style={{ flex: 1, padding: "8px 0", textAlign: "center", background: "var(--field)", color: "#fff", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: ".03em" }}>ROTATE</div>
        <div style={{ flex: 1, padding: "8px 0", textAlign: "center", background: "var(--surface)", color: "var(--ink)", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: ".03em" }}>STATIC</div>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>Players rotate through all stations on a timer</div>
    </div>
    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
      <DurStepperMock label="Time at Station (min)" value="13m" />
      <DurStepperMock label="Transition (min)" value="2m" />
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      <button className="btn outline bsm" style={{ flex: "1 1 100%" }}>Generate Random Groups</button>
      <button className="btn ghost bsm" style={{ flex: 1 }}>Clear Groups</button>
      <button className="btn ghost bsm" style={{ flex: 1 }}>Group By...Bats</button>
    </div>
    {stations.map((s, si) => (<div key={s.label} style={{ background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "10px 10px 8px", marginBottom: 8 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 900, color: "var(--field)", letterSpacing: ".05em" }}>{s.label.toUpperCase()}</div>
      <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>{s.drill}</div>
      {s.groupLabel && <div style={{ marginBottom: 6 }}><span className="bdg bp">Group: {s.groupLabel}</span></div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {STATION_ROSTER.map(p => <RosterChip key={p.n} p={p} si={si} />)}
      </div>
    </div>))}
  </div>);
}

// Modeled directly on PreviewView (CommandScreen.jsx) -- the actual
// screen behind "Share Live Link": dark, standalone, opened by whoever's
// setting up a station before the coach ever gets there. Same literal
// colors as that component (not the CSS-var palette the rest of the site
// mocks use) since this dark-on-#0d1512 look IS the real screen, not a
// reskin of it. Top to bottom: Practice Setup / location, team, date and
// time, who's watching, the Starts In countdown, Pre-Practice Warmup,
// Equipment Needed grouped by area, then the timed Run of Practice list
// with the station block's stations (area · coach, equipment pills).
const PRE_SETUP_STATIONS = [
  { name: "Ground Ball Fundamentals", area: "Infield", coach: "Coach Mike", equip: ["Bucket of Balls"] },
  { name: "Front Toss", area: "Batting Cage 1", coach: "Coach Jen", equip: ["L-Screen"] },
  { name: "Fly Ball Reads", area: "Outfield", coach: "Coach Dana", equip: ["Cones"] },
];
const PRE_SETUP_EQUIP = [{ area: "Infield", items: ["Bucket of Balls"] }, { area: "Batting Cage 1", items: ["L-Screen"] }, { area: "Outfield", items: ["Cones"] }];
const CLOCK_PRESETUP_START = 28 * 60 + 41; // 28:41, Pre-Practice Setup only
const PS_LABEL = { fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" };
const PS_ROW = { padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,.1)" };
function PreSetupVisual() {
  const { display, over } = useCountdown(CLOCK_PRESETUP_START);
  return (<div className="lp-phone" style={{ background: "#0d1512", borderColor: "#0d1512", color: "#fff" }}>
    <div style={{ ...PS_ROW, paddingTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#52b788", display: "inline-block", flexShrink: 0 }} />
        <span style={{ ...PS_LABEL, color: "#52b788" }}>Practice Setup</span>
        <span style={{ fontSize: 11, color: "#555", marginLeft: 4 }}>· Eastside Park</span>
      </div>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 28, fontWeight: 900, lineHeight: 1, marginBottom: 4 }}>12U Red</div>
      <div style={{ fontSize: 13, color: "#aaa" }}>Tuesday, October 28 at 4:00 PM</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#8fa89b", marginTop: 10 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#52b788", display: "inline-block" }} />Coach Mike, Coach Jen · 1 person watching</div>
    </div>
    <div style={{ ...PS_ROW, textAlign: "center", padding: "18px 0" }}>
      <div style={{ ...PS_LABEL, color: over ? "#f59e0b" : "#52b788", marginBottom: 8 }}>{over ? "Practice should have started" : "Starts in"}</div>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 44, fontWeight: 700, color: over ? "#f59e0b" : "#fff", lineHeight: 1, marginBottom: 4 }}>{display}</div>
      <div style={{ fontSize: 12, color: "#555" }}>{over ? "Waiting for coach to start the live run" : "Use this time to get everything set up before you start."}</div>
    </div>
    <div style={PS_ROW}>
      <div style={{ ...PS_LABEL, color: "#52b788", marginBottom: 8 }}>Pre-Practice Warmup</div>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>Grab a glove and start playing catch.</div>
    </div>
    <div style={PS_ROW}>
      <div style={{ ...PS_LABEL, color: "#ca8a04", marginBottom: 10 }}>Equipment Needed</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
        {PRE_SETUP_EQUIP.map(g => (<div key={g.area}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#52b788", marginBottom: 6 }}>{g.area}</div>
          {g.items.map(n => <span key={n} style={{ borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 700, background: "#fbbf24", border: "1px solid #d97706", color: "#422006" }}>{n}</span>)}
        </div>))}
      </div>
    </div>
    <div style={{ paddingTop: 14 }}>
      <div style={{ ...PS_LABEL, color: "#555", marginBottom: 12 }}>Run of Practice · 85min</div>
      <div style={{ marginBottom: 8, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between" }}>
        <div><div style={{ fontSize: 15, fontWeight: 700 }}>Dynamic Warmup</div><div style={{ fontSize: 12, color: "#888", marginTop: 2 }}><span style={{ color: "#52b788", fontWeight: 600 }}>Infield</span><span style={{ color: "#444" }}> · </span>Coach Mike</div></div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}><span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: "#555" }}>10m</span><span style={{ fontSize: 10, color: "#555", fontFamily: "'DM Mono',monospace" }}>4:00 PM–4:10 PM</span></div>
      </div>
      <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div><div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#52b788" }}>Station Block</div><div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>3 stations · 13m each · rotates</div></div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}><span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: "#555" }}>43m</span><span style={{ fontSize: 10, color: "#555", fontFamily: "'DM Mono',monospace" }}>4:20 PM–5:03 PM</span></div>
        </div>
        {PRE_SETUP_STATIONS.map((st, i) => (<div key={st.name} style={{ padding: "10px 14px", borderBottom: i < PRE_SETUP_STATIONS.length - 1 ? "1px solid rgba(255,255,255,.06)" : "none" }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 700, color: "#52b788", letterSpacing: ".05em", marginBottom: 2 }}>Station {i + 1}</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{st.name}</div>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}><span style={{ color: "#52b788", fontWeight: 600 }}>{st.area}</span><span style={{ color: "#444" }}> · </span>{st.coach}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{st.equip.map(n => <span key={n} style={{ background: "rgba(202,138,4,.12)", border: "1px solid rgba(202,138,4,.3)", borderRadius: 20, padding: "2px 8px", fontSize: 11, color: "#fde047" }}>{n}</span>)}</div>
        </div>))}
      </div>
    </div>
  </div>);
}

function TemplatesVisual() {
  return (<div className="lp-phone">
    <div className="card">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, lineHeight: 1 }}>Tuesday Practice Template</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>4 activities - 90min</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>Created Sep 9, 2026 - Updated Oct 21, 2026</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
            <span className="tagchip">Fielding</span><span className="tagchip">Hitting</span><span className="tagchip">Footwork</span>
          </div>
        </div>
        <span className="ell-btn" aria-hidden="true"><span /><span /><span /></span>
      </div>
      <div className="brow">
        <button className="btn outline bmd" style={{ flex: 1 }}>View / Edit</button>
        <button className="btn primary bmd" style={{ flex: 1 }}>Run Now</button>
      </div>
    </div>
  </div>);
}

// ── Live practice mocks. LiveShell copies the coach's live screen in
// CommandScreen.jsx from top to bottom: the action row (attendance pill,
// Overview, audio toggle, options menu), the Live dot + pace chip + "ends"
// time + who's here, the uppercase phase title and its subline, the
// .cc-timer with its pause button, +1m/-1m, the progress bar, the </Next
// controls, then the screen's own body and the Up Next queue.
const LIVE_LABEL = { fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" };

function PaceChip({ ahead }) {
  const behind = ahead < 0;
  return (<span style={{ background: behind ? "var(--caution-tint)" : "var(--field-tint)", color: behind ? "var(--caution)" : "var(--field)", padding: "3px 10px", borderRadius: 20, fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700 }}>
    {ahead === 0 ? "On time" : behind ? Math.abs(ahead) + "m behind" : ahead + "m ahead"}
  </span>);
}

function LiveShell({ phase, sub, display, over, ahead, ends, present, children, upNext, controls, className, readOnlyBy }) {
  return (<div className={"lp-phone" + (className ? " " + className : "")} style={{ padding: 0, overflow: "hidden" }}>
    {readOnlyBy && <div style={{ background: "var(--caution-tint)", borderBottom: "1px solid var(--caution-tint-border)", padding: "8px 14px" }}><span style={{ fontSize: 12, color: "var(--caution)", fontWeight: 600 }}>Read-only · {readOnlyBy} has control</span></div>}
    <div className="cc-header">
      <div className="cc-header-top" style={{ justifyContent: "flex-end" }}>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          <span style={{ background: "var(--field-tint)", border: "1.5px solid var(--field-tint-border)", borderRadius: 20, padding: "4px 10px", display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--field)" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z" /></svg>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 700, color: "var(--field)" }}>{present}</span>
          </span>
          <span className="btn ghost bxs" style={{ display: "flex", alignItems: "center", gap: 4 }}>Overview<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></span>
          <span style={{ background: "var(--surface-soft)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-md)", padding: "4px 8px", fontSize: 13, fontWeight: 700, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 13, lineHeight: 1 }}>🔇</span>Off</span>
          <span className="ell-btn" aria-hidden="true"><span /><span /><span /></span>
        </div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span className="live" /><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--field)" }}>Live</span></span>
        <PaceChip ahead={ahead} />
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'DM Mono',monospace", alignSelf: "center" }}>ends {ends}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-dim)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#52b788", display: "inline-block" }} />Coach Mike, Coach Jen</span>
      </div>
      <div className="cc-act-name" style={{ fontSize: 30 }}>{phase}</div>
      {sub}
    </div>
    <div className="cc-timer-row">
      <div className={"cc-timer" + (over ? " over" : "")} style={{ fontSize: 56, fontVariantNumeric: "tabular-nums" }}>{display}</div>
      {!readOnlyBy && <span style={{ width: 46, height: 46, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "var(--surface-pressed)", color: "var(--ink-soft)" }} aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg></span>}
      <div style={{ flex: 1 }} />
    </div>
    {readOnlyBy ? <div className="cc-prog"><div className="cc-prog-bar" style={{ width: "40%" }} /></div> : controls || <>
      <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}><button className="btn ghost bsm" style={{ flex: 1 }}>+1m</button><button className="btn ghost bsm" style={{ flex: 1 }}>-1m</button></div>
      <div className="cc-prog"><div className="cc-prog-bar" style={{ width: "40%" }} /></div>
      <div className="cc-controls"><button className="btn ghost bmd" style={{ minWidth: 52 }}>&lt;</button><button className="btn primary blg" style={{ flex: 1 }}>Next &gt;</button></div>
    </>}
    <div style={{ padding: "4px 14px 14px" }}>
      {children}
      {upNext && <>
        <div className="cc-queue-hdr"><span className="cc-queue-hdr-label">Up Next</span><span className="cc-queue-hdr-line" /></div>
        <div className="cc-queue">{upNext.map(u => <div key={u.n} className="cc-queue-item"><span style={{ fontSize: 13, color: "var(--text-dim)" }}>{u.n}</span><span className="bdg bs">{u.m}</span></div>)}</div>
      </>}
    </div>
  </div>);
}

function CoachLine({ coach, area }) {
  return (<div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-dim)", marginTop: 2, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
    <span className="bdg bp">Coach: {coach}</span>{area && <><span>·</span><span>{area}</span></>}
  </div>);
}
function BlockLine({ text }) {
  return <div style={{ ...LIVE_LABEL, color: "var(--text-dim)" }}>{text}</div>;
}
function LiveSection({ label, color, border, children, big }) {
  return (<div style={{ borderLeft: "3px solid " + border, paddingLeft: 10, paddingTop: 4, paddingBottom: 4, marginBottom: 8 }}>
    <div style={{ ...LIVE_LABEL, color, marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: big ? 15 : 14, color: "var(--ink)", lineHeight: 1.5 }}>{children}</div>
  </div>);
}

function LiveVisual() {
  const { display, over, minutesBehind } = useCountdown(CLOCK_LIVE_DEFAULT_START);
  return (<LiveShell phase="DEFENSIVE SHELL DRILL" sub={<CoachLine coach="Coach Mike" area="Court 1" />} display={display} over={over} ahead={over ? -minutesBehind : 0} ends="5:30 PM" present="12/12"
    upNext={[{ n: "3-on-3 Scrimmage", m: "20m" }, { n: "Free Throw Ladder", m: "10m" }]}>
    <LiveSection label="Description" color="var(--ink)" border="var(--ink)">Four defenders in a shell around the key, one ball reversed side to side. Close out low and hard on the catch, stay in a stance.</LiveSection>
    <LiveSection label="💡 Coaching Focus" color="#16a34a" border="#16a34a" big>Sprint to close out, then chop your feet down. Contest without fouling.</LiveSection>
    <LiveSection label="👥 Players" color="var(--text-dim)" border="var(--border)">Whole Team Together</LiveSection>
  </LiveShell>);
}

// The real "Get everyone to their station" block intro: a dark #0d1512 card
// of station cards (Station N, area, coach link, drill, group, equipment,
// jersey-numbered player chips) with Reshuffle at the bottom.
const OVERVIEW_STATIONS = [
  { drill: "Ground Ball Fundamentals", area: "Infield", coach: "Coach Mike", equip: "Bucket of Balls", players: [["2", "Ryker"], ["7", "Owen"], ["12", "Mason"]] },
  { drill: "Front Toss", area: "Batting Cage 1", coach: "Coach Jen", equip: "L-Screen", group: "Lefties", players: [["4", "Ava"], ["9", "Jordan"]] },
  { drill: "Fly Ball Reads", area: "Outfield", coach: "Coach Dana", equip: "Cones", players: [["15", "Max"], ["21", "Riley"], ["5", "Sam"]] },
];
function EquipPillMock({ name }) {
  return <span style={{ borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 700, background: "#fbbf24", border: "1px solid #d97706", color: "#422006" }}>{name}</span>;
}
function BlockIntroCard() {
  return (<div style={{ background: "#0d1512", borderRadius: "var(--radius-lg)", padding: "14px 12px" }}>
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#8fa89b", marginBottom: 4 }}>Get everyone to their station</div>
    <div style={{ fontSize: 11, color: "#8fa89b", marginBottom: 8 }}>Tap a player to move them.</div>
    {OVERVIEW_STATIONS.map((st, i) => (<div key={st.drill} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: "var(--radius-lg)", padding: "12px 14px", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#52b788" }}>Station {i + 1}</div>
        <div style={{ fontSize: 11, color: "#52b788", fontWeight: 600 }}>{st.area}</div>
        <div style={{ fontSize: 11, color: "#52b788", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}>{st.coach}</div>
      </div>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 900, color: "#fff", marginBottom: 6 }}>{st.drill}</div>
      {st.group && <div style={{ marginBottom: 6 }}><span className="bdg bp">Group: {st.group}</span></div>}
      <div style={{ marginBottom: 6 }}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#8fa89b", marginBottom: 3 }}>Equipment</div><EquipPillMock name={st.equip} /></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {st.players.map(([j, n]) => <span key={n} style={{ padding: "6px 10px", borderRadius: 20, background: "rgba(255,255,255,.1)", border: "1.5px solid rgba(255,255,255,.25)", fontSize: 12, fontWeight: 600, color: "#fff" }}><span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#52b788", marginRight: 4 }}>#{j}</span>{n}</span>)}
      </div>
    </div>))}
    <button className="btn outline bmd bfull mt10" style={{ borderColor: "rgba(255,255,255,.3)", color: "#fff", background: "transparent" }}>Reshuffle</button>
  </div>);
}

// Focused on one station during a rotation: the real station detail
// (Station N, drill name, coach · area, Coaching Focus, Equipment, then
// "Players at this station" as PlayerChipLive pills with handedness and
// each player's focus note for this drill's skill area). This drill has no
// Description, which the real screen simply leaves out.
function LiveChip({ j, name, hand, note }) {
  return (<span style={{ padding: "6px 12px", borderRadius: 20, border: "1.5px solid var(--field-tint-border)", background: "var(--field-tint)", fontSize: 14, fontWeight: 600, color: "var(--ink)", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, maxWidth: 200 }}>
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "var(--field)" }}>#{j}</span>{name}</span>
    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{hand}</span>
    {note && <span style={{ fontSize: 11, fontWeight: 500, color: "var(--field-accent)", lineHeight: 1.3, textAlign: "left" }}>{note}</span>}
  </span>);
}
function StationDetailVisual() {
  const { display, over, minutesBehind } = useCountdown(CLOCK_STATION_BLOCK_START);
  return (<LiveShell readOnlyBy="Coach Mike" phase="ROTATION 2 of 3" sub={<BlockLine text="Station Block · 3 Stations · 43min total" />} display={display} over={over} ahead={over ? -minutesBehind : 2} ends="5:30 PM" present="11/12">
    <button className="btn ghost bxs" style={{ marginBottom: 10 }}>&#8249; All Stations</button>
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--field)", marginBottom: 2 }}>Station 2</div>
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 32, fontWeight: 900, color: "var(--ink)", lineHeight: 1, marginBottom: 6 }}>Front Toss</div>
    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--field-accent)", marginBottom: 10 }}>Coach Jen · Batting Cage 1</div>
    <LiveSection label="💡 Coaching Focus" color="#16a34a" border="#16a34a" big>Level swing, contact out front. Let the outside pitch travel.</LiveSection>
    <div style={{ marginBottom: 10 }}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 3 }}>Equipment</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}><EquipPillMock name="L-Screen" /><EquipPillMock name="Bucket of Balls" /></div></div>
    <div style={{ ...LIVE_LABEL, color: "var(--text-dim)", marginBottom: 8 }}>Players at this station</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      <LiveChip j="4" name="Ava" hand="Bats Left · Throws Right" note="Keep the front foot closed, drive through the ball." />
      <LiveChip j="9" name="Jordan" hand="Bats Left · Throws Left" note="Two hands through contact, don't cast the barrel." />
    </div>
  </LiveShell>);
}

// The head coach's block intro (just its "Get everyone to their station"
// card) beside an assistant's phone, read-only while the head coach has
// control, focused on the station they lead mid-rotation. A coach's
// per-player focus note (set once on the player's profile, per skill area)
// shows up on that player's chip wherever they land, so whoever runs the
// station already knows what the coach wants them to hear.
function HelperVisual() {
  return (<div className="lp-duo-fixed">
    <div className="lp-phone lp-card-primary" style={{ padding: 10 }}><BlockIntroCard /></div>
    <div className="lp-phoneframe-wrap"><PhoneFrame><StationDetailVisual /></PhoneFrame></div>
  </div>);
}

function AdjustVisual() {
  const t = useStepTimer(13 * 60, 4);
  return (<LiveShell className={t.flash ? "lp-flash-green" : ""} phase="SMALL-SIDED SCRIMMAGE" sub={<CoachLine coach="Coach Dana" area="Field 2" />} display={t.display} over={false} ahead={t.aheadMinutes} ends="6:15 PM" present="14/14"
      upNext={[{ n: "Team Talk", m: "5m" }]}
      controls={<>
        <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
          <button className="btn ghost bsm" style={{ flex: 1, minHeight: 44 }} aria-label="Add one minute to activity timer" onClick={() => t.bump(1)}>+1m</button>
          <button className="btn ghost bsm" style={{ flex: 1, minHeight: 44 }} aria-label="Subtract one minute from activity timer" onClick={() => t.bump(-1)}>-1m</button>
        </div>
        <div className="cc-prog"><div className="cc-prog-bar" style={{ width: "55%" }} /></div>
        <div className="cc-controls">
          <button className="btn ghost bmd" style={{ minWidth: 52, minHeight: 44 }} aria-label="Previous activity" onClick={t.prev}>&lt;</button>
          <button className="btn primary blg" style={{ flex: 1, minHeight: 44 }} aria-label="Next activity" onClick={t.next}>Next &gt;</button>
        </div>
      </>} />);
}

// The real transition screen: a dark card with "Rotate Now", one summary
// line of the area sequence, then a card per group with names, group
// label, a green TO line and a muted FROM line.
const ROTATION_MOVES = [
  { names: "Ryker, Owen, Mason", to: "Station 2: Batting Cage 1 · Coach Jen · Front Toss", from: "Station 1: Infield · Coach Mike · Ground Ball Fundamentals" },
  { names: "Ava, Jordan", groupLabel: "Lefties", to: "Station 3: Outfield · Coach Dana · Fly Ball Reads", from: "Station 2: Batting Cage 1 · Coach Jen · Front Toss" },
  { names: "Max, Riley, Sam", to: "Station 1: Infield · Coach Mike · Ground Ball Fundamentals", from: "Station 3: Outfield · Coach Dana · Fly Ball Reads" },
];

function TransitionVisual() {
  return (<LiveShell phase="TRANSITION" sub={<BlockLine text="Station Block · 3 Stations · 43min total" />} display="01:42" over={false} ahead={2} ends="5:30 PM" present="11/12">
    <div style={{ background: "#0d1512", borderRadius: "var(--radius-lg)", padding: "14px 12px" }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 900, color: "#f87171", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 10 }}>Rotate Now</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", lineHeight: 1.4, marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,.1)" }}>Infield to Batting Cage 1, Batting Cage 1 to Outfield, Outfield to Infield</div>
      {ROTATION_MOVES.map(r => (<div key={r.names} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: "var(--radius-lg)", padding: 14, marginBottom: 8 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 900, color: "#fff", lineHeight: 1.2, marginBottom: 6 }}>{r.names}</div>
        {r.groupLabel && <div style={{ marginBottom: 4 }}><span className="bdg bp">Group: {r.groupLabel}</span></div>}
        <div style={{ fontSize: 13, fontWeight: 700, color: "#52b788", marginBottom: 3 }}>TO: <span style={{ fontWeight: 400 }}>{r.to}</span></div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#8fa89b" }}>FROM: <span style={{ fontWeight: 400 }}>{r.from}</span></div>
      </div>))}
    </div>
  </LiveShell>);
}

// Mirrors GoalsScreen.jsx's history detail top to bottom: date, wall time
// and attendance, Run Now / Save as Template, then the "Planned vs. Actual"
// cards (planned badge plus the logged start-end and minutes), then the
// Notes card (grouped by drill, author + tagged-player chips). Trimmed to
// three drills; the attendance timeline and skill minutes are left out.
const HISTORY_DRILLS = [
  { n: "Dynamic Warmup", planned: 10, from: "4:00 PM", to: "4:09 PM", actual: 9 },
  { n: "Ground Ball Fundamentals", planned: 15, from: "4:09 PM", to: "4:28 PM", actual: 19 },
  { n: "Situational Scrimmage", planned: 20, from: "4:52 PM", to: "5:16 PM", actual: 24 },
];

function HistoryDrillRow({ n, planned, from, to, actual }) {
  return (<div className="card mb8">
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{n}</span>
      <span className="bdg bp">{planned}m planned</span>
    </div>
    <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
      Actual: {from} - {to}<span style={{ fontFamily: "'DM Mono',monospace" }}>&middot; {actual}m</span>
    </div>
  </div>);
}

function HistoryVisual() {
  return (<div className="lp-phone">
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Tuesday, Oct 28</div>
    <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 12 }}>78min wall time · 11 attended</div>
    <button className="btn primary bmd bfull" style={{ marginBottom: 8 }}>Run Now</button>
    <button className="btn ghost bmd bfull" style={{ marginBottom: 14 }}>Save as Template</button>
    <div className="clbl mb8">Planned vs. Actual</div>
    {HISTORY_DRILLS.map(d => <HistoryDrillRow key={d.n} {...d} />)}
    <div className="card" style={{ marginTop: 10 }}>
      <div className="clbl mb8">Notes</div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--field-accent)", marginBottom: 4 }}>Ground Ball Fundamentals</div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 2 }}>Coach Mike · Assistant Coach · 4:24 PM</div>
        <div style={{ fontSize: 13 }}>Glove work looked great today, ready for faster reads next week.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}><span className="bdg bs" style={{ fontSize: 10 }}>Ryker</span></div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--field-accent)", marginBottom: 4 }}>Situational Scrimmage</div>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 2 }}>Ava's Mom · Helper · 5:10 PM</div>
        <div style={{ fontSize: 13 }}>Runners at second were slow to read balls in the dirt.</div>
      </div>
    </div>
  </div>);
}

// Matches the real Goals & Insights > Benchmarks detail (BenchmarkReport.jsx
// TeamBenchmarkDetail): Latest, Comparison, Target and Players · latest cards,
// in that order, with the same labels and status text. Trimmed to five
// players and no assessment history so it fits beside the copy.
const BENCHMARK_PLAYERS = [
  { n: "Ava R #4", r: "4.31 seconds", meets: true },
  { n: "Jordan T #9", r: "4.58 seconds", meets: true },
  { n: "Mason K #12", r: "5.14 seconds", meets: false },
  { n: "Owen P #7", r: "4.72 seconds", meets: true },
  { n: "Ryker L #2", r: "Waiting" },
];

function BenchmarkVisual() {
  return (<div className="lp-phone">
    <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, margin: "0 0 2px" }}>Home-to-first sprint</div>
    <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>Individual · time · 1 version</div>
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="clbl mb8">Latest · 2026-10-28 4:41 PM · 12U Red Practice</div>
      <div style={{ fontSize: 15, fontWeight: 800 }}>Avg 4.69 seconds</div>
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>4 measured · 1 waiting · 0 partial · 0 skipped · 0 unable</div>
    </div>
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="clbl mb8">Comparison</div>
      <div style={{ fontSize: 15, fontWeight: 800 }}>+0.21 faster (4.3%)</div>
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>matched 4 players · 2026-09-30 → 2026-10-28</div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>3 improved · 0 unchanged · 1 lower</div>
    </div>
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="clbl mb8">Target</div>
      <div style={{ fontSize: 13 }}>≤ 5 seconds · objective 75% of measured</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>3 of 4 measured meet target (75%)</div>
    </div>
    <div className="card">
      <div className="clbl mb8">Players · latest</div>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <tbody>{BENCHMARK_PLAYERS.map(p => <tr key={p.n}>
          <td style={{ borderBottom: "1px solid var(--border)" }}>{p.n}</td>
          <td style={{ borderBottom: "1px solid var(--border)", textAlign: "right" }}>{p.r}</td>
          <td style={{ borderBottom: "1px solid var(--border)", textAlign: "right", width: 40 }}>{p.meets === undefined ? "" : p.meets ? "✓" : "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>);
}

// ── "On Your Wrist" roadmap teaser: an Apple Watch device frame with two
// screen states (live timer, rotate alert), built from the app's own fonts
// and color tokens rather than the mockup's standalone stylesheet.
function WatchFrame({ children }) {
  return (<div className="lp-watch">
    <div className="lp-watch-band top"></div>
    <div className="lp-watch-band bottom"></div>
    <div className="lp-watch-crown"></div>
    <div className="lp-watch-button"></div>
    <div className="lp-watch-case">{children}</div>
  </div>);
}

function PhoneFrame({ children }) {
  return (<div className="lp-phoneframe">
    <div className="lp-phoneframe-island" aria-hidden="true"></div>
    <div className="lp-phoneframe-screen">{children}</div>
  </div>);
}

function WatchLiveScreen() {
  const { display, over, minutesBehind } = useCountdown(CLOCK_STATION_BLOCK_START);
  return (<div className="lp-watch-screen">
    <div className="lp-w-statusline">
      <span className={"lp-w-live" + (over ? " over" : "")}><span className="dot"></span>LIVE</span>
      {over ? <span className="lp-w-behind">{minutesBehind}m behind</span> : <span className="lp-w-ontime">On time</span>}
    </div>
    <div className="lp-w-drill">Station Block</div>
    <div className="lp-w-location">📍 Infield</div>
    <div className={"lp-w-timer" + (over ? " over" : "")}>{display}</div>
    <div className="lp-w-timer-label">remaining</div>
    <div className="lp-w-upnext">
      <div className="lbl">UP NEXT</div>
      <div className="name">Situational Scrimmage <span className="mins">20m</span></div>
    </div>
    <div className="lp-w-next-btn">NEXT &rsaquo;</div>
  </div>);
}

function WatchAlertScreen() {
  return (<div className="lp-watch-screen lp-w-alert-screen">
    <div className="lp-w-haptic" aria-hidden="true">
      <span></span><span></span><span></span><span></span><span></span>
    </div>
    <div className="lp-w-rotate">ROTATE NOW</div>
    <div className="lp-w-move-card">
      <div className="who">Ryker, Owen, Mason</div>
      <div className="to">&rarr; <strong>Batting Cage 1</strong> &middot; Coach Jen</div>
    </div>
    <div className="lp-w-done-btn">GOT IT</div>
  </div>);
}

function Section({ id, eyebrow, title, body, visual, reverse, dark, tight, wideVisual }) {
  return (<section id={id} className={"lp-section" + (dark ? " dark" : "") + (tight ? " tight" : "")}>
    <div className="lp-wrap">
      <div className={"lp-row" + (reverse ? " rev" : "") + (wideVisual ? " wide-visual" : "")}>
        <div className="lp-copy">
          {eyebrow && <div className="lp-eyebrow">{eyebrow}</div>}
          <div className="lp-title">{title}</div>
          {body.map((p, i) => <div key={i} className="lp-body">{p}</div>)}
        </div>
        <div className="lp-visual"><div className="lp-visual-inner">{visual}</div></div>
      </div>
    </div>
  </section>);
}

const FAQS = [
  ...(LAUNCHED ? [
    { q: "Is Run of Practice free?", a: "Yes, to start. The Free plan covers one team, with unlimited live practices and parent-helper links. Pro adds more teams, your whole staff, unlimited drills and templates, and every Goals & Insights tool for $12 a month or $99 a year. No credit card is needed to start." },
    { q: "What is the partner program?", a: "Coaches who use Run of Practice in real practices and share regular, useful feedback can apply to be partners. Partners get Pro free for each quarter they keep helping us improve it." },
  ] : [
    { q: "Is Run of Practice free?", a: "Run of Practice is free during early access while the product is being tested and improved." },
  ]),
  { q: "Who is it for?", a: "Run of Practice is designed for head coaches, assistant coaches and anyone helping run an organized practice." },
  { q: "Does every helper need an account?", a: "No. Assistant coaches can access practices through their accounts, while temporary or ad hoc helpers can receive a link with the information they need." },
  { q: "Can I use it for different sports?", a: "Yes. Run of Practice is designed around common practice needs such as drills, groups, stations, locations, timing, equipment and transitions. The exact setup can be adjusted for different sports and levels." },
  { q: "Can I copy an old practice?", a: "Yes. Previous practices can be copied, adjusted and run again. Coaches can also save reusable templates." },
  { q: "What happens if attendance changes?", a: "Player groupings can be updated based on the players who are actually present. Coaches can use random groupings or make manual changes." },
  { q: "Can I adjust the schedule while practice is happening?", a: "Yes. Coaches can add or reduce time, end an activity early, or skip an activity entirely. These changes are reflected in realtime on all connected devices." },
  { q: "Will I hear the timer if my phone is in my pocket?", a: "Turn on audio and Run of Practice will call out the two-minute warning and blow a whistle when time's up, so you don't need to have the screen in front of you. If a drill runs long, the timer counts into negative time instead of stopping, so you can keep coaching and move on when you're ready." },
];

function FAQ() {
  const [open, setOpen] = useState(0);
  return (<div className="lp-section tight"><div className="lp-wrap" style={{ maxWidth: 760 }}>
    <div className="lp-title" style={{ marginBottom: 4 }}>Questions coaches ask</div>
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {FAQS.map((f, i) => (<div key={i}>
        <button className="lp-faq-q" onClick={() => setOpen(open === i ? -1 : i)}>{f.q}<span style={{ color: "var(--text-dim)", fontSize: 20, flexShrink: 0 }}>{open === i ? "−" : "+"}</span></button>
        {open === i && <div className="lp-faq-a">{f.a}</div>}
      </div>))}
    </div>
  </div></div>);
}

export default function LandingPage({ onGetStarted }) {
  return (<div id="top" className="lp" style={{ minHeight: "100dvh" }}>
    <style>{LP_CSS}</style>
    <Header onGetStarted={onGetStarted} />

    <div className="lp-hero">
      <div className="lp-eyebrow">Practice Planning and Live Execution</div>
      <h1>Plan the practice. Run it live. Keep everyone aligned.</h1>
      <div className="lp-hero-sub">Schedule practices, build the plan, and run it live with your assistants and helpers. Less time explaining what happens next. More time coaching.</div>
      <div className="lp-btnrow">
        <button className="btn primary blg" onClick={onGetStarted}>Try It Free</button>
        <a href="#how-it-works" className="btn ghost blg" style={{ textDecoration: "none" }}>See How It Works</a>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 12 }}>{LAUNCHED ? "Free to start. No credit card needed." : "Free during early access."}</div>
      <div className="lp-hero-mark-wrap">
        <div className="lp-hero-mark-glow" aria-hidden="true" />
        <img className="lp-hero-mark" src="/hero-mark.png" alt="" />
      </div>
    </div>

    <Section id="how-it-works" dark eyebrow="Live Practice View" title="One screen runs the whole practice." visual={<LiveVisual />} body={[
      "What's happening now, time remaining, the coaching focus, which players, which coach, which field, and what's next. No clipboard, no stopwatch, no flipping between notes.",
    ]} />

    <Section eyebrow="Assistant and Helper Views" title="The coaching message stays consistent, no matter who leads the drill." reverse wideVisual visual={<HelperVisual />} body={[
      "Assistant coaches are granted ongoing access to the team's practices through their own account. Parent helpers can join from a shared link, no account or download required. Everyone sees the same drill, timer and coaching focus. Head coaches can give each player a focus point for a skill area, like hitting or fielding. When a drill works that area, the player's focus point is visible to the coach leading that station. The player receives consistent messaging, regardless of the messenger.",
    ]} />

    <Section eyebrow="Transition Support" title="Rotate stations like a well oiled machine." reverse visual={<TransitionVisual />} body={[
      "During transition time, every coach sees where to send their players and which group is coming to their station next. More clarity, less confusion.",
    ]} />

    <Section eyebrow="Live Adjustments & Timers" title="Practice never goes to plan. That's fine." visual={<AdjustVisual />} body={[
      "See at a glance whether the practice as a whole is ahead of or behind its allotted schedule. Each drill announces when there are two minutes remaining, giving stations time to clean up or keep playing until the whistle.",
    ]} />

    <div className="lp-section tight dark" style={{ textAlign: "center" }}>
      <div className="lp-wrap" style={{ maxWidth: 640 }}>
        <div className="lp-title">A smooth practice starts before you get to the field or the court.</div>
        <div className="lp-body">Everything the live view shows comes from a plan you build in minutes.</div>
      </div>
    </div>

    <Section id="features" eyebrow="Practice Builder" title="Build the practice in the order it will happen." reverse visual={<BuilderVisual />} body={[
      "Set your total time, then add warmups, drills, stations, breaks and a scrimmage. Pull from your library or write something new. The running total tells you whether the plan fits the time you have.",
    ]} />

    <Section eyebrow="Stations and Groupings" title="Groups built from who actually showed up." visual={<StationsVisual />} body={[
      "Set station lengths, transition time and rotation order. Players can be grouped at random, by the coach, or by position and handedness. If a player is out sick, adjust the groupings on the fly.",
    ]} />

    <Section eyebrow="Pre-Practice Setup" title="Coaches know where to go and what to bring before the first whistle." reverse visual={<PreSetupVisual />} body={[
      "Assistants and helpers can see the equipment needed at each station, who's coaching where, and a countdown to start. Stations are already set up by the time players arrive.",
    ]} />

    <Section eyebrow="Drill Library" title="Save a drill once. Use it all season." visual={<LibraryVisual />} body={[
      "Each drill keeps its setup, coaching points, skills, default duration and equipment. Add it to any practice in one tap. You never rebuild a drill you've already taught.",
    ]} />

    <Section eyebrow="Schedule" title="Know which practices still need planning." reverse visual={<ScheduleVisual />} body={[
      "Add one-time or recurring practices to your schedule. Each one shows its status so Thursday's practice doesn't sneak up on you Wednesday night.",
    ]} />

    <Section eyebrow="Templates and Previous Practices" title="Start with what already works." visual={<TemplatesVisual />} body={[
      "Save your standard practice as a template, or copy last week's and change two drills. No need to recreate the wheel every week.",
    ]} />

    <Section eyebrow="Practice History" title="Keep the plan and what actually happened together." reverse visual={<HistoryVisual />} body={[
      "After practice, see attendance, actual drill times, what changed on the fly, and notes captured during practice. Every session is stored in Goals & Insights. You can see how practice time spent aligns to the goals you set.",
    ]} />

    <Section eyebrow="Benchmarks · Pro" title="Measure progress the same way every time." visual={<BenchmarkVisual />} body={[
      "Set up a repeatable test once: a home-to-first sprint, bat speed, free throws out of ten. Run it as a station during practice, or record it any time. Assistants, or a parent helper with a recording link, can enter results as players finish.",
      "Each test shows every player's result, who meets your target, and how the same players changed since the last time you measured.",
    ]} />

    <div className="lp-section tight">
      <div className="lp-wrap">
        <div className="lp-title" style={{ textAlign: "center" }}>A clearer plan leads to a smoother practice.</div>
        <div className="lp-outcome" style={{ marginTop: 20 }}>
          <div className="lp-outcome-item">Faster transitions, fewer repeated instructions</div>
          <div className="lp-outcome-item">One coaching message across every station</div>
          <div className="lp-outcome-item">Groups that survive attendance changes</div>
          <div className="lp-outcome-item">More time to observe, teach and adjust</div>
        </div>
      </div>
    </div>

    <div id="on-your-wrist" className="lp-section">
      <div className="lp-wrap" style={{ maxWidth: 760, textAlign: "center" }}>
        <div className="lp-eyebrow-row" style={{ justifyContent: "center" }}>
          <span className="lp-eyebrow">On Your Wrist</span>
          <span className="lp-pill-roadmap">On the Roadmap</span>
        </div>
        <div className="lp-title">Coach the drill, not the clock.</div>
        <div className="lp-body">On our roadmap: Run of Practice on your wrist. Current drill, time remaining and coaching focus at a glance, with a tap on the wrist when it's time to rotate. Your phone stays in your pocket. Your eyes stay on your players.</div>
        <div className="lp-watch-stage">
          <div className="lp-watch-col">
            <WatchFrame><WatchLiveScreen /></WatchFrame>
            <p className="lp-watch-caption"><strong>Glance, don't scroll.</strong> Drill, time and what's next: advance with one tap.</p>
          </div>
          <div className="lp-watch-col">
            <WatchFrame><WatchAlertScreen /></WatchFrame>
            <p className="lp-watch-caption"><strong>A tap on the wrist</strong> when it's time to move: no whistle, no shouting across the field.</p>
          </div>
        </div>
      </div>
    </div>

    {!LAUNCHED && <div id="early-access" className="lp-section" style={{ background: "var(--field-tint)", textAlign: "center" }}>
      <div className="lp-wrap" style={{ maxWidth: 640 }}>
        <div className="lp-eyebrow">Early Access</div>
        <div className="lp-title">Use Run of Practice and help shape what comes next.</div>
        <div className="lp-body">Run of Practice is in early access, and we're looking for coaches to use it in real practices and share what works, what's unclear and where the experience falls short. The goal is to build something coaches can rely on before, during and after every practice.</div>
        <button className="btn primary blg" onClick={onGetStarted} style={{ marginTop: 8 }}>Try Run of Practice</button>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>Free during early access.</div>
      </div>
    </div>}

    {LAUNCHED && <div id="partners" className="lp-section" style={{ background: "var(--field-tint)", textAlign: "center" }}>
      <div className="lp-wrap" style={{ maxWidth: 640 }}>
        <div className="lp-eyebrow">Partner Program</div>
        <div className="lp-title">Coach with Run of Practice and help shape what comes next.</div>
        <div className="lp-body">We're looking for coaches who will use Run of Practice in real practices and tell us honestly what works, what's unclear, and where it falls short. Partners get Pro free for each quarter they keep sharing that feedback.</div>
        <a href="/partners" className="btn primary blg" style={{ marginTop: 8, textDecoration: "none", display: "inline-block" }}>Become a Partner</a>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>Or start on the Free plan today. No credit card needed.</div>
      </div>
    </div>}

    <FAQ />

    <div className="lp-section dark" style={{ textAlign: "center" }}>
      <div className="lp-wrap" style={{ maxWidth: 560 }}>
        <div className="lp-title">Build the plan. Keep everyone on track.</div>
        <div className="lp-body">Schedule the practice, organize the details and run it live from one place.</div>
        <button className="btn primary blg" onClick={onGetStarted} style={{ marginTop: 8 }}>Try It Free</button>
        <div style={{ marginTop: 12 }}><button className="lp-signin" style={{ color: "var(--text-dim)" }} onClick={onGetStarted}>Already have an account? Sign in</button></div>
      </div>
    </div>

    <div className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-brand" style={{ color: "#fff" }}><img src="/apple-touch-icon.png" alt="" /><span style={{ color: "#fff" }}>Run of Practice</span></div>
        <div style={{ fontSize: 13, marginTop: 10, maxWidth: 420 }}>Practice planning and live execution for coaches, assistants and helpers.</div>
        <div className="lp-footer-links">
          <a href="#how-it-works">How It Works</a>
          <a href="#features">Features</a>
          {!LAUNCHED && <a href="#early-access">Early Access</a>}
          {FEATURE_FLAGS.PRICING_PAGE_PUBLIC && <a href="/pricing">Pricing</a>}
          {LAUNCHED && <a href="/partners">Partners</a>}
          <button className="lp-signin" style={{ color: "#c9d6cf" }} onClick={onGetStarted}>Sign In</button>
          <a href={"mailto:" + CONTACT_EMAIL}>Contact</a>
          <a href="/terms">Terms of Use</a>
          <a href="/privacy">Privacy Policy</a>
        </div>
      </div>
    </div>
  </div>);
}
