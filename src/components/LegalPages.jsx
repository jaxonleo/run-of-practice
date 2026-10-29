import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { submitFeedback, submitPublicFeedback } from "../supabase.js";
import { FEATURE_FLAGS, launchLegalVisible } from "../entitlements.js";

const LAST_UPDATED = "July 10, 2026";
// Launch versions of Terms and Privacy (paid plans, Stripe, partner
// program), drafted 2026-10-29 for Jax and a lawyer to review. They go live
// when EARLY_ACCESS_ACTIVE turns off at launch; until then they show only
// on staging/local, under a draft banner (see launchLegalVisible). Set
// LAUNCH_LEGAL_DATE to the launch date when they take effect.
const LAUNCH_LEGAL_DATE = "Draft, October 29, 2026";
const CONTACT_EMAIL = "contact@runofpractice.com";

// ── ConsultationRequestForm ───────────────────────────────────────────────────
// Shared between the FAQ answer below and Settings > Account > Membership
// (SettingsScreen.jsx imports this). Replaces a bare mailto link with real
// fields, since a mailto gave Jax nothing to prep for the actual sales call
// with -- no phone number, no sense of how big the club even is. Reuses the
// existing `feedback` table/submitFeedback+submitPublicFeedback RPCs rather
// than a new table: same actor-identity pattern, same triage-by-Jax-directly
// workflow, and per this file's own history the anonymous RPC path was built
// and deliberately left in place for exactly this kind of future contact
// form. coachId present -> authenticated path (attaches user_id); absent ->
// the anonymous RPC (used from FAQ, which is reachable signed out).
function ConsultationRequestForm({coachId, coachEmail, pageContext, onClose}){
  const [name,setName]=useState("");
  const [email,setEmail]=useState(coachEmail||"");
  const [phone,setPhone]=useState("");
  const [numTeams,setNumTeams]=useState("");
  const [details,setDetails]=useState("");
  const [sending,setSending]=useState(false);
  const [done,setDone]=useState(false);
  const [sendError,setSendError]=useState("");
  const canSend=name.trim()&&(email.trim()||phone.trim())&&numTeams;
  const send=async()=>{
    if(!canSend||sending)return;
    setSending(true);
    setSendError("");
    const message="Organization consultation request\n\n"
      +"Name: "+name.trim()+"\n"
      +"Email: "+(email.trim()||"(not provided)")+"\n"
      +"Phone: "+(phone.trim()||"(not provided)")+"\n"
      +"Number of teams: "+numTeams+"\n\n"
      +(details.trim()?details.trim():"No additional details provided.");
    // Real gap found live: both submit* helpers can fail (network, a
    // server-side validation error inside the RPC's own JSON return) --
    // this is a sales-lead form, so silently claiming success on a failed
    // submit would be actively harmful, not just a minor bug.
    const result=coachId
      ?await submitFeedback(coachId,{contactEmail:email.trim(),message,pageContext:pageContext||"Organization consultation"})
      :await submitPublicFeedback({email:email.trim(),message,pageContext:pageContext||"Organization consultation"});
    setSending(false);
    if(result&&result.error){setSendError("Something went wrong sending this. Please try again, or email us directly at contact@runofpractice.com.");return;}
    setDone(true);
  };
  return(<div className="movly" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal">
      <div className="mhandle"/>
      {done?(<div>
        <div className="mtitle">Thanks, that's in.</div>
        <div style={{fontSize:14,color:"var(--ink-soft)",marginBottom:16,lineHeight:1.5}}>We'll follow up to set up your consultation.</div>
        <button className="btn primary bmd bfull" onClick={onClose}>Close</button>
      </div>):(<div>
        <div className="mtitle">Request a Consultation</div>
        <div style={{fontSize:13,color:"var(--text-dim)",marginBottom:16,lineHeight:1.5}}>Tell us a bit about your organization and we'll reach out to get things set up.</div>
        <div className="fld mb10"><label className="lbl">Name</label><input className="inp" autoFocus value={name} onChange={e=>setName(e.target.value)}/></div>
        <div className="fld mb10"><label className="lbl">Email <span style={{color:"var(--text-dim)",fontWeight:400}}>(email or phone required)</span></label><input className="inp" type="email" value={email} onChange={e=>setEmail(e.target.value)}/></div>
        <div className="fld mb10"><label className="lbl">Phone <span style={{color:"var(--text-dim)",fontWeight:400}}>(email or phone required)</span></label><input className="inp" type="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></div>
        <div className="fld mb10"><label className="lbl">Number of Teams</label><input className="inp" type="number" min="1" value={numTeams} onChange={e=>{const v=e.target.value;setNumTeams(v===""?"":+v);}}/></div>
        <div className="fld mb10">
          <label className="lbl">Anything else that would help? <span style={{color:"var(--text-dim)",fontWeight:400}}>(optional)</span></label>
          <textarea className="ta" rows={3} placeholder="Sport, location, timeline, anything that'll help us prep for the call." value={details} onChange={e=>setDetails(e.target.value)}/>
        </div>
        {sendError&&<div style={{fontSize:13,color:"var(--danger)",marginBottom:10}}>{sendError}</div>}
        <div className="brow"><button className="btn ghost bsm" onClick={onClose}>Cancel</button><button className="btn primary bsm" style={{flex:1}} onClick={send} disabled={!canSend||sending}>{sending?"Sending...":"Send Request"}</button></div>
      </div>)}
    </div>
  </div>);
}
export { ConsultationRequestForm };

// Back used to hard-navigate to "/" regardless of where you came from --
// most noticeably wrong from Settings > Account, which landed you back on
// Home instead. navigate(-1) is the generically correct fix (works for the
// landing page and auth-screen entry points too, since it's just browser
// history), but Settings > Account isn't its own URL (SettingsScreen keeps
// which section is open in local component state, reset on remount), so a
// plain history pop there would land on Settings' top-level list, not back
// inside Account specifically. location.state.openSection carries that
// intent across the navigation for the one caller that needs it.
function LegalLayout({ title, children, updated = LAST_UPDATED, draft = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = () => {
    if (location.state && location.state.openSection) navigate("/settings", { state: { openSection: location.state.openSection } });
    else navigate(-1);
  };
  return (<div style={{ minHeight: "100dvh", background: "var(--canvas)" }}>
    <div style={{ background: "var(--ink)", padding: "20px 20px 24px", display: "flex", alignItems: "center", gap: 12 }}>
      <button onClick={goBack} style={{ color: "#fff", background: "rgba(255,255,255,.08)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, cursor: "pointer" }}>&#8249;</button>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 22, fontWeight: 900, color: "#fff" }}>{title}</div>
    </div>
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px 60px" }}>
      {draft && <div style={{ fontSize: 13, background: "var(--caution-tint)", border: "1px solid var(--caution-tint-border)", color: "var(--caution)", borderRadius: 8, padding: "10px 12px", marginBottom: 14, lineHeight: 1.5 }}>Draft for review. This version takes effect when paid plans launch; the current version still applies until then.</div>}
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20 }}>Last updated: {updated}</div>
      <div style={{ fontSize: 14.5, lineHeight: 1.7, color: "var(--ink-soft)" }}>
        {children}
      </div>
    </div>
  </div>);
}

function S({ n, title, children }) {
  return (<div style={{ marginBottom: 22 }}>
    <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 17, fontWeight: 900, marginBottom: 6, color: "var(--ink)" }}>{n ? n + ". " : ""}{title}</div>
    <div>{children}</div>
  </div>);
}

// ── FAQPage ────────────────────────────────────────────────────────────────────
// Reached from Home's "?" menu (signed-in only), but not gated behind auth
// as a route -- same top-level-sibling treatment as Terms/Privacy, since
// there's nothing sensitive here and it means a link to it works whether
// or not the recipient happens to be signed in yet.
function FAQItem({ q, children, open, onToggle }) {
  return (<div style={{ borderBottom: "1px solid var(--border)" }}>
    <button onClick={onToggle} style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "16px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, cursor: "pointer", font: "inherit" }}>
      <span style={{ fontWeight: 700, color: "var(--ink)" }}>{q}</span>
      <span style={{ color: "var(--text-dim)", fontSize: 20, flexShrink: 0 }}>{open ? "−" : "+"}</span>
    </button>
    {open && <div style={{ paddingBottom: 16 }}>{children}</div>}
  </div>);
}

export function FAQPage() {
  const [open, setOpen] = useState(-1);
  const [showConsult, setShowConsult] = useState(false);
  const toggle = i => setOpen(open === i ? -1 : i);
  const items = [
    {
      q: "Can I delete my account?",
      a: (<>
        <p style={{ margin: "0 0 10px" }}>You can deactivate your account any time from Settings &gt; Account. Deactivating signs you out and hides you from your teammates' rosters, but nothing is thrown away: all your teams, practices, and data stay exactly as they are. Sign in again whenever you're ready and everything picks up right where you left off, no re-setup needed.</p>
        <p style={{ margin: 0 }}>If you really do want your account and data permanently deleted instead, we don't yet have a self-serve way to do that. Email us at {CONTACT_EMAIL} and we'll take care of it manually.</p>
      </>),
    },
    {
      // Reworded: the old copy ("we set these up with you rather than
      // offering instant self-service") read as a limitation to a
      // prospective club sizing up the product. Same underlying process,
      // framed as white-glove onboarding instead of a missing feature.
      q: "How do I set up an organization with multiple teams?",
      a: (<>
        <p style={{ margin: "0 0 10px" }}>Organizations are for clubs running more than one team, with a director who can see across all of them and coaches managing their own team day to day. Our team personally sets up every organization, so sports, teams, and coaches all start out configured correctly.</p>
        <p style={{ margin: 0 }}>Tell us a bit about your club and we'll be in touch: <button type="button" onClick={() => setShowConsult(true)} style={{ background: "none", border: "none", padding: 0, color: "var(--field)", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>request a consultation</button>.</p>
      </>),
    },
    { q: "Is Run of Practice free?", a: FEATURE_FLAGS.EARLY_ACCESS_ACTIVE
      ? "Yes, Run of Practice is free during early access while we're still testing and improving it."
      : "Yes, to start. The Free plan covers one team, with unlimited live practices and parent-helper links. Pro adds more teams, your whole staff, unlimited drills and templates, and every Goals & Insights tool for $12 a month or $99 a year. Coaches who give us regular feedback can apply to the partner program for free Pro." },
    { q: "Who is it for?", a: "Head coaches, assistant coaches, and anyone helping run an organized practice, from a single team to a whole club." },
    { q: "Does every helper need an account?", a: "No. Assistant coaches get ongoing access through their own account, while a parent or ad hoc helper can just use a shared link with the information they need for that practice, no account or download required." },
    { q: "Can I use it for different sports?", a: "Yes. Run of Practice is built around things every sport's practices share, like drills, groups, stations, locations, timing, and equipment. The setup adjusts to whatever sport and level you coach." },
    { q: "What do I do if my sport isn't listed?", a: <>If you're creating a team for a sport that isn't listed, reach out to us at {CONTACT_EMAIL} and we'll add it.</> },
    { q: "What happens if attendance changes?", a: "Update who's present and your groupings adjust with them. You can shuffle players randomly or make changes yourself, whichever fits the moment." },
    { q: "Can I adjust the schedule while practice is happening?", a: "Yes. You can add or reduce time, end an activity early, or skip one entirely, and everyone connected sees the change reflected in real time." },
    { q: "Will I hear the timer if my phone is in my pocket?", a: "Turn on audio in a live practice and Run of Practice will call out the two-minute warning and play a sound when time's up, so you don't need to keep the screen in front of you." },
  ];
  return (<LegalLayout title="FAQs">
    <div>
      {items.map((it, i) => (<FAQItem key={i} q={it.q} open={open === i} onToggle={() => toggle(i)}>
        {typeof it.a === "string" ? <p style={{ margin: 0 }}>{it.a}</p> : it.a}
      </FAQItem>))}
    </div>
    <div style={{ marginTop: 20, fontSize: 13, color: "var(--text-dim)" }}>Still stuck on something? Reach us at {CONTACT_EMAIL}.</div>
    {showConsult && <ConsultationRequestForm pageContext="FAQ" onClose={() => setShowConsult(false)} />}
  </LegalLayout>);
}


// Launch version (see LAUNCH_LEGAL_DATE above). Plain-language, not legal
// advice: to be reviewed before it takes effect.
function LaunchTermsPage() {
  const ul = { paddingLeft: 20, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 6 };
  return (<LegalLayout title="Terms of Use" updated={LAUNCH_LEGAL_DATE} draft={FEATURE_FLAGS.EARLY_ACCESS_ACTIVE}>
    <S n={1} title="Acceptance">
      Run of Practice is operated by Run of Practice LLC ("Run of Practice," "we," "us"). By creating an account or using Run of Practice, you agree to these terms. If you don't agree, don't use the app.
    </S>
    <S n={2} title="What this is">
      Run of Practice is a tool for sports coaches to plan and run practices, and to share limited practice information with assistant coaches and helpers. We keep improving it, so features and behavior may change over time.
    </S>
    <S n={3} title="Accounts">
      You must provide an accurate email address to create an account, and you must be at least 18 (or the age of majority where you live) to buy a paid plan. You're responsible for activity that happens under your account. Coaches are responsible for the accuracy of information they enter about their teams, including player and staff information.
    </S>
    <S n={4} title="Plans">
      <ul style={ul}>
        <li><strong>Free</strong> is free and has limits, shown on the pricing page and in the app (for example, one active team, you plus up to two assistant coaches, 20 saved drills, two templates, and your 10 most recent practices). Live practices are unlimited on every plan.</li>
        <li><strong>Pro</strong> costs $12 per month or $99 per year in US dollars, and lifts those limits as described on the pricing page.</li>
        <li><strong>Founding Coaches</strong>, the coaches who joined during early access, have Pro features at no charge.</li>
        <li><strong>Organization</strong> plans are arranged directly with us and may have their own written agreement, which governs where it differs from these terms.</li>
      </ul>
      <div style={{ marginTop: 8 }}>We may change what each plan includes. If a change takes away something a paid plan includes, we'll tell you in advance, and you can cancel before it applies to you.</div>
    </S>
    <S n={5} title="Billing and renewal">
      Payments are processed by Stripe. When you subscribe to Pro, you authorize us (through Stripe) to charge your payment method at the start of each billing period. <strong>Pro renews automatically</strong>, monthly or yearly depending on your choice, until you cancel. Prices don't include taxes unless stated, and you're responsible for any taxes that apply.
      <div style={{ marginTop: 8 }}>If we change the price of Pro, we'll email you at least 30 days before it applies to your next renewal, and you can cancel before then.</div>
      <div style={{ marginTop: 8 }}>If you switch between monthly and yearly billing, the change takes effect right away: you're charged the difference for the new plan, with credit for the unused part of your current period.</div>
      <div style={{ marginTop: 8 }}>If a payment fails, we'll try again and let you know. If it still can't be collected, your account moves to Free.</div>
    </S>
    <S n={6} title="Cancelling">
      You can cancel any time in Settings, then Plan &amp; billing, then Manage subscription. Pro stays on until the end of the period you've already paid for, then your account moves to Free. Cancelling or moving to Free never deletes your information: teams, practices, drills, templates, and history stay saved. Free's limits decide what is active and visible (for example, extra teams are paused and older practices are hidden until you upgrade again).
    </S>
    <S n={7} title="Refunds, credits, and free time">
      Payments aren't refunded for the unused part of a billing period, except where the law requires it. When something on our side gets in the way of your use of the app, we may make it right with a refund, account credit, or free Pro time, at our discretion. Account credit is applied to future Pro charges automatically. Credit and free Pro time have no cash value and can't be transferred.
      <div style={{ marginTop: 8 }}>If you think you were charged in error, email {CONTACT_EMAIL} before disputing the charge with your bank, and we'll work it out with you.</div>
    </S>
    <S n={8} title="Partner program">
      Coaches can apply to be Run of Practice partners. If we accept you, you get Pro free for one quarter (three months) at a time. Each further quarter is our decision, based on whether you've kept sharing useful feedback. Either of us can end the partnership at any time; your current free quarter still runs out. Partner Pro has no cash value, and partners don't need a payment method. Feedback you send us, as a partner or otherwise, may be used to improve Run of Practice without any obligation to you.
    </S>
    <S n={9} title="Acceptable use">
      Use the app only for its intended purpose: planning and running sports practices. Don't use it to store or share information you don't have the right to share, don't attempt to access other coaches' or teams' data, and don't use the anonymous helper/preview links for anything other than sharing practice information with people actually helping at that practice.
    </S>
    <S n={10} title="Your content, your data">
      Information you enter (rosters, practice plans, notes, and similar) belongs to you. We store it to provide the service. See the Privacy Policy for what's collected and how it's handled.
    </S>
    <S n={11} title="Disclaimer">
      The app is provided "as is," without warranties of any kind, express or implied, to the extent the law allows. We work to keep it available and accurate, but we don't guarantee it will be uninterrupted, error-free, or suitable for any particular purpose. Don't rely on it as your only record of critical information.
    </S>
    <S n={12} title="Limitation of liability">
      To the maximum extent permitted by law, Run of Practice and its owners are not liable for any indirect, incidental, special, or consequential damages arising from use of the app. Our total liability for any claim is limited to the amount you paid us in the 12 months before the claim arose.
    </S>
    <S n={13} title="Ending your use">
      You may stop using the app and deactivate your account at any time through account settings; cancel any Pro subscription first so it doesn't renew. We may suspend or end access for violation of these terms. If we end your access without a violation on your part, we'll refund the unused part of any prepaid Pro period.
    </S>
    <S n={14} title="Governing law">
      These terms are governed by the laws of the State of Arizona, without regard to its conflict-of-law rules.
    </S>
    <S n={15} title="Changes">
      We may update these terms as the product evolves. Material changes will be posted here with an updated date, and changes that affect paid plans will also be emailed to subscribers before they take effect. Continuing to use the app after a change means you accept the updated terms.
    </S>
    <S n={16} title="Contact">
      Questions about these terms or your billing: {CONTACT_EMAIL}.
    </S>
  </LegalLayout>);
}

export function TermsPage() {
  if (launchLegalVisible()) return <LaunchTermsPage />;
  return (<LegalLayout title="Terms of Use">
    <S n={1} title="Acceptance">
      By creating an account or using Run of Practice ("the app," "we," "us"), you agree to these terms. If you don't agree, don't use the app.
    </S>
    <S n={2} title="What this is">
      Run of Practice is a tool for sports coaches to plan and run practices, and to share limited practice information with assistant coaches and helpers. It is currently an early-access product under active development. Features, behavior, and availability may change, including without advance notice.
    </S>
    <S n={3} title="Accounts">
      You must provide an accurate email address to create an account. You're responsible for activity that happens under your account. Coaches are responsible for the accuracy of information they enter about their teams, including player and staff information.
    </S>
    <S n={4} title="Acceptable use">
      Use the app only for its intended purpose: planning and running sports practices. Don't use it to store or share information you don't have the right to share, don't attempt to access other coaches' or teams' data, and don't use the anonymous helper/preview links for anything other than sharing practice information with people actually helping at that practice.
    </S>
    <S n={5} title="Your content, your data">
      Information you enter (rosters, practice plans, notes, and similar) belongs to you. We store it to provide the service. See the Privacy Policy for what's collected and how it's handled, including current limitations around deletion.
    </S>
    <S n={6} title="Early-access disclaimer">
      This app is provided "as is," in active development, without warranties of any kind, express or implied. We do not guarantee it will be available, error-free, or suitable for any particular purpose. Do not rely on it as your sole record of critical information.
    </S>
    <S n={7} title="Limitation of liability">
      To the maximum extent permitted by law, Run of Practice and its creator are not liable for any indirect, incidental, or consequential damages arising from use of the app. Our total liability for any claim is limited to the amount you've paid us in the preceding 12 months (currently $0, as the app has no paid tiers).
    </S>
    <S n={8} title="Termination">
      You may stop using the app and deactivate your account at any time through account settings. We may suspend or terminate access for violation of these terms.
    </S>
    <S n={9} title="Changes">
      We may update these terms as the product evolves. Material changes will be reflected here with an updated date. Continued use after a change means you accept the updated terms.
    </S>
    <S n={10} title="Contact">
      Questions about these terms: {CONTACT_EMAIL}.
    </S>
  </LegalLayout>);
}


function LaunchPrivacyPage() {
  const ul = { paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 6 };
  return (<LegalLayout title="Privacy Policy" updated={LAUNCH_LEGAL_DATE} draft={FEATURE_FLAGS.EARLY_ACCESS_ACTIVE}>
    <S title="Who we are">
      Run of Practice is operated by Run of Practice LLC. This policy explains what we collect, why, and who we share it with.
    </S>
    <S title="What we collect">
      <ul style={ul}>
        <li><strong>Account information:</strong> your email address, and a display name you provide.</li>
        <li><strong>Team and roster information you enter:</strong> team names, player first/last names, jersey numbers, positions, coaching staff, and similar, entered by coaches to plan and run practices.</li>
        <li><strong>Practice content:</strong> drills, plans, schedules, attendance records, and notes you create.</li>
        <li><strong>Billing information:</strong> if you subscribe to Pro, your payment details go directly to Stripe, our payment processor. We never see or store your full card number. We keep your plan, subscription status, renewal date, the Stripe IDs that link your account to your subscription, and records of any refunds or credits we issue.</li>
        <li><strong>Partner program applications:</strong> the name, email, sport, team level, and message you send when you apply.</li>
        <li><strong>Usage information:</strong> basic activity events (e.g. that a practice was created or a session was run, or that you viewed an upgrade prompt) used to understand how the app is used, and any feedback you submit to us.</li>
        <li><strong>Error reports:</strong> when something breaks, technical details about the error (such as the page and browser) so we can fix it.</li>
      </ul>
    </S>
    <S title="About players' information">
      Player information (name, jersey number, position, focus areas) is entered by coaches, not collected directly from players. Where teams include minors, we deliberately minimize what's shared with anonymous helpers. Helper links show first name, last initial, and jersey number only; full names and other details are visible only to signed-in coaching staff on the team.
      <div style={{ marginTop: 8 }}>If you are a parent or guardian with questions about your child's information in the app, contact the coach who manages your child's team directly, or reach us at {CONTACT_EMAIL}.</div>
    </S>
    <S title="How we use information">
      To provide the app's features: practice planning, live session execution, roster and attendance tracking, and sharing limited practice details with helpers via the links coaches generate. To bill Pro subscriptions, send receipts and billing notices, and handle refunds and credits. To review partner applications. We also use aggregate usage information to understand and improve the product. We do not sell your information or use it for advertising.
    </S>
    <S title="Who we share it with">
      We use third-party services to run the app:
      <ul style={{ paddingLeft: 20, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 4 }}>
        <li><strong>Supabase</strong> (database, authentication, hosting infrastructure)</li>
        <li><strong>Stripe</strong> (payment processing for Pro subscriptions; Stripe also sends receipts)</li>
        <li><strong>Google Workspace</strong> (sending sign-in and notification emails)</li>
        <li><strong>Vercel</strong> (application hosting)</li>
        <li><strong>Sentry</strong> (error monitoring)</li>
      </ul>
      <div style={{ marginTop: 8 }}>These providers process data on our behalf to operate the service. Stripe also handles payment information under its own privacy policy, as payment processors are required to. We do not otherwise sell or share your information, except when the law requires it.</div>
    </S>
    <S title="Data retention and deletion">
      Most information in the app is archived rather than permanently deleted when you remove it (e.g. removing a team or player marks it inactive rather than erasing it immediately), so that accidental removal can be recovered from. Moving from Pro to Free never deletes anything.
      <div style={{ marginTop: 8 }}>Full account and data deletion is not yet self-service. If you want your account and associated data permanently deleted, contact us at {CONTACT_EMAIL} and we will handle it. Billing records (what was charged, refunded, or credited) are kept as long as tax and accounting rules require, even after an account is deleted.</div>
    </S>
    <S title="Cookies and tracking">
      We use only what's necessary to keep you signed in and to run checkout. We do not use advertising trackers or sell data to advertisers. Stripe's checkout and billing pages use their own cookies to process payments and prevent fraud.
    </S>
    <S title="Changes to this policy">
      We may update this policy as the product evolves. Material changes will be reflected here with an updated date.
    </S>
    <S title="Contact">
      Questions about this policy or your data: {CONTACT_EMAIL}.
    </S>
  </LegalLayout>);
}

export function PrivacyPage() {
  if (launchLegalVisible()) return <LaunchPrivacyPage />;
  return (<LegalLayout title="Privacy Policy">
    <S title="What we collect">
      <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <li><strong>Account information:</strong> your email address, and a display name you provide.</li>
        <li><strong>Team and roster information you enter:</strong> team names, player first/last names, jersey numbers, positions, coaching staff, and similar, entered by coaches to plan and run practices.</li>
        <li><strong>Practice content:</strong> drills, plans, schedules, attendance records, and notes you create.</li>
        <li><strong>Usage information:</strong> basic activity events (e.g. that a practice was created or a session was run) used to understand how the app is used, and any feedback you submit to us.</li>
      </ul>
    </S>
    <S title="About players' information">
      Player information (name, jersey number, position, focus areas) is entered by coaches, not collected directly from players. Where teams include minors, we deliberately minimize what's shared with anonymous helpers. Helper links show first name, last initial, and jersey number only; full names and other details are visible only to signed-in coaching staff on the team.
      <div style={{ marginTop: 8 }}>If you are a parent or guardian with questions about your child's information in the app, contact the coach who manages your child's team directly, or reach us at {CONTACT_EMAIL}.</div>
    </S>
    <S title="How we use information">
      To provide the app's core features: practice planning, live session execution, roster and attendance tracking, and sharing limited practice details with helpers via the links coaches generate. We also use aggregate usage information to understand and improve the product. We do not sell your information or use it for advertising.
    </S>
    <S title="Who we share it with">
      We use third-party services to run the app:
      <ul style={{ paddingLeft: 20, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 4 }}>
        <li><strong>Supabase</strong> (database, authentication, hosting infrastructure)</li>
        <li><strong>Google Workspace</strong> (sending sign-in and notification emails)</li>
        <li><strong>Vercel</strong> (application hosting)</li>
      </ul>
      <div style={{ marginTop: 8 }}>These providers process data on our behalf to operate the service; they don't independently use it for their own purposes. We do not otherwise sell or share your information with third parties.</div>
    </S>
    <S title="Data retention and deletion">
      Most information in the app is archived rather than permanently deleted when you remove it (e.g. removing a team or player marks it inactive rather than erasing it immediately), so that accidental removal can be recovered from.
      <div style={{ marginTop: 8 }}>Full account and data deletion is not yet self-service. If you want your account and associated data permanently deleted, contact us at {CONTACT_EMAIL} and we will handle it. We are working on a self-service option.</div>
    </S>
    <S title="Cookies and tracking">
      We use only what's necessary to keep you signed in. We do not use advertising trackers or sell data to advertisers.
    </S>
    <S title="Changes to this policy">
      We may update this policy as the product evolves. Material changes will be reflected here with an updated date.
    </S>
    <S title="Contact">
      Questions about this policy or your data: {CONTACT_EMAIL}.
    </S>
  </LegalLayout>);
}
