import { test, expect } from '@playwright/test';

// Deliberately signed-out for this whole file, overriding the project-level
// authenticated storageState -- this is the one spec that needs to see the
// real logged-out landing/sign-in screens.
test.use({ storageState: { cookies: [], origins: [] } });

// Does not actually submit "Send Code": that hits the same real Supabase
// rate-limit bucket as the app's own sign-in codes and scripts/qa_login.mjs
// (see BUILD-STATUS.md Working Conventions) -- a shared, finite resource
// this test shouldn't spend on every CI run. This checks the UI is reachable
// and functional up to that boundary; the authenticated specs in this suite
// (builder-save, live-practice) are what prove a real session actually
// authenticates correctly past it.
test('landing page shows Sign In and the sign-in form accepts an email', async ({ page }) => {
  await page.goto('/');
  const signInNavButton = page.getByRole('button', { name: 'Sign In', exact: true }).first();
  await expect(signInNavButton).toBeVisible();

  await signInNavButton.click();
  const emailInput = page.getByPlaceholder('you@example.com');
  await expect(emailInput).toBeVisible();

  await emailInput.fill('e2e-smoke-test@example.com');
  await expect(emailInput).toHaveValue('e2e-smoke-test@example.com');

  const sendCode = page.getByRole('button', { name: 'Send Code' });
  await expect(sendCode).toBeVisible();
  await expect(sendCode).toBeEnabled();
});
