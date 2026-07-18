import { test, expect, type Page } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

// Note: the app holds a persistent SSE connection, so we never wait for
// 'networkidle' — we wait for concrete elements instead.

async function authHeaders(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('atlas_token'));
  expect(token).toBeTruthy();
  return { 'x-auth-token': token as string, 'Content-Type': 'application/json' };
}

test.describe('flow metrics', () => {
  test('reports screen shows the flow panels', async ({ page }) => {
    await login(page);
    const headers = await authHeaders(page);

    // The flow panels only render when history exists; seed one board move so
    // "since tracking began" has at least one recorded transition.
    const projects = await (await page.request.get('/api/projects', { headers })).json();
    const issues = await (await page.request.get(`/api/projects/${projects[0].id}/issues`, { headers })).json();
    const target = issues.find((i: { type: string; status: string }) => i.type !== 'epic' && i.status === 'todo');
    if (target) {
      await page.request.put(`/api/issues/${target.id}/move`, { headers, data: { status: 'in_progress' } });
    }

    await page.goto('/reports');
    await expect(page.getByText('Time in status').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Cumulative flow').first()).toBeVisible();
    await assertNoCrash(page);
  });
});

test.describe('jql macro', () => {
  test('a [jql:] block renders a live issue table', async ({ page }) => {
    await login(page);
    const headers = await authHeaders(page);
    const spaces = await (await page.request.get('/api/wiki/spaces', { headers })).json();
    const created = await (await page.request.post(`/api/wiki/spaces/${spaces[0].id}/pages`, {
      headers,
      data: { title: 'E2E jql fixture', body: '<p>[jql: type = task]</p>' },
    })).json();

    await page.goto(`/wiki/page/${created.id}`);
    const block = page.locator('.wiki-jql-block');
    await expect(block.locator('table')).toBeVisible({ timeout: 15_000 });
    await expect(block.locator('.wiki-issue-chip').first()).toBeVisible();
    await assertNoCrash(page);

    await page.request.delete(`/api/wiki/pages/${created.id}`, { headers });
  });

  test('a bad query renders an inline error, not silence', async ({ page }) => {
    await login(page);
    const headers = await authHeaders(page);
    const spaces = await (await page.request.get('/api/wiki/spaces', { headers })).json();
    const created = await (await page.request.post(`/api/wiki/spaces/${spaces[0].id}/pages`, {
      headers,
      data: { title: 'E2E jql error fixture', body: '<p>[jql: nofield = 1]</p>' },
    })).json();

    await page.goto(`/wiki/page/${created.id}`);
    await expect(page.getByText(/JQL error/).first()).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);

    await page.request.delete(`/api/wiki/pages/${created.id}`, { headers });
  });
});
