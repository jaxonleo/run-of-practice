// Self-serve upgrade: a signed-in Free coach starts a Stripe Checkout
// session for Pro (monthly or annual) and is redirected to Stripe's hosted
// page. Nothing about their plan changes here; the stripe-webhook function
// moves them to Pro once Stripe confirms the subscription. Deployed with
// JWT verification on (the default); the caller's own token identifies them.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { stripe, json, corsHeaders } from '../_shared/stripe.ts'

const LOOKUP_KEYS: Record<string, string> = { monthly: 'rop_pro_monthly', annual: 'rop_pro_annual' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Sign in first.' }, 401)

    const { interval } = await req.json().catch(() => ({}))
    const lookupKey = LOOKUP_KEYS[interval as string]
    if (!lookupKey) return json({ error: 'Choose monthly or annual.' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: cohort } = await admin.from('entitlement_cohort_assignments')
      .select('cohort_bundle_key').eq('subject_type', 'user').eq('user_id', user.id).maybeSingle()
    if (cohort && cohort.cohort_bundle_key === 'founding_coach') {
      return json({ error: 'As a Founding Coach you already have everything in Pro.' }, 409)
    }
    const { data: ps } = await admin.from('entitlement_plan_state')
      .select('plan_bundle_key, billing_status, stripe_customer_id')
      .eq('subject_type', 'user').eq('user_id', user.id).maybeSingle()
    if (ps && ps.plan_bundle_key === 'pro' && ['active', 'trialing', 'past_due'].includes(ps.billing_status)) {
      return json({ error: 'You already have Pro. Use Manage subscription to change it.' }, 409)
    }

    // One Stripe customer per coach, created on first checkout.
    let customerId = ps && ps.stripe_customer_id
    if (!customerId) {
      const customer = await stripe('POST', '/customers', {
        email: user.email,
        'metadata[user_id]': user.id,
      }, `rop-customer-${user.id}`)
      customerId = customer.id
      await admin.from('entitlement_plan_state').update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('subject_type', 'user').eq('user_id', user.id)
    }

    const prices = await stripe('GET', '/prices', { 'lookup_keys[]': lookupKey, active: true })
    const price = prices.data && prices.data[0]
    if (!price) return json({ error: 'That plan is not available right now.' }, 500)

    const appUrl = Deno.env.get('APP_URL') || 'https://www.runofpractice.com'
    const session = await stripe('POST', '/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': price.id,
      'line_items[0][quantity]': 1,
      client_reference_id: user.id,
      'subscription_data[metadata][user_id]': user.id,
      'metadata[user_id]': user.id,
      allow_promotion_codes: true,
      // Cards only (Jax, 2026-10-17): Apple Pay and Google Pay still appear,
      // since they pay by card; Klarna, Cash App Pay, and bank debits don't,
      // whatever the Dashboard's payment-method settings say.
      'payment_method_types[0]': 'card',
      success_url: `${appUrl}/settings/plan?checkout=success`,
      cancel_url: `${appUrl}/settings/plan?checkout=cancel`,
    })
    return json({ url: session.url })
  } catch (e) {
    console.error('stripe-checkout failed', e)
    return json({ error: 'Could not start checkout. Try again.' }, 500)
  }
})
