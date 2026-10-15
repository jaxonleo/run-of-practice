// Emails Jax when a coach applies to the partner program. Same pg_net
// trigger shape as notify-consultation-request (shared-secret header,
// deployed with --no-verify-jwt), but the trigger reads this function's
// URL from the per-environment Vault entry `functions_base_url`, so
// staging emails come from staging and production from production.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/sendEmail.ts'

const NOTIFY_EMAIL = 'jaxon@runofpractice.com'

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('unauthorized', { status: 401 })
  }
  const { application_id } = await req.json()
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: row, error } = await supabase
    .from('partner_applications')
    .select('name, email, sport, team_level, message, created_at')
    .eq('id', application_id)
    .single()
  if (error || !row) {
    console.error('partner application lookup failed', error)
    return new Response('lookup failed', { status: 500 })
  }

  const esc = (s: string | null) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const appUrl = Deno.env.get('APP_URL') || 'https://www.runofpractice.com'
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f2f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #dde5e0;overflow:hidden;">
<tr><td style="background:#111714;padding:16px 24px;font-size:16px;font-weight:800;color:#ffffff;">New partner application</td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:1.6;color:#111714;">
<p style="margin:0 0 8px;"><strong>${esc(row.name)}</strong> &middot; <a href="mailto:${esc(row.email)}" style="color:#2d6a4f;">${esc(row.email)}</a></p>
<p style="margin:0 0 14px;color:#6b7a72;">${esc(row.sport) || 'Sport not given'}${row.team_level ? ' &middot; ' + esc(row.team_level) : ''}</p>
<div style="white-space:pre-wrap;margin:0 0 18px;">${esc(row.message) || '(no message)'}</div>
<a href="${appUrl}/admin/partners" style="display:inline-block;background:#2d6a4f;color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px;">Review in Run of Practice</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`

  const result = await sendEmail({ to: NOTIFY_EMAIL, replyTo: row.email, subject: `Partner application: ${row.name}`, html })
  if (!result.ok) {
    console.error('email send failed', result.error)
    return new Response('send failed', { status: 502 })
  }
  return new Response('ok', { status: 200 })
})
