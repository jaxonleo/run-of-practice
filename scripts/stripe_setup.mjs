// Idempotent Stripe catalog setup for Run of Practice Pro. Safe to re-run:
// every object is found by a stable key first and only created if missing.
// Usage (test mode, the default):  node scripts/stripe_setup.mjs
// Also create the webhook endpoint: node scripts/stripe_setup.mjs --webhook-url https://<ref>.functions.supabase.co/stripe-webhook
//   (its signing secret is written to .env as STRIPE_<MODE>_WEBHOOK_SECRET, never printed)
// Live mode later, deliberately:   STRIPE_MODE=live node scripts/stripe_setup.mjs
// Reads STRIPE_TEST_SECRET_KEY (or STRIPE_LIVE_SECRET_KEY) from rop/.env and
// never prints it. Code refers to prices only by lookup key
// (rop_pro_monthly / rop_pro_annual), never by Stripe id, so test and live
// catalogs stay interchangeable.
import fs from 'fs';
import path from 'path';

const mode = process.env.STRIPE_MODE === 'live' ? 'live' : 'test';
const envName = mode === 'live' ? 'STRIPE_LIVE_SECRET_KEY' : 'STRIPE_TEST_SECRET_KEY';
const env = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
const m = env.match(new RegExp(`^${envName}=(.*)$`, 'm'));
if (!m) { console.error(`${envName} not found in .env`); process.exit(1); }
const key = m[1].trim();
if (!key.startsWith(mode === 'live' ? 'sk_live_' : 'sk_test_')) {
  console.error(`${envName} does not look like a ${mode} secret key. Aborting.`);
  process.exit(1);
}

// Same pinned version as supabase/functions/_shared/stripe.ts. params may
// be an object or an array of [key, value] pairs (for repeated keys).
const STRIPE_API_VERSION = '2024-06-20';
async function stripe(method, pathname, params) {
  const res = await fetch('https://api.stripe.com/v1' + pathname, {
    method,
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_API_VERSION },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data = await res.json();
  if (data.error) throw new Error(`${method} ${pathname}: ${data.error.message}`);
  return data;
}

const PRICES = [
  { lookup_key: 'rop_pro_monthly', unit_amount: 1200, interval: 'month', nickname: 'Pro monthly' },
  { lookup_key: 'rop_pro_annual', unit_amount: 9900, interval: 'year', nickname: 'Pro annual' },
];

// 1. The Pro product, found by its metadata key. A direct list, not
// /products/search: search is eventually consistent, so a quick re-run
// would not see a product created seconds earlier and would duplicate it.
const listed = await stripe('GET', '/products?active=true&limit=100');
let product = listed.data.find(p => p.metadata && p.metadata.rop_key === 'pro');
if (!product) {
  product = await stripe('POST', '/products', {
    name: 'Run of Practice Pro',
    description: 'Up to three active teams, unlimited staff, drills, and templates, shared planning, full Goals & Insights, Benchmarks, and complete practice history.',
    'metadata[rop_key]': 'pro',
  });
  console.log('created product', product.id);
} else {
  console.log('product exists', product.id);
}

// 2. Monthly and annual prices, found by lookup key.
for (const p of PRICES) {
  const existing = await stripe('GET', `/prices?lookup_keys[]=${p.lookup_key}&active=true`);
  if (existing.data[0]) { console.log('price exists', p.lookup_key, existing.data[0].id); continue; }
  const price = await stripe('POST', '/prices', {
    product: product.id,
    currency: 'usd',
    unit_amount: String(p.unit_amount),
    'recurring[interval]': p.interval,
    lookup_key: p.lookup_key,
    nickname: p.nickname,
    'metadata[rop_key]': p.lookup_key,
  });
  console.log('created price', p.lookup_key, price.id);
}

// 3. Billing portal configuration: switch monthly/annual, update the card,
// see invoices, cancel at period end (never immediately).
const priceIds = [];
for (const p of PRICES) priceIds.push((await stripe('GET', `/prices?lookup_keys[]=${p.lookup_key}&active=true`)).data[0].id);
const configs = await stripe('GET', '/billing_portal/configurations?active=true&limit=20');
if (configs.data.find(c => c.metadata && c.metadata.rop_key === 'portal')) {
  console.log('portal configuration exists');
} else {
  const appUrl = mode === 'live' ? 'https://www.runofpractice.com' : 'https://staging.runofpractice.com';
  const cfg = await stripe('POST', '/billing_portal/configurations', [
    ['business_profile[headline]', 'Run of Practice: manage your Pro subscription'],
    ['business_profile[privacy_policy_url]', appUrl + '/privacy'],
    ['business_profile[terms_of_service_url]', appUrl + '/terms'],
    ['features[invoice_history][enabled]', 'true'],
    ['features[payment_method_update][enabled]', 'true'],
    ['features[customer_update][enabled]', 'false'],
    ['features[subscription_cancel][enabled]', 'true'],
    ['features[subscription_cancel][mode]', 'at_period_end'],
    ['features[subscription_update][enabled]', 'true'],
    ['features[subscription_update][default_allowed_updates][]', 'price'],
    ['features[subscription_update][proration_behavior]', 'create_prorations'],
    ['features[subscription_update][products][0][product]', product.id],
    ...priceIds.map(id => ['features[subscription_update][products][0][prices][]', id]),
    ['default_return_url', appUrl + '/settings/plan'],
    ['metadata[rop_key]', 'portal'],
  ]);
  console.log('created portal configuration', cfg.id);
}

// 4. Webhook endpoint (only when --webhook-url is given).
const urlArg = process.argv.indexOf('--webhook-url');
if (urlArg > -1) {
  const webhookUrl = process.argv[urlArg + 1];
  const existing = (await stripe('GET', '/webhook_endpoints?limit=50')).data.find(w => w.url === webhookUrl);
  if (existing) {
    console.log('webhook endpoint exists', existing.id, '(secret unchanged in .env)');
  } else {
    const wh = await stripe('POST', '/webhook_endpoints', [
      ['url', webhookUrl],
      ['api_version', STRIPE_API_VERSION],
      ['description', 'Run of Practice plan sync'],
      ['enabled_events[]', 'checkout.session.completed'],
      ['enabled_events[]', 'customer.subscription.created'],
      ['enabled_events[]', 'customer.subscription.updated'],
      ['enabled_events[]', 'customer.subscription.deleted'],
      ['metadata[rop_key]', 'webhook'],
    ]);
    const secretName = `STRIPE_${mode.toUpperCase()}_WEBHOOK_SECRET`;
    const envPath = path.join(process.cwd(), '.env');
    let envText = fs.readFileSync(envPath, 'utf8');
    const line = `${secretName}=${wh.secret}`;
    envText = new RegExp(`^${secretName}=.*$`, 'm').test(envText)
      ? envText.replace(new RegExp(`^${secretName}=.*$`, 'm'), line)
      : envText.replace(/\n?$/, '\n') + line + '\n';
    fs.writeFileSync(envPath, envText);
    console.log('created webhook endpoint', wh.id, `(signing secret saved to .env as ${secretName})`);
  }
}

console.log(`done (${mode} mode)`);
