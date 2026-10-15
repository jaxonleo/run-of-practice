import { useEffect, useState } from "react";
import { submitPartnerApplication } from "../supabase.js";

// Public partner program page (/partners, 2026-10-15), reachable signed in
// or not, linked from the landing page nav, its partner section, and the
// footer. Applications go through submit_partner_application (one open
// application per email; a repeat submission updates it) and email Jax;
// he approves and renews each free Pro quarter from /admin/partners.

const CONTACT_EMAIL = "contact@runofpractice.com";
const SPORTS = ["Basketball", "Baseball", "Softball", "Soccer", "Volleyball", "Football", "Lacrosse", "Hockey", "Other"];

const CSS = `
.pt{background:#fff;color:var(--ink);min-height:100dvh;font-family:'Barlow',sans-serif;}
.pt-header{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:10px 20px;}
.pt-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);}
.pt-brand img{width:32px;height:32px;border-radius:8px;display:block;}
.pt-brand span{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:900;}
.pt-nav{display:flex;align-items:center;gap:18px;}
.pt-navlink{font-size:13px;font-weight:600;color:var(--ink-soft);text-decoration:none;}
.pt-hero{max-width:680px;margin:0 auto;padding:44px 20px 8px;text-align:center;}
.pt-eyebrow{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--field-accent);margin-bottom:8px;}
.pt-h1{font-family:'Barlow Condensed',sans-serif;font-size:36px;font-weight:900;line-height:1.08;margin-bottom:14px;}
.pt-sub{font-size:16px;color:var(--text-muted);line-height:1.6;}
.pt-grid{max-width:900px;margin:32px auto 0;padding:0 20px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
@media (max-width:760px){.pt-grid{grid-template-columns:1fr;}}
.pt-card{border:1.5px solid var(--border);border-radius:14px;padding:18px;}
.pt-card h3{font-family:'Barlow Condensed',sans-serif;font-size:19px;font-weight:900;margin:0 0 6px;}
.pt-card p{font-size:14px;color:var(--ink-soft);line-height:1.55;margin:0;}
.pt-form{max-width:560px;margin:40px auto 0;padding:22px 20px;border:1.5px solid var(--field);border-radius:16px;box-sizing:border-box;}
.pt-form h2{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:900;margin:0 0 4px;}
.pt-footer{border-top:1px solid var(--border);margin-top:56px;padding:24px 20px 40px;text-align:center;font-size:12px;color:var(--text-dim);}
.pt-footer a{color:var(--text-muted);text-decoration:none;margin:0 8px;}
`;

export default function PartnersPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Partner Program | Run of Practice";
    return () => { document.title = prev; };
  }, []);
  const [f, setF] = useState({ name: "", email: "", sport: "", teamLevel: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!f.name.trim() || !f.email.trim()) { setError("Your name and email are required."); return; }
    setBusy(true);
    const { error: err } = await submitPartnerApplication(f);
    setBusy(false);
    if (err) { setError(err.message && !err.message.includes("function") ? err.message : "That didn't go through. Try again, or email " + CONTACT_EMAIL + "."); return; }
    setDone(true);
  };

  return (<div className="pt">
    <style>{CSS}</style>
    <div className="pt-header">
      <a href="/" className="pt-brand"><img src="/apple-touch-icon.png" alt="" /><span>Run of Practice</span></a>
      <div className="pt-nav">
        <a className="pt-navlink" href="/pricing">Pricing</a>
        <a className="pt-navlink" href="/">Sign In</a>
      </div>
    </div>

    <div className="pt-hero">
      <div className="pt-eyebrow">Partner Program</div>
      <div className="pt-h1">Help build the practice tool coaches actually want</div>
      <div className="pt-sub">We're looking for coaches who will run real practices with Run of Practice and tell us honestly what works and what doesn't. In return, partners get Pro free for each quarter they keep sharing that feedback.</div>
    </div>

    <div className="pt-grid">
      <div className="pt-card"><h3>Coach with it</h3><p>Plan and run your actual practices in Run of Practice, with your staff and helpers.</p></div>
      <div className="pt-card"><h3>Tell us the truth</h3><p>Share what's working, what's confusing, and what's missing. A short note after practice is plenty.</p></div>
      <div className="pt-card"><h3>Get Pro free</h3><p>Each quarter you keep giving useful feedback, your next quarter of Pro is on us. No card, nothing to cancel.</p></div>
    </div>

    <form className="pt-form" onSubmit={submit}>
      {done ? (<>
        <h2>Thanks for applying</h2>
        <div style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.6, marginTop: 6 }}>We read every application and will be in touch at <strong>{f.email}</strong>. If you haven't already, <a href="/" style={{ color: "var(--field)" }}>create your free account</a> with the same email so your Pro quarter can start as soon as you're approved.</div>
      </>) : (<>
        <h2>Apply to be a partner</h2>
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 14 }}>Use the email you sign in with (or will sign in with).</div>
        <div className="fld mb10"><label className="lbl">Your name</label><input className="inp" value={f.name} onChange={e => set("name", e.target.value)} autoComplete="name" /></div>
        <div className="fld mb10"><label className="lbl">Email</label><input className="inp" type="email" value={f.email} onChange={e => set("email", e.target.value)} autoComplete="email" /></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div className="fld mb10" style={{ flex: 1, minWidth: 160 }}><label className="lbl">Sport</label>
            <select className="sel" value={f.sport} onChange={e => set("sport", e.target.value)} style={{ width: "100%" }}>
              <option value="">Choose...</option>
              {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="fld mb10" style={{ flex: 1, minWidth: 160 }}><label className="lbl">Team level</label><input className="inp" placeholder="e.g. 12U, varsity, club" value={f.teamLevel} onChange={e => set("teamLevel", e.target.value)} /></div>
        </div>
        <div className="fld mb10"><label className="lbl">Tell us about your team and how you'd use it</label><textarea className="inp" rows={4} value={f.message} onChange={e => set("message", e.target.value)} /></div>
        {error && <div style={{ fontSize: 13, color: "var(--danger)", marginBottom: 10 }}>{error}</div>}
        <button className="btn primary bmd bfull" type="submit" disabled={busy}>{busy ? "Sending..." : "Apply"}</button>
      </>)}
    </form>

    <div className="pt-footer">
      Questions? <a href={"mailto:" + CONTACT_EMAIL} style={{ margin: 0 }}>{CONTACT_EMAIL}</a>
      <div style={{ marginTop: 10 }}><a href="/">Home</a><a href="/pricing">Pricing</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></div>
    </div>
  </div>);
}
