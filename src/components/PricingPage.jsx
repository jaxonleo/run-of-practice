import React, { useEffect, useState } from "react";
import { FEATURE_FLAGS } from "../entitlements.js";
import { Ic } from "../icons.jsx";

const CONTACT_EMAIL = "contact@runofpractice.com";

// Public preview page, not yet linked from anywhere in the app (still under
// review -- reachable only by typing /pricing directly, same deliberate
// choice as the prior version of this page). Header now matches
// LandingPage's own lp-header pattern (same sticky white bar, brand, and nav
// treatment) rather than the plain centered-logo bar this page started with
// -- reimplemented locally (not imported) since this file is deliberately
// self-contained, same reasoning as PP_CSS itself.
// Launch structure: Free, Pro, Pro+, and Organizations. Pro+ (added back
// after a follow-up request) grants everything Pro does, plus delegating
// practice planning to any number of assistants per team (widened from one,
// 2026-08-16) and 2 concurrent live practices -- pricing-page content only
// for now, not enforced anywhere
// (see src/entitlements.js's PLAN_LIMITS.pro_plus, same inert scaffolding
// as free/pro). Forward-looking on purpose: the rest of the site still says
// "free during early access" everywhere, and FEATURE_FLAGS.BILLING_ENABLED
// is false, so every CTA here either points a visitor at using the product
// today or at a plain mailto -- nothing reads as a live checkout that isn't
// real.
const PP_CSS = `
.pp{background:#fff;color:var(--black);min-height:100dvh;font-family:'Barlow',sans-serif;}
.pp-header{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--b);display:flex;align-items:center;justify-content:space-between;padding:10px 20px;}
.pp-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--black);}
.pp-brand img{width:32px;height:32px;border-radius:8px;flex-shrink:0;display:block;}
.pp-brand span{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:900;letter-spacing:-.01em;}
.pp-nav{display:flex;align-items:center;gap:22px;}
.pp-navlink{font-size:13px;font-weight:600;color:var(--black2);text-decoration:none;white-space:nowrap;}
.pp-navlink.hideonsm{display:none;}
.pp-signin{font-size:13px;font-weight:600;color:var(--black2);text-decoration:underline;white-space:nowrap;background:none;border:none;cursor:pointer;}
@media (min-width:860px){.pp-navlink.hideonsm{display:inline;}}
.pp-hero{max-width:720px;margin:0 auto;padding:48px 24px 4px;text-align:center;}
.pp-eyebrow{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green2);margin-bottom:8px;}
.pp-h1{font-family:'Barlow Condensed',sans-serif;font-size:38px;font-weight:900;line-height:1.08;letter-spacing:-.01em;margin-bottom:14px;}
.pp-sub{font-size:16px;color:var(--tm);line-height:1.6;max-width:560px;margin:0 auto;}

.pp-early{max-width:720px;margin:26px auto 0;padding:20px 24px;text-align:center;background:var(--gbg);border:1px solid var(--gb);border-radius:16px;}
.pp-early-h{font-family:'Barlow Condensed',sans-serif;font-size:19px;font-weight:900;color:var(--green2);margin-bottom:8px;}
.pp-early-body{font-size:14px;color:var(--black2);line-height:1.6;max-width:560px;margin:0 auto 16px;}
.pp-early-ctas{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}

.pp-btn{display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--rs);cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.05em;text-transform:uppercase;font-size:14px;padding:11px 22px;text-decoration:none;transition:opacity .12s;}
.pp-btn:active{opacity:.7;}
.pp-btn.primary{background:var(--green);color:#fff;}
.pp-btn.outline{background:transparent;color:var(--black);border:1.5px solid var(--b);}
.pp-btn.disabled{background:var(--s2);color:var(--tm);cursor:default;}
.pp-btn.sm{padding:8px 16px;font-size:12.5px;}

.pp-toggle-wrap{display:flex;flex-direction:column;align-items:center;gap:8px;margin:34px auto 0;}
.pp-toggle{display:inline-flex;border:1.5px solid var(--b);border-radius:24px;padding:3px;background:#fff;}
.pp-toggle button{border:none;background:none;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;letter-spacing:.04em;text-transform:uppercase;padding:8px 20px;border-radius:20px;cursor:pointer;color:var(--tm);}
.pp-toggle button[aria-pressed="true"]{background:var(--green);color:#fff;}
.pp-toggle-help{font-size:12.5px;color:var(--td);}

.pp-grid{max-width:1020px;margin:32px auto 0;padding:0 24px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:stretch;}
@media (max-width:900px){.pp-grid{grid-template-columns:1fr 1fr;max-width:520px;}}
@media (max-width:560px){.pp-grid{grid-template-columns:1fr;max-width:420px;}}
.pp-card{border:1.5px solid var(--b);border-radius:16px;padding:26px 22px;display:flex;flex-direction:column;background:#fff;}
.pp-card.featured{border-color:var(--green);box-shadow:0 0 0 1px var(--green);}
.pp-tier-row{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.pp-tier{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:900;letter-spacing:.01em;}
.pp-most-popular{font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--green);background:var(--gbg);padding:4px 9px;border-radius:12px;flex-shrink:0;}
.pp-pitch{font-size:13.5px;color:var(--tm);line-height:1.55;margin:8px 0 20px;min-height:40px;}
.pp-price{font-family:'Barlow Condensed',sans-serif;font-size:34px;font-weight:900;line-height:1;}
.pp-price-sub{font-size:12.5px;color:var(--td);margin-top:6px;line-height:1.5;min-height:18px;}
.pp-cta{margin:18px 0 20px;}
.pp-note{font-size:11.5px;color:var(--td);margin-top:8px;}
.pp-feat{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px;}
.pp-feat li{display:flex;gap:8px;font-size:13.5px;line-height:1.5;color:var(--black2);}
.pp-feat .mk{flex-shrink:0;width:16px;font-weight:700;color:var(--green);}

.pp-org{max-width:1180px;margin:40px auto 0;padding:0 24px;}
.pp-org-inner{background:var(--black);color:#fff;border-radius:20px;padding:36px 32px;display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center;}
@media (max-width:760px){.pp-org-inner{grid-template-columns:1fr;padding:28px 22px;}}
.pp-org-eyebrow{font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green3,var(--green));margin-bottom:10px;}
.pp-org-h{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:900;line-height:1.1;margin-bottom:10px;}
.pp-org-sub{font-size:14.5px;color:#c9cfcb;line-height:1.6;margin-bottom:20px;}
.pp-org-price{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;margin-bottom:6px;}
.pp-org-price-help{font-size:12.5px;color:#9aa39c;line-height:1.55;margin-bottom:20px;}
.pp-org-feat{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px;}
.pp-org-feat li{display:flex;gap:8px;font-size:13.5px;line-height:1.5;color:#e6e9e7;}
.pp-org-feat .mk{flex-shrink:0;width:16px;font-weight:700;color:var(--green3,var(--green));}

.pp-table-wrap{max-width:980px;margin:56px auto 0;padding:0 24px;}
.pp-table-title{font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;text-align:center;margin-bottom:6px;}
.pp-table-sub{font-size:14px;color:var(--tm);text-align:center;max-width:480px;margin:0 auto 24px;line-height:1.5;}
.pp-scroll{overflow-x:auto;border:1px solid var(--b);border-radius:14px;}
.pp-cmp{width:100%;border-collapse:collapse;min-width:620px;font-size:13.5px;table-layout:fixed;}
.pp-cmp col.pp-feat-col{width:36%;}
.pp-cmp col.pp-plan-col{width:16%;}
.pp-cmp thead th{text-align:center;padding:14px 8px;border-bottom:2px solid var(--black);background:#fff;}
.pp-cmp thead th:first-child{text-align:left;font-family:'Barlow Condensed',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.03em;font-size:13px;}
.pp-plan-pill{display:inline-block;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:12px;letter-spacing:.04em;text-transform:uppercase;padding:5px 15px;border-radius:20px;}
.pp-plan-pill.free{background:var(--s2);color:var(--black2);}
.pp-plan-pill.pro{background:var(--green);color:#fff;}
.pp-plan-pill.proplus{background:var(--black);color:#fff;}
.pp-plan-pill.org{background:#fff;color:var(--black);border:1.5px solid var(--b);}
.pp-cmp .pp-group-row th,.pp-cmp .pp-group-row td{text-align:left;background:var(--gbg);color:var(--green2);font-family:'Barlow Condensed',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:11.5px;padding:8px 12px;}
.pp-cmp .pp-group-row th{position:sticky;left:0;}
.pp-cmp tbody th{text-align:left;font-weight:600;padding:12px;border-bottom:1px solid var(--b);position:sticky;left:0;background:#fff;color:var(--black2);font-size:13px;}
.pp-cmp tbody td{text-align:center;padding:12px 10px;border-bottom:1px solid var(--b);color:var(--tm);}
.pp-cmp tbody tr.pp-row-alt th,.pp-cmp tbody tr.pp-row-alt td{background:var(--s2);}
.pp-cmp tbody td.pp-featured-col{background:var(--gbg);}
.pp-cmp tbody tr.pp-row-alt td.pp-featured-col{background:var(--gbg);}
.pp-cb{width:22px;height:22px;border-radius:50%;border:2px solid var(--b);display:inline-flex;align-items:center;justify-content:center;background:transparent;}
.pp-cb.on{border-color:var(--green);background:var(--green);}
.pp-value{font-weight:700;color:var(--black2);line-height:1.3;}
.pp-value.pp-dash{color:var(--td);font-weight:400;}

.pp-faq{max-width:720px;margin:56px auto 0;padding:0 24px;}
.pp-faq-title{font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;text-align:center;margin-bottom:16px;}
.pp-faq-item{border-bottom:1px solid var(--b);}
.pp-faq-item button{width:100%;text-align:left;background:none;border:none;padding:16px 0;display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer;font:inherit;}
.pp-faq-item button span:first-child{font-weight:700;color:var(--black);font-size:14.5px;}
.pp-faq-mark{color:var(--td);font-size:20px;flex-shrink:0;}
.pp-faq-a{padding:0 0 16px;font-size:13.5px;color:var(--black2);line-height:1.6;}

.pp-final{max-width:640px;margin:64px auto 0;padding:0 24px;text-align:center;}
.pp-final-h{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:900;margin-bottom:10px;}
.pp-final-sub{font-size:14.5px;color:var(--tm);line-height:1.6;margin-bottom:22px;}
.pp-final-ctas{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}

.pp-footer{border-top:1px solid var(--b);margin-top:56px;padding:28px 24px 40px;text-align:center;font-size:12px;color:var(--td);}
.pp-footer a{color:var(--tm);text-decoration:none;margin:0 8px;}
`;

const FREE_FEATURES = [
  "One active personal team",
  "Build, schedule, and run practices live",
  "Timers, transitions, rotations, and live adjustments",
  "Up to two assistant coaches",
  "Unlimited parent-helper links",
  "Player focus areas",
  "20 active personal drills",
  "Three active practice templates",
  "Your 10 most recent completed practices",
];

const PRO_FEATURES = [
  "Up to three active personal teams",
  "No plan-based assistant limit",
  "Unlimited personal drills and templates",
  "Full Run of Practice drill library",
  "Complete practice history",
  "Player focus areas",
  "Season goals",
  "Planned-versus-actual practice insights",
];

const PROPLUS_FEATURES = PRO_FEATURES.concat([
  "Delegate practice planning to any number of assistant coaches on each of your teams",
  "Run two practices live at the same time, ideal when your teams practice at overlapping hours",
  "Share drill-library and practice-planning permissions with your assistants even when they aren't on Pro themselves",
]);

const ORG_FEATURES = [
  "Create and assign organization teams",
  "Add and manage coaches centrally",
  "Publish an organization drill library",
  "Share organization equipment and locations",
  "Keep personal and organization teams in one coach account",
  "See weekly live-practice activity",
  "Retain organization teams and history when coaches change",
];

// Redesigned again (2026-08-02, second pass) after checking GameChanger's
// live comparison table directly: their table opens with only a couple of
// shared rows before differentiating, not a whole section of identical
// checkmarks. Our old "Core coaching tools" group repeated 5 rows that were
// true across all four columns -- exactly the redundancy that reads as
// noise. That group is gone; the shared foundation is now one line of prose
// above the table (see pp-table-sub below) and every remaining row is a
// genuine differentiator. "Future capability" rows from the original
// version (cross-team development reporting, advanced adoption reporting)
// stay dropped -- neither is built, and a comparison table shouldn't market
// something that doesn't exist.
const COMPARISON_GROUPS = [
  {
    title: "Teams and staff",
    rows: [
      { feature: "Active personal teams", type: "value", free: "1", pro: "3", proplus: "3", org: "Org-managed" },
      { feature: "Assistant coaches", type: "value", free: "2", pro: "Unlimited", proplus: "Unlimited", org: "Org-managed" },
      { feature: "Delegate practice planning to an assistant", type: "value", free: "—", pro: "—", proplus: "Unlimited per team", org: "Org-managed" },
      { feature: "Concurrent live practices", type: "value", free: "1", pro: "1", proplus: "2", org: "Unlimited" },
    ],
  },
  {
    title: "Drill library and templates",
    rows: [
      { feature: "Personal drill library", type: "value", free: "20 drills", pro: "Unlimited", proplus: "Unlimited", org: "Org-managed" },
      { feature: "Full Run of Practice drill library", type: "check", free: false, pro: true, proplus: true, org: true },
      { feature: "Personal templates", type: "value", free: "3", pro: "Unlimited", proplus: "Unlimited", org: "Org-managed" },
      { feature: "Organization drill library", type: "check", free: false, pro: false, proplus: false, org: true },
    ],
  },
  {
    title: "Player development",
    rows: [
      { feature: "Season goals", type: "check", free: false, pro: true, proplus: true, org: true },
      { feature: "Planned-versus-actual insights", type: "check", free: false, pro: true, proplus: true, org: true },
      { feature: "Practice history", type: "value", free: "10 most recent", pro: "Complete", proplus: "Complete", org: "Complete" },
    ],
  },
  {
    title: "Organization oversight",
    rows: [
      { feature: "Organization equipment and locations", type: "check", free: false, pro: false, proplus: false, org: true },
      { feature: "Centralized coach management", type: "check", free: false, pro: false, proplus: false, org: true },
      { feature: "Organization-team history", type: "check", free: false, pro: false, proplus: false, org: true },
      { feature: "Weekly live-practice dashboard", type: "check", free: false, pro: false, proplus: false, org: true },
    ],
  },
];

const FAQ_ITEMS = [
  { q: "What counts as an active team?", a: "An active team can schedule, build, and run new practices. Archived teams keep their roster, practices, templates, and history but cannot create new practices until they are reactivated." },
  { q: "Can I archive a team and reactivate it later?", a: "Yes. Free includes one active personal team, and Pro includes up to three. You can archive and reactivate teams as long as you remain within your plan's active-team limit." },
  { q: "Do assistant coaches need their own subscription?", a: "No. Assistant access is covered by the team owner's plan. Assistants create an account so they can view practices, update future attendance, and take control during a live practice." },
  { q: "Do parent helpers need an account?", a: "No. Parent helpers use a practice-specific link and see only what they need to help with that practice." },
  { q: "What happens to my information if I downgrade?", a: "Nothing is deleted. Teams, drills, templates, history, goals, and insights remain stored. Free limits which teams and content remain active and which practice history is visible." },
  { q: "Are organization teams counted toward my personal team limit?", a: "No. Organization teams are covered by the organization and do not count against your one Free or three Pro active personal teams." },
  { q: "What happens when a coach leaves an organization?", a: "The organization keeps its teams, practice history, drills, equipment, and locations. The coach keeps personal teams and personal content." },
  { q: "Can I switch between annual and monthly billing?", a: "Yes. Plan changes take effect according to the billing terms shown during checkout. Annual Pro provides the lowest effective monthly price." },
  { q: "What happens when early access ends?", a: "Early-access coaches will receive at least 30 days' notice. No data will be deleted. Eligible early-access coaches may receive a discounted first year of Pro." },
  { q: "Is there a Pro trial?", a: "After paid plans launch, new coaches can use a 14-day Pro preview without entering a credit card." },
  { q: "Do you offer pricing for schools, leagues, or nonprofits?", a: "Organization pricing is based on the number of active teams and the support the program needs. Contact us so we can understand your setup." },
  { q: "What do I do if my sport isn't listed?", a: "If you're creating a team for a sport that isn't listed, reach out to us at " + CONTACT_EMAIL + " and we'll add it." },
];

function useSeo() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Pricing | Run of Practice";
    const setMeta = (name, content) => {
      let el = document.head.querySelector(`meta[name="${name}"]`);
      const created = !el;
      if (!el) { el = document.createElement("meta"); el.setAttribute("name", name); document.head.appendChild(el); }
      const prevContent = el.getAttribute("content");
      el.setAttribute("content", content);
      return () => {
        if (created) el.remove();
        else if (prevContent !== null) el.setAttribute("content", prevContent);
      };
    };
    const restoreDesc = setMeta("description", "Start with one team for free. Upgrade to Run of Practice Pro for more teams, unlimited planning tools, complete history, season goals, and practice insights.");
    // Not linked from anywhere yet -- keep it out of search results until the
    // page is public per the brief's own "During internal review, use
    // noindex" instruction.
    const restoreRobots = FEATURE_FLAGS.PRICING_PAGE_PUBLIC ? () => {} : setMeta("robots", "noindex");
    return () => { document.title = prevTitle; restoreDesc(); restoreRobots(); };
  }, []);
}

// Checkbox-in-circle language reused verbatim from the app's own existing
// attendance/checklist marks (App.jsx's role picker, CommandScreen's
// attendance circles) -- same green-fill-plus-white-check convention,
// not a new shape invented for this page.
function Cell({ row, plan, featured }) {
  const cls = featured ? "pp-featured-col" : undefined;
  if (row.type === "check") {
    const on = row[plan];
    return (<td className={cls}><span className={"pp-cb" + (on ? " on" : "")} aria-label={on ? "Included" : "Not included"}>{on && <Ic.Check />}</span></td>);
  }
  const val = row[plan];
  return (<td className={cls}><span className={"pp-value" + (val === "—" ? " pp-dash" : "")}>{val}</span></td>);
}

function FaqItem({ q, a, open, onToggle }) {
  return (<div className="pp-faq-item">
    <button onClick={onToggle} aria-expanded={open}>
      <span>{q}</span>
      <span className="pp-faq-mark" aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open && <div className="pp-faq-a">{a}</div>}
  </div>);
}

export default function PricingPage() {
  useSeo();
  const [billing, setBilling] = useState("monthly");
  const [openFaq, setOpenFaq] = useState(0);
  const annual = billing === "annual";

  return (<div className="pp">
    <style>{PP_CSS}</style>
    <div className="pp-header">
      <a href="/" className="pp-brand"><img src="/apple-touch-icon.png" alt="" /><span>Run of Practice</span></a>
      <div className="pp-nav">
        <a className="pp-navlink hideonsm" href="/">Home</a>
        <a className="pp-navlink hideonsm" href="/faq">FAQ</a>
        <a href="/" className="pp-signin">Sign In</a>
        <a href="/" className="pp-btn primary sm">{FEATURE_FLAGS.EARLY_ACCESS_ACTIVE ? "Start Coaching Free" : "Try It Free"}</a>
      </div>
    </div>

    <div className="pp-hero">
      <div className="pp-eyebrow">Pricing</div>
      <div className="pp-h1">Plans that grow with the way you coach</div>
      <div className="pp-sub">Run one team for free. Upgrade when you need more teams, unlimited planning tools, and deeper insight into how your practice time is being used.</div>
    </div>

    {FEATURE_FLAGS.EARLY_ACCESS_ACTIVE && (<div className="pp-early">
      <div className="pp-early-h">Run of Practice is free during early access</div>
      <div className="pp-early-body">Every coach can use all currently available features while we test the product and prepare paid plans. Early-access coaches will receive at least 30 days' notice before pricing begins and may be eligible for a first-year Pro offer.</div>
      <div className="pp-early-ctas">
        <a href="/" className="pp-btn primary">Start coaching free</a>
        <a href="#pricing-plans" className="pp-btn outline">See planned pricing</a>
      </div>
    </div>)}

    <div className="pp-toggle-wrap" id="pricing-plans">
      <div className="pp-toggle" role="group" aria-label="Pro billing period">
        <button type="button" aria-pressed={annual} onClick={() => setBilling("annual")}>Annual</button>
        <button type="button" aria-pressed={!annual} onClick={() => setBilling("monthly")}>Monthly</button>
      </div>
      <div className="pp-toggle-help">Save $45/year on Pro or $56/year on Pro+ with annual billing</div>
    </div>

    <div className="pp-grid">
      <div className="pp-card">
        <div className="pp-tier-row"><div className="pp-tier">Free</div></div>
        <div className="pp-pitch">For a coach running one team.</div>
        <div className="pp-price">$0</div>
        <div className="pp-price-sub">Free forever</div>
        <div className="pp-cta"><a href="/" className="pp-btn outline" style={{ width: "100%" }}>{FEATURE_FLAGS.EARLY_ACCESS_ACTIVE ? "Start coaching free" : "Start free"}</a></div>
        <div className="pp-note" style={{ marginTop: -10, marginBottom: 16 }}>No credit card required</div>
        <ul className="pp-feat">
          {FREE_FEATURES.map((f, i) => (<li key={i}><span className="mk">&#10003;</span><span>{f}</span></li>))}
        </ul>
      </div>

      <div className="pp-card featured">
        <div className="pp-tier-row"><div className="pp-tier">Pro</div><span className="pp-most-popular">Most Popular</span></div>
        <div className="pp-pitch">For a committed coach managing multiple teams and player development across a season.</div>
        <div className="pp-price">{annual ? "$99/year" : "$12/month"}</div>
        <div className="pp-price-sub">{annual ? "Equivalent to $8.25/month" : "Cancel anytime"}</div>
        <div className="pp-cta">
          {FEATURE_FLAGS.BILLING_ENABLED
            ? <a href="/" className="pp-btn primary" style={{ width: "100%" }}>Start your Pro preview</a>
            : <a href="/" className="pp-btn primary" style={{ width: "100%" }}>Included during early access</a>}
        </div>
        {FEATURE_FLAGS.PRO_PREVIEW_ENABLED && <div className="pp-note" style={{ marginTop: -10, marginBottom: 16 }}>14-day preview. No credit card required.</div>}
        <ul className="pp-feat">
          {PRO_FEATURES.map((f, i) => (<li key={i}><span className="mk">&#10003;</span><span>{f}</span></li>))}
        </ul>
      </div>

      <div className="pp-card">
        <div className="pp-tier-row"><div className="pp-tier">Pro+</div></div>
        <div className="pp-pitch">For a coaching staff that plans together: delegate practice building to an assistant and run two practices at once.</div>
        <div className="pp-price">{annual ? "$124/year" : "$15/month"}</div>
        <div className="pp-price-sub">{annual ? "Equivalent to $10.33/month" : "Cancel anytime"}</div>
        <div className="pp-cta">
          {FEATURE_FLAGS.BILLING_ENABLED
            ? <a href="/" className="pp-btn primary" style={{ width: "100%" }}>Start your Pro preview</a>
            : <a href="/" className="pp-btn primary" style={{ width: "100%" }}>Included during early access</a>}
        </div>
        <ul className="pp-feat">
          {PROPLUS_FEATURES.map((f, i) => (<li key={i}><span className="mk">&#10003;</span><span>{f}</span></li>))}
        </ul>
      </div>
    </div>

    <div className="pp-org">
      <div className="pp-org-inner">
        <div>
          <div className="pp-org-eyebrow">For clubs, leagues, schools, and programs</div>
          <div className="pp-org-h">Run a consistent program across every team</div>
          <div className="pp-org-sub">Give directors centralized control while coaches plan and run practices in the same familiar experience.</div>
          <div className="pp-org-price">Custom pricing</div>
          <div className="pp-org-price-help">Pricing is based on active organization teams, with lower per-team pricing as your organization grows.</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href={"mailto:" + CONTACT_EMAIL} className="pp-btn primary">Talk with us</a>
          </div>
        </div>
        <ul className="pp-org-feat">
          {ORG_FEATURES.map((f, i) => (<li key={i}><span className="mk">&#10003;</span><span>{f}</span></li>))}
        </ul>
      </div>
    </div>

    <div className="pp-table-wrap">
      <div className="pp-table-title">Where the room to grow comes in</div>
      <div className="pp-table-sub">Every plan starts with the same foundation: practice building, live practice mode with timers and rotations, personal equipment and locations, player focus areas, and unlimited parent-helper links. From here, here's what each plan adds.</div>
      <div className="pp-scroll">
        <table className="pp-cmp">
          <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>Feature comparison across Free, Pro, Pro+, and Organizations plans</caption>
          <colgroup>
            <col className="pp-feat-col" />
            <col className="pp-plan-col" />
            <col className="pp-plan-col" />
            <col className="pp-plan-col" />
            <col className="pp-plan-col" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col"><span className="pp-plan-pill free">Free</span></th>
              <th scope="col" className="pp-featured-col"><span className="pp-plan-pill pro">Pro</span></th>
              <th scope="col"><span className="pp-plan-pill proplus">Pro+</span></th>
              <th scope="col"><span className="pp-plan-pill org">Org</span></th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_GROUPS.map((g) => (<React.Fragment key={g.title}>
              <tr className="pp-group-row"><th scope="colgroup">{g.title}</th><td colSpan={4} aria-hidden="true"></td></tr>
              {g.rows.map((r, i) => (<tr key={i} className={i % 2 === 1 ? "pp-row-alt" : undefined}>
                <th scope="row">{r.feature}</th>
                <Cell row={r} plan="free" />
                <Cell row={r} plan="pro" featured />
                <Cell row={r} plan="proplus" />
                <Cell row={r} plan="org" />
              </tr>))}
            </React.Fragment>))}
          </tbody>
        </table>
      </div>
    </div>

    <div className="pp-faq">
      <div className="pp-faq-title">Pricing FAQ</div>
      <div>
        {FAQ_ITEMS.map((it, i) => (<FaqItem key={i} q={it.q} a={it.a} open={openFaq === i} onToggle={() => setOpenFaq(openFaq === i ? -1 : i)} />))}
      </div>
    </div>

    <div className="pp-final">
      <div className="pp-final-h">Start with your next practice</div>
      <div className="pp-final-sub">Build one team for free and see how Run of Practice keeps the plan, the coaches, and the live practice connected.</div>
      <div className="pp-final-ctas">
        <a href="/" className="pp-btn primary">Start free</a>
        <a href={"mailto:" + CONTACT_EMAIL} className="pp-btn outline">Talk with us about Organizations</a>
      </div>
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
