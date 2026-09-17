import { expect, test } from '@playwright/test';
import { assertNoCrash } from './helpers';

test.describe('sample-data demo', () => {
  test('opens straight into the app, with no sign-in', async ({ page }) => {
    await page.goto('/demo/');
    await expect(page).toHaveURL(/\/demo\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.locator('#email')).toHaveCount(0);
    await assertNoCrash(page);
  });

  test('a moved card stays moved until reload', async ({ page }) => {
    await page.goto('/demo/atl/board');
    // Board columns are <section aria-label={status label}>; cards carry data-issue-key.
    const todo = page.locator('section[aria-label="To Do"]');
    const review = page.locator('section[aria-label="In Review"]');
    const first = todo.locator('[data-issue-key]').first();
    await expect(first).toBeVisible();
    const key = await first.getAttribute('data-issue-key');
    // Pinned by key: once it moves, "first card in To Do" is a different card.
    const card = page.locator(`[data-issue-key="${key}"]`);

    // Dispatched rather than card.dragTo(): Playwright's mouse-driven drag never
    // fires this board's HTML5 dragstart/drop, so dragTo silently moves nothing.
    // Separate round trips let React re-render between dragstart and drop, which
    // the drop handler needs (it reads the dragged id from state).
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent('dragstart', { dataTransfer });
    await review.dispatchEvent('dragover', { dataTransfer });
    await review.dispatchEvent('drop', { dataTransfer });
    await card.dispatchEvent('dragend', { dataTransfer });
    await expect(review.locator(`[data-issue-key="${key}"]`)).toBeVisible();

    // Leave and come back inside the app — a page load would reset the demo.
    await page.locator('a[href="/demo/atl/backlog"]').first().click();
    await expect(page).toHaveURL(/\/demo\/atl\/backlog/);
    await page.locator('a[href="/demo/atl/board"]').first().click();
    await expect(page.locator(`section[aria-label="In Review"] [data-issue-key="${key}"]`)).toBeVisible();
  });

  test('never touches a real session on the same origin', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('atlas_token', 'real-session');
      localStorage.setItem('atlas_last_project', 'real-project');
    });
    await page.goto('/demo/atl/board');
    await expect(page.locator('[data-issue-key]').first()).toBeVisible();
    expect(await page.evaluate(() => [localStorage.getItem('atlas_token'), localStorage.getItem('atlas_last_project')]))
      .toEqual(['real-session', 'real-project']);
  });
});
