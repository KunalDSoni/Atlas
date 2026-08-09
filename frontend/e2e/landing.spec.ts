import { expect, test } from '@playwright/test';
import { assertNoCrash, login } from './helpers';

test.describe('landing page', () => {
  test('an anonymous visitor gets marketing, not a login form', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 }))
      .toContainText('Your backlog and your roadmap');
    await expect(page.getByRole('button', { name: /try the live demo/i }).first()).toBeVisible();
    await assertNoCrash(page);
  });

  test('exactly one h1 on the page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('the product frame tabs switch panels', async ({ page }) => {
    await page.goto('/');

    const board = page.getByRole('tab', { name: 'Board' });
    const roadmap = page.getByRole('tab', { name: 'Roadmap' });

    await expect(board).toHaveAttribute('aria-selected', 'true');

    await roadmap.click();
    await expect(roadmap).toHaveAttribute('aria-selected', 'true');
    await expect(board).toHaveAttribute('aria-selected', 'false');
    // Scoped to the frame panel: "Enterprise readiness" is also a pillar
    // heading further down in the capability index, so an unscoped locator
    // is ambiguous even though the panel itself is correct. Within the panel
    // itself the roadmap row renders the theme name twice (row label + bar
    // label), hence .first().
    await expect(page.locator('#frame-panel').getByText('Enterprise readiness').first()).toBeVisible();
  });

  test('the capability filter narrows the list and recovers', async ({ page }) => {
    await page.goto('/');

    const search = page.getByLabel(/search capabilities/i);
    const items = page.locator('#capabilities li');

    const total = await items.count();
    expect(total).toBe(165);

    await search.fill('sprint');
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
