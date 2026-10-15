import { test, expect } from '@playwright/test';
import { stagingAdminClient, QA_FREE_USER_ID, QA_FREE_TEAM_ID } from './staging-admin.js';

// Free / Pro / Organization packaging (2026-10-14): the Free-plan limit
// notices and previews render for a real Free coach, at both viewports.
// Signed in as the staging-only ropqa-free account, which sits at every
// Free cap (1 team, 2 staff incl. a pending invite, 20 drills, 2 templates,
// 11 completed practices, 4 goals). Read-only by design: every action here
// stops at the notice, or is refused before anything is written (the drill
// save is pre-checked client-side and capped server-side), so the
// fixture's caps never move. The upsell analytics rows these screens log
// are deleted afterward.
test.use({ storageState: 'e2e/.auth/free-coach.json' });

test.afterAll(async () => {
  await stagingAdminClient().from('entitlement_events').delete().eq('user_id', QA_FREE_USER_ID);
});

test('T1: a second team shows the Free team limit and blocks Save', async ({ page }) => {
  await page.goto('/teams');
  await page.getByRole('button', { name: '+ Team' }).click();
  await expect(page.getByText('Coaching more than one team? Free covers one team.')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('T2: a third coach shows the staff limit', async ({ page }) => {
  await page.goto(`/team/${QA_FREE_TEAM_ID}/roster`);
  await page.getByRole('button', { name: /Coaches/ }).click();
  await page.getByRole('button', { name: '+ Add' }).click();
  await expect(page.getByText('Your staff is growing. Free teams include 2 coaches.')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('L2: a 21st drill is refused with the full-library notice', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByText('20 of 20 saved drills')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '+ Add Drill' }).click();
  await page.locator('.modal input.inp').first().fill('E2E One Too Many');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Your library is full.')).toBeVisible({ timeout: 15000 });
  const { count } = await stagingAdminClient().from('activity_library')
    .select('id', { count: 'exact', head: true }).eq('owner_user_id', QA_FREE_USER_ID).eq('name', 'E2E One Too Many');
  expect(count).toBe(0);
});

test('L3: a third template shows the template limit', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: '+ New Template' }).click();
  await expect(page.getByText('Templates turn your best practice into a one-tap start.')).toBeVisible({ timeout: 15000 });
});

test('H1: history shows the 10 most recent with a hidden-count footer', async ({ page }) => {
  await page.goto(`/team/${QA_FREE_TEAM_ID}/goals`);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText(/Showing your 10 most recent practices\. \d+ older practices are saved\./)).toBeVisible({ timeout: 15000 });
});

test('G2: Next Practice Guidance shows one priority plus the preview', async ({ page }) => {
  await page.goto(`/team/${QA_FREE_TEAM_ID}/goals`);
  await expect(page.getByText(/\d+ more categories are below target\. Pro shows all of them/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Show all categories' })).toHaveCount(0);
});
