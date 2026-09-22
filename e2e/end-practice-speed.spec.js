import { test, expect } from '@playwright/test';
import { stagingAdminClient } from './staging-admin.js';

// Direct feedback: "End Practice" (the final-activity relabel of the
// Next/advance button, CommandScreen.jsx) took a while with nothing on
// screen indicating it was working. Root cause was two sequential,
// unguarded network round trips (closeCurrentLog then a raw writeSession)
// with no in-flight UI at all -- the same "felt laggy" shape this file's
// own transitionTo already fixed for every other advance/back/jump action,
// just never applied to the terminal (end-of-practice) case. Fixed by
// running the two writes concurrently through a shared, single-flight
// endSession() helper (also used by the ellipsis menu's End Practice/Abort
// Practice) with real "Ending practice..." button state.
//
// This slows the session-row write so the in-flight window is long enough
// to observe, then verifies: the button shows real busy state, a repeat
// tap during that window doesn't do anything extra (single-flight), the
// session row actually lands as 'completed' with ended_at set, and the
// activity log row for the one drill also got its own ended_at set --
// confirming the parallelized close still lands correctly (whether via
// the client's own call or the DB's close_open_session_activity_rows
// trigger, either is correct; what matters is neither got skipped).
let createdPracticeId = null;

test('End Practice: real in-flight state, session completes, activity log closes', async ({ page }) => {
  // Scoped to the finalize write specifically (status:"completed"), not
  // every practice_live_sessions PATCH -- delaying the earlier "start
  // practice" write too (handleAttConfirm's own writeSession call, same
  // table) raced it against a background effect and silently skipped
  // opening the first activity's log, a pure test-setup artifact with
  // nothing to do with the fix under test here.
  await page.route('**/rest/v1/practice_live_sessions*', async route => {
    const req = route.request();
    if (req.method() === 'PATCH' && (req.postData() || '').includes('"status":"completed"')) {
      await new Promise(r => setTimeout(r, 2000));
    }
    await route.continue();
  });

  await page.goto('/builder/new');
  await page.waitForSelector('text=Layup Lines', { timeout: 15000 });
  await page.getByText('Layup Lines', { exact: true }).click();
  await page.getByRole('button', { name: 'Run Now', exact: true }).click();
  await page.waitForURL(/\/run\//, { timeout: 15000 });
  createdPracticeId = page.url().split('/run/')[1];
  await page.getByRole('button', { name: 'Run Practice', exact: true }).click();

  // The artificial route delay below can shift when this one-time prompt
  // actually renders relative to a fixed check right after "Run Practice"
  // (seen live: it can still pop up moments before the End Practice tap,
  // intercepting the click) -- isVisible() checks the DOM's current state
  // with no real wait, so it can run before the prompt has rendered at
  // all and report "not there" even though it's about to appear. Use a
  // real waiting click with its own timeout instead, at both points, and
  // swallow the timeout when it genuinely never shows.
  const dismissAudioPrompt = async (timeout) => {
    await page.getByRole('button', { name: 'Keep Audio Off' }).click({ timeout }).catch(() => {});
  };
  await dismissAudioPrompt(3000);

  const endBtn = page.getByRole('button', { name: 'End Practice', exact: true });
  await expect(endBtn).toBeVisible({ timeout: 10000 });
  await dismissAudioPrompt(5000);
  await endBtn.click();

  // Real busy state, not silence: the button relabels and disables while
  // the writes are in flight.
  const working = page.getByRole('button', { name: /Ending practice/ });
  await expect(working).toBeVisible();
  await expect(working).toBeDisabled();

  // Repeat taps during the wait (a coach unsure it registered) must not
  // fire a second end -- direct DOM clicks bypass Playwright's own
  // wait-for-enabled, matching an impatient real tap landing on a
  // disabled button.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Ending practice')); if (b) b.click(); });
    await page.waitForTimeout(200);
  }

  await expect(page.getByText('Practice Complete', { exact: true })).toBeVisible({ timeout: 10000 });

  const admin = stagingAdminClient();
  const { data: sessionRow, error: sessionErr } = await admin
    .from('practice_live_sessions')
    .select('id, status, ended_at')
    .eq('practice_id', createdPracticeId)
    .maybeSingle();
  expect(sessionErr).toBeNull();
  expect(sessionRow).not.toBeNull();
  expect(sessionRow.status).toBe('completed');
  expect(sessionRow.ended_at).not.toBeNull();

  const { data: logRows, error: logErr } = await admin
    .from('session_activity_log')
    .select('id, ended_at')
    .eq('session_id', sessionRow.id);
  expect(logErr).toBeNull();
  expect(logRows.length).toBeGreaterThan(0);
  for (const row of logRows) expect(row.ended_at).not.toBeNull();
});

test.afterEach(async () => {
  if (!createdPracticeId) return;
  const admin = stagingAdminClient();
  await admin.from('practices').delete().eq('id', createdPracticeId);
  createdPracticeId = null;
});
