// Rewritten 2026-08-01 for the new team_invites consent flow -- this used
// to be a pure FYI ("you've been added, no need to log in until you're
// ready") since add_team_staff granted access immediately. Now a real
// invite requiring accept/decline, so the copy needs to actually ask for a
// response, and needs to branch on whether the invited email already has a
// Run of Practice account: an existing coach can "sign in to respond," but
// someone brand new has no account to sign into yet -- Email OTP creates
// one automatically on first use, so the underlying link/mechanism is
// identical either way, only the wording differs. Kept the same deployed
// function name/URL rather than standing up a new one, to avoid a
// dangling old function plus a trigger-URL cutover on a live app.
//
// Triggered by the pg_net trigger on team_invites insert, and again on any
// update that puts status back to 'pending' (a resend or an edited invite)
// -- see 20260801020000_team_invites.sql. verify_jwt is off since pg_net
// calls carry no user JWT, so the shared x-webhook-secret header is the
// only thing standing between this endpoint and the open internet.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderEmailHtml, articleFor } from '../_shared/emailTemplate.ts'
import { sendEmail } from '../_shared/sendEmail.ts'

const ROLE_LABELS: Record<string, string> = { head_coach: 'Head Coach', assistant_coach: 'Assistant Coach', helper: 'Helper' }

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
    .from('team_invites')
    .select('email, role, team_id, invited_by, status')
    .eq('id', invite_id)
    .single()

  if (inviteErr) {
    console.error('invite lookup failed', inviteErr)
    return new Response('invite lookup failed', { status: 500 })
  }
  if (!invite || invite.status !== 'pending') {
    return new Response('nothing to notify', { status: 200 })
  }

  const [{ data: team }, { data: inviter }, { data: existingProfile }] = await Promise.all([
    supabase.from('teams').select('name').eq('id', invite.team_id).single(),
    invite.invited_by
      ? supabase.from('profiles').select('first_name, last_name').eq('id', invite.invited_by).single()
      : Promise.resolve({ data: null }),
    supabase.from('profiles').select('id').ilike('email', invite.email).maybeSingle(),
  ])

  const teamName = team?.name || 'a team'
  const inviterName = inviter ? `${inviter.first_name} ${inviter.last_name}`.trim() : 'A coach'
  const roleLabel = ROLE_LABELS[invite.role] || invite.role
  const isNewUser = !existingProfile

  const html = renderEmailHtml({
    headline: `You're invited to join ${teamName}`,
    bodyHtml: `<p style="margin:0 0 12px;">${inviterName} invited you to join <strong>${teamName}</strong> on Run of Practice as ${articleFor(roleLabel)} <strong>${roleLabel}</strong>.</p>
<p style="margin:0;">${isNewUser
      ? 'Create your account with this email address, then you\'ll see the invite waiting on your Home screen with the option to accept or decline.'
      : 'Once you sign in, you\'ll see the invite waiting on your Home screen with the option to accept or decline.'}</p>`,
    ctaLabel: isNewUser ? 'Create Your Account' : 'Sign In to Respond',
    signInEmail: invite.email,
  })

  const sendResult = await sendEmail({
    to: invite.email,
    subject: `You've been invited to join ${teamName} on Run of Practice`,
    html,
  })

  if (!sendResult.ok) {
    console.error('email send failed', sendResult.error)
    return new Response('send failed', { status: 502 })
  }

  return new Response('ok', { status: 200 })
})
