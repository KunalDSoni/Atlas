import { test, expect } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

// Note: the app holds a persistent SSE connection, so we never wait for
// 'networkidle' — we wait for concrete elements instead.

test.describe('board', () => {
  test('renders status columns', async ({ page }) => {
    await login(page);
    await page.goto('/board');
    await expect(page.getByText(/To Do|In Progress|Done/i).first()).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);
  });
});

test.describe('wiki', () => {
  test('opens a space and reads a page', async ({ page }) => {
    await login(page);
    await page.goto('/wiki');
    const spaceLink = page.locator('a[href^="/wiki/space/"]').first();
    await expect(spaceLink).toBeVisible({ timeout: 15_000 });
    await spaceLink.click();
    const pageLink = page.locator('a[href^="/wiki/page/"]').first();
    await expect(pageLink).toBeVisible({ timeout: 15_000 });
    await pageLink.click();
    await expect(page.locator('.wiki-prose').first()).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);
  });
});

test.describe('product', () => {
  test('features table lists seeded features', async ({ page }) => {
    await login(page);
    await page.goto('/product/features');
    await expect(page.getByText('SAML single sign-on')).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);
  });
});

test.describe('settings', () => {
  test('developer card exposes API tokens and webhooks', async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await expect(page.getByText('Developer')).toBeVisible({ timeout: 15_000 });
    // The token-name input and webhook URL input are unambiguous anchors for
    // the two Developer sub-sections.
    await expect(page.getByPlaceholder(/Token name/)).toBeVisible();
    await expect(page.getByPlaceholder(/your-server\.com/)).toBeVisible();
    await assertNoCrash(page);
  });
});
