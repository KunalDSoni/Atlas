import { test, expect, type Page } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

// Note: the app holds a persistent SSE connection, so we never wait for
// 'networkidle' — we wait for concrete elements instead.

/** The session token the SPA stored at login, for driving the API directly. */
async function authToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('atlas_token'));
  expect(token, 'login should have stored a session token').toBeTruthy();
  return token as string;
}

test.describe('wiki issue links', () => {
  test('a real issue key renders as a chip; clicking opens that issue', async ({ page }) => {
    await login(page);
    const token = await authToken(page);
    const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

    // Seeded wiki pages mention no real issues, so create the fixture we need:
    // grab a real issue key, then a page that mentions it.
    const projects = await (await page.request.get('/api/projects', { headers })).json();
    const issues = await (await page.request.get(`/api/projects/${projects[0].id}/issues`, { headers })).json();
    const issue = issues.find((i: { type: string }) => i.type !== 'epic') ?? issues[0];

    const spaces = await (await page.request.get('/api/wiki/spaces', { headers })).json();
    const created = await (await page.request.post(`/api/wiki/spaces/${spaces[0].id}/pages`, {
      headers,
      data: { title: 'E2E chip fixture', body: `<p>Tracking ${issue.issue_key} here.</p>` },
    })).json();

    await page.goto(`/wiki/page/${created.id}`);
    const chip = page.locator('.wiki-issue-chip', { hasText: issue.issue_key });
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.click();
    // One route serves every issue type now, and the project comes from the
    // key's prefix — so a chip is a link to the issue, not to a screen.
    await expect(page).toHaveURL(
      new RegExp(`/${projects[0].key}/${issue.issue_key}$`, 'i'), { timeout: 15_000 });
    await assertNoCrash(page);

    await page.request.delete(`/api/wiki/pages/${created.id}`, { headers });
  });

  test('a key that resolves to nothing stays prose (SEV-1 in the runbook)', async ({ page }) => {
    await login(page);
    const token = await authToken(page);
    const headers = { 'x-auth-token': token };

    // The seeded Incident Runbook mentions SEV-1/2/3 — severity labels, not
    // issues. Under the old client-side matching these rendered as chips that
    // navigated to an arbitrary search result.
    const results = await (await page.request.get('/api/wiki/search?q=Incident%20Runbook', { headers })).json();
    const runbook = results.find((p: { title: string }) => /incident runbook/i.test(p.title));
    expect(runbook, 'seeded Incident Runbook should exist').toBeTruthy();

    await page.goto(`/wiki/page/${runbook.id}`);
    await expect(page.getByText(/SEV-1/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.wiki-issue-chip', { hasText: 'SEV-1' })).toHaveCount(0);
    await assertNoCrash(page);
  });
});
