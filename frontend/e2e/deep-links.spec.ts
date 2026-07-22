import { test, expect } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

test.describe('project-scoped URLs', () => {
  test('the board lives under its project key', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    await expect(page).toHaveURL(/\/atlas\/board/);
    await assertNoCrash(page);
  });

  test('a bare project key lands on the board', async ({ page }) => {
    await login(page);
    await page.goto('/atlas');
    await expect(page).toHaveURL(/\/atlas\/board/);
  });

  test('an unknown project key says so instead of silently redirecting', async ({ page }) => {
    await login(page);
    await page.goto('/nosuchproject/board');
    await expect(page.getByText(/project not found/i)).toBeVisible();
  });
});

test.describe('legacy URLs keep working', () => {
  test('a bare legacy screen redirects to the remembered project', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    // goto() resolves on load, but the project is remembered in an effect after
    // the project list arrives. Wait for the sidebar to prove ATLAS is current,
    // or this races the fallback to the first project.
    await expect(page.getByRole('link', { name: 'Backlog' })).toHaveAttribute('href', '/atlas/backlog');

    await page.goto('/backlog');
    await expect(page).toHaveURL(/\/atlas\/backlog/);
  });
});

test.describe('navigation carries the project', () => {
  // Asserting on the href, not on the URL after clicking: a bare /backlog link
  // still LANDS on /atlas/backlog via the legacy redirect, so only the href
  // proves the sidebar itself carries the project.
  test('sidebar links are project-scoped', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    await expect(page.getByRole('link', { name: 'Backlog' })).toHaveAttribute('href', '/atlas/backlog');
    await page.getByRole('link', { name: 'Backlog' }).click();
    await expect(page).toHaveURL(/\/atlas\/backlog/);
  });

  test('switching project rewrites the URL and keeps the screen', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/backlog');
    await page.getByRole('button', { name: 'Switch project' }).click();
    await page.getByRole('menuitem').filter({ hasNotText: /atlas development/i }).first().click();
    await expect(page).toHaveURL(/\/[a-z0-9-]+\/backlog/);
    await expect(page).not.toHaveURL(/\/atlas\/backlog/);
  });
});

test.describe('an issue is a place', () => {
  test('clicking a card pushes its URL and opens the drawer', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    const card = page.locator('[data-issue-key]').first();
    const key = await card.getAttribute('data-issue-key');
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/atlas/${key}$`));
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('back closes the drawer and returns to the board', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    await page.locator('[data-issue-key]').first().click();
    await page.goBack();
    await expect(page).toHaveURL(/\/atlas\/board/);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('the same URL opened cold renders a full page, not a drawer', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    const key = await page.locator('[data-issue-key]').first().getAttribute('data-issue-key');
    await page.goto(`/atlas/${key}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(key!, { exact: false }).first()).toBeVisible();
    await assertNoCrash(page);
  });

  test('an unknown issue key says so', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/ATLAS-999999');
    await expect(page.getByText(/issue not found/i)).toBeVisible();
  });

  // Deferred from the legacy-redirect task: needs data-issue-id on the card.
  test('an old ?issue=<uuid> link resolves to the permanent URL', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/board');
    const card = page.locator('[data-issue-key]').first();
    const key = await card.getAttribute('data-issue-key');
    const id = await card.getAttribute('data-issue-id');
    await page.goto(`/board?issue=${id}`);
    await expect(page).toHaveURL(new RegExp(`/atlas/${key}`));
  });
});

test.describe('sprints and releases are places', () => {
  test('a sprint row opens its own URL', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/sprints');
    await page.getByRole('button', { name: 'New sprint' }).first().click();
    await page.getByLabel('Name').fill('Q3 Hardening');
    await page.getByRole('button', { name: 'Create sprint' }).click();
    await page.locator('[data-sprint-slug]').first().click();
    await expect(page).toHaveURL(/\/atlas\/sprints\/[a-z0-9-]+/);
    await assertNoCrash(page);
  });

  test('a release row opens its own URL', async ({ page }) => {
    await login(page);
    await page.goto('/atlas/releases');
    await page.getByRole('button', { name: 'New version' }).click();
    await page.getByLabel('Name').fill('Q3 Hardening');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.locator('[data-release-slug]').first().click();
    await expect(page).toHaveURL(/\/atlas\/releases\/[a-z0-9-]+/);
    await assertNoCrash(page);
  });
});
