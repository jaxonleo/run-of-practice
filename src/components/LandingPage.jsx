import React, { useState } from "react";
import { submitPublicFeedback } from "../supabase.js";

const LIc = {
  Plan: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /><path d="M7 14h4M7 17h7" /></svg>,
  Run: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
  Share: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 10.6l6.8-3.8M8.6 13.4l6.8 3.8" /></svg>,
  Track: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>,
};

const CAPS = [
  { I: LIc.Plan, title: "Plan the practice", body: "Drills, stations, rotations, timing — built in minutes, not a notebook page." },
  { I: LIc.Run, title: "Run it live", body: "A timer that drives the practice: what's next, who's where, how long's left." },
  { I: LIc.Share, title: "Share a helper view", body: "Send a link to a parent helper or assistant — no login, just what they need to run their station." },
  { I: LIc.Track, title: "Track attendance & absences", body: "Mark who's out ahead of time, and it flows into groupings automatically." },
];

function FeedbackBlock() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    if (!email.trim() || !message.trim() || sending) return;
    setSending(true); setError("");
    const res = await submitPublicFeedback({ email: email.trim(), message: message.trim(), pageContext: "landing" });
    setSending(false);
    if (res && res.error) { setError("Something went wrong. Try again."); return; }
    setDone(true);
  };
  if (done) return (<div className="card" style={{ textAlign: "center", padding: "24px 16px" }}>
    <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 20, fontWeight: 900, color: "var(--green)", marginBottom: 4 }}>Thanks — got it.</div>
    <div style={{ fontSize: 14, color: "var(--td)" }}>We read every note.</div>
  </div>);
  return (<div className="card">
    <div className="fld mb10">
      <label className="lbl">Your email</label>
      <input className="inp" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
    </div>
    <div className="fld mb10">
      <label className="lbl">What's on your mind?</label>
      <textarea className="ta" rows={4} placeholder="Ideas, questions, what you'd want to see..." value={message} onChange={e => setMessage(e.target.value)} />
    </div>
    {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 10 }}>{error}</div>}
    <button className="btn primary bmd bfull" onClick={send} disabled={!email.trim() || !message.trim() || sending}>{sending ? "Sending..." : "Send Feedback"}</button>
  </div>);
}

export default function LandingPage({ onGetStarted }) {
  return (<div style={{ minHeight: "100dvh", background: "var(--bg)", overflowY: "auto" }}>
    <div style={{ background: "var(--black)", padding: "48px 24px 40px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
      <div style={{ width: 84, height: 84, borderRadius: 20, overflow: "hidden", marginBottom: 18, boxShadow: "0 8px 32px rgba(0,0,0,.4)" }}>
        <img src="/apple-touch-icon.png" style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="Run of Practice" />
      </div>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 34, fontWeight: 900, color: "#fff", letterSpacing: "-.01em", lineHeight: 1.05, marginBottom: 14, maxWidth: 340 }}>
        Live practice execution for youth sports coaches.
      </div>
      <div style={{ fontSize: 15, color: "var(--td)", lineHeight: 1.5, maxWidth: 320, marginBottom: 28 }}>
        Not another scheduling app — TeamSnap already does that. Run of Practice is about running the practice itself.
      </div>
      <button className="btn primary blg bfull" style={{ maxWidth: 320 }} onClick={onGetStarted}>Try it free</button>
      <button className="btn ghost bmd bfull" style={{ maxWidth: 320, marginTop: 10, background: "transparent", color: "var(--td)", border: "1.5px solid rgba(255,255,255,.2)" }} onClick={onGetStarted}>Already have an account? Sign in</button>
    </div>

    <div style={{ padding: "36px 20px", maxWidth: 480, margin: "0 auto" }}>
      <div className="clbl">Built by coaches, for coaches</div>
      <div style={{ fontSize: 15, lineHeight: 1.6, color: "var(--black2)", marginBottom: 32 }}>
        Run of Practice started because running a practice off a notes app and a stopwatch got old. It's built by a coach, for the actual job of standing on a field with a group of kids and a plan you need to execute — not just print out.
      </div>

      <div className="card" style={{ background: "var(--gbg)", borderColor: "var(--gb)", marginBottom: 32 }}>
        <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--green)", marginBottom: 6 }}>Founding Coach — Early Access</div>
        <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--black2)" }}>
          We're early, and building this out in the open with the coaches who use it. Sign up now and you're helping shape what this becomes — your feedback goes straight into what gets built next.
        </div>
      </div>

      <div className="clbl" style={{ marginBottom: 14 }}>What it does</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 32 }}>
        {CAPS.map((c, i) => (<div key={i} className="card" style={{ padding: "16px 14px" }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--gbg)", color: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
            <div style={{ width: 18, height: 18 }}><c.I /></div>
          </div>
          <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{c.title}</div>
          <div style={{ fontSize: 12.5, color: "var(--tm)", lineHeight: 1.4 }}>{c.body}</div>
        </div>))}
      </div>

      <div className="clbl" style={{ marginBottom: 6 }}>Tell us what you think</div>
      <div style={{ fontSize: 13.5, color: "var(--tm)", marginBottom: 12 }}>We're actively building this — tell us what's working, what's missing, or what you'd want next.</div>
      <FeedbackBlock />

      <div style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid var(--b)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <button className="btn outline bsm" onClick={onGetStarted}>Sign In</button>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--td)" }}>
          <a href="/terms" style={{ color: "var(--td)" }}>Terms of Use</a>
          <a href="/privacy" style={{ color: "var(--td)" }}>Privacy Policy</a>
        </div>
      </div>
    </div>
  </div>);
}
