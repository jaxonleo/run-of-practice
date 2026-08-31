// SMTP transport for transactional email, via the Google Workspace SMTP
// relay (stability-and-environments pass, §5) instead of Resend's API.
// Supabase Edge Functions support npm specifiers, so nodemailer runs
// directly in Deno here -- no separate build step. Kept in its own file
// rather than folded into emailTemplate.ts (which only renders HTML and
// has no other logic in it): that file is template rendering, this one is
// transport, and the three functions that used to each duplicate their own
// Resend fetch() call now share this one instead.
//
// Port 587 with STARTTLS (secure:false, upgraded via STARTTLS), matching
// J4's relay setup. All four SMTP_* values plus SMTP_FROM come from
// function secrets (supabase secrets set), never committed.
import nodemailer from 'npm:nodemailer'

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: Deno.env.get('SMTP_HOST')!,
      port: Number(Deno.env.get('SMTP_PORT') || '587'),
      secure: false,
      auth: {
        user: Deno.env.get('SMTP_USER')!,
        pass: Deno.env.get('SMTP_PASS')!,
      },
    })
  }
  return transporter
}

export async function sendEmail({ to, subject, html, replyTo }: {
  to: string
  subject: string
  html: string
  replyTo?: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await getTransporter().sendMail({
      from: `"Run of Practice" <${Deno.env.get('SMTP_FROM')}>`,
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
