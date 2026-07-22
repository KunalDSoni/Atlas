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
    await page.goto('/atlas/board');       // establishes the remembered project
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
