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
  // Sprints are named for the calendar window they cover now ("Sep 1–15, 2026"),
  // so a fixed "Sprint " prefix is no longer what a real sprint looks like. What
  // the prefix was actually standing in for is the check that survives: the
  // heading is a sprint's name and not the "Board" placeholder the skeleton
  // renders while the sprints load.
  expect(title).not.toBe('Board');
  expect(title.length).toBeGreaterThan(0);

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
