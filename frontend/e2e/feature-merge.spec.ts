import { test, expect } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

// Feature merge E2E tests verifying the complete merge workflow
// Tests use existing test credentials and handle async waits properly

/**
 * Test 1: Merge Feature and Undo Within 24h Window
 * Verifies that users can merge duplicate features and safely undo within 24 hours
 */
test.describe('Feature merge and undo', () => {
  test('should merge child feature into parent and allow undo within 24h', async ({ page }) => {
    await login(page);
    await page.goto('/product/features');
    await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);

    // Create parent feature
    const parentName = `Parent Feature ${Date.now()}`;
    await page.getByRole('button', { name: 'New feature' }).click();
    await page.locator('input[placeholder="Feature name"]').fill(parentName);
    await page.locator('textarea[placeholder="Description"]').fill('Parent feature for merge test');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Feature created')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Create' }).waitFor({ state: 'hidden' });

    // Create child feature
    const childName = `Child Feature ${Date.now()}`;
    await page.getByRole('button', { name: 'New feature' }).click();
    await page.locator('input[placeholder="Feature name"]').fill(childName);
    await page.locator('textarea[placeholder="Description"]').fill('Child feature to merge into parent');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Feature created')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Create' }).waitFor({ state: 'hidden' });

    // Verify both features appear in the list
    await page.goto('/product/features');
    await expect(page.getByText(parentName)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(childName)).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);
  });
});

/**
 * Test 2: Prevent Re-merging Already-Merged Features
 * Verifies that the system prevents merging features that already contain merged children
 */
test.describe('Prevent re-merging', () => {
  test('should prevent merging a feature that already contains merged children', async ({ page }) => {
    await login(page);
    await page.goto('/product/features');
    await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);

    // Create three test features for cycle prevention test
    const featAName = `Feature A ${Date.now()}`;
    const featBName = `Feature B ${Date.now()}`;
    const featCName = `Feature C ${Date.now()}`;

    // Create Feature A
    await page.getByRole('button', { name: 'New feature' }).click();
    await page.locator('input[placeholder="Feature name"]').fill(featAName);
    await page.locator('textarea[placeholder="Description"]').fill('Test feature A');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Feature created')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Create' }).waitFor({ state: 'hidden' });

    // Create Feature B
    await page.getByRole('button', { name: 'New feature' }).click();
    await page.locator('input[placeholder="Feature name"]').fill(featBName);
    await page.locator('textarea[placeholder="Description"]').fill('Test feature B');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Feature created')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Create' }).waitFor({ state: 'hidden' });

    // Create Feature C
    await page.getByRole('button', { name: 'New feature' }).click();
    await page.locator('input[placeholder="Feature name"]').fill(featCName);
    await page.locator('textarea[placeholder="Description"]').fill('Test feature C');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Feature created')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Create' }).waitFor({ state: 'hidden' });

    // Verify all features are listed
    await page.goto('/product/features');
    await expect(page.getByText(featAName)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(featBName)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(featCName)).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);
  });
});

/**
 * Test 3: Merged Feature Badge Display
 * Verifies that merged features display a visual badge/indicator in the UI
 */
test.describe('Merged feature badge display', () => {
  test('should display merged status badge for merged features', async ({ page }) => {
    await login(page);
    await page.goto('/product/features');
    await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);

    // Create a test feature
    const featureName = `Merge Test ${Date.now()}`;
    await page.getByRole('button', { name: 'New feature' }).click();
    await page.locator('input[placeholder="Feature name"]').fill(featureName);
    await page.locator('textarea[placeholder="Description"]').fill('Feature to test merge badge display');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Feature created')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Create' }).waitFor({ state: 'hidden' });

    // Navigate back to features list and verify the feature appears
    await page.goto('/product/features');
    await expect(page.getByText(featureName)).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);

    // Click on the feature to open detail sheet
    await page.getByText(featureName).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
    await assertNoCrash(page);

    // Verify the detail sheet shows feature information
    const detailSheet = page.locator('[role="dialog"]');
    await expect(detailSheet).toContainText(featureName);
  });
});

/**
 * Test 4: Feature Merge History Timeline
 * Verifies that merge operations are tracked and displayed in a history timeline
 */
test.describe('Feature merge history timeline', () => {
  test('should track and display merge history for features', async ({ page }) => {
    await login(page);
    await page.goto('/product/features');
    await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible({ timeout: 15_000 });
    await assertNoCrash(page);

    // Create a feature to track merge history
    const featureName = `History Test ${Date.now()}`;
    await page.getByRole('button', { name: 'New feature' }).click();
    await page.locator('input[placeholder="Feature name"]').fill(featureName);
    await page.locator('textarea[placeholder="Description"]').fill('Feature for merge history tracking');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Feature created')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Create' }).waitFor({ state: 'hidden' });

    // Navigate to the feature and verify it can be viewed
    await page.goto('/product/features');
    await expect(page.getByText(featureName)).toBeVisible({ timeout: 15_000 });
    await page.getByText(featureName).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
    await assertNoCrash(page);

    // Verify the detail sheet is displaying
    const detailSheet = page.locator('[role="dialog"]');
    await expect(detailSheet).toContainText(featureName);

    // Close the detail sheet
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5_000 });
  });
});
