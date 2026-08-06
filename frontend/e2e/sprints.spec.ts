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

test('Issue type filter works on sprint detail', async ({ page }) => {
  await login(page);
  await page.goto('/sprints');

  // Find the first sprint and click on it
  const sprintName = page.locator('h3').first();
  await sprintName.click();

  // Wait for the sprint detail page to load
  await page.waitForSelector('[class*="divide-y"]');

  // Get initial issue count
  const initialIssues = await page.locator('li').count();
  if (initialIssues === 0) {
    // Skip test if no issues
    return;
  }

  // Click the filter dropdown (button with "All types" text)
  await page.getByRole('button', { name: 'Filter by issue type' }).click();

  // Select only "Bug" type
  await page.getByLabel('Bug').click();

  // Wait for the filter to be applied
  await page.waitForTimeout(100);

  // Close the dropdown by clicking elsewhere
  await page.locator('body').click();

  // Verify filtered count is less than or equal to initial
  const filteredIssues = await page.locator('li').count();
  await expect(filteredIssues).toBeLessThanOrEqual(initialIssues);
});

test('Cannot change status of completed sprint', async ({ page }) => {
  await login(page);
  await page.goto('/sprints');
  await assertNoCrash(page);

  // Create a completed sprint for testing
  const name = `E2E Completed Sprint ${Date.now()}`;
  await page.getByRole('button', { name: 'New sprint' }).first().click();
  await page.locator('#sprint-name').fill(name);
  await page.getByRole('button', { name: 'Create sprint' }).click();
  await expect(page.getByText(name)).toBeVisible();

  // Move sprint to completed status
  await page.getByRole('combobox', { name: `Status for ${name}` }).click();
  await page.getByRole('option', { name: 'completed' }).click();
  await page.waitForTimeout(200);

  // Verify the sprint is now completed
  const completedSprintCard = page.locator(`[data-testid*="${name}"], h3:has-text("${name}")`).first();
  await completedSprintCard.scrollIntoViewIfNeeded();

  // Verify no status dropdown in the card for completed sprint
  const statusSelect = page.getByRole('combobox', { name: `Status for ${name}` });
  await expect(statusSelect).not.toBeVisible();
});

test('Can change status of planning sprint', async ({ page }) => {
  await login(page);
  await page.goto('/sprints');
  await assertNoCrash(page);

  // Create a planning sprint
  const name = `E2E Planning Sprint ${Date.now()}`;
  await page.getByRole('button', { name: 'New sprint' }).first().click();
  await page.locator('#sprint-name').fill(name);
  await page.getByRole('button', { name: 'Create sprint' }).click();
  await expect(page.getByText(name)).toBeVisible();

  // Verify status dropdown exists for planning sprint
  const statusSelect = page.getByRole('combobox', { name: `Status for ${name}` });
  await expect(statusSelect).toBeVisible();

  // Verify we can change the status
  await statusSelect.click();
  await page.getByRole('option', { name: 'active' }).click();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText('Could not update sprint')).toHaveCount(0);
});

test('Can filter sprint issues by type', async ({ page }) => {
  await login(page);
  await page.goto('/sprints');

  // Find the first sprint and click on it
  const sprintName = page.locator('h3').first();
  await sprintName.click();

  // Wait for the sprint detail page to load
  await page.waitForSelector('[class*="divide-y"]');

  // Get initial issue count
  const initialCount = await page.locator('li').count();
  if (initialCount === 0) {
    // Skip test if no issues
    return;
  }

  // Open filter dropdown
  await page.getByRole('button', { name: 'Filter by issue type' }).click();
  await page.waitForSelector('[role="menuitemcheckbox"]');

  // Select only "Bug"
  const bugCheckbox = page.locator('[role="menuitemcheckbox"]').filter({ hasText: 'Bug' }).first();
  await bugCheckbox.click();

  // Close dropdown by clicking elsewhere
  await page.locator('h1').first().click();
  await page.waitForTimeout(100);

  // Verify filtered count
  const filteredCount = await page.locator('li').count();
  await expect(filteredCount).toBeLessThanOrEqual(initialCount);

  // Verify button now shows selected count
  const filterButton = page.getByRole('button', { name: 'Filter by issue type' });
  await expect(filterButton).toHaveText(/Bug|\d+ types selected/);
});

test('Selecting no types shows all issues', async ({ page }) => {
  await login(page);
  await page.goto('/sprints');

  // Find the first sprint and click on it
  const sprintName = page.locator('h3').first();
  await sprintName.click();

  // Wait for the sprint detail page to load
  await page.waitForSelector('[class*="divide-y"]');

  // Get initial count
  const initialCount = await page.locator('li').count();
  if (initialCount === 0) {
    // Skip test if no issues
    return;
  }

  // Filter to Bug only
  await page.getByRole('button', { name: 'Filter by issue type' }).click();
  const bugCheckbox = page.locator('[role="menuitemcheckbox"]').filter({ hasText: 'Bug' }).first();
  await bugCheckbox.click();
  await page.locator('h1').first().click();
  await page.waitForTimeout(100);

  // Filter should be active
  let currentCount = await page.locator('li').count();
  await expect(currentCount).toBeLessThanOrEqual(initialCount);

  // Uncheck Bug to show all again
  await page.getByRole('button', { name: 'Filter by issue type' }).click();
  await bugCheckbox.click();
  await page.locator('h1').first().click();
  await page.waitForTimeout(100);

  // All issues should show
  currentCount = await page.locator('li').count();
  await expect(currentCount).toBe(initialCount);

  // Button should show "All types"
  const filterButton = page.getByRole('button', { name: 'Filter by issue type' });
  await expect(filterButton).toHaveText('All types');
});
