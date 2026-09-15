import { test, expect } from '@playwright/test';
import { stagingAdminClient } from './staging-admin.js';

// Real regression coverage for the exact shape of bug this app has actually
// shipped: Save-as-Template broke in production for months (Sentry-reported,
// 2026-09-10 session, BUILD-STATUS.md) because App.jsx never imported
// saveTemplateTree -- a bug a type checker wouldn't catch and no test
// suite existed to catch either. This exercises the real Builder -> add a
// drill -> Save -> Template path against real staging data, then verifies
// the row actually landed (not just that no error was thrown) and cleans
// up after itself.
const templateName = `E2E Builder Save ${Date.now()}`;
let createdTemplateId = null;

test('Builder: adding a drill and saving as a template actually persists', async ({ page }) => {
  await page.goto('/builder/new');
  await page.waitForSelector('text=Layup Lines', { timeout: 15000 });

  // Click-to-add (BB Builder convention) -- adds the library drill to the
  // Run of Practice.
  await page.getByText('Layup Lines', { exact: true }).click();
  await expect(page.getByText('Nothing added yet.')).not.toBeVisible();
  await expect(page.locator('.li', { hasText: 'Layup Lines' })).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Template', exact: true }).click();
  await page.getByPlaceholder('Template name...').fill(templateName);
  await page.getByRole('button', { name: 'Save Template', exact: true }).click();

  // The save is a real network round trip -- give it a moment, then verify
  // against the database directly rather than trusting a transient toast.
  await page.waitForTimeout(2000);

  const admin = stagingAdminClient();
  const { data, error } = await admin
    .from('templates')
    .select('id, name')
    .eq('name', templateName)
    .maybeSingle();

  expect(error).toBeNull();
  expect(data).not.toBeNull();
  expect(data.name).toBe(templateName);
  createdTemplateId = data.id;
});

test.afterEach(async () => {
  if (!createdTemplateId) return;
  const admin = stagingAdminClient();
  await admin.from('templates').delete().eq('id', createdTemplateId);
  createdTemplateId = null;
});
