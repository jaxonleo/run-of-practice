// Real gap found live (2026-07-22): org_invites never had an email
// notification, unlike team_staff's notify-team-staff-added -- an invited
// director/admin had no way to know they'd been invited unless they
// happened to sign in and notice the pending-invite card on Home. Mirrors
// that function's exact shape and reuses its same project-wide secrets
// (RESEND_API_KEY, WEBHOOK_SECRET) rather than minting new ones -- both are
// already shared across every deployed function in this project.
//
// Deliberately NOT a magic link (same reasoning as notify-team-staff-added:
// magic links broke installed-PWA sign-in, hence Email OTP). Org invites
// also require an explicit in-app Accept/Decline (unlike team_staff, which
// auto-links) -- the email just points at signing in, where the
// pending-invite card on Home is what lets them actually respond.
//
// Triggered only by the pg_net trigger on org_invites insert/update (see
// notify_org_invite_created / on_org_invite_created_notify) -- verify_jwt
// is off since pg_net calls carry no user JWT, so the shared
// x-webhook-secret header is the only thing gating this endpoint.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ROLE_LABELS: Record<string, string> = { director: 'Director', admin: 'Admin' }

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('unauthorized', { status: 401 })
  }

  const { invite_id } = await req.json()

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: invite, error: inviteErr } = await supabase
    .from('org_invites')
    .select('email, role, organization_id, invited_by, status')
    .eq('id', invite_id)
    .single()

  if (inviteErr) {
    console.error('invite lookup failed', inviteErr)
    return new Response('invite lookup failed', { status: 500 })
  }
  if (!invite || invite.status !== 'pending') {
    return new Response('nothing to notify', { status: 200 })
  }

  const [{ data: org }, { data: inviter }] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', invite.organization_id).single(),
    invite.invited_by
      ? supabase.from('profiles').select('first_name, last_name').eq('id', invite.invited_by).single()
      : Promise.resolve({ data: null }),
  ])

  const orgName = org?.name || 'an organization'
  const inviterName = inviter ? `${inviter.first_name} ${inviter.last_name}`.trim() : 'A director'
  const roleLabel = ROLE_LABELS[invite.role] || invite.role

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Run of Practice <noreply@runofpractice.com>',
      to: [invite.email],
      subject: `You've been invited to help lead ${orgName} on Run of Practice`,
      html: `<p>${inviterName} invited you to help lead <strong>${orgName}</strong> on Run of Practice as a <strong>${roleLabel}</strong>.</p>
<p>Sign in any time at <a href="https://www.runofpractice.com">runofpractice.com</a> with this email address (${invite.email}) — we'll send a one-time code, no password needed. Once signed in, you'll see the invite on your Home screen with an option to accept or decline.</p>`,
    }),
  })

  if (!resendRes.ok) {
    console.error('resend send failed', resendRes.status, await resendRes.text())
    return new Response('send failed', { status: 502 })
  }

  return new Response('ok', { status: 200 })
})
