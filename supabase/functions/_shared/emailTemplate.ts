// Shared HTML shell for transactional emails (notify-team-staff-added,
// notify-org-invite). A table-based outer wrapper for reliable centering
// across email clients; everything inline since most clients strip <style>
// blocks. Colors/type match the app's own CSS vars (App.jsx's --green/
// --black/--td) -- no web-font loading (unreliable in email), just a
// system-font stack that reads close enough to the in-app look.
// "Prettier, in the free version" (Jax's ask) -- this is hand-written
// HTML/CSS, which Resend's free tier already sends as-is; no paid
// template-builder product involved. Header icon is the real PWA icon
// (public/icon-512.png), already public via the Vercel deploy at
// runofpractice.com -- a plain <img src> pointed at it costs nothing.

export function renderEmailHtml({ headline, bodyHtml, ctaLabel, signInEmail }: {
  headline: string
  bodyHtml: string
  ctaLabel: string
  signInEmail: string
}): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f2f5f3;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f3;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dde5e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="background:#111714;padding:18px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:10px;"><img src="https://www.runofpractice.com/icon-512.png" width="28" height="28" alt="" style="display:block;border-radius:7px;"></td>
            <td style="font-size:19px;font-weight:800;color:#ffffff;letter-spacing:.01em;vertical-align:middle;">Run of Practice</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px 28px 8px;">
          <h1 style="margin:0 0 14px;font-size:21px;font-weight:800;color:#111714;line-height:1.35;">${headline}</h1>
          <div style="font-size:15px;line-height:1.65;color:#2c3830;">${bodyHtml}</div>
        </td></tr>
        <tr><td style="padding:12px 28px 32px;">
          <a href="https://www.runofpractice.com" style="display:inline-block;background:#2d6a4f;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.02em;padding:13px 26px;border-radius:9px;">${ctaLabel}</a>
          <p style="margin:18px 0 0;font-size:13px;color:#6b7a72;line-height:1.5;">Sign in with <strong>${signInEmail}</strong> — we'll send a one-time code, no password needed.</p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#f7f9f8;border-top:1px solid #eef2f0;">
          <p style="margin:0;font-size:12px;color:#8a9a91;">Practice planning and live execution — <a href="https://www.runofpractice.com" style="color:#8a9a91;">runofpractice.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
