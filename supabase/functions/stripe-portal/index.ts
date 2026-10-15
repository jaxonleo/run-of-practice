// "Manage subscription": opens Stripe's hosted billing portal for the
// signed-in coach (switch monthly/annual, update the card, see invoices,
// cancel). Cancelling there ends Pro at the end of the paid period; the
// stripe-webhook function moves the coach to Free when it actually ends.
// The portal configuration (what coaches may do there) is created by
// scripts/stripe_setup.mjs and found by its metadata key.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { stripe, json, corsHeaders } from '../_shared/stripe.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Sign in first.' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: ps } = await admin.from('entitlement_plan_state')
      .select('stripe_customer_id').eq('subject_type', 'user').eq('user_id', user.id).maybeSingle()
    if (!ps || !ps.stripe_customer_id) return json({ error: 'There is no subscription to manage yet.' }, 404)

    const configs = await stripe('GET', '/billing_portal/configurations', { active: true, limit: 20 })
    const config = (configs.data || []).find((c: { metadata?: Record<string, string> }) => c.metadata && c.metadata.rop_key === 'portal')

    const appUrl = Deno.env.get('APP_URL') || 'https://www.runofpractice.com'
    const session = await stripe('POST', '/billing_portal/sessions', {
      customer: ps.stripe_customer_id,
      return_url: `${appUrl}/settings/plan`,
      configuration: config ? config.id : undefined,
    })
    return json({ url: session.url })
  } catch (e) {
    console.error('stripe-portal failed', e)
    return json({ error: 'Could not open billing. Try again.' }, 500)
  }
})
