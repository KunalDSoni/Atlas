import { test, expect } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

// Radix popper menus were rendering at exactly -2x their own height — Radix's
// "not yet positioned" placeholder transform — because ui/button.tsx shipped
// without forwardRef on React 18, so trigger anchors were never measurable.
// These assert popper menus land INSIDE the viewport, which is the real symptom.

test.describe('project switcher', () => {
  test('opens on screen and switches the active project', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await page.waitForSelector('text=Total issues', { timeout: 15_000 });

    const trigger = page.getByRole('button', { name: 'Switch project' });
    // Read the current project BEFORE opening: Radix marks siblings aria-hidden
    // while a menu is open, so the trigger is unqueryable by role until it closes.
    const before = (await trigger.innerText()).trim();
    await trigger.click();

    const menu = page.getByRole('menu').first();
    await expect(menu).toBeVisible({ timeout: 10_000 });

    const box = await menu.boundingBox();
    const vp = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);

    // Pick a project other than the current one and confirm the switch sticks.
    const items = menu.getByRole('menuitem');
    const count = await items.count();
    expect(count).toBeGreaterThan(1);

    let clicked = false;
    for (let i = 0; i < count; i++) {
      const text = (await items.nth(i).innerText()).trim();
      if (!text.includes('current')) { await items.nth(i).click(); clicked = true; break; }
    }
    expect(clicked).toBe(true);
    // The switcher must now show a different project than it did before.
    await expect
      .poll(async () => (await trigger.innerText()).trim(), { timeout: 10_000 })
      .not.toBe(before);
    await assertNoCrash(page);
  });

  test('wiki page action menu also positions on screen', async ({ page }) => {
    await login(page);
    await page.goto('/wiki');
    await page.locator('a[href^="/wiki/space/"]').first().click();
    await page.locator('a[href^="/wiki/page/"]').first().click();

    const more = page.getByRole('button', { name: 'More actions' });
    await expect(more).toBeVisible({ timeout: 15_000 });
    await more.click();

    const menu = page.getByRole('menu').first();
    await expect(menu).toBeVisible({ timeout: 10_000 });
    const box = await menu.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await assertNoCrash(page);
  });
});
