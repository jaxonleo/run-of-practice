// Testing-round-1 addendum §2(e): informational-only notification when a
// coach adds staff to their team. NOT an auth mechanism -- deliberately
// does not use Supabase's admin.inviteUserByEmail (that sends a magic
// link, the exact thing already ripped out in favor of Email OTP because
// it breaks for installed-PWA sign-in). Just names who added them, which
// team, and points at the normal sign-in flow.
//
// Triggered only by the pg_net trigger on team_staff insert (see
// 20260710020000_team_staff_notify_trigger.sql) -- verify_jwt is off for
// this function since pg_net calls carry no user JWT, so the shared
// x-webhook-secret header is the only thing standing between this
// endpoint and the open internet.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('unauthorized', { status: 401 })
  }

  const { staff_id } = await req.json()

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: staff, error: staffErr } = await supabase
    .from('team_staff')
    .select('invite_email, team_id, added_by')
    .eq('id', staff_id)
    .single()

  if (staffErr) {
    console.error('staff lookup failed', staffErr)
    return new Response('staff lookup failed', { status: 500 })
  }
  if (!staff || !staff.invite_email) {
    return new Response('nothing to notify', { status: 200 })
  }

  const [{ data: team }, { data: adder }] = await Promise.all([
    supabase.from('teams').select('name').eq('id', staff.team_id).single(),
    staff.added_by
      ? supabase.from('profiles').select('first_name, last_name').eq('id', staff.added_by).single()
      : Promise.resolve({ data: null }),
  ])

  const teamName = team?.name || 'a team'
  const adderName = adder ? `${adder.first_name} ${adder.last_name}`.trim() : 'a coach'

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Run of Practice <noreply@runofpractice.com>',
      to: [staff.invite_email],
      subject: `You've been added to ${teamName} on Run of Practice`,
      html: `<p>${adderName} added you to <strong>${teamName}</strong> on Run of Practice.</p>
<p>Sign in any time at <a href="https://www.runofpractice.com">runofpractice.com</a> with this email address (${staff.invite_email}) — we'll send a one-time code, no password needed.</p>
<p>This is just an FYI, nothing to click or confirm here.</p>`,
    }),
  })

  if (!resendRes.ok) {
    console.error('resend send failed', resendRes.status, await resendRes.text())
    return new Response('send failed', { status: 502 })
  }

  return new Response('ok', { status: 200 })
})
