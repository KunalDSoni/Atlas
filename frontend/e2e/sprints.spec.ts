import { expect, test } from '@playwright/test';
import { assertNoCrash, login } from './helpers';

// A sprint created from the UI lands in the DB with the column default status
// ('planning'). The screen groups sprints by status, so any vocabulary drift
// between the frontend and the DB makes a freshly created sprint vanish: it
// matches no group, and the zero-state is suppressed because the list is not
// empty. That combination renders a blank page after a success toast.
test('a newly created sprint appears on the sprints screen', async ({ page }) => {
  await login(page);
  await page.goto('/sprints');
  await assertNoCrash(page);

  const name = `E2E Sprint ${Date.now()}`;
  await page.getByRole('button', { name: 'New sprint' }).first().click();
  await page.locator('#sprint-name').fill(name);
  await page.getByRole('button', { name: 'Create sprint' }).click();

  await expect(page.getByText(name)).toBeVisible();
});

test('a sprint can be moved through its statuses from the card', async ({ page }) => {
  await login(page);
  await page.goto('/sprints');

  const name = `E2E Status ${Date.now()}`;
  await page.getByRole('button', { name: 'New sprint' }).first().click();
  await page.locator('#sprint-name').fill(name);
  await page.getByRole('button', { name: 'Create sprint' }).click();
  await expect(page.getByText(name)).toBeVisible();

  // The status the card offers must be one the API accepts: the sprints table
  // has a CHECK constraint, so an unknown value is a 500, not a no-op.
  await page.getByRole('combobox', { name: `Status for ${name}` }).click();
  await page.getByRole('option', { name: 'active' }).click();

  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText('Could not update sprint')).toHaveCount(0);
});
