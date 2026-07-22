import { test, expect } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

// The sidebar nav is taller than the viewport for an admin (Project + Product +
// Administration + Knowledge). It lives in a ScrollArea inside a flex column,
// which only constrains itself if the flex child is allowed to shrink — a flex
// item's `min-height: auto` floor otherwise sizes it to its CONTENT, so the box
// grows past the bottom of the screen and Radix never sees an overflow to
// scroll. The bug that fails these assertions is a nav whose last sections are
// simply unreachable: no scrollbar, nothing below the fold.

test.describe('sidebar navigation', () => {
  test('scrolls to its last item at a short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await login(page);
    await page.waitForSelector('text=Total issues', { timeout: 15_000 });

    const viewport = page.locator('aside [data-slot="scroll-area-viewport"]');
    await expect(viewport).toBeVisible();

    // The scroll container must end inside the window, not past the fold.
    const box = (await viewport.boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect(box.y + box.height).toBeLessThanOrEqual(vh + 1);

    // ...and it must actually overflow, which is what makes it scrollable.
    const { scrollHeight, clientHeight } = await viewport.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    // The last nav item is reachable by scrolling the sidebar alone.
    const wiki = page.locator('aside').getByRole('link', { name: 'Wiki' });
    await viewport.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(wiki).toBeInViewport();
    await assertNoCrash(page);
  });

  test('does not push the sidebar past the bottom of the screen', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await login(page);
    await page.waitForSelector('text=Total issues', { timeout: 15_000 });

    // The sticky column is the full screen height; nothing inside it may exceed
    // that, or the overflow is clipped away with no way to reach it.
    const overflow = await page.locator('aside').evaluate((aside) => {
      const sticky = aside.firstElementChild as HTMLElement;
      return Math.round(sticky.scrollHeight - sticky.clientHeight);
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
