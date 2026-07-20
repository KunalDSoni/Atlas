import { test, expect } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

// Focus mode exists because the nav sidebar (240px) plus the page tree (236px)
// left the editor a cramped column. These assert the chrome actually collapses
// and — more importantly — that the user is never stranded without navigation.

test.describe('wiki focus mode', () => {
  test('editing hides both sidebars and restores them on cancel', async ({ page }) => {
    await login(page);
    await page.goto('/wiki');
    await page.locator('a[href^="/wiki/space/"]').first().click();
    await page.locator('a[href^="/wiki/page/"]').first().click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 15_000 });

    const navLink = page.getByRole('link', { name: 'Backlog' });
    const tree = page.locator('aside').first();
    await expect(navLink).toBeVisible();

    const widthBefore = await page.locator('.wiki-prose').first().evaluate((el) => el.clientWidth);

    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(navLink).toBeHidden({ timeout: 10_000 });
    await expect(tree).toBeHidden();

    const widthAfter = await page.locator('[role="textbox"]').first().evaluate((el) => el.clientWidth);
    console.log(`content width: ${widthBefore}px -> ${widthAfter}px`);
    expect(widthAfter).toBeGreaterThan(widthBefore);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(navLink).toBeVisible({ timeout: 10_000 });
    await assertNoCrash(page);
  });

  test('the focus toggle works while reading, and navigation stays reachable', async ({ page }) => {
    await login(page);
    await page.goto('/wiki');
    await page.locator('a[href^="/wiki/space/"]').first().click();
    await page.locator('a[href^="/wiki/page/"]').first().click();

    const toggle = page.getByRole('button', { name: 'Focus mode' });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await toggle.click();

    await expect(page.getByRole('link', { name: 'Backlog' })).toBeHidden({ timeout: 10_000 });
    // Collapsing the sidebar must not trap the user: the menu button reaches it.
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();

    await page.getByRole('button', { name: 'Show sidebars' }).click();
    await expect(page.getByRole('link', { name: 'Backlog' })).toBeVisible({ timeout: 10_000 });
    await assertNoCrash(page);
  });
});
