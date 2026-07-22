import { test, expect, type Page } from '@playwright/test';
import { assertNoCrash, login } from './helpers';

async function authHeaders(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('atlas_token'));
  expect(token).toBeTruthy();
  return { 'x-auth-token': token as string, 'Content-Type': 'application/json' };
}

test.describe('personal JQL saved filters', () => {
  test('runs, saves, reloads, edits and deletes a project filter', async ({ page }) => {
    await login(page);
    const headers = await authHeaders(page);
    const projects = await (await page.request.get('/api/projects', { headers })).json();
    const atlas = projects.find((project: { key: string }) => project.key === 'ATLAS');
    const created = await (await page.request.post(`/api/projects/${atlas.id}/issues`, {
      headers,
      data: { title: 'Epic 55 filter fixture', type: 'bug', priority: 'high' },
    })).json();

    try {
      await page.goto('/atlas/filters');
      await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible({ timeout: 15_000 });

      await page.getByLabel('Name').fill('Epic 55 active bugs');
      const query = page.getByLabel('JQL query');

      // Preview errors come from the same server parser used during save.
      await query.fill('type = bug AND sla = brached');
      await page.getByRole('button', { name: 'Run query' }).click();
      await expect(page.getByRole('alert')).toContainText(/brached.*column/i);
      await expect(query).toHaveAttribute('aria-invalid', 'true');

      await query.fill('type = bug AND priority = high');
      await page.getByRole('button', { name: 'Run query' }).click();
      await expect(page.getByText('Epic 55 filter fixture')).toBeVisible();
      await page.getByRole('button', { name: 'Save filter' }).click();
      await expect(page.getByRole('button', { name: /Epic 55 active bugs/ })).toBeVisible();

      await page.reload();
      await expect(page.getByLabel('Name')).toHaveValue('Epic 55 active bugs');
      await expect(page.getByLabel('JQL query')).toHaveValue('type = bug AND priority = high');
      await expect(page.getByText('Epic 55 filter fixture')).toBeVisible({ timeout: 15_000 });

      await page.getByLabel('Name').fill('Epic 55 high-priority bugs');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByRole('button', { name: /Epic 55 high-priority bugs/ })).toBeVisible();

      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toContainText('Epic 55 high-priority bugs');
      await page.getByRole('button', { name: 'Delete filter' }).click();
      await expect(page.getByRole('button', { name: /Epic 55 high-priority bugs/ })).toHaveCount(0);
      await expect(page.getByText('Your JQL filters will appear here.')).toBeVisible();
      await assertNoCrash(page);
    } finally {
      await page.request.delete(`/api/issues/${created.id}`, { headers });
    }
  });
});
