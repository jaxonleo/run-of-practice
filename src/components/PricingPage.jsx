import React from "react";

const CONTACT_EMAIL = "contact@runofpractice.com";

// Public preview page, not yet linked from anywhere in the app (Jax asked
// for the URL without a link from the marketing home page while the actual
// tiers/copy get reviewed). Reachable directly at /pricing in the meantime.
// Forward-looking on purpose: the rest of the site (LandingPage, FAQ) still
// says "free during early access" everywhere, so this describes what
// pricing will look like at general availability, not what's enforced
// today -- the early-access banner below says so explicitly.
// No functional CTAs yet either (no billing/checkout exists in this app at
// all) -- every tier shows a plain "Coming Soon" badge instead of a button,
// so nothing here reads as a live purchase flow that isn't real.
const PP_CSS = `
.pp{background:#fff;color:var(--black);min-height:100dvh;font-family:'Barlow',sans-serif;}
.pp-header{padding:18px 24px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--b);}
.pp-brand{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--black);}
.pp-brand img{width:26px;height:26px;border-radius:6px;display:block;}
.pp-brand span{font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:900;}
.pp-hero{max-width:720px;margin:0 auto;padding:48px 24px 4px;text-align:center;}
.pp-eyebrow{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--green);margin-bottom:10px;}
.pp-h1{font-family:'Barlow Condensed',sans-serif;font-size:38px;font-weight:900;line-height:1.08;letter-spacing:-.01em;margin-bottom:14px;}
.pp-sub{font-size:16px;color:var(--tm);line-height:1.6;max-width:560px;margin:0 auto;}
.pp-banner{display:inline-block;background:var(--gbg);color:var(--green2);border:1px solid var(--gb);border-radius:20px;padding:7px 18px;font-size:13px;font-weight:600;margin-top:18px;line-height:1.5;}
.pp-grid{max-width:1180px;margin:40px auto 0;padding:0 24px 72px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;align-items:stretch;}
@media (max-width:1020px){.pp-grid{grid-template-columns:repeat(2,1fr);max-width:720px;}}
@media (max-width:600px){.pp-grid{grid-template-columns:1fr;max-width:420px;}}
.pp-card{border:1.5px solid var(--b);border-radius:16px;padding:24px 20px;display:flex;flex-direction:column;background:#fff;}
.pp-card.featured{border-color:var(--green);box-shadow:0 0 0 1px var(--green);}
.pp-tier-row{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.pp-tier{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;letter-spacing:.01em;}
.pp-most-popular{font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--green);background:var(--gbg);padding:4px 9px;border-radius:12px;flex-shrink:0;}
.pp-pitch{font-size:13px;color:var(--tm);line-height:1.55;margin:8px 0 20px;}
.pp-price{font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:900;line-height:1;}
.pp-price.custom{font-size:22px;}
.pp-price-sub{font-size:12px;color:var(--td);margin-top:6px;line-height:1.5;min-height:32px;}
.pp-badge{align-self:flex-start;background:var(--s2);color:var(--tm);font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:7px 15px;border-radius:20px;margin:18px 0 20px;}
.pp-feat{list-style:none;margin:0 0 4px;padding:0;display:flex;flex-direction:column;gap:11px;}
.pp-feat li{display:flex;gap:8px;font-size:13.5px;line-height:1.5;color:var(--black2);}
.pp-feat li.off{color:var(--td);}
.pp-feat .mk{flex-shrink:0;width:16px;font-weight:700;}
.pp-feat li:not(.off) .mk{color:var(--green);}
.pp-footer{border-top:1px solid var(--b);padding:28px 24px 40px;text-align:center;font-size:12px;color:var(--td);}
.pp-footer a{color:var(--tm);text-decoration:none;margin:0 8px;}
`;

const TIERS = [
  {
    key: "free",
    name: "Free",
    pitch: "For a coach trying out Run of Practice with a single team. No credit card, no risk.",
    price: "$0",
    priceSub: "Free, forever",
    features: [
      "Run and manage one team from start to finish.",
      "Bring on up to two assistant coaches to help keep an eye on things, though they'll be view only for now.",
      "Run one practice live at a time, everything a single team needs.",
      "Build a personal library of up to 15 of your own drills.",
      "Get a taste of the Run of Practice drill library with 5 ready made drills to try.",
      "Save your two favorite practice plans as reusable templates.",
      "Keep your entire practice history forever, and look back on any practice you've ever run.",
    ],
    notIncluded: [
      "Parent helper links",
      "Player focus areas, goals, and insights",
      "At home programs for players",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    pitch: "For a coach running more than one team, or who wants their full library and history always at hand.",
    price: "$96",
    priceSub: "per year, or $12 per month",
    features: [
      "Coach as many teams as you need, all from one account.",
      "Keep up to two assistant coaches on your roster, and invite unlimited parent helpers for game day and practice support.",
      "Run one practice live at a time.",
      "Build an unlimited personal library of your own drills.",
      "Unlock the entire Run of Practice drill library, so you always have proven drills ready to grab.",
      "Save unlimited practice templates.",
      "Keep your entire practice history forever, and look back on any practice you've ever run.",
      "Track player focus areas and see how your practice time lines up with your season goals.",
      "Assign players an at home program to work on between practices, fully managed by you.",
    ],
    notIncluded: [],
    featured: true,
  },
  {
    key: "proplus",
    name: "Pro+",
    pitch: "For a coaching staff that plans together: run two practices at once and let assistants build alongside you.",
    price: "$150",
    priceSub: "per year, billed annually",
    features: [
      "Coach as many teams as you need, all from one account.",
      "Your two assistant coaches can create and edit drills and templates right alongside you, and you can still invite unlimited parent helpers.",
      "Run two practices live at the same time, ideal when your teams practice at overlapping hours.",
      "Build an unlimited personal library of your own drills.",
      "Unlock the entire Run of Practice drill library, and let your assistant coaches contribute drills straight into your team's shared library.",
      "Save unlimited practice templates.",
      "Keep your entire practice history forever, and look back on any practice you've ever run.",
      "Track player focus areas and see how your practice time lines up with your season goals.",
      "Assign players an at home program to work on between practices, fully managed by you.",
    ],
    notIncluded: [],
  },
  {
    key: "org",
    name: "Org",
    pitch: "For a club or organization coaching multiple teams under one roof, with oversight and reporting built in.",
    price: "Custom pricing",
    priceCustom: true,
    priceSub: "Talk to us for a quote. Pricing per team goes down as your organization grows.",
    features: [
      "Every team in your organization can have as many coaches and helpers as they need, with no per person limits.",
      "Every team can run its practice live at the same time, with no limit on how many run at once.",
      "Give every coach an unlimited personal drill library.",
      "Every coach can pull from and add to one shared club library, plus full access to the Run of Practice drill library.",
      "Save unlimited templates across every team in your organization.",
      "See every practice ever run across your organization for as long as you need, with reporting on equipment use and who showed up to each one.",
      "See goals and actual practice time across every team in your organization, all in one place.",
      "Coaches can assign at home programs to players, and admins and directors can see them across the whole organization.",
    ],
    notIncluded: [],
  },
];

export default function PricingPage() {
  return (<div className="pp">
    <style>{PP_CSS}</style>
    <div className="pp-header">
      <a href="/" className="pp-brand"><img src="/apple-touch-icon.png" alt="" /><span>Run of Practice</span></a>
    </div>

    <div className="pp-hero">
      <div className="pp-eyebrow">Pricing</div>
      <div className="pp-h1">Straightforward plans for however you coach.</div>
      <div className="pp-sub">From a single team just getting started to a club running dozens of programs, there's a plan built for it.</div>
      <div className="pp-banner">Run of Practice is currently free for every coach during early access. These plans reflect what pricing will look like once early access ends.</div>
    </div>

    <div className="pp-grid">
      {TIERS.map(t => (<div key={t.key} className={"pp-card" + (t.featured ? " featured" : "")}>
        <div className="pp-tier-row">
          <div className="pp-tier">{t.name}</div>
          {t.featured && <span className="pp-most-popular">Most Popular</span>}
        </div>
        <div className="pp-pitch">{t.pitch}</div>
        <div className={"pp-price" + (t.priceCustom ? " custom" : "")}>{t.price}</div>
        <div className="pp-price-sub">{t.priceSub}</div>
        <div className="pp-badge">Coming Soon</div>
        <ul className="pp-feat">
          {t.features.map((f, i) => (<li key={i}><span className="mk">&#10003;</span><span>{f}</span></li>))}
          {t.notIncluded.map((f, i) => (<li key={"off" + i} className="off"><span className="mk">&ndash;</span><span>Not included: {f}</span></li>))}
        </ul>
      </div>))}
    </div>

    <div className="pp-footer">
      <div style={{ marginBottom: 10 }}>Questions about a plan? Reach us at <a href={"mailto:" + CONTACT_EMAIL} style={{ margin: 0 }}>{CONTACT_EMAIL}</a>.</div>
      <div>
        <a href="/terms">Terms of Use</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="/faq">FAQ</a>
      </div>
    </div>
  </div>);
}
