/**
 * MENTION WORKFLOW E2E
 *
 * Drives the real @ picker in a real browser: type '@', see the list, choose a
 * person, post, see the badge, and confirm the person was notified.
 *
 * The suite this replaces wrapped every assertion in `if (await x.isVisible())`
 * and asserted things like `expect(count).toBeGreaterThanOrEqual(0)`, so it
 * passed while the feature was completely dead. Nothing here is conditional.
 */
import { test, expect, type Page } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

/** The session token the SPA stored at login, for driving the API directly. */
async function authToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('atlas_token'));
  expect(token, 'login should have stored a session token').toBeTruthy();
  return token as string;
}

async function apiContext(page: Page) {
  const token = await authToken(page);
  const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };
  const projects = await (await page.request.get('/api/projects', { headers })).json();
  return { headers, project: projects[0] };
}

test.describe('mentions', () => {
  test('typing @ offers members, and picking one posts a resolved badge', async ({ page }) => {
    await login(page);
    const { headers, project } = await apiContext(page);

    const issues = await (await page.request.get(
      `/api/projects/${project.id}/issues`, { headers })).json();
    const issue = issues.find((i: { type: string }) => i.type !== 'epic') ?? issues[0];

    await page.goto(`/${project.key}/${issue.issue_key}`);

    const composer = page.getByPlaceholder('Add a comment…');
    await expect(composer).toBeVisible({ timeout: 15_000 });

    // The composer must fill its row. It previously collapsed to a narrow
    // column because the picker wrapped it in an unsized div.
    const box = await composer.boundingBox();
    expect(box, 'comment box should be laid out').toBeTruthy();
    expect(box!.width).toBeGreaterThan(200);

    await composer.click();
    await composer.pressSequentially('Ping ');
    await composer.pressSequentially('@Sa');

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 15_000 });

    const option = page.getByRole('option').first();
    const picked = (await option.textContent()) ?? '';
    expect(picked).toContain('Sarah');
    await option.click();

    // The stored form is a token; the composer shows exactly what will be saved.
    await expect(composer).toHaveValue(/@\[Sarah Chen\]\(user:[\w-]+\)/);

    await page.getByRole('button', { name: 'Post comment' }).click();

    const badge = page.locator('.mention', { hasText: 'Sarah Chen' });
    await expect(badge).toBeVisible({ timeout: 15_000 });
    // Rendered, not raw: the reader never sees token syntax.
    await expect(page.getByText('](user:')).toHaveCount(0);
    await assertNoCrash(page);
  });

  test('an email address does not open the picker', async ({ page }) => {
    await login(page);
    const { headers, project } = await apiContext(page);
    const issues = await (await page.request.get(
      `/api/projects/${project.id}/issues`, { headers })).json();
    const issue = issues.find((i: { type: string }) => i.type !== 'epic') ?? issues[0];

    await page.goto(`/${project.key}/${issue.issue_key}`);
    const composer = page.getByPlaceholder('Add a comment…');
    await expect(composer).toBeVisible({ timeout: 15_000 });

    await composer.click();
    await composer.pressSequentially('write to sarah@example');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await assertNoCrash(page);
  });

  test('a mention notifies the person mentioned', async ({ page }) => {
    await login(page);
    const { headers, project } = await apiContext(page);

    const users = await (await page.request.get('/api/users', { headers })).json();
    const sarah = users.find((u: { email: string }) => u.email === 'sarah@example.com');
    expect(sarah, 'seeded Sarah Chen should exist').toBeTruthy();

    const issues = await (await page.request.get(
      `/api/projects/${project.id}/issues`, { headers })).json();
    const issue = issues.find((i: { type: string }) => i.type !== 'epic') ?? issues[0];

    await page.request.post(`/api/issues/${issue.id}/comments`, {
      headers,
      data: { body: `Please look @[Sarah Chen](user:${sarah.id})` },
    });

    // Sarah's own session is the only one that can read her notifications.
    const sarahLogin = await (await page.request.post('/api/auth/login', {
      data: { email: 'sarah@example.com', password: 'password123' },
    })).json();
    const sarahHeaders = { 'x-auth-token': sarahLogin.token, 'Content-Type': 'application/json' };
    const after = await (await page.request.get('/api/notifications', { headers: sarahHeaders })).json();

    const mentions = (after.notifications ?? after).filter(
      (n: { type: string }) => n.type === 'mention');
    expect(mentions.length).toBeGreaterThan(0);
    expect(mentions[0].message).toContain('mentioned you');
  });

  test('a mention in a wiki page body renders as a badge', async ({ page }) => {
    await login(page);
    const token = await authToken(page);
    const headers = { 'x-auth-token': token, 'Content-Type': 'application/json' };

    const users = await (await page.request.get('/api/users', { headers })).json();
    const sarah = users.find((u: { email: string }) => u.email === 'sarah@example.com');
    const spaces = await (await page.request.get('/api/wiki/spaces', { headers })).json();

    const created = await (await page.request.post(`/api/wiki/spaces/${spaces[0].id}/pages`, {
      headers,
      data: {
        title: 'E2E mention fixture',
        body: `<p>Owner: <span data-mention-id="${sarah.id}">@Sarah Chen</span></p>`,
      },
    })).json();

    await page.goto(`/wiki/page/${created.id}`);
    const badge = page.locator('.mention', { hasText: 'Sarah Chen' });
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);
  });
});
