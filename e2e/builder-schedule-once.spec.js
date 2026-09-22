import { test, expect } from '@playwright/test';
import { stagingAdminClient, QA_HEAD_USER_ID } from './staging-admin.js';

// Regression for the AZBC 10U incident (2026-09-21): a coach planned a
// brand-new practice, clicked "Schedule Practice", saw nothing change while
// the (slow) save ran, and clicked again -- each click inserted its own copy,
// leaving three identical practices seconds apart. This slows the practice
// insert down so the wait is long enough to click into, hammers the button,
// then checks the database (not the UI) for exactly one row. It also checks
// the visible "working" state the fix added.
const startedAt = Date.now();
let createdIds = [];

test('Builder: clicking Schedule Practice repeatedly creates exactly one practice', async ({ page }) => {
  // A long insert is the whole point -- it is the window the old code lost
  // clicks in.
  await page.route('**/rest/v1/practices*', async route => {
    if (route.request().method() === 'POST') await new Promise(r => setTimeout(r, 2500));
    await route.continue();
  });

  await page.goto('/builder/new');
  await page.waitForSelector('text=Layup Lines', { timeout: 15000 });
  await page.getByText('Layup Lines', { exact: true }).click();
  await expect(page.locator('.li', { hasText: 'Layup Lines' })).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Add to Schedule', exact: true }).click();

  const schedule = page.getByRole('button', { name: 'Schedule Practice', exact: true });
  await schedule.click();

  // The button must visibly change and stop accepting clicks while the save
  // runs, instead of looking idle.
  const working = page.getByRole('button', { name: /Scheduling/ });
  await expect(working).toBeVisible();
  await expect(working).toBeDisabled();

  // The stopwatch mark in "The Run of Practice" header ticks while saving.
  const hand = page.locator('.rop-hand-spin');
  await expect(hand).toHaveCount(1);
  expect(await hand.evaluate(el => el.getAnimations().some(a => a.animationName === 'tick'))).toBe(true);

  // Hammer it anyway -- straight DOM clicks bypass Playwright's own
  // "wait until enabled" and land the way impatient real taps do.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => document.querySelectorAll('.modal .btn.primary').forEach(b => b.click()));
    await page.waitForTimeout(300);
  }

  await expect(page.getByText('Practice scheduled')).toBeVisible({ timeout: 30000 });
  // ...and comes to rest (finishes its lap) once the save is done.
  await expect(hand).toHaveCount(0, { timeout: 5000 });

  const admin = stagingAdminClient();
  const { data, error } = await admin
    .from('practices')
    .select('id, created_at')
    .eq('created_by', QA_HEAD_USER_ID)
    .gte('created_at', new Date(startedAt - 60_000).toISOString());
  expect(error).toBeNull();
  createdIds = (data || []).map(r => r.id);
  expect(createdIds).toHaveLength(1);
});

test.afterEach(async () => {
  if (!createdIds.length) return;
  const admin = stagingAdminClient();
  await admin.from('practices').delete().in('id', createdIds);
  createdIds = [];
});
