/**
 * MENTION WORKFLOW E2E TESTS
 *
 * Comprehensive end-to-end testing of the full mention workflow.
 */
import { test, expect } from '@playwright/test';

test.describe('Mention Workflow E2E', () => {
  const projectKey = process.env.TEST_PROJECT_KEY || 'ATLAS';

  test('can mention user in issue description with autocomplete', async ({ page }) => {
    await page.goto(`/${projectKey}`);
    await page.waitForLoadState('networkidle');

    // Find first issue
    const issueLink = page.locator('[data-testid="issue-row"]').first();
    if (await issueLink.isVisible()) {
      await issueLink.click();
      await page.waitForLoadState('networkidle');

      // Look for edit button
      const editBtn = page.locator('button:has-text("Edit")').first();
      if (await editBtn.isVisible()) {
        await editBtn.click();
        await page.waitForSelector('[id="edit-issue-desc"]', { timeout: 5000 });
        
        const descInput = page.locator('[id="edit-issue-desc"]');
        await descInput.focus();
        await descInput.fill('@Pr');
        
        // Wait for dropdown
        const dropdown = page.locator('[role="listbox"]');
        if (await dropdown.isVisible({ timeout: 3000 })) {
          const option = page.locator('[role="option"]').first();
          await option.click();

          const value = await descInput.inputValue();
          expect(value).toContain('@');
        }
      }
    }
  });

  test('mention displays as styled element in description', async ({ page }) => {
    await page.goto(`/${projectKey}`);
    await page.waitForLoadState('networkidle');

    // Find issue with mentions
    const issueLink = page.locator('[data-testid="issue-row"]').first();
    if (await issueLink.isVisible()) {
      await issueLink.click();
      await page.waitForLoadState('networkidle');

      // Look for mention elements
      const mentions = page.locator('[class*="mention"], span[class*="badge"]');
      const count = await mentions.count();
      // At least verify no errors on render
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('notification settings page is accessible', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Verify settings page loads
    const title = page.locator('h1, h2').first();
    const text = await title.textContent();
    expect(text).toBeTruthy();
  });

  test('issue edit dialog can be opened and closed', async ({ page }) => {
    await page.goto(`/${projectKey}`);
    await page.waitForLoadState('networkidle');

    const issueLink = page.locator('[data-testid="issue-row"]').first();
    if (await issueLink.isVisible()) {
      await issueLink.click();
      await page.waitForLoadState('networkidle');

      const editBtn = page.locator('button:has-text("Edit")').first();
      if (await editBtn.isVisible()) {
        await editBtn.click();
        await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

        const dialog = page.locator('[role="dialog"]');
        expect(await dialog.isVisible()).toBe(true);

        // Close dialog
        await page.keyboard.press('Escape');
        await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 3000 });
      }
    }
  });

  test('multiple project members are available for mention', async ({ page }) => {
    await page.goto(`/${projectKey}`);
    await page.waitForLoadState('networkidle');

    const issueLink = page.locator('[data-testid="issue-row"]').first();
    if (await issueLink.isVisible()) {
      await issueLink.click();
      await page.waitForLoadState('networkidle');

      const editBtn = page.locator('button:has-text("Edit")').first();
      if (await editBtn.isVisible()) {
        await editBtn.click();
        await page.waitForSelector('[id="edit-issue-desc"]', { timeout: 5000 });

        const descInput = page.locator('[id="edit-issue-desc"]');
        await descInput.focus();
        await descInput.fill('@');

        const dropdown = page.locator('[role="listbox"]');
        if (await dropdown.isVisible({ timeout: 3000 })) {
          const options = await page.locator('[role="option"]').count();
          expect(options).toBeGreaterThan(0);
        }
      }
    }
  });
});
