import { expect, test } from '@playwright/test';
import { assertNoCrash, login } from './helpers';

test.describe('landing page', () => {
  test('an anonymous visitor gets marketing, not a login form', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 }))
      .toContainText('Your backlog and your roadmap');
    await expect(page.getByRole('link', { name: /try the live demo/i }).first()).toHaveAttribute('href', '/demo/');
    await assertNoCrash(page);
  });

  test('exactly one h1 on the page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('the product frame runs the demo, and its tabs drive it', async ({ page }) => {
    await page.goto('/');

    const board = page.getByRole('tab', { name: 'Board' });
    const roadmap = page.getByRole('tab', { name: 'Roadmap' });
    await expect(board).toHaveAttribute('aria-selected', 'true');

    const frame = page.frameLocator('#frame-panel iframe');
    await expect(frame.locator('[data-issue-key]').first()).toBeVisible();
    const demo = () => page.frames().find((f) => f.url().includes('/demo/'))?.url() ?? '';
    await expect.poll(demo).toContain('/demo/atl/board');

    await roadmap.click();
    await expect(roadmap).toHaveAttribute('aria-selected', 'true');
    await expect(board).toHaveAttribute('aria-selected', 'false');
    await expect.poll(demo).toContain('/demo/product/roadmap');
  });

  test('the capability filter narrows the list and recovers', async ({ page }) => {
    await page.goto('/');

    const search = page.getByLabel(/search capabilities/i);
    const items = page.locator('#capabilities li');

    // `/` waits on the auth check and then lazy-loads the landing chunk, so for
    // the first frames the page is a Suspense spinner with no list at all.
    // locator.count() snapshots without retrying and reads 0 there, which is
    // how this passed locally and failed on the colder CI runner. The assertion
    // has to be the thing that waits — never a bare count().
    const total = 165;
    await expect(items).toHaveCount(total);

    await search.fill('sprint');
    // Same hazard: wait for the filter to actually shrink the list before
    // snapshotting its length.
    await expect(items).not.toHaveCount(total);
    const filtered = await items.count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(total);

    await search.fill('zzzznotathing');
    await expect(page.getByText('No capability matches that.')).toBeVisible();

    await search.fill('');
    await expect(items).toHaveCount(total);
  });

  test('a signed-in user is sent to the dashboard instead', async ({ page }) => {
    test.skip(!!process.env.ATLAS_EMPTY, 'no seeded user in the empty fixture');

    await login(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { level: 1, name: /your backlog/i })).toHaveCount(0);
  });
});
