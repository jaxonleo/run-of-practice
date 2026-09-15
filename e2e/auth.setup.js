// Mints a real session for the persistent QA head-coach account (staging
// only -- see BUILD-STATUS.md Working Conventions) the same way
// scripts/qa_login.mjs does for manual browser QA, then saves it as a
// Playwright storageState so every other spec starts already signed in
// instead of re-running the email/code flow per test. Runs as its own
// "setup" project (playwright.config.js) that the real specs depend on.
import { test as setup } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { readEnvVar } from './env.js';

const authFile = path.join(process.cwd(), 'e2e', '.auth', 'head-coach.json');

setup('authenticate as QA head coach', async ({ page, baseURL }) => {
  const projectRef = readEnvVar('STAGING_PROJECT_REF');
  const serviceRoleKey = readEnvVar('STAGING_SERVICE_ROLE_KEY');
  const anonKey = readEnvVar('STAGING_ANON_KEY');
  const supabaseUrl = `https://${projectRef}.supabase.co`;

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: 'ropqa-head@example.com',
  });
  if (linkErr) throw linkErr;
  const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'email',
  });
  if (verifyErr) throw verifyErr;

  const session = verifyData.session;

  // localStorage is origin-scoped -- needs a real page load first before it
  // can be written, same reason the manual browser-QA convention navigates
  // before injecting.
  await page.goto(baseURL);
  await page.evaluate(
    ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
    { key: `sb-${projectRef}-auth-token`, session }
  );
  await page.goto(baseURL);
  await page.waitForSelector('text=Home', { timeout: 15000 });

  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
