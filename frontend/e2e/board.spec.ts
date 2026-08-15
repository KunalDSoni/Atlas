import { expect, test } from '@playwright/test';
import { assertNoCrash, login } from './helpers';

// The board is one sprint's board, not a filterable view of the whole project:
// it shows the sprint the team is working in and names it in the heading. The
// seed gives the first project an active sprint holding all of its issues.
test('the board is titled with the sprint it shows', async ({ page }) => {
  await login(page);
  await page.goto('/board');
  await assertNoCrash(page);

  // Wait for the board itself before reading the heading. While the sprints load,
  // the screen renders column skeletons under a placeholder "Board" title, and
  // assertNoCrash is satisfied by the skeleton — so reading any earlier measures
  // the placeholder rather than the sprint, and the test fails whenever the load
  // is a little slow.
  await expect(page.locator('article').first()).toBeVisible();

  const title = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
  expect(title).toMatch(/^Sprint /);

  // The heading names the sprint the cards actually come from — the board
  // filters to it, so every card carries the same sprint badge.
  await expect(page.locator('article').first()).toContainText(title);
});

test('the board has no sprint picker', async ({ page }) => {
  await login(page);
  await page.goto('/board');
  await assertNoCrash(page);

  await expect(page.getByRole('combobox', { name: 'Filter by sprint' })).toHaveCount(0);
  await expect(page.getByText('Backlog only')).toHaveCount(0);
  // The controls that remain still work.
  await expect(page.getByRole('combobox', { name: 'Swimlanes' })).toBeVisible();
});
