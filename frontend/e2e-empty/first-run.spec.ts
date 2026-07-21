import { expect, test } from '@playwright/test';
import { assertNoCrash, login } from '../e2e/helpers';

// A brand-new deployment has an admin and zero projects. Every project screen
// short-circuits to "No project selected" in that state, so the only thing
// standing between a fresh install and an unusable app is whether the zero
// state hands the user a way to create the first project.

test.beforeEach(async ({ page }) => {
  await login(page, 'admin@atlas.local', 'changeme123');
});

test('the dashboard zero state offers a way to create the first project', async ({ page }) => {
  await assertNoCrash(page);
  await expect(page.getByText('No project selected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create project' })).toBeVisible();
});

test('the project switcher stays reachable with zero projects', async ({ page }) => {
  const switcher = page.getByRole('button', { name: 'Switch project' });
  await expect(switcher).toBeVisible();

  await switcher.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Create project')).toBeVisible();

  // Regression cover for the popper bug in KNOWN-ISSUES.md: the menu must be
  // inside the viewport, not merely present in the DOM.
  const box = await menu.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
});

test('creating the first project from the zero state makes the app usable', async ({ page }) => {
  await page.getByRole('button', { name: 'Create project' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#pr-name').fill('First Project');
  await expect(dialog.locator('#pr-key')).toHaveValue('FIRS');
  await dialog.getByRole('button', { name: 'Create project' }).click();

  // The new project must become the active one without a manual reload.
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Switch project' })).toContainText('First Project');
  await expect(page.getByText('No project selected')).toBeHidden();

  // And the rest of the app must now work against it.
  await page.getByRole('link', { name: 'Board', exact: true }).click();
  await expect(page).toHaveURL(/\/board/);
  await expect(page.getByRole('button', { name: 'Create' })).toBeVisible();
  await assertNoCrash(page);
});
