import { test, expect } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

test.describe('JQL v2 queue editor', () => {
  test('shows the server parse error inline with field help', async ({ page }) => {
    await login(page);
    await page.goto('/hd/servicedesk');
    await expect(page.getByRole('heading', { name: 'Queues' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'New queue' }).click();
    await page.getByLabel('Name').fill('Invalid JQL fixture');
    const query = page.getByLabel('Query');
    await query.fill('type = request AND sla = brached');
    await page.getByRole('button', { name: 'Create queue' }).click();

    const error = page.getByRole('alert');
    await expect(error).toContainText('Invalid value "brached" for "sla"');
    await expect(error).toContainText(/column \d+/);
    await expect(query).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(/waiting_for_customer/)).toBeVisible();
    await expect(page.getByText(/Operators:.*NOT IN.*IS EMPTY/)).toBeVisible();
    await assertNoCrash(page);
  });
});
