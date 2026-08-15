import { expect, test, type Page } from '@playwright/test';
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

  // Find the first sprint and click on it. The card title is a div, not a
  // heading, so target the link's own data-sprint-slug hook instead.
  const sprintName = page.locator('[data-sprint-slug]').first();
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

  // Select only "Bug" type. Scope to the menu item: the issue rows render
  // type icons with the same "Bug" label, so an unscoped lookup is ambiguous.
  await page.waitForSelector('[role="menuitemcheckbox"]');
  await page.locator('[role="menuitemcheckbox"]').filter({ hasText: 'Bug' }).first().click();

  // Wait for the filter to be applied
  await page.waitForTimeout(100);

  // Close the dropdown by clicking elsewhere
  await page.locator('body').click();

  // Verify filtered count is less than or equal to initial
  const filteredIssues = await page.locator('li').count();
  await expect(filteredIssues).toBeLessThanOrEqual(initialIssues);
});

/** Create a sprint from the sprints screen and return once its card is visible. */
async function createSprint(page: Page, name: string) {
  await page.getByRole('button', { name: 'New sprint' }).first().click();
  await page.locator('#sprint-name').fill(name);
  await page.getByRole('button', { name: 'Create sprint' }).click();
  await expect(page.getByText(name)).toBeVisible();
}

/**
 * Wait for the sprints list itself. Every load and every status change swaps the
 * list for a skeleton, and the skeleton renders no sections — so anything that
 * reads the status groups has to wait for the real list to come back, or it reads
 * "no sprints" off a page that is merely still loading.
 */
async function awaitSprintList(page: Page) {
  await expect(page.locator('section').first()).toBeVisible();
}

/** Move one sprint through the status dropdown on its card. */
async function setSprintStatus(page: Page, name: string, status: string) {
  await awaitSprintList(page);
  await page.getByRole('combobox', { name: `Status for ${name}` }).click();
  await page.getByRole('option', { name: status }).click();
  await expect(page.getByText('Could not update sprint')).toHaveCount(0);
  await page.waitForTimeout(400);
}

/**
 * Atlas refuses to reopen a sprint while another one is running, and the demo
 * project ships with an active sprint. Park them so a reopen has a clear field,
 * and report what was parked so the caller can put it back — the sprints screen
 * groups by status, so leaving them parked reorders the page for later specs.
 */
async function parkActiveSprints(page: Page): Promise<string[]> {
  // Case-insensitive: the group heading is styled `uppercase`, and Playwright
  // applies text-transform when it computes an accessible name, so this reads as
  // "ACTIVE (1)" no matter what the JSX says.
  // Case-insensitive: the group heading is styled `uppercase`, and Playwright
  // applies text-transform when it computes an accessible name, so this reads as
  // "ACTIVE (1)" no matter what the JSX says.
  const activeSection = () => page.locator('section').filter({
    has: page.getByRole('heading', { level: 2, name: /^active \(/i }),
  });

  const parked: string[] = [];

  // Every spec in the run shares one database and several leave a sprint running,
  // so the guard is generous. It is a guard, not an expectation.
  for (let guard = 0; guard < 25; guard += 1) {
    // Reload rather than lean on the in-place refresh: one deterministic load per
    // pass, so the group check never races a re-render it did not start.
    await page.goto('/sprints');
    await awaitSprintList(page);
    if (await activeSection().count() === 0) break;

    const combo = activeSection().getByRole('combobox').first();
    const label = await combo.getAttribute('aria-label');
    await combo.click();
    await page.getByRole('option', { name: 'planning' }).click();
    await expect(page.getByText('Could not update sprint')).toHaveCount(0);
    await page.waitForTimeout(400);
    if (label) parked.push(label.replace(/^Status for /, ''));
  }

  // Assert the precondition rather than discovering it as a 409 three steps later.
  await page.goto('/sprints');
  await awaitSprintList(page);
  await expect(activeSection(), 'all active sprints parked before reopening').toHaveCount(0);

  return parked;
}

test('A completed sprint keeps its rename but loses status and delete', async ({ page }) => {
  await login(page);
  await page.goto('/sprints');
  await assertNoCrash(page);

  const name = `E2E Frozen Sprint ${Date.now()}`;
  await createSprint(page, name);

  await page.getByRole('combobox', { name: `Status for ${name}` }).click();
  await page.getByRole('option', { name: 'completed' }).click();

  // Jira's rule: the record of what shipped can be renamed, but its status and
  // dates are fixed and it cannot be deleted. Reopening lives on the detail screen.
  await expect(page.getByRole('button', { name: `Edit ${name}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Delete ${name}` })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: `Status for ${name}` })).toHaveCount(0);
  await expect(page.getByRole('link', { name })).toBeVisible();
});

test('An active sprint cannot be deleted', async ({ page }) => {
  await login(page);
  await page.goto('/sprints');
  await assertNoCrash(page);

  const name = `E2E Running Sprint ${Date.now()}`;
  await createSprint(page, name);

  await expect(page.getByRole('button', { name: `Delete ${name}` })).toBeVisible();

  await page.getByRole('combobox', { name: `Status for ${name}` }).click();
  await page.getByRole('option', { name: 'active' }).click();
  await page.waitForTimeout(300);

  // Completing it is the only way out, exactly as in Jira.
  await expect(page.getByRole('button', { name: `Delete ${name}` })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: `Status for ${name}` })).toBeVisible();
});

test('A completed sprint can be reopened from its detail screen', async ({ page }) => {
  // Reopening needs a clear field, and clearing it means walking every sprint the
  // rest of the suite left running — a page load each. Well past the 30s default.
  test.setTimeout(120_000);

  await login(page);
  await page.goto('/sprints');
  await assertNoCrash(page);

  const name = `E2E Reopen Sprint ${Date.now()}`;
  await createSprint(page, name);

  await page.getByRole('combobox', { name: `Status for ${name}` }).click();
  await page.getByRole('option', { name: 'completed' }).click();
  await expect(page.getByRole('combobox', { name: `Status for ${name}` })).toHaveCount(0);

  const parked = await parkActiveSprints(page);

  try {
    await page.getByRole('link', { name }).first().click();
    await assertNoCrash(page);

    // The header action and the dialog's submit share a name, so scope both ends:
    // once the dialog opens an unscoped lookup matches two buttons.
    await page.getByRole('button', { name: 'Reopen sprint' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#reopen-end-date').fill('2027-01-15');
    // Submit is disabled until a date is set, so a click that raced the dialog's
    // own state would silently do nothing.
    await expect(dialog.locator('#reopen-end-date')).toHaveValue('2027-01-15');
    await dialog.getByRole('button', { name: 'Reopen sprint' }).click();

    await expect(page.getByText('Could not reopen sprint')).toHaveCount(0);
    // The action exists only for a completed sprint, so its absence is the proof
    // that the reopen landed rather than failing quietly behind a toast.
    await expect(page.getByRole('button', { name: 'Reopen sprint' })).toHaveCount(0);

    await page.goto('/board');
    await assertNoCrash(page);
    await expect(page.getByRole('heading', { name })).toBeVisible();
  } finally {
    // Hand the project back as we found it, pass or fail. These specs share one
    // database and the sprints screen groups by status, so a sprint left running
    // reorders the page under every later spec that reads "the first sprint".
    await page.goto('/sprints');
    await setSprintStatus(page, name, 'completed').catch(() => {});
    for (const parkedName of parked) {
      await setSprintStatus(page, parkedName, 'active').catch(() => {});
    }
  }
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

  // Verify the sprint is now completed. The card title renders as a div, so
  // find the card by its sprint link rather than by a heading.
  const completedSprintCard = page.getByRole('link', { name }).first();
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

  // Find the first sprint and click on it. The card title is a div, not a
  // heading, so target the link's own data-sprint-slug hook instead.
  const sprintName = page.locator('[data-sprint-slug]').first();
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

  // Find the first sprint and click on it. The card title is a div, not a
  // heading, so target the link's own data-sprint-slug hook instead.
  const sprintName = page.locator('[data-sprint-slug]').first();
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
