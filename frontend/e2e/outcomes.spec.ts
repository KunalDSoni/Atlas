import { test, expect } from '@playwright/test';
import { assertNoCrash, login } from './helpers';

test.describe('product outcomes', () => {
  test('reviews a launched feature against its declared measure', async ({ page }) => {
    await login(page);
    await page.goto('/product/outcomes');

    await expect(page.getByRole('heading', { name: 'Outcomes' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Audit log export' })).toBeVisible();
    await expect(page.getByText('Weekly time spent preparing audit exports')).toBeVisible();
    await expect(page.getByText('Under 1 hour per week')).toBeVisible();
    await expect(page.getByText('Review due')).toBeVisible();
    await expect(page.getByText('Scheduled audit exports still need a date filter')).toBeVisible();

    await page.getByRole('button', { name: 'Review launch' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Review Audit log export' })).toBeVisible();
    await dialog.getByLabel('Measured result').fill('45 minutes per week');
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Partially achieved' }).click();
    await dialog.getByLabel('Review notes').fill('The time target was met, but date filtering still needs follow-up.');
    await dialog.getByRole('button', { name: 'Save review' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('Partially achieved')).toBeVisible();
    await expect(page.getByText('Measured: 45 minutes per week')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit review' })).toBeVisible();
    await expect(page.getByText('Review due')).toBeHidden();
    await assertNoCrash(page);
  });
});
