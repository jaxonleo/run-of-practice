// Minimal Stripe REST client for Edge Functions (no SDK dependency).
// Every request pins one API version, so object shapes (invoice.charge,
// subscription.current_period_end) never shift under us when Stripe
// changes its default; the webhook endpoint is created with the same
// version by scripts/stripe_setup.mjs.
export const STRIPE_API_VERSION = '2024-06-20'

type Params = Record<string, string | number | boolean | undefined | null>

export async function stripe(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Params, idempotencyKey?: string) {
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) body.append(k, String(v))
  }
  const isGet = method === 'GET'
  const url = 'https://api.stripe.com/v1' + path + (isGet && body.toString() ? (path.includes('?') ? '&' : '?') + body.toString() : '')
  const headers: Record<string, string> = {
    Authorization: 'Bearer ' + key,
    'Stripe-Version': STRIPE_API_VERSION,
  }
  if (!isGet) headers['Content-Type'] = 'application/x-www-form-urlencoded'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const res = await fetch(url, { method, headers, body: isGet ? undefined : body.toString() })
  const data = await res.json()
  if (data.error) {
    const err = new Error(data.error.message || 'Stripe error') as Error & { stripe?: unknown }
    err.stripe = data.error
    throw err
  }
  return data
}

// Stripe-Signature verification (t=timestamp, v1=HMAC-SHA256 of
// "timestamp.payload"), with a 5-minute tolerance against replays.
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300): Promise<boolean> {
  if (!header) return false
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]).filter(p => p.length === 2))
  const t = parts['t']
  const signatures = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3))
  if (!t || !signatures.length) return false
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  // Constant-time comparison.
  return signatures.some(s => s.length === expected.length && [...s].reduce((acc, ch, i) => acc | (ch.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0)
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
