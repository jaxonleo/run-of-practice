// Stripe -> Run of Practice. The only writer of a coach's Stripe-driven
// plan: verifies Stripe's signature, records each event id once (a
// redelivered event is a no-op), then mirrors the subscription onto
// entitlement_plan_state. Deploy with --no-verify-jwt (Stripe has no
// Supabase token; the signature is the authentication).
//
// Mapping: active / trialing / past_due -> plan 'pro' (past_due keeps Pro
// while Stripe retries the card); canceled / unpaid / incomplete_expired
// -> plan 'free'. Cancelling in the portal sets cancel_at_period_end and
// keeps Pro until Stripe sends the final customer.subscription.deleted.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { stripe, verifyStripeSignature } from '../_shared/stripe.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

async function userIdFor(sub: { metadata?: Record<string, string>; customer: string }) {
  if (sub.metadata && sub.metadata.user_id) return sub.metadata.user_id
  const { data } = await admin.from('entitlement_plan_state').select('user_id')
    .eq('subject_type', 'user').eq('stripe_customer_id', sub.customer).maybeSingle()
  return data ? data.user_id : null
}

// deno-lint-ignore no-explicit-any
async function syncSubscription(sub: any) {
  const userId = await userIdFor(sub)
  if (!userId) { console.error('no user for subscription', sub.id); return }
  const status: string = sub.status
  const paid = ['active', 'trialing', 'past_due'].includes(status)
  const ended = ['canceled', 'unpaid', 'incomplete_expired'].includes(status)
  if (!paid && !ended) return // incomplete: wait for the outcome
  if (ended) {
    // A late "ended" event for an old subscription must not undo a newer
    // one (a coach who cancelled and later resubscribed).
    const { data: row } = await admin.from('entitlement_plan_state').select('stripe_subscription_id')
      .eq('subject_type', 'user').eq('user_id', userId).maybeSingle()
    if (row && row.stripe_subscription_id && row.stripe_subscription_id !== sub.id) return
  }
  const item = sub.items && sub.items.data && sub.items.data[0]
  const periodEnd = sub.current_period_end || (item && item.current_period_end)
  const update: Record<string, unknown> = {
    stripe_customer_id: sub.customer,
    stripe_subscription_id: ended ? null : sub.id,
    plan_bundle_key: paid ? 'pro' : 'free',
    billing_status: ended ? 'canceled' : status,
    cancel_at_period_end: !!sub.cancel_at_period_end && !ended,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    stripe_price_lookup_key: ended ? null : (item && item.price && item.price.lookup_key) || null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await admin.from('entitlement_plan_state').update(update)
    .eq('subject_type', 'user').eq('user_id', userId)
  if (error) throw error
}

Deno.serve(async (req) => {
  const payload = await req.text()
  const ok = await verifyStripeSignature(payload, req.headers.get('stripe-signature'), Deno.env.get('STRIPE_WEBHOOK_SECRET') || '')
  if (!ok) return new Response('bad signature', { status: 400 })

  const event = JSON.parse(payload)
  const { error: dupError } = await admin.from('stripe_webhook_events').insert({ id: event.id, type: event.type })
  if (dupError) {
    if (dupError.code === '23505') return new Response('duplicate', { status: 200 })
    console.error('event log failed', dupError)
    return new Response('retry', { status: 500 })
  }

  try {
    const obj = event.data.object
    switch (event.type) {
      case 'checkout.session.completed':
        if (obj.mode === 'subscription' && obj.subscription) {
          await syncSubscription(await stripe('GET', `/subscriptions/${obj.subscription}`))
        }
        break
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(obj)
        break
      default:
        break
    }
    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error('webhook handling failed', event.type, e)
    // Let Stripe retry: forget this event id so the retry is processed.
    await admin.from('stripe_webhook_events').delete().eq('id', event.id)
    return new Response('retry', { status: 500 })
  }
})
