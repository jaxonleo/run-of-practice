import React, { useState, useEffect, useRef } from "react";

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

// Interactive clock for the hero demo -- unlike useCountdown (pure wall-clock
// math, read-only), this one re-anchors on every pause/resume/adjust/reset so
// it stays Date.now()-accurate while still supporting user control.
function useAdjustableClock(initialSeconds) {
  const reducedMotion = usePrefersReducedMotion();
  const [state, setState] = useState({ base: initialSeconds, at: Date.now(), paused: false });
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (reducedMotion || state.paused) return;
    const id = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [reducedMotion, state.paused]);

  const computeRemaining = (s) => (s.paused || reducedMotion) ? s.base : loopedRemaining(s.base, Math.floor((Date.now() - s.at) / 1000));
  const remaining = computeRemaining(state);
  const over = remaining < 0;

  return {
    display: formatClock(remaining),
    over,
    minutesBehind: over ? Math.ceil(Math.abs(remaining) / 60) : 0,
    paused: state.paused,
    pause: () => setState(s => s.paused ? s : { base: computeRemaining(s), at: Date.now(), paused: true }),
    resume: () => setState(s => s.paused ? { base: s.base, at: Date.now(), paused: false } : s),
    adjust: (deltaSeconds) => setState(s => ({ base: computeRemaining(s) + deltaSeconds, at: Date.now(), paused: s.paused })),
    resetTo: (seconds) => setState(s => ({ base: seconds, at: Date.now(), paused: s.paused })),
  };
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
.lp{background:var(--bg);--mock-card-primary:480px;--mock-card-secondary:350px;}
.lp-header{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--b);display:flex;align-items:center;justify-content:space-between;padding:10px 20px;}
.lp-brand{display:flex;align-items:center;gap:10px;}
.lp-brand img{width:32px;height:32px;border-radius:8px;flex-shrink:0;}
.lp-brand span{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:900;letter-spacing:-.01em;color:var(--black);}
.lp-nav{display:flex;align-items:center;gap:22px;}
.lp-navlink{font-size:13px;font-weight:600;color:var(--black2);text-decoration:none;white-space:nowrap;}
.lp-navlink.hideonsm{display:none;}
.lp-signin{font-size:13px;font-weight:600;color:var(--black2);text-decoration:underline;white-space:nowrap;background:none;border:none;cursor:pointer;}
.lp-wrap{max-width:1120px;margin:0 auto;padding:0 20px;}
.lp-section{padding:56px 0;}
.lp-section.dark{background:var(--black);color:#fff;}
.lp-section.tight{padding:34px 0;}
.lp-eyebrow{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green2);margin-bottom:8px;}
.lp-section.dark .lp-eyebrow{color:var(--gb);}
.lp-title{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;line-height:1.15;letter-spacing:-.01em;margin-bottom:14px;color:var(--black);}
.lp-section.dark .lp-title{color:#fff;}
.lp-body{font-size:15.5px;line-height:1.65;color:var(--black2);margin-bottom:12px;}
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
.lp-phone{background:#fff;border:1px solid var(--b);border-radius:20px;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,.14);text-align:left;color:var(--black);width:100%;max-width:var(--mock-card-primary);margin:0 auto;}
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
.lp-hero-stage{position:relative;width:100%;max-width:var(--mock-card-primary);margin:0 auto;}
.lp-hero-mini{position:absolute;right:-18px;bottom:-22px;width:60%;max-width:var(--mock-card-secondary);transform:scale(0.7) rotate(-2deg);transform-origin:bottom right;z-index:2;filter:drop-shadow(0 16px 26px rgba(0,0,0,.3));}
.lp-hero-mini .lp-phone{max-width:none;}
.lp-rotate-flash{position:absolute;top:14px;right:14px;background:var(--red);color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:12px;letter-spacing:.08em;text-transform:uppercase;padding:5px 12px;border-radius:20px;z-index:5;animation:lp-rotate-flash-pop .3s ease;}
@keyframes lp-rotate-flash-pop{from{opacity:0;transform:scale(.8);}to{opacity:1;transform:scale(1);}}
.lp-chip-fade{animation:lp-chip-fade .3s ease;}
@keyframes lp-chip-fade{from{opacity:0;transform:translateY(2px);}to{opacity:1;transform:translateY(0);}}
.lp-flash-green{animation:lp-flash-green .6s ease;}
@keyframes lp-flash-green{0%{border-color:var(--green);}100%{border-color:var(--b);}}
.lp-hero{background:var(--black);padding:52px 20px 60px;text-align:center;}
.lp-hero h1{font-family:'Barlow Condensed',sans-serif;font-size:36px;font-weight:900;color:#fff;letter-spacing:-.01em;line-height:1.08;margin:14px auto 16px;max-width:640px;}
.lp-hero-sub{font-size:16px;color:var(--td);line-height:1.6;max-width:520px;margin:0 auto 26px;}
@media (min-width:640px){.lp-hero h1{font-size:46px;}}
.lp-btnrow{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}
.lp-outcome{display:grid;grid-template-columns:1fr;gap:10px;}
@media (min-width:640px){.lp-outcome{grid-template-columns:1fr 1fr;}}
.lp-outcome-item{display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid var(--b);border-radius:var(--r);padding:12px 14px;font-size:14px;color:var(--black2);}
.lp-faq-q{width:100%;text-align:left;background:none;border:none;border-top:1px solid var(--b);padding:16px 0;font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:700;color:var(--black);cursor:pointer;display:flex;justify-content:space-between;gap:12px;align-items:center;}
.lp-faq-a{font-size:14.5px;line-height:1.6;color:var(--black2);padding:0 0 16px;max-width:720px;}
.lp-footer{background:var(--black);color:#c9d6cf;padding:36px 20px 28px;}
.lp-footer a{color:#c9d6cf;}
.lp-footer-links{display:flex;flex-wrap:wrap;gap:18px;margin-top:16px;font-size:13px;}

/* ---- On Your Wrist (roadmap) ---- */
.lp-eyebrow-row{display:flex;align-items:center;gap:12px;margin-bottom:8px;}
.lp-eyebrow-row .lp-eyebrow{margin-bottom:0;}
.lp-pill-roadmap{font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--amber);background:var(--ambg);border:1px solid var(--ambb);border-radius:999px;padding:4px 12px;text-transform:uppercase;}
.lp-watch-stage{margin-top:32px;display:flex;justify-content:center;align-items:flex-start;gap:48px;flex-wrap:wrap;}
.lp-watch-col{display:flex;flex-direction:column;align-items:center;max-width:240px;}
.lp-watch{position:relative;width:200px;margin:40px 0 44px;filter:drop-shadow(0 20px 34px rgba(17,23,20,.22));}
.lp-watch-band{position:absolute;left:50%;transform:translateX(-50%);width:104px;height:40px;background:var(--black2);z-index:0;}
.lp-watch-band.top{top:-32px;border-radius:16px 16px 5px 5px;}
.lp-watch-band.bottom{bottom:-32px;border-radius:5px 5px 16px 16px;}
.lp-watch-case{position:relative;z-index:1;background:linear-gradient(145deg,#3a3f3a,#191c19);border-radius:48px;padding:10px;}
.lp-watch-crown{position:absolute;right:-5px;top:64px;width:7px;height:30px;border-radius:4px;background:linear-gradient(90deg,#4a4f4a,#232623);}
.lp-watch-button{position:absolute;right:-4px;top:106px;width:4px;height:40px;border-radius:3px;background:#2c302c;}
.lp-watch-screen{position:relative;background:#000;border-radius:40px;overflow:hidden;aspect-ratio:4/4.9;display:flex;flex-direction:column;padding:22px 17px 17px;}
.lp-w-statusline{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
.lp-w-live{display:flex;align-items:center;gap:6px;font-family:'DM Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.1em;color:#7fd6a4;}
.lp-w-live .dot{width:6px;height:6px;border-radius:50%;background:#43d97d;animation:pulse 1.5s infinite;}
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
.lp-w-next-btn{margin-top:auto;background:var(--green);color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:14px;letter-spacing:.05em;text-align:center;border-radius:999px;padding:11px 0;}
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
.lp-watch-caption{font-size:12.5px;line-height:1.5;color:var(--tm);text-align:center;max-width:210px;}
.lp-watch-caption strong{color:var(--black);font-weight:600;}
@media (prefers-reduced-motion:reduce){.lp-w-live .dot,.lp-w-haptic span,.lp-w-timer.over,.lp-rotate-flash,.lp-chip-fade,.lp-flash-green,.cc-timer.over{animation:none;}}
@media (max-width:560px){.lp-watch-stage{gap:32px;}}
`;

function Header({ onGetStarted }) {
  return (<div className="lp-header">
    <a href="#top" className="lp-brand"><img src="/apple-touch-icon.png" alt="" /><span>Run of Practice</span></a>
    <div className="lp-nav">
      <a className="lp-navlink hideonsm" href="#how-it-works">How It Works</a>
      <a className="lp-navlink hideonsm" href="#features">Features</a>
      <a className="lp-navlink hideonsm" href="#early-access">Early Access</a>
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
function ScheduleVisual() {
  const rows = [
    { day: "Today", t: "12U Red Practice", time: "4:00 PM", icon: "✓", color: "var(--green)", status: "90/90 min" },
    { day: "Today", t: "10U Blue Practice", time: "5:30 PM", icon: null, color: "var(--td)", status: "Needs plan" },
    { day: "Tomorrow", t: "12U Red Practice", time: "4:00 PM", icon: "◐", color: "var(--amber)", status: "40/90 min" },
  ];
  let lastDay = null;
  return (<div className="lp-phone">
    {rows.map((r, i) => (<React.Fragment key={i}>
      {r.day !== lastDay && (lastDay = r.day, <div className="clbl" style={{ marginTop: i ? 10 : 0 }}>{r.day}</div>)}
      <div className="li" style={{ cursor: "default" }}>
        <div className="lim"><div className="lin">{r.t}</div><div className="limt">{r.time} · {r.icon ? <span style={{ color: r.color, fontWeight: 600 }}>{r.icon} {r.status}</span> : r.status}</div></div>
        <span style={{ color: "var(--td)", fontSize: 18 }}>&#8250;</span>
      </div>
    </React.Fragment>))}
  </div>);
}

function LibraryVisual() {
  return (<div className="lp-phone">
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--s1)", borderRadius: "var(--r) var(--r) 0 0" }}>
      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 700 }}>Baseball</span>
      <span style={{ fontSize: 12, color: "var(--td)" }}>14 drills ▾</span>
    </div>
    <div style={{ border: "1px solid var(--b)", borderTop: "none", padding: "10px 12px" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Ground Ball Fundamentals</div>
      <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 2, lineHeight: 1.4 }}>Fielding triangle, glove out front. Right, left, throw.</div>
      <div style={{ fontSize: 11, color: "var(--td)", marginTop: 2 }}>Needs: Bucket of Balls</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        <span className="bdg bs" style={{ fontSize: 10, whiteSpace: "nowrap" }}>Fielding</span><span className="bdg bs" style={{ fontSize: 10, whiteSpace: "nowrap" }}>Footwork</span>
      </div>
    </div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--s1)", border: "1px solid var(--b)", borderRadius: "var(--r)", marginTop: 10 }}>
      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 700 }}>Basketball</span>
      <span style={{ fontSize: 12, color: "var(--td)" }}>6 drills ▸</span>
    </div>
  </div>);
}

function BuilderVisual() {
  const rows = [{ n: "Dynamic Warmup", d: "10m" }, { n: "Throwing Progression", d: "10m" }, { n: "Station Block", d: "45m" }, { n: "Situational Scrimmage", d: "20m" }];
  return (<div className="lp-phone">
    <div className="sechdr mb8"><span className="sectitle">4 Activities</span><span className="pill">85m</span></div>
    {rows.map((r, i) => (<div key={i} className="ablk" style={{ marginBottom: 6 }}>
      <div className="abhdr" style={{ cursor: "default" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: 6, flexShrink: 0, color: "var(--s3)", fontSize: 12, lineHeight: 1 }}><span>&#8593;</span><span>&#8595;</span></div>
        <div style={{ flex: 1, font: "700 14px 'Barlow Condensed',sans-serif" }}>{r.n}</div>
        <span className="bdg bp">{r.d}</span>
      </div>
    </div>))}
    <div className="brow mt8"><button className="btn outline bsm" style={{ flex: 1 }}>Save</button><button className="btn primary bsm" style={{ flex: 1 }}>Run Now</button></div>
  </div>);
}

// `note` mirrors the real app's station chips (CommandScreen.jsx): a
// player's individual focus note rendered right under their name, not
// hidden behind a tap -- whoever picked up this station already knows
// what the coach wants them to say.
function StationChip({ name, tone, note }) {
  const map = { here: { b: "var(--green)", bg: "var(--green)", c: "#fff" }, other: { b: "#d97706", bg: "#fef3c7", c: "#92400e" }, none: { b: "var(--b)", bg: "var(--s1)", c: "var(--black)" } }[tone];
  return (<span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 1, maxWidth: note ? 150 : undefined }}>
    <span style={{ padding: "5px 9px", borderRadius: 8, border: "1.5px solid " + map.b, background: map.bg, color: map.c, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{name}</span>
    {note && <span style={{ fontSize: 10, color: "var(--green2)", lineHeight: 1.3, whiteSpace: "normal" }}>{note}</span>}
  </span>);
}

function LocationLine({ text, style }) {
  return <div style={{ fontSize: 12, color: "var(--td)", display: "flex", alignItems: "center", gap: 4, ...style }}><span aria-hidden="true">📍</span>{text}</div>;
}

function StationsVisual() {
  const stations = [
    { label: "Station 1", area: "Infield", chips: [{ n: "Ryker", t: "here" }, { n: "Owen", t: "here" }, { n: "Mason", t: "here" }] },
    { label: "Station 2", area: "Batting Cage 1", chips: [{ n: "Ava", t: "here" }, { n: "Jordan", t: "here" }] },
    { label: "Station 3", area: "Outfield", chips: [{ n: "Max", t: "here" }, { n: "Riley", t: "here" }, { n: "Sam", t: "here" }] },
  ];
  return (<div className="lp-phone">
    <div style={{ display: "flex", borderRadius: "var(--r)", overflow: "hidden", border: "1.5px solid var(--b)", marginBottom: 8 }}>
      <div style={{ flex: 1, padding: "6px 0", textAlign: "center", background: "var(--green)", color: "#fff", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 700 }}>ROTATE</div>
      <div style={{ flex: 1, padding: "6px 0", textAlign: "center", background: "var(--s1)", color: "var(--black)", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 700 }}>STATIC</div>
    </div>
    <button className="btn outline bsm bfull mb8">Generate Random Groups</button>
    {stations.map((s) => (<div key={s.label} style={{ background: "var(--s1)", border: "1.5px solid var(--b)", borderRadius: "var(--r)", padding: "10px 10px 8px", marginBottom: 8 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 13, fontWeight: 900, color: "var(--green)", letterSpacing: ".05em", marginBottom: 6 }}>{s.label.toUpperCase()} · {s.area.toUpperCase()}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {s.chips.map(c => <StationChip key={c.n} name={c.n} tone={c.t} />)}
      </div>
    </div>))}
  </div>);
}

// Modeled directly on PreviewView (CommandScreen.jsx) -- the actual
// screen behind "Share Setup Link": dark, standalone, opened by whoever's
// setting up a station before the coach ever gets there. Same literal
// colors as that component (not the CSS-var palette the rest of the site
// mocks use) since this dark-on-#0d1512 look IS the real screen, not a
// reskin of it.
const PRE_SETUP_STATIONS = [
  { name: "Ground Ball Fundamentals", area: "Infield", coach: "Coach Mike", equip: ["Bucket of Balls"] },
  { name: "Front Toss", area: "Batting Cage 1", coach: "Coach Jen", equip: ["L-Screen"] },
  { name: "Fly Ball Reads", area: "Outfield", coach: "Ava's Dad (helper)", equip: [] },
];
const CLOCK_PRESETUP_START = 28 * 60 + 41; // 28:41, Pre-Practice Setup only
function PreSetupVisual() {
  const { display, over } = useCountdown(CLOCK_PRESETUP_START);
  return (<div className="lp-phone" style={{ background: "#0d1512", borderColor: "#0d1512" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#52b788", display: "inline-block", flexShrink: 0 }} />
      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#52b788" }}>Practice Setup</span>
      <span style={{ fontSize: 11, color: "#666" }}>· Eastside Park</span>
    </div>
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24, fontWeight: 900, color: "#fff", marginBottom: 14 }}>12U Red</div>
    <div style={{ textAlign: "center", padding: "8px 0 16px", borderBottom: "1px solid rgba(255,255,255,.1)", marginBottom: 16 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: over ? "#f59e0b" : "#52b788", marginBottom: 6 }}>{over ? "Practice Should Have Started" : "Starts In"}</div>
      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 32, fontWeight: 700, color: over ? "#f59e0b" : "#fff" }}>{display}</div>
      <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{over ? "Waiting for the coach to start" : "Use this time to set up stations"}</div>
    </div>
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#ca8a04", marginBottom: 8 }}>Equipment Needed</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {["L-Screen", "Bucket of Balls", "Cones"].map(n => (<span key={n} style={{ background: "rgba(202,138,4,.15)", border: "1px solid rgba(202,138,4,.4)", borderRadius: 20, padding: "3px 10px", fontSize: 11, color: "#fde047", fontWeight: 600 }}>{n}</span>))}
      </div>
    </div>
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#666", marginBottom: 8 }}>Run Order</div>
    {PRE_SETUP_STATIONS.map((st, i) => (<div key={st.name} style={{ padding: "10px 12px", marginBottom: 6, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10, fontWeight: 700, color: "#52b788", letterSpacing: ".05em", marginBottom: 2 }}>Station {i + 1}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 2 }}>{st.name}</div>
      <div style={{ fontSize: 11, color: "#999" }}><span style={{ color: "#52b788", fontWeight: 600 }}>{st.area}</span> · {st.coach}</div>
      {st.equip.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
        {st.equip.map(n => (<span key={n} style={{ background: "rgba(202,138,4,.12)", border: "1px solid rgba(202,138,4,.3)", borderRadius: 20, padding: "2px 8px", fontSize: 10, color: "#fde047" }}>{n}</span>))}
      </div>}
    </div>))}
  </div>);
}

function TemplatesVisual() {
  return (<div className="lp-phone">
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, lineHeight: 1 }}>Standard Tuesday Practice</div>
      <div style={{ fontSize: 12, color: "var(--td)", marginTop: 2, marginBottom: 8 }}>4 activities · 90min</div>
      <button className="btn primary bmd bfull">View / Edit</button>
    </div>
    <div className="clbl" style={{ marginBottom: 6 }}>Tuesday</div>
    <div className="li" style={{ cursor: "default" }}><div className="lim"><div className="lin">12U Red Practice</div><div className="limt">Completed</div></div></div>
    <button className="btn primary bsm bfull mt8">Run Again</button>
  </div>);
}

function LiveVisual({
  drill = "Defensive Shell Drill",
  roundLabel = null,
  location = "Court 1 · Eastside Rec Center",
  startSeconds = CLOCK_LIVE_DEFAULT_START,
  description = "Four defenders in a shell around the key, one ball reversed side to side. Close out low and hard on the catch, stay in a stance.",
  focus = "Sprint to close out, then chop your feet down. Contest without fouling.",
  skills = ["Defense", "Footwork"],
  upNextName = "3-on-3 Scrimmage",
  upNextMins = "20m",
}) {
  const { display, over, minutesBehind } = useCountdown(startSeconds);
  return (<div className="lp-phone">
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
      <div className="row"><span className="live" /><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--green)", marginLeft: 5 }}>Live</span></div>
      {over
        ? <span style={{ background: "var(--ambg)", color: "var(--amber)", padding: "3px 10px", borderRadius: 20, fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700 }}>{minutesBehind}m behind</span>
        : <span style={{ background: "var(--gbg)", color: "var(--green)", padding: "3px 10px", borderRadius: 20, fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700 }}>On time</span>}
    </div>
    {roundLabel && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--td)", marginBottom: 2 }}>{roundLabel}</div>}
    <div className="cc-act-name">{drill}</div>
    {location && <LocationLine text={location} style={{ marginTop: 2, marginBottom: 4 }} />}
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "2px 0 10px" }}>
      <div className={"cc-timer" + (over ? " over" : "")} style={{ fontSize: 46, fontVariantNumeric: "tabular-nums" }}>{display}</div><span style={{ fontSize: 12, color: "var(--td)" }}>remaining</span>
    </div>
    {description && <div style={{ borderLeft: "3px solid var(--b)", paddingLeft: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--td)", marginBottom: 4 }}>Description</div>
      <div style={{ fontSize: 13, color: "var(--black)", lineHeight: 1.5 }}>{description}</div>
    </div>}
    <div style={{ borderLeft: "3px solid #16a34a", paddingLeft: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#16a34a", marginBottom: 4 }}>💡 Coaching Focus</div>
      <div style={{ fontSize: 14, color: "var(--black)", lineHeight: 1.5 }}>{focus}</div>
    </div>
    {skills.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      {skills.map(s => <span key={s} className="bdg bs" style={{ fontSize: 10, whiteSpace: "nowrap" }}>{s}</span>)}
    </div>}
    <div className="cc-queue"><div style={{ padding: "6px 12px", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--td)" }}>Up Next</div><div className="cc-queue-item"><span style={{ fontSize: 13, color: "var(--black2)" }}>{upNextName}</span><span className="bdg bs">{upNextMins}</span></div></div>
  </div>);
}

function StationOverviewRow({ label, drill, area, coach, chips }) {
  return (<div style={{ background: "var(--s1)", border: "1px solid var(--b)", borderRadius: "var(--rs)", padding: "8px 10px", marginBottom: 6 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--green)" }}>{label}</span>
      <span style={{ fontSize: 10, color: "var(--td)" }}>{coach}</span>
    </div>
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 900, color: "var(--black)", marginBottom: 2 }}>{drill}</div>
    <LocationLine text={area} style={{ fontSize: 11, marginBottom: 4 }} />
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{chips}</div>
  </div>);
}

// ── Hero demo: one Station Block round, both cards on one shared,
// pausable/adjustable clock. Stations (drill/coach/location) are fixed;
// only the player groups rotate through them each round.
const HERO_ROTATION = [
  { infield: ["Ryker", "Owen", "Mason"], cage: ["Ava", "Jordan"] },
  { infield: ["Ava", "Jordan"], cage: ["Max", "Riley", "Sam"] },
  { infield: ["Max", "Riley", "Sam"], cage: ["Ryker", "Owen", "Mason"] },
];
function playerTone() { return "here"; }

function HeroPrimaryCard({ round, clock, rotateFlash, players, onPauseToggle, onAdjust, onNext }) {
  return (<div className="lp-phone" style={{ position: "relative" }}>
    {rotateFlash && <div className="lp-rotate-flash">Rotate</div>}
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
      <div className="row"><span className="live" style={{ animationPlayState: clock.paused ? "paused" : "running" }} /><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--green)", marginLeft: 5 }}>Live</span></div>
      {clock.paused
        ? <span style={{ background: "var(--s2)", color: "var(--tm)", padding: "3px 10px", borderRadius: 20, fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700 }}>Paused</span>
        : clock.over
          ? <span style={{ background: "var(--ambg)", color: "var(--amber)", padding: "3px 10px", borderRadius: 20, fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700 }}>{clock.minutesBehind}m behind</span>
          : <span style={{ background: "var(--gbg)", color: "var(--green)", padding: "3px 10px", borderRadius: 20, fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700 }}>On time</span>}
    </div>
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--td)", marginBottom: 2 }}>Round {round} of 3</div>
    <div className="cc-act-name">Ground Ball Fundamentals</div>
    <LocationLine text="Infield · Eastside Park" style={{ marginTop: 2, marginBottom: 2 }} />
    <div className="limt" style={{ marginBottom: 6 }}>Coach Mike</div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "2px 0 10px" }}>
      <div className={"cc-timer" + (clock.over ? " over" : "")} style={{ fontSize: 46, fontVariantNumeric: "tabular-nums" }}>{clock.display}</div><span style={{ fontSize: 12, color: "var(--td)" }}>remaining</span>
    </div>
    <div style={{ borderLeft: "3px solid var(--b)", paddingLeft: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--td)", marginBottom: 4 }}>Description</div>
      <div style={{ fontSize: 13, color: "var(--black)", lineHeight: 1.5 }}>Coach rolls firm grounders, alternating forehand and backhand. Field, footwork, throw to the bucket target.</div>
    </div>
    <div style={{ borderLeft: "3px solid #16a34a", paddingLeft: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#16a34a", marginBottom: 4 }}>💡 Coaching Focus</div>
      <div style={{ fontSize: 14, color: "var(--black)", lineHeight: 1.5 }}>Fielding triangle: feet wide, glove out front. Right, left, throw.</div>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      <span className="bdg bs" style={{ fontSize: 10, whiteSpace: "nowrap" }}>Fielding</span><span className="bdg bs" style={{ fontSize: 10, whiteSpace: "nowrap" }}>Footwork</span>
    </div>
    <div key={round} className="lp-chip-fade" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      {players.map(p => <StationChip key={p} name={p} tone={playerTone(p)} />)}
    </div>
    <div className="cc-queue" style={{ marginBottom: 10 }}>
      <div style={{ padding: "6px 12px", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--td)" }}>Up Next</div>
      <div className="cc-queue-item">
        {round < 3
          ? <span style={{ fontSize: 13, color: "var(--black2)" }}>Round {round + 1}: players rotate</span>
          : <><span style={{ fontSize: 13, color: "var(--black2)" }}>Situational Scrimmage</span><span className="bdg bs">20m</span></>}
      </div>
    </div>
    <div className="brow" style={{ marginBottom: 8, gap: 8 }}>
      <button className="btn ghost bsm" style={{ minWidth: 44, minHeight: 44 }} aria-label={clock.paused ? "Resume timer" : "Pause timer"} onClick={onPauseToggle}>{clock.paused ? "▶" : "❚❚"}</button>
      <button className="btn ghost bsm" style={{ flex: 1, minHeight: 44 }} aria-label="Subtract one minute from round timer" onClick={() => onAdjust(-60)}>−1M</button>
      <button className="btn ghost bsm" style={{ flex: 1, minHeight: 44 }} aria-label="Add one minute to round timer" onClick={() => onAdjust(60)}>+1M</button>
    </div>
    <button className="btn primary blg bfull" style={{ minHeight: 44 }} aria-label="Advance to next round" onClick={onNext}>Next &gt;</button>
  </div>);
}

function HeroOverlayCard({ round, clock, players }) {
  return (<div className="lp-phone">
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--green)", marginBottom: 2 }}>Station 2</div>
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, marginBottom: 2 }}>Front Toss</div>
    <LocationLine text="Batting Cage 1 · Eastside Park" style={{ fontSize: 11, marginBottom: 2 }} />
    <div className="limt" style={{ fontSize: 11, marginBottom: 6 }}>Coach Jen</div>
    <div className={"cc-timer" + (clock.over ? " over" : "")} style={{ fontSize: 30, fontVariantNumeric: "tabular-nums", marginBottom: 8 }}>{clock.display}</div>
    <div style={{ borderLeft: "3px solid var(--b)", paddingLeft: 8, marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--td)" }}>Description</div>
      <div style={{ fontSize: 11.5, lineHeight: 1.4 }}>Firm underhand toss from behind the L-screen. 8 swings, rotate. Partner shags.</div>
    </div>
    <div style={{ borderLeft: "3px solid #16a34a", paddingLeft: 8, marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#16a34a" }}>💡 Coaching Focus</div>
      <div style={{ fontSize: 12, lineHeight: 1.4 }}>Level swing, contact out front.</div>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
      <span className="bdg bs" style={{ fontSize: 9, whiteSpace: "nowrap" }}>Hitting</span><span className="bdg bs" style={{ fontSize: 9, whiteSpace: "nowrap" }}>Contact</span>
    </div>
    <div key={round} className="lp-chip-fade" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {players.map(p => <StationChip key={p} name={p} tone={playerTone(p)} />)}
    </div>
  </div>);
}

function HeroDemo() {
  const clock = useAdjustableClock(CLOCK_STATION_BLOCK_START);
  const [round, setRound] = useState(1);
  const [rotateFlash, setRotateFlash] = useState(false);
  const flashTimeoutRef = useRef(null);
  useEffect(() => () => { if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current); }, []);

  const handleNext = () => {
    clock.resetTo(CLOCK_STATION_BLOCK_START);
    setRound(r => (r % 3) + 1);
    setRotateFlash(true);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setRotateFlash(false), 1000);
  };

  const roundData = HERO_ROTATION[round - 1];

  return (<div className="lp-hero-stage">
    <HeroPrimaryCard
      round={round}
      clock={clock}
      rotateFlash={rotateFlash}
      players={roundData.infield}
      onPauseToggle={clock.paused ? clock.resume : clock.pause}
      onAdjust={clock.adjust}
      onNext={handleNext}
    />
    <div className="lp-hero-mini"><HeroOverlayCard round={round} clock={clock} players={roundData.cage} /></div>
  </div>);
}

function StationDetailVisual() {
  const { display, over } = useCountdown(CLOCK_STATION_BLOCK_START);
  return (<div className="lp-phone">
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--green)", marginBottom: 2 }}>Station 2</div>
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Front Toss</div>
    <LocationLine text="Batting Cage 1 · Eastside Park" style={{ marginBottom: 3 }} />
    <div className="limt" style={{ marginBottom: 6 }}>Coach Jen</div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "2px 0 10px" }}>
      <div className={"cc-timer" + (over ? " over" : "")} style={{ fontSize: 46, fontVariantNumeric: "tabular-nums" }}>{display}</div><span style={{ fontSize: 12, color: "var(--td)" }}>remaining</span>
    </div>
    <div style={{ borderLeft: "3px solid var(--b)", paddingLeft: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--td)", marginBottom: 4 }}>Description</div>
      <div style={{ fontSize: 13, color: "var(--black)", lineHeight: 1.5 }}>Toss from behind the L-screen, firm underhand to the front half of the plate. Each hitter takes 8 swings, then rotates. Partner shags into the bucket.</div>
    </div>
    <div style={{ borderLeft: "3px solid #16a34a", paddingLeft: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#16a34a", marginBottom: 4 }}>💡 Coaching Focus</div>
      <div style={{ fontSize: 14, color: "var(--black)", lineHeight: 1.5 }}>Level swing, contact out front. Let the outside pitch travel.</div>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      <span className="bdg bs" style={{ fontSize: 10, whiteSpace: "nowrap" }}>Hitting</span><span className="bdg bs" style={{ fontSize: 10, whiteSpace: "nowrap" }}>Contact</span>
    </div>
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--td)", marginBottom: 4 }}>Equipment</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <span style={{ border: "1.5px solid #fde047", borderRadius: 20, padding: "3px 10px", fontSize: 12, color: "#854d0e", fontWeight: 600, background: "#fff", whiteSpace: "nowrap" }}>L-Screen</span>
        <span style={{ border: "1.5px solid #fde047", borderRadius: 20, padding: "3px 10px", fontSize: 12, color: "#854d0e", fontWeight: 600, background: "#fff", whiteSpace: "nowrap" }}>Bucket of Balls</span>
      </div>
    </div>
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--td)", marginBottom: 8 }}>Players at this station</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}><StationChip name="Ava" tone="here" note="Keep the front foot closed, drive through the ball." /><StationChip name="Jordan" tone="here" /></div>
  </div>);
}

// One list, one detail view -- a coach's per-player note (set once on
// their profile) shows up right on the chip wherever that player lands,
// so an assistant or parent helper running any given station already
// knows what the coach wants them to hear. Folds what used to be a
// separate "Player Profiles" screenshot into the one story it was
// actually telling.
function HelperVisual() {
  return (<div className="lp-duo-fixed">
    <div className="lp-phone lp-card-primary">
      <div className="clbl">All Stations</div>
      <StationOverviewRow label="Station 1" drill="Ground Ball Fundamentals" area="Infield" coach="Coach Mike" chips={<><StationChip name="Ryker" tone="here" /><StationChip name="Owen" tone="here" /><StationChip name="Mason" tone="here" /></>} />
      <StationOverviewRow label="Station 2" drill="Front Toss" area="Batting Cage 1" coach="Coach Jen" chips={<><StationChip name="Ava" tone="here" note="Keep the front foot closed, drive through the ball." /><StationChip name="Jordan" tone="here" /></>} />
      <StationOverviewRow label="Station 3" drill="Fly Ball Reads" area="Outfield" coach="Coach Dana" chips={<><StationChip name="Max" tone="here" /><StationChip name="Riley" tone="here" /><StationChip name="Sam" tone="here" /></>} />
    </div>
    <div className="lp-phoneframe-wrap"><PhoneFrame><StationDetailVisual /></PhoneFrame></div>
  </div>);
}

function FocusVisual() {
  return (<div className="lp-phone">
    <div style={{ borderLeft: "3px solid #16a34a", paddingLeft: 10, paddingTop: 4, paddingBottom: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#16a34a", marginBottom: 4 }}>💡 Coaching Focus</div>
      <div style={{ fontSize: 15, color: "var(--black)", lineHeight: 1.5 }}>Fielding triangle: feet wide, glove out front. Right, left, throw. Work through the ball, never around it.</div>
    </div>
  </div>);
}

function AdjustVisual() {
  const t = useStepTimer(13 * 60, 4);
  return (<div className={"lp-phone" + (t.flash ? " lp-flash-green" : "")}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
      <span style={{ color: "var(--black)", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 700 }}>Small-Sided Scrimmage</span>
      {t.over
        ? <span style={{ background: "var(--ambg)", color: "var(--amber)", padding: "3px 10px", borderRadius: 20, fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700 }}>{Math.abs(t.aheadMinutes)}m behind</span>
        : <span style={{ background: "var(--gbg)", color: "var(--green)", padding: "3px 10px", borderRadius: 20, fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700 }}>{t.aheadMinutes}m ahead</span>}
    </div>
    <LocationLine text="Field 2 · Riverside Complex" style={{ marginBottom: 8 }} />
    <div className="cc-timer" style={{ fontSize: 34, fontVariantNumeric: "tabular-nums", marginBottom: 8 }}>{t.display}</div>
    <div className="brow" style={{ marginBottom: 8 }}>
      <button className="btn ghost bsm" style={{ flex: 1, minHeight: 44 }} aria-label="Add one minute to activity timer" onClick={() => t.bump(1)}>+1m</button>
      <button className="btn ghost bsm" style={{ flex: 1, minHeight: 44 }} aria-label="Subtract one minute from activity timer" onClick={() => t.bump(-1)}>-1m</button>
    </div>
    <div className="cc-controls" style={{ padding: 0 }}>
      <button className="btn ghost bmd" style={{ minWidth: 52, minHeight: 44 }} aria-label="Previous round" onClick={t.prev}>&lt;</button>
      <button className="btn primary blg" style={{ flex: 1, minHeight: 44 }} aria-label="Next round" onClick={t.next}>Next &gt;</button>
    </div>
  </div>);
}

const ROTATION_MOVES = [
  { names: "Ryker, Owen, Mason", from: "Station 1: Infield · Coach Mike", to: "Station 2: Batting Cage 1 · Coach Jen", bring: "helmets, bats" },
  { names: "Ava, Jordan", from: "Station 2: Batting Cage 1 · Coach Jen", to: "Station 3: Outfield · Coach Dana", bring: "gloves" },
  { names: "Max, Riley, Sam", from: "Station 3: Outfield · Coach Dana", to: "Station 1: Infield · Coach Mike", bring: "gloves" },
];

function TransitionVisual() {
  return (<div className="lp-phone">
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 900, color: "var(--red)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 10 }}>Rotate Now</div>
    {ROTATION_MOVES.map((r, i) => (<div key={r.names} className="cc-trans-card" style={{ marginBottom: i < ROTATION_MOVES.length - 1 ? 8 : 0 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 900, color: "var(--black)", lineHeight: 1.2, marginBottom: 4 }}>{r.names}</div>
      <div style={{ fontSize: 11, color: "var(--td)", marginBottom: 2 }}>from {r.from}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--black)", marginBottom: 4 }}>&#8594; {r.to}</div>
      <div style={{ fontSize: 11, color: "var(--td)" }}>Bring: {r.bring}</div>
    </div>))}
  </div>);
}

function HistoryVisual() {
  return (<div className="lp-phone">
    <div className="sechdr mb8"><span className="sectitle">4 Activities</span><span className="pill">88m</span></div>
    <div className="ablk" style={{ marginBottom: 8 }}>
      <div className="abhdr" style={{ cursor: "default" }}>
        <div style={{ flex: 1, font: "700 14px 'Barlow Condensed',sans-serif" }}>Station Block</div>
        <span className="bdg bs">49m</span>
      </div>
    </div>
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>End of Practice Notes</div>
      <div style={{ fontSize: 13, color: "var(--black)" }}>Cage 1 group needs more reps on the outside pitch. Ryker's throws sailing high, check grip next week.</div>
    </div>
    <button className="btn primary bxl bfull mb8">Run Again</button>
    <button className="btn ghost bmd bfull">Save as Template</button>
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
      <span className="lp-w-live"><span className="dot"></span>LIVE</span>
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
  { q: "Is Run of Practice free?", a: "Run of Practice is free during early access while the product is being tested and improved." },
  { q: "Who is it for?", a: "Run of Practice is designed for head coaches, assistant coaches and anyone helping run an organized practice." },
  { q: "Does every helper need an account?", a: "No. Assistant coaches can access practices through their accounts, while temporary or ad hoc helpers can receive a link with the information they need." },
  { q: "Can I use it for different sports?", a: "Run of Practice is designed around common practice needs such as drills, groups, stations, locations, timing, equipment and transitions. The exact setup can be adjusted for different sports and levels." },
  { q: "Can I copy an old practice?", a: "Yes. Previous practices can be copied, adjusted and run again. Coaches can also save reusable templates." },
  { q: "What happens if attendance changes?", a: "Player groupings can be updated based on the players who are actually present. Coaches can use random groupings or make manual changes." },
  { q: "Can I adjust the schedule while practice is happening?", a: "Yes. Coaches can add or reduce time, end an activity, skip an activity or move to the next part of the practice. Run of Practice shows how those changes affect the overall schedule." },
];

function FAQ() {
  const [open, setOpen] = useState(0);
  return (<div className="lp-section tight"><div className="lp-wrap" style={{ maxWidth: 760 }}>
    <div className="lp-title" style={{ marginBottom: 4 }}>Questions coaches ask</div>
    <div style={{ borderBottom: "1px solid var(--b)" }}>
      {FAQS.map((f, i) => (<div key={i}>
        <button className="lp-faq-q" onClick={() => setOpen(open === i ? -1 : i)}>{f.q}<span style={{ color: "var(--td)", fontSize: 20, flexShrink: 0 }}>{open === i ? "−" : "+"}</span></button>
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
      <div style={{ fontSize: 12, color: "var(--td)", marginTop: 12 }}>Free during early access.</div>
      <div style={{ marginTop: 34, display: "flex", justifyContent: "center" }}>
        <HeroDemo />
      </div>
    </div>

    <Section id="how-it-works" dark eyebrow="Live Practice View" title="One screen runs the whole practice." visual={<LiveVisual />} body={[
      "What's happening now, time remaining, the coaching focus, which players, which coach, which field, and what's next. No clipboard, no stopwatch, no flipping between notes.",
    ]} />

    <Section eyebrow="Assistant and Helper Views" title="Every helper relays exactly what the coach wrote." reverse wideVisual visual={<HelperVisual />} body={[
      "Assistant coaches see their team's practices automatically. Parent helpers get a link, no account needed and nothing to download. Everyone sees the same timer, the same drill and the same coaching focus. Set a note for a player under a skill like Shooting or Hitting, and it follows them to whatever station they land at, so whoever is running that station already knows what the coach wants them to work on.",
    ]} />

    <Section eyebrow="Consistent Coaching" title="Every station teaches the same thing." visual={<FocusVisual />} body={[
      "Write the focus points once. Every assistant and helper sees them while the drill is running, so players hear one message instead of four versions of it.",
    ]} />

    <Section eyebrow="Transition Support" title="Rotate stations without stopping practice." reverse visual={<TransitionVisual />} body={[
      "Before each rotation, every coach sees their drill, location, where to send players, and which players are coming. More clarity, less confusion.",
    ]} />

    <Section eyebrow="Live Adjustments & Timers" title="Practice never goes to plan. That's fine." visual={<AdjustVisual />} body={[
      "Add a minute, cut a drill short, or skip ahead. The schedule recalculates as you go, so you always know if you're ahead or behind. Timers run into negative time: you see a drill went two minutes over instead of losing the thread. Drills that need cleanup can warn the group before time is up.",
    ]} />

    <div className="lp-section tight dark" style={{ textAlign: "center" }}>
      <div className="lp-wrap" style={{ maxWidth: 640 }}>
        <div className="lp-title">A smooth practice starts before you get to the field or the court.</div>
        <div className="lp-body">Everything the live view shows (drills, groups, stations, equipment) comes from a plan you build in minutes, not the night before at the kitchen table.</div>
      </div>
    </div>

    <Section id="features" eyebrow="Practice Builder" title="Build the practice in the order it will happen." reverse visual={<BuilderVisual />} body={[
      "Set your total time, then add warmups, drills, stations, breaks and scrimmage. Pull from your library or write something new. The running total tells you whether the plan fits the time you have.",
    ]} />

    <Section eyebrow="Stations and Groupings" title="Groups built from who actually showed up." visual={<StationsVisual />} body={[
      "Set station lengths, transition time and rotation order. Generate groups from the players at practice: random, balanced, manual or by position and handedness. When attendance changes, the groups update. You don't rebuild the practice because two players are out sick.",
    ]} />

    <Section eyebrow="Pre-Practice Setup" title="Everyone knows what to bring and where to go before the first whistle." reverse visual={<PreSetupVisual />} body={[
      "Share one link with your assistants and helpers. It lays out the equipment needed at each station, who's coaching where, and a countdown to start, so stations are already set up by the time players show up.",
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
      "After practice, see attendance, actual drill times, what changed on the fly, and notes on what needs more work. That history feeds straight into next week's plan.",
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
          <span className="lp-pill-roadmap">Coming to iOS</span>
        </div>
        <div className="lp-title">Coach the drill, not the clock.</div>
        <div className="lp-body">The next step: a native iOS app with Apple Watch support. Current drill, time remaining and coaching focus on your wrist, with a tap when it's time to rotate. Your phone stays in your pocket. Your eyes stay on your players.</div>
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

    <div id="early-access" className="lp-section" style={{ background: "var(--gbg)", textAlign: "center" }}>
      <div className="lp-wrap" style={{ maxWidth: 640 }}>
        <div className="lp-eyebrow">Early Access</div>
        <div className="lp-title">Use it in a real practice. Tell us where it falls short.</div>
        <div className="lp-body">Run of Practice is in early access. We're looking for coaches who will run it during real practices and tell us what worked, what was confusing, and what their assistants needed. The goal: something coaches rely on before, during and after practice.</div>
        <button className="btn primary blg" onClick={onGetStarted} style={{ marginTop: 8 }}>Try Run of Practice</button>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 10 }}>Free during early access.</div>
      </div>
    </div>

    <FAQ />

    <div className="lp-section dark" style={{ textAlign: "center" }}>
      <div className="lp-wrap" style={{ maxWidth: 560 }}>
        <div className="lp-title">Build the plan once. Keep everyone following it.</div>
        <div className="lp-body">Schedule the practice, organize the details and run it live from one place.</div>
        <button className="btn primary blg" onClick={onGetStarted} style={{ marginTop: 8 }}>Try It Free</button>
        <div style={{ marginTop: 12 }}><button className="lp-signin" style={{ color: "var(--td)" }} onClick={onGetStarted}>Already have an account? Sign in</button></div>
      </div>
    </div>

    <div className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-brand" style={{ color: "#fff" }}><img src="/apple-touch-icon.png" alt="" /><span style={{ color: "#fff" }}>Run of Practice</span></div>
        <div style={{ fontSize: 13, marginTop: 10, maxWidth: 420 }}>Practice planning and live execution for coaches, assistants and helpers.</div>
        <div className="lp-footer-links">
          <a href="#how-it-works">How It Works</a>
          <a href="#features">Features</a>
          <a href="#early-access">Early Access</a>
          <button className="lp-signin" style={{ color: "#c9d6cf" }} onClick={onGetStarted}>Sign In</button>
          <a href={"mailto:" + CONTACT_EMAIL}>Contact</a>
          <a href="/terms">Terms of Use</a>
          <a href="/privacy">Privacy Policy</a>
        </div>
      </div>
    </div>
  </div>);
}
