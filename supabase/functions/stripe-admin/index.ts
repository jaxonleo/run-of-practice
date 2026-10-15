// Admin-only billing make-goods for a coach: list their payments and
// credit balance, refund a payment (full or partial), or add account
// credit that comes off their next bills. Every action re-checks
// is_admin() with the caller's own token, requires a reason, uses an
// idempotency key from the client (a double click cannot refund twice),
// and writes a billing_adjustments row. The Stripe secret never leaves
// the server. Deployed with JWT verification on.
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
    const { data: isAdmin } = await userClient.rpc('is_admin')
    if (!isAdmin) return json({ error: 'Not authorized.' }, 403)

    const body = await req.json().catch(() => ({}))
    const { action, user_id: targetUserId, invoice_id, amount_cents, reason, operation_id } = body
    if (!targetUserId) return json({ error: 'user_id is required' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: ps } = await admin.from('entitlement_plan_state')
      .select('stripe_customer_id').eq('subject_type', 'user').eq('user_id', targetUserId).maybeSingle()
    const customerId = ps && ps.stripe_customer_id
    if (!customerId) return json({ payments: [], balance_cents: 0, note: 'This coach has never paid through Stripe.' })

    if (action === 'list') {
      const [invoices, customer] = await Promise.all([
        stripe('GET', '/invoices', { customer: customerId, limit: 24, 'expand[]': 'data.charge' }),
        stripe('GET', `/customers/${customerId}`),
      ])
      // deno-lint-ignore no-explicit-any
      const payments = (invoices.data || []).filter((i: any) => i.amount_paid > 0).map((i: any) => ({
        invoice_id: i.id,
        number: i.number,
        created: i.created,
        amount_paid: i.amount_paid,
        amount_refunded: i.charge && typeof i.charge === 'object' ? i.charge.amount_refunded : 0,
        currency: i.currency,
        description: (i.lines && i.lines.data && i.lines.data[0] && i.lines.data[0].description) || 'Run of Practice Pro',
      }))
      // Stripe stores credit as a negative balance.
      return json({ payments, balance_cents: -(customer.balance || 0) })
    }

    if (!reason || !String(reason).trim()) return json({ error: 'A reason is required.' }, 400)
    if (!operation_id) return json({ error: 'operation_id is required' }, 400)
    const cents = Math.round(Number(amount_cents))

    if (action === 'refund') {
      if (!invoice_id) return json({ error: 'Choose a payment to refund.' }, 400)
      const invoice = await stripe('GET', `/invoices/${invoice_id}`, { 'expand[]': 'charge' })
      if (invoice.customer !== customerId) return json({ error: 'That payment belongs to a different coach.' }, 400)
      const charge = invoice.charge
      if (!charge || typeof charge !== 'object') return json({ error: 'That payment has nothing to refund.' }, 400)
      const refundable = charge.amount - (charge.amount_refunded || 0)
      const amount = Number.isFinite(cents) && cents > 0 ? cents : refundable
      if (amount > refundable) return json({ error: `At most ${(refundable / 100).toFixed(2)} can still be refunded on that payment.` }, 400)
      const refund = await stripe('POST', '/refunds', {
        charge: charge.id,
        amount,
        'metadata[reason]': String(reason).slice(0, 450),
        'metadata[admin_user_id]': user.id,
      }, `rop-refund-${operation_id}`)
      await admin.from('billing_adjustments').insert({
        user_id: targetUserId, kind: 'refund', amount_cents: amount, currency: charge.currency,
        stripe_object_id: refund.id, reason: String(reason).trim(), created_by: user.id,
      })
      return json({ ok: true, refund_id: refund.id, amount })
    }

    if (action === 'credit') {
      if (!Number.isFinite(cents) || cents <= 0 || cents > 100000) return json({ error: 'Enter a credit between $0.01 and $1,000.' }, 400)
      const txn = await stripe('POST', `/customers/${customerId}/balance_transactions`, {
        amount: -cents,
        currency: 'usd',
        description: String(reason).slice(0, 350),
        'metadata[admin_user_id]': user.id,
      }, `rop-credit-${operation_id}`)
      await admin.from('billing_adjustments').insert({
        user_id: targetUserId, kind: 'credit', amount_cents: cents, currency: 'usd',
        stripe_object_id: txn.id, reason: String(reason).trim(), created_by: user.id,
      })
      return json({ ok: true, transaction_id: txn.id, amount: cents })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    console.error('stripe-admin failed', e)
    const msg = (e as { stripe?: { message?: string } }).stripe?.message
    return json({ error: msg || 'Stripe request failed.' }, 500)
  }
})
