import React, { useState } from "react";

const CONTACT_EMAIL = "contact@runofpractice.com";

// Scoped to this page only -- the app's own CSS (App.jsx's CSS block) is
// injected globally and already defines .btn/.card/.pill/.bdg/.cc-* etc, so
// section visuals below reuse those real component classes instead of
// inventing look-alikes. This block only adds the marketing-page-specific
// layout (header, alternating rows, responsive breakpoint) under an
// `.lp-` prefix so nothing here can collide with the app's own classes.
const LP_CSS = `
.lp{background:var(--bg);}
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
.lp-visual-inner{width:100%;max-width:400px;}
@media (min-width:860px){
  .lp-row{flex-direction:row;gap:56px;align-items:center;}
  .lp-row.rev{flex-direction:row-reverse;}
  .lp-navlink.hideonsm{display:inline;}
}
.lp-phone{background:#fff;border:1px solid var(--b);border-radius:20px;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,.14);}
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
    { day: "Today", t: "Varsity Practice", time: "4:00 PM", icon: "✓", color: "var(--green)", status: "60/60 min" },
    { day: "Today", t: "JV Practice", time: "5:30 PM", icon: null, color: "var(--td)", status: "Needs plan" },
    { day: "Tomorrow", t: "Varsity Practice", time: "4:00 PM", icon: "◐", color: "var(--amber)", status: "35/60 min" },
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
      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 700 }}>Basketball</span>
      <span style={{ fontSize: 12, color: "var(--td)" }}>6 drills ▼</span>
    </div>
    <div style={{ border: "1px solid var(--b)", borderTop: "none", padding: "10px 12px" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>3-Man Weave</div>
      <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 2, lineHeight: 1.4 }}>Finish every rep at full speed, no walking back.</div>
      <div style={{ fontSize: 11, color: "var(--td)", marginTop: 2 }}>Needs: Cones</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
        <span className="bdg bs" style={{ fontSize: 10 }}>Ball Handling</span><span className="bdg bs" style={{ fontSize: 10 }}>Finishing</span>
      </div>
    </div>
  </div>);
}

function BuilderVisual() {
  const rows = [{ n: "Warmup", d: "10m" }, { n: "3-Man Weave", d: "10m" }, { n: "Station Block", d: "20m" }, { n: "Team Scrimmage", d: "15m" }];
  return (<div className="lp-phone">
    <div className="sechdr mb8"><span className="sectitle">4 Activities</span><span className="pill">55m</span></div>
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

function StationChip({ name, tone }) {
  const map = { here: { b: "var(--green)", bg: "var(--green)", c: "#fff" }, other: { b: "#d97706", bg: "#fef3c7", c: "#92400e" }, none: { b: "var(--b)", bg: "var(--s1)", c: "var(--black)" } }[tone];
  return <span style={{ padding: "5px 9px", borderRadius: 8, border: "1.5px solid " + map.b, background: map.bg, color: map.c, fontSize: 12, fontWeight: 700 }}>{name}</span>;
}

function StationsVisual() {
  return (<div className="lp-phone">
    <div style={{ display: "flex", borderRadius: "var(--r)", overflow: "hidden", border: "1.5px solid var(--b)", marginBottom: 8 }}>
      <div style={{ flex: 1, padding: "6px 0", textAlign: "center", background: "var(--green)", color: "#fff", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 700 }}>ROTATE</div>
      <div style={{ flex: 1, padding: "6px 0", textAlign: "center", background: "var(--s1)", color: "var(--black)", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 700 }}>STATIC</div>
    </div>
    <button className="btn outline bsm bfull mb8">Generate Random Groups</button>
    {["Station 1", "Station 2"].map((s, i) => (<div key={i} style={{ background: "var(--s1)", border: "1.5px solid var(--b)", borderRadius: "var(--r)", padding: "10px 10px 8px", marginBottom: 8 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 13, fontWeight: 900, color: "var(--green)", letterSpacing: ".05em", marginBottom: 6 }}>{s.toUpperCase()}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {i === 0 ? (<><StationChip name="Ava" tone="here" /><StationChip name="Jordan" tone="here" /><StationChip name="Sam" tone="other" /></>)
          : (<><StationChip name="Max" tone="here" /><StationChip name="Riley" tone="none" /></>)}
      </div>
    </div>))}
  </div>);
}

function LocationsVisual() {
  return (<div className="lp-phone">
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 700 }}>Eastside Park</span>
        <button className="btn ghost bxs">+ Area</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <span className="bdg bs">Batting Cage 1</span><span className="bdg bs">Batting Cage 2</span><span className="bdg bs">Infield</span><span className="bdg bs">Outfield</span>
      </div>
    </div>
    <div className="sechdr mb8"><span className="sectitle">Team Equipment</span></div>
    <div className="li" style={{ cursor: "default" }}><div className="lim"><div className="lin">L-Screen</div></div></div>
    <div className="li" style={{ cursor: "default" }}><div className="lim"><div className="lin">Bucket of Balls</div></div></div>
  </div>);
}

function TemplatesVisual() {
  return (<div className="lp-phone">
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 900, lineHeight: 1 }}>Standard Weekly Practice</div>
      <div style={{ fontSize: 12, color: "var(--td)", marginTop: 2, marginBottom: 8 }}>6 activities · 60min</div>
      <button className="btn primary bmd bfull">View / Edit</button>
    </div>
    <div className="clbl" style={{ marginBottom: 6 }}>Tuesday</div>
    <div className="li" style={{ cursor: "default" }}><div className="lim"><div className="lin">Varsity Practice</div><div className="limt">Completed</div></div></div>
    <button className="btn primary bsm bfull mt8">Run Again</button>
  </div>);
}

function LiveVisual() {
  return (<div className="lp-phone">
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
      <div className="row"><span className="live" /><span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--green)", marginLeft: 5 }}>Live</span></div>
      <span style={{ background: "var(--gbg)", color: "var(--green)", padding: "3px 10px", borderRadius: 20, fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700 }}>On time</span>
    </div>
    <div className="cc-act-name">3-Man Weave</div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "2px 0 10px" }}>
      <div className="cc-timer" style={{ fontSize: 46 }}>04:12</div><span style={{ fontSize: 12, color: "var(--td)" }}>remaining</span>
    </div>
    <div style={{ borderLeft: "3px solid #16a34a", paddingLeft: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#16a34a", marginBottom: 4 }}>💡 Coaching Focus</div>
      <div style={{ fontSize: 14, color: "var(--black)", lineHeight: 1.5 }}>Finish every rep at full speed, no walking back.</div>
    </div>
    <div className="cc-queue"><div style={{ padding: "6px 12px", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--td)" }}>Up Next</div><div className="cc-queue-item"><span style={{ fontSize: 13, color: "var(--black2)" }}>Station Block</span><span className="bdg bs">20m</span></div></div>
  </div>);
}

function HelperVisual() {
  return (<div className="lp-row" style={{ gap: 14 }}>
    <div className="lp-phone" style={{ maxWidth: 220 }}>
      <div className="clbl">Head Coach</div>
      <div className="cc-act-name" style={{ fontSize: 17 }}>Station Block</div>
      <div className="limt">All 4 stations · Round 1 of 4</div>
    </div>
    <div className="lp-phone" style={{ maxWidth: 220 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--green)", marginBottom: 2 }}>Station 2</div>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Batting Cage 2</div>
      <div className="limt" style={{ marginBottom: 6 }}>Coach Jen</div>
      <div style={{ borderLeft: "3px solid #16a34a", paddingLeft: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#16a34a" }}>💡 Coaching Focus</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>Level swing, contact out front</div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}><StationChip name="Ava" tone="here" /><StationChip name="Jordan" tone="here" /></div>
    </div>
  </div>);
}

function FocusVisual() {
  return (<div className="lp-phone">
    <div style={{ borderLeft: "3px solid #16a34a", paddingLeft: 10, paddingTop: 4, paddingBottom: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#16a34a", marginBottom: 4 }}>💡 Coaching Focus</div>
      <div style={{ fontSize: 15, color: "var(--black)", lineHeight: 1.5 }}>Stay balanced through the movement. Keep your eyes up. Finish every rep under control.</div>
    </div>
  </div>);
}

function AdjustVisual() {
  return (<div className="lp-phone">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <span style={{ color: "var(--black)", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 700 }}>Station Block</span>
      <span style={{ background: "var(--gbg)", color: "var(--green)", padding: "3px 10px", borderRadius: 20, fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700 }}>4m ahead</span>
    </div>
    <div className="brow" style={{ marginBottom: 8 }}>
      <button className="btn ghost bsm" style={{ flex: 1 }}>+1m</button><button className="btn ghost bsm" style={{ flex: 1 }}>-1m</button>
    </div>
    <div className="cc-controls" style={{ padding: 0 }}>
      <button className="btn ghost bmd" style={{ minWidth: 52 }}>&lt;</button>
      <button className="btn primary blg" style={{ flex: 1 }}>Next &gt;</button>
    </div>
  </div>);
}

function TimerVisual() {
  return (<div className="lp-phone">
    <div className="cc-act-name">Batting Cage 2</div>
    <div className="cc-timer over" style={{ fontSize: 46 }}>-01:42</div>
    <div style={{ fontSize: 12, color: "var(--td)", marginTop: 4 }}>over planned time · prepare to transition</div>
  </div>);
}

function TransitionVisual() {
  return (<div className="lp-phone">
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 900, color: "var(--red)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 10 }}>Rotate Now</div>
    <div className="cc-trans-card">
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, fontWeight: 900, color: "var(--black)", lineHeight: 1.2, marginBottom: 6 }}>Timmy, Billy, Bobby</div>
      <div style={{ fontSize: 12, color: "var(--td)", marginBottom: 3 }}>from Station 1: Infield · Coach Mike</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--black)" }}>&#8594; Station 2: Batting Cage 2 · Coach Jen</div>
    </div>
  </div>);
}

function HistoryVisual() {
  return (<div className="lp-phone">
    <div className="sechdr mb8"><span className="sectitle">4 Activities</span><span className="pill">58m</span></div>
    <div className="ablk" style={{ marginBottom: 8 }}>
      <div className="abhdr" style={{ cursor: "default" }}>
        <div style={{ flex: 1, font: "700 14px 'Barlow Condensed',sans-serif" }}>3-Man Weave</div>
        <span className="bdg bs">10m</span>
      </div>
    </div>
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>End of Practice Notes</div>
      <div style={{ fontSize: 13, color: "var(--black)" }}>Cage 2 group needs more reps on timing.</div>
    </div>
    <button className="btn primary bxl bfull mb8">Run Again</button>
    <button className="btn ghost bmd bfull">Save as Template</button>
  </div>);
}

function Section({ id, eyebrow, title, body, visual, reverse, dark, tight }) {
  return (<section id={id} className={"lp-section" + (dark ? " dark" : "") + (tight ? " tight" : "")}>
    <div className="lp-wrap">
      <div className={"lp-row" + (reverse ? " rev" : "")}>
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
  return (<div id="top" className="lp" style={{ minHeight: "100dvh", overflowY: "auto" }}>
    <style>{LP_CSS}</style>
    <Header onGetStarted={onGetStarted} />

    <div className="lp-hero">
      <div className="lp-eyebrow">Practice Planning and Live Execution</div>
      <h1>Plan the practice. Run it live. Keep everyone aligned.</h1>
      <div className="lp-hero-sub">Run of Practice gives coaches one place to schedule practices, build detailed plans, organize drills, players, stations, equipment and locations, then run the plan live with assistants and helpers. Spend less time explaining what happens next and more time coaching.</div>
      <div className="lp-btnrow">
        <button className="btn primary blg" onClick={onGetStarted}>Try It Free</button>
        <a href="#how-it-works" className="btn ghost blg" style={{ textDecoration: "none" }}>See How It Works</a>
      </div>
      <div style={{ fontSize: 12, color: "var(--td)", marginTop: 12 }}>Free during early access.</div>
      <div style={{ marginTop: 34, display: "flex", justifyContent: "center" }}><div style={{ maxWidth: 320, width: "100%" }}><LiveVisual /></div></div>
    </div>

    <Section id="how-it-works" eyebrow="Schedule" title="See what is planned and what still needs work." visual={<ScheduleVisual />} body={[
      "Add one-time or recurring practices and see the status of each one at a glance.",
      "You can quickly tell which practices are ready, which have been started and which still need a plan.",
      "Instead of waiting until the night before, you always know what is coming and what needs your attention.",
    ]} />

    <Section id="features" eyebrow="Drill Library" title="Build a drill library around the way you coach." reverse visual={<LibraryVisual />} body={[
      "Save the drills you use so you do not have to recreate them for every practice. Each drill can include a description and setup instructions, coaching focus points, the skills it develops, default duration, equipment and grouping format.",
      "The library becomes a reusable collection of the drills, teaching points and practice ideas that fit your team.",
    ]} />

    <Section eyebrow="Practice Builder" title="Build the practice in the order it will happen." visual={<BuilderVisual />} body={[
      "Start with the amount of time available and create the full flow of practice. Add drills from your library or create something new, and adjust the duration for that specific practice without changing the saved default.",
      "Include everything needed to run the plan: opening checklist, warmups, drills, stations, breaks, team periods, position-specific work and closing activities. You can see the total planned time as the practice comes together.",
    ]} />

    <Section eyebrow="Stations and Groupings" title="Organize the players before the drill starts." reverse visual={<StationsVisual />} body={[
      "Create stations and define how long each station lasts, how much transition time is needed and how players will move through the rotation. Group players based on who is actually at practice, using random groups, manual groups, balanced groups or position-specific groups.",
      "Attendance changes can flow into the groupings so the coach does not have to rebuild the practice when someone is absent.",
    ]} />

    <Section eyebrow="Locations and Equipment" title="Plan around the space and equipment you actually have." visual={<LocationsVisual />} body={[
      "Save the places where your team practices, then define the specific areas within each location, such as Main Field, Bullpen, Batting Cage 2 or Court 1. Assign each drill or station to the correct area.",
      "Equipment can also be listed ahead of time so coaches and helpers know what needs to be ready.",
    ]} />

    <Section eyebrow="Templates and Previous Practices" title="Start with what already works." reverse visual={<TemplatesVisual />} body={[
      "Save common practice structures as templates so you do not have to begin with a blank plan every time. You can also copy a previous practice, run it again or make a few changes for the next session.",
      "The more you use Run of Practice, the less work it should take to create the next plan.",
    ]} />

    <div className="lp-section tight dark" style={{ textAlign: "center" }}>
      <div className="lp-wrap" style={{ maxWidth: 640 }}>
        <div className="lp-title">The plan does not stop being useful when practice starts.</div>
        <div className="lp-body">Once practice begins, Run of Practice turns the plan into a live view that coaches, assistants and helpers can follow together. The head coach stays in control while everyone else sees the information they need to carry out the plan.</div>
      </div>
    </div>

    <Section dark eyebrow="Live Practice View" title="Keep the full practice in view." visual={<LiveVisual />} body={[
      "The live practice screen shows what is happening now, how much time remains, the coaching focus, which players are involved, who is leading the activity, where it is happening, what equipment is needed and what is coming next.",
      "The coach can move through the practice without switching between a written plan, a stopwatch and separate instructions.",
    ]} />

    <Section eyebrow="Assistant and Helper Views" title="Put the same live plan in every coach's hands." reverse visual={<HelperVisual />} body={[
      "Assistant coaches automatically see the practices assigned to their team. For an additional coach or parent helper, send a simple link they can open on their phone.",
      "They see what they are responsible for now, which players they have, what drill they are running, the coaching points to reinforce, how much time remains and where they go next. Ad hoc helpers do not need to create an account or download an app.",
    ]} />

    <Section eyebrow="Consistent Coaching" title="Keep the coaching message consistent." visual={<FocusVisual />} body={[
      "The head coach can include the specific focus points that matter for each drill. Assistants and helpers see those same points while the drill is happening.",
      "Instead of each coach emphasizing something different, everyone can reinforce the same priorities, and players receive clearer instruction with fewer things competing for their attention.",
    ]} />

    <Section eyebrow="Live Adjustments" title="Adjust the plan without losing track of it." reverse visual={<AdjustVisual />} body={[
      "Practice rarely runs exactly as planned. Add time when a drill needs another repetition, end something early when the team is ready to move on, or skip an activity and move directly to the next one.",
      "Run of Practice updates the live schedule as changes are made, so the coach can always see whether practice is ahead, on schedule or behind.",
    ]} />

    <Section eyebrow="Timers and Warnings" title="Know how long the drill actually took." visual={<TimerVisual />} body={[
      "When the planned time expires, the timer can continue into negative time, so a coach can immediately see that a drill has gone two minutes over instead of losing track of the schedule.",
      "Activities that require cleanup or travel can include an advance warning, so a group knows to finish the current repetition and start packing up before time runs out.",
    ]} />

    <Section eyebrow="Transition Support" title="Make the next move clear before the current drill ends." reverse visual={<TransitionVisual />} body={[
      "Transitions should not require the head coach to stop everyone and explain the next setup. Before the change, each coach or helper can see their next location, their next drill, the players moving with them, the coach taking over the group, and any equipment that needs to move.",
      "Everyone can prepare for what is next while the current activity is finishing.",
    ]} />

    <div className="lp-section tight">
      <div className="lp-wrap">
        <div className="lp-title" style={{ textAlign: "center" }}>A clearer plan leads to a smoother practice.</div>
        <div className="lp-outcome" style={{ marginTop: 20 }}>
          <div className="lp-outcome-item">Faster transitions, less time repeating instructions</div>
          <div className="lp-outcome-item">More consistent coaching across every station</div>
          <div className="lp-outcome-item">Less time sorting players and rebuilding groups</div>
          <div className="lp-outcome-item">More time for the coach to observe, teach and adjust</div>
        </div>
      </div>
    </div>

    <Section eyebrow="Practice History" title="Keep the plan and what actually happened together." reverse visual={<HistoryVisual />} body={[
      "After practice, keep a record of attendance, completed activities, actual drill durations, coaching notes, changes made during practice and areas that need more work.",
      "Use that information when building the next practice or deciding which plan to run again.",
    ]} />

    <div id="early-access" className="lp-section" style={{ background: "var(--gbg)", textAlign: "center" }}>
      <div className="lp-wrap" style={{ maxWidth: 640 }}>
        <div className="lp-eyebrow">Early Access</div>
        <div className="lp-title">Use it in a real practice. Tell us where it falls short.</div>
        <div className="lp-body">Run of Practice is currently in early access. We are looking for coaches who will use it during real practices and provide direct feedback about what made planning easier, what was confusing, what slowed them down, and what assistants needed to run their part of the plan.</div>
        <div className="lp-body">The goal is to build something coaches can rely on before, during and after practice.</div>
        <button className="btn primary blg" onClick={onGetStarted} style={{ marginTop: 8 }}>Try Run of Practice</button>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 10 }}>Free during early access.</div>
      </div>
    </div>

    <div className="lp-section dark" style={{ textAlign: "center" }}>
      <div className="lp-wrap" style={{ maxWidth: 560 }}>
        <div className="lp-title">Build the plan once. Keep everyone following it.</div>
        <div className="lp-body">Schedule the practice, organize the details and run it live from the same place.</div>
        <button className="btn primary blg" onClick={onGetStarted} style={{ marginTop: 8 }}>Try It Free</button>
        <div style={{ marginTop: 12 }}><button className="lp-signin" style={{ color: "var(--td)" }} onClick={onGetStarted}>Already have an account? Sign in</button></div>
      </div>
    </div>

    <FAQ />

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
