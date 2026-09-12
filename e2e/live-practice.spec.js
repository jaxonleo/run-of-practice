import { test, expect } from '@playwright/test';
import { stagingAdminClient } from './staging-admin.js';

// The actual bread-and-butter flow of this app (its own Session Log's
// words, forty-fifth session): build a practice, run it live, confirm the
// real coaching view loads with working controls. Creates a real practice +
// live session on staging, verifies the live session row directly, then
// deletes the practice (practice_live_sessions/practice_activities/etc. all
// cascade-delete from practices, confirmed via pg_constraint before writing
// this test) so nothing lingers on the shared QA fixture team.
let createdPracticeId = null;

test('Run Now takes a built practice into a real live coaching view', async ({ page }) => {
  await page.goto('/builder/new');
  await page.waitForSelector('text=Layup Lines', { timeout: 15000 });
  await page.getByText('Layup Lines', { exact: true }).click();

  await page.getByRole('button', { name: 'Run Now', exact: true }).click();
  await page.waitForURL(/\/run\//, { timeout: 15000 });
  createdPracticeId = page.url().split('/run/')[1];

  await page.getByRole('button', { name: 'Run Practice', exact: true }).click();

  // Dismiss the one-time audio-preference prompt if it appears, then
  // confirm the real live-coaching surface rendered -- the timer controls
  // and the Next/advance action are what actually matter, not just "no
  // error was thrown."
  const keepAudioOff = page.getByRole('button', { name: 'Keep Audio Off' });
  if (await keepAudioOff.isVisible({ timeout: 3000 }).catch(() => false)) {
    await keepAudioOff.click();
  }

  await expect(page.getByRole('button', { name: 'Next >' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: '+1m' })).toBeVisible();
  await expect(page.getByText('Layup Lines')).toBeVisible();

  const admin = stagingAdminClient();
  const { data, error } = await admin
    .from('practice_live_sessions')
    .select('id, status')
    .eq('practice_id', createdPracticeId)
    .maybeSingle();

  expect(error).toBeNull();
  expect(data).not.toBeNull();
  expect(data.status).toBe('active');
});

test.afterEach(async () => {
  if (!createdPracticeId) return;
  const admin = stagingAdminClient();
  await admin.from('practices').delete().eq('id', createdPracticeId);
  createdPracticeId = null;
});
