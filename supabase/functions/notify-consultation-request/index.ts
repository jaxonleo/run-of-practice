// Real gap found live: a submitted consultation request (Settings > Account
// > Membership, or the FAQ's anonymous path) just landed in the `feedback`
// table with no alert at all -- Jax had no way to know a lead came in
// short of periodically checking the table by hand. Mirrors notify-org-
// invite's exact pg_net-trigger shape, but this one notifies Jax, not the
// submitting coach, so it skips renderEmailHtml's sign-in-CTA template
// (that's built for a coach being invited to *do* something in-app; a lead
// notification just needs the lead's own details, readable at a glance).
//
// Triggered only for rows whose message starts with "Organization
// consultation request" (the literal marker ConsultationRequestForm's own
// message-building always writes) -- feedback also carries plain "Send
// Feedback" submissions from Home, which aren't leads and shouldn't page
// anyone.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/sendEmail.ts'

const NOTIFY_EMAIL = 'jaxon@runofpractice.com'

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('unauthorized', { status: 401 })
  }

  const { feedback_id } = await req.json()

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: row, error } = await supabase
    .from('feedback')
    .select('contact_email, message, page_context, created_at')
    .eq('id', feedback_id)
    .single()

  if (error || !row) {
    console.error('feedback lookup failed', error)
    return new Response('feedback lookup failed', { status: 500 })
  }

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const messageHtml = escapeHtml(row.message).replace(/\n/g, '<br>')
  const contactEmail = row.contact_email || '(not provided)'
  const submittedAt = new Date(row.created_at).toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles',
  })

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f2f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #dde5e0;overflow:hidden;">
<tr><td style="background:#111714;padding:16px 24px;font-size:16px;font-weight:800;color:#ffffff;">New Consultation Request</td></tr>
<tr><td style="padding:24px;">
<p style="margin:0 0 14px;font-size:13px;color:#6b7a72;">${escapeHtml(row.page_context || 'Unknown page')} &middot; ${submittedAt} PT</p>
<p style="margin:0 0 14px;font-size:14px;"><strong>Reply to:</strong> <a href="mailto:${escapeHtml(contactEmail)}" style="color:#2d6a4f;">${escapeHtml(contactEmail)}</a></p>
<div style="font-size:14px;line-height:1.6;color:#111714;white-space:pre-wrap;">${messageHtml}</div>
</td></tr>
</table>
</td></tr></table>
</body></html>`

  const sendResult = await sendEmail({
    to: NOTIFY_EMAIL,
    replyTo: row.contact_email || undefined,
    subject: 'New consultation request',
    html,
  })

  if (!sendResult.ok) {
    console.error('email send failed', sendResult.error)
    return new Response('send failed', { status: 502 })
  }

  return new Response('ok', { status: 200 })
})
