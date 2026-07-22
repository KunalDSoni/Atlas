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
