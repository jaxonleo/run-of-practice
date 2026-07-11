import React from "react";

const CONTACT_EMAIL = "contact@runofpractice.com";

const LIc = {
  Plan: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /><path d="M7 14h4M7 17h7" /></svg>,
  Run: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
  Share: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 10.6l6.8-3.8M8.6 13.4l6.8 3.8" /></svg>,
  Track: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>,
};

const CAPS = [
  { I: LIc.Plan, title: "Plan practices worth the minutes.", body: "Drills, stations, timing, groups, all built in minutes from your phone." },
  { I: LIc.Run, title: "Run it live.", body: "One shared timer keeps the whole practice moving, station to station." },
  { I: LIc.Share, title: "Put a plan in every helper's hand.", body: "Anyone helping just opens a link, no app or account needed, and sees exactly what to run and coach right now." },
  { I: LIc.Track, title: "Keep the record.", body: "Attendance, notes, and what actually happened, saved with every practice." },
];

export default function LandingPage({ onGetStarted }) {
  return (<div style={{ minHeight: "100dvh", background: "var(--bg)", overflowY: "auto" }}>
    <div style={{ background: "var(--black)", padding: "48px 24px 40px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
      <div style={{ width: 84, height: 84, borderRadius: 20, overflow: "hidden", marginBottom: 18, boxShadow: "0 8px 32px rgba(0,0,0,.4)" }}>
        <img src="/apple-touch-icon.png" style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="Run of Practice" />
      </div>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 34, fontWeight: 900, color: "#fff", letterSpacing: "-.01em", lineHeight: 1.05, marginBottom: 14, maxWidth: 340 }}>
        Make every minute of practice count.
      </div>
      <div style={{ fontSize: 15, color: "var(--td)", lineHeight: 1.5, maxWidth: 320, marginBottom: 28 }}>
        Plan it once, run it live, and everyone on your staff, from assistant coaches to helpers to players, knows exactly what to do.
      </div>
      <button className="btn primary blg bfull" style={{ maxWidth: 320 }} onClick={onGetStarted}>Try it free</button>
      <button className="btn ghost bmd bfull" style={{ maxWidth: 320, marginTop: 10, background: "transparent", color: "var(--td)", border: "1.5px solid rgba(255,255,255,.2)" }} onClick={onGetStarted}>Already have an account? Sign in</button>
    </div>

    <div style={{ padding: "36px 20px", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ fontSize: 15, lineHeight: 1.6, color: "var(--black2)", marginBottom: 12 }}>
        Players end up waiting in line. Helpers aren't always sure what they're supposed to be running. Assistant coaches all emphasize something different, and transitions eat up more time than you planned for. Before long you're spending more time managing logistics than actually developing players.
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.6, color: "var(--black2)", marginBottom: 32 }}>
        Run of Practice keeps everyone aligned, so coaches spend more time coaching and players spend more time improving.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 32 }}>
        {CAPS.map((c, i) => (<div key={i} className="card" style={{ padding: "16px 14px" }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--gbg)", color: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
            <div style={{ width: 18, height: 18 }}><c.I /></div>
          </div>
          <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{c.title}</div>
          <div style={{ fontSize: 12.5, color: "var(--tm)", lineHeight: 1.4 }}>{c.body}</div>
        </div>))}
      </div>

      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--black2)" }}>
          Run of Practice is a coaching operations platform. It connects the plan you build ahead of time to what actually happens once practice starts, so it's not another scheduling app and it's not a group chat. It's the plan itself, live, in everyone's hands.
        </div>
      </div>

      <div style={{ marginBottom: 32 }}>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Built by a coach who still coaches.</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--black2)" }}>
          Run of Practice is in early access, and the coaches using it now are shaping what it becomes. Try it out, and if something would make your practices better, <a href={"mailto:" + CONTACT_EMAIL} style={{ color: "var(--green)" }}>tell us</a>. We read everything.
        </div>
      </div>

      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, lineHeight: 1.3, marginBottom: 18, maxWidth: 340, marginLeft: "auto", marginRight: "auto" }}>
          If you forget you're even using software because practice just runs better, that's the goal.
        </div>
        <button className="btn primary blg bfull" style={{ maxWidth: 320, margin: "0 auto" }} onClick={onGetStarted}>Try it free</button>
      </div>

      <div style={{ paddingTop: 20, borderTop: "1px solid var(--b)", display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 8, fontSize: 12, color: "var(--td)" }}>
        <a href="/terms" style={{ color: "var(--td)" }}>Terms of Use</a>
        <span>·</span>
        <a href="/privacy" style={{ color: "var(--td)" }}>Privacy Policy</a>
        <span>·</span>
        <a href={"mailto:" + CONTACT_EMAIL} style={{ color: "var(--td)" }}>{CONTACT_EMAIL}</a>
        <span>·</span>
        <a href="#" onClick={e => { e.preventDefault(); onGetStarted(); }} style={{ color: "var(--td)" }}>Sign in</a>
      </div>
    </div>
  </div>);
}
