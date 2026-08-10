// Reusable QA session minting for the two persistent Run of Practice test
// accounts (ropqa-head@example.com / ropqa-asst@example.com). Run any time
// you need fresh tokens for these accounts -- their underlying data (teams,
// roster, drills) persists across sessions, only the auth session expires.
// Usage: node scripts/qa_login.mjs > /tmp/qa_session.json
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('/Users/jaxonleo/Desktop/Run of Practice/rop/.env', 'utf8');
const SERVICE_ROLE_KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const SUPABASE_URL = 'https://bepoojcbizxhqadrytjq.supabase.co';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(SUPABASE_URL, 'sb_publishable_z0atQT9uv4_9OZSlGe_awg_d07YcC7v', { auth: { autoRefreshToken: false, persistSession: false } });

const emails = {
  head: 'ropqa-head@example.com',
  asst: 'ropqa-asst@example.com',
};

async function mint(email) {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkErr) throw linkErr;
  const token_hash = linkData.properties.hashed_token;
  const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({ token_hash, type: 'email' });
  if (verifyErr) throw verifyErr;
  return { userId: linkData.user.id, access_token: verifyData.session.access_token, refresh_token: verifyData.session.refresh_token };
}

const head = await mint(emails.head);
const asst = await mint(emails.asst);

console.log(JSON.stringify({ head, asst }, null, 2));
