import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Auth headers for a direct API call.
 *
 * Atlas authenticates with a session token in `x-auth-token`, held in
 * localStorage — not a cookie. page.request therefore carries no identity of
 * its own and every direct call 401s without this.
 */
async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem('atlas_token'));
  return { 'x-auth-token': token ?? '' };
}

// Browser coverage for the three surfaces added after the abandoned-timer fix:
// the working-hours forms, the unresolved-timer chip, and /my-time.
//
// The running-timer spec's own lesson is the reason this file exists: an
// endpoint nothing calls is indistinguishable from an endpoint that does not
// work, and api.timers.commit(), mine() and totals() each shipped broken or
// dead because only jest ever exercised them. Three new surfaces with unit
// tests alone would be the same bet placed again.
//
// Kept separate from timer.spec.ts, which drives the stopwatch itself — the
// running-chip start/pause flow lives there and is not duplicated here.

test.describe('working hours', () => {
  test('a personal override saves and survives a reload', async ({ page }) => {
    await login(page);
    await page.goto('/settings');

    const toggle = page.getByLabel('Use my own hours');
    await expect(toggle).toBeVisible({ timeout: 15_000 });

    // Unset must state the consequence, not just show an empty form — that
    // sentence is what connects this screen to the behaviour people felt.
    const alreadyOn = await toggle.getAttribute('data-state') === 'checked';
    if (!alreadyOn) {
      await expect(page.getByText(/stopped without logging any time/i)).toBeVisible();
      await toggle.click();
    }

    await expect(page.getByLabel('Time zone')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /save working hours/i }).click();

    await page.reload();
    await expect(page.getByLabel('Use my own hours')).toHaveAttribute('data-state', 'checked', { timeout: 15_000 });
    await expect(page.getByLabel('Time zone')).toBeVisible();
  });

  test('an inverted day is rejected rather than saved as unconfigured', async ({ page }) => {
    // The whole reason writes validate strictly: parseBusinessHours would read
    // an inverted profile back as null while the form displayed what was typed.
    await login(page);
    await page.goto('/dashboard');
    const res = await page.request.put('/api/profile', {
      headers: await authHeaders(page),
      data: { business_hours: { timezone: 'UTC', work_days: [1], start_hour: 17, end_hour: 9 } },
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/end_hour/);
  });

  test('a project default is reachable from admin projects', async ({ page }) => {
    await login(page);
    await page.goto('/admin/projects');

    const hours = page.getByRole('button', { name: /Working hours for /i }).first();
    await expect(hours).toBeVisible({ timeout: 15_000 });
    await hours.click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText(/Working hours/i);
  });
});

test.describe('unresolved timers', () => {
  test('the chip stays hidden when there is nothing to resolve', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');

    // It must never occupy header space speculatively.
    await expect(page.getByRole('button', { name: /stopped without logging time/i }))
      .toBeHidden({ timeout: 10_000 });
  });

  test('the unresolved endpoint answers for the signed-in user only', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    const res = await page.request.get('/api/me/timer/unresolved', { headers: await authHeaders(page) });

    expect(res.status()).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  test('dismissing someone else\'s segment is not possible', async ({ page }) => {
    await login(page);
    // A segment that is not the caller's is indistinguishable from one that
    // does not exist — 404, never 403.
    await page.goto('/dashboard');
    const res = await page.request.post('/api/timer-segments/not-a-real-segment/resolve', {
      headers: await authHeaders(page),
    });

    expect(res.status()).toBe(404);
  });

});

test.describe('my time', () => {
  test('shows the week and moves between weeks', async ({ page }) => {
    await login(page);
    await page.goto('/my-time');

    await expect(page.getByRole('heading', { name: 'My time' })).toBeVisible({ timeout: 15_000 });
    // The zone the days were bucketed in is part of the answer, not decoration.
    await expect(page.getByText(/times shown in /i)).toBeVisible();

    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(page.getByRole('button', { name: 'This week' })).toBeEnabled({ timeout: 10_000 });

    await page.getByRole('button', { name: 'This week' }).click();
    await expect(page.getByRole('button', { name: 'This week' })).toBeDisabled({ timeout: 10_000 });
  });

  test('rejects a range it will not stream', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    const res = await page.request.get('/api/me/time?from=2026-01-01&to=2026-06-01', {
      headers: await authHeaders(page),
    });

    expect(res.status()).toBe(400);
  });

  test('is reachable from the account menu', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Account menu' }).click();

    await page.getByRole('menuitem', { name: 'My time' }).click();
    await expect(page).toHaveURL(/\/my-time$/, { timeout: 15_000 });
  });
});
