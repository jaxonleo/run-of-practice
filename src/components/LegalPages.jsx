import React from "react";

const LAST_UPDATED = "July 10, 2026";
const CONTACT_EMAIL = "contact@runofpractice.com";

function LegalLayout({ title, children }) {
  return (<div style={{ minHeight: "100dvh", background: "var(--bg)" }}>
    <div style={{ background: "var(--black)", padding: "20px 20px 24px", display: "flex", alignItems: "center", gap: 12 }}>
      <a href="/" style={{ color: "#fff", textDecoration: "none", background: "rgba(255,255,255,.08)", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>&#8249;</a>
      <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 22, fontWeight: 900, color: "#fff" }}>{title}</div>
    </div>
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px 60px" }}>
      <div style={{ fontSize: 13, color: "var(--td)", marginBottom: 20 }}>Last updated: {LAST_UPDATED}</div>
      <div style={{ fontSize: 14.5, lineHeight: 1.7, color: "var(--black2)" }}>
        {children}
      </div>
    </div>
  </div>);
}

function S({ n, title, children }) {
  return (<div style={{ marginBottom: 22 }}>
    <div style={{ fontFamily: "Barlow Condensed,sans-serif", fontSize: 17, fontWeight: 900, marginBottom: 6, color: "var(--black)" }}>{n ? n + ". " : ""}{title}</div>
    <div>{children}</div>
  </div>);
}

export function TermsPage() {
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

export function PrivacyPage() {
  return (<LegalLayout title="Privacy Policy">
    <S title="What we collect">
      <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <li><strong>Account information:</strong> your email address, and a display name you provide.</li>
        <li><strong>Team and roster information you enter:</strong> team names, player first/last names, jersey numbers, positions, coaching staff, and similar — entered by coaches to plan and run practices.</li>
        <li><strong>Practice content:</strong> drills, plans, schedules, attendance records, and notes you create.</li>
        <li><strong>Usage information:</strong> basic activity events (e.g. that a practice was created or a session was run) used to understand how the app is used, and any feedback you submit to us.</li>
      </ul>
    </S>
    <S title="About players' information">
      Player information (name, jersey number, position, focus areas) is entered by coaches, not collected directly from players. Where teams include minors, we deliberately minimize what's shared with anonymous helpers — helper links show first name, last initial, and jersey number only; full names and other details are visible only to signed-in coaching staff on the team.
      <div style={{ marginTop: 8 }}>If you are a parent or guardian with questions about your child's information in the app, contact the coach who manages your child's team directly, or reach us at {CONTACT_EMAIL}.</div>
    </S>
    <S title="How we use information">
      To provide the app's core features: practice planning, live session execution, roster and attendance tracking, and sharing limited practice details with helpers via the links coaches generate. We also use aggregate usage information to understand and improve the product. We do not sell your information or use it for advertising.
    </S>
    <S title="Who we share it with">
      We use third-party services to run the app:
      <ul style={{ paddingLeft: 20, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 4 }}>
        <li><strong>Supabase</strong> (database, authentication, hosting infrastructure)</li>
        <li><strong>Resend</strong> (sending sign-in and notification emails)</li>
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
