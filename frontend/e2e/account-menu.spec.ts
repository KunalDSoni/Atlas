import { test, expect } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

// This menu is hand-positioned rather than popper-positioned because every
// Radix DropdownMenu in this app currently renders off-screen. These tests
// assert it is actually WITHIN the viewport — a menu that exists in the DOM but
// sits at negative coordinates is exactly the bug this replaced.

test.describe('account menu', () => {
  test('opens on screen with Settings reachable', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await page.waitForSelector('text=Total issues', { timeout: 15_000 });

    await page.locator('button[aria-label="Account menu"]').click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu).toBeVisible({ timeout: 10_000 });

    const box = await menu.boundingBox();
    const vp = page.viewportSize()!;
    expect(box).not.toBeNull();
    // Fully inside the viewport, not merely present in the DOM.
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);

    await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Profile' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await assertNoCrash(page);
  });

  test('Settings navigates to the settings screen', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await page.waitForSelector('text=Total issues', { timeout: 15_000 });
    await page.locator('button[aria-label="Account menu"]').click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/);
    await assertNoCrash(page);
  });

  test('an admin gets the Administration group; the menu closes on Escape', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await page.waitForSelector('text=Total issues', { timeout: 15_000 });
    await page.locator('button[aria-label="Account menu"]').click();

    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu.getByText('Administration')).toBeVisible();
    for (const label of ['Overview', 'Users', 'Projects', 'Audit log']) {
      await expect(menu.getByRole('menuitem', { name: label })).toBeVisible();
    }

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await page.locator('button[aria-label="Account menu"]').click();
    await page.getByRole('menuitem', { name: 'Users' }).click();
    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(page.getByRole('button', { name: 'Create user' }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('a non-admin sees no Administration group', async ({ page }) => {
    await login(page, 'priya@example.com', 'password123');
    await page.goto('/dashboard');
    await page.locator('button[aria-label="Account menu"]').click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await expect(menu.getByText('Administration')).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  });
});
