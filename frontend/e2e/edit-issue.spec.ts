import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Title and description were render-only for every issue type: once an issue
// existed, nothing in the UI could change what it said. These drive the edit
// dialog from the detail sheet, which is the single entry point every screen
// (board, backlog, epics, roadmap, search) funnels through.

async function openSeededStory(page: Page) {
  // The seeded stories sit in the active sprint, so they are on the board
  // rather than the backlog.
  await page.goto('/board');
  await page.getByText('Implement OAuth2 login flow').first().click({ timeout: 15_000 });
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** Point the app at a project other than the default one. */
async function switchProject(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: 'Switch project' });
  await trigger.click();
  await page.getByRole('menuitem', { name: new RegExp(name, 'i') }).first().click();
  await expect(trigger).toContainText(name, { timeout: 10_000 });
}

test('a story title and description can be edited from the detail sheet', async ({ page }) => {
  await login(page);
  await openSeededStory(page);

  await page.getByRole('button', { name: 'Edit issue' }).click();

  const title = `Edited title ${Date.now()}`;
  await page.locator('#edit-issue-title').fill(title);
  await page.locator('#edit-issue-desc').fill('Edited description body.');
  await page.getByRole('button', { name: 'Save changes' }).click();

  // Scope to the sheet: the board card behind it shows the new title too.
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText(title)).toBeVisible();
  await expect(sheet.getByText('Edited description body.')).toBeVisible();
});

test('an invalid type change reports the reason and keeps the dialog open', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await page.waitForSelector('text=Total issues', { timeout: 15_000 });
  // The roadmap epics live in Atlas Development; "Subtasks" owns child issues,
  // so the API refuses to retype it. The dialog must surface that rather than
  // silently closing and dropping the edit.
  await switchProject(page, 'Atlas Development');

  await page.goto('/epics');
  await page.getByText('Subtasks', { exact: true }).first().click({ timeout: 15_000 });
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByRole('button', { name: 'Edit issue' }).click();
  // Wait for the dialog to finish mounting: clicking the select while it is
  // still animating opens and immediately re-closes the listbox.
  await expect(page.locator('#edit-issue-title')).toBeVisible();
  await page.getByRole('combobox', { name: 'Type' }).click();
  // Each option pairs a TypeIcon with its label, so the accessible name reads
  // "Task Task". Match on visible text instead; ^Task$ excludes "Subtask".
  await page.getByRole('option').filter({ hasText: /^Task$/ }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('alert')).toContainText(/still has child issues/i);
  await expect(page.locator('#edit-issue-title')).toBeVisible();
});
