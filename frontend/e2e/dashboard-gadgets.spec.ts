import { test, expect } from '@playwright/test';
import { assertNoCrash, login } from './helpers';

test.describe('customizable dashboard gadgets', () => {
  test('saves gadget order, width and visibility across a reload', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dashboard-gadget-summary')).toBeVisible();
    await expect(page.getByTestId('dashboard-gadget-active_sprint')).toBeVisible();

    await page.getByRole('button', { name: 'Customize' }).click();
    await page.getByRole('button', { name: 'Add gadget' }).click();
    await page.getByRole('button', { name: 'Add Priority breakdown gadget' }).click();
    await expect(page.getByTestId('dashboard-gadget-priority_breakdown')).toBeVisible();

    await page.getByRole('button', { name: 'Remove Active sprint' }).click();
    const movePriorityUp = page.getByRole('button', { name: 'Move Priority breakdown up' });
    await movePriorityUp.click();
    await movePriorityUp.click();
    await movePriorityUp.click();
    await page.getByRole('button', { name: 'Make Project snapshot half width' }).click();
    await page.getByRole('button', { name: 'Save layout' }).click();
    await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
    const gadgets = page.locator('[data-testid^="dashboard-gadget-"]');
    await expect(gadgets).toHaveCount(4);
    await expect(gadgets.first()).toHaveAttribute('data-testid', 'dashboard-gadget-priority_breakdown');
    await expect(page.getByTestId('dashboard-gadget-active_sprint')).toHaveCount(0);

    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('button', { name: 'Make Project snapshot full width' })).toBeVisible();

    // Leave the shared E2E user on the product default for the rest of the suite.
    await page.getByRole('button', { name: 'Reset' }).click();
    await page.getByRole('button', { name: 'Save layout' }).click();
    await expect(page.getByTestId('dashboard-gadget-active_sprint')).toBeVisible();
    await assertNoCrash(page);
  });
});
