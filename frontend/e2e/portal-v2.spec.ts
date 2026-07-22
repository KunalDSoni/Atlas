import { test, expect } from '@playwright/test';
import { assertNoCrash } from './helpers';

test.describe('Portal v2', () => {
  test('an anonymous visitor can browse the roadmap and public-safe detail', async ({ page }) => {
    await page.goto('/portal');

    await expect(page.getByRole('heading', { name: 'Ideas portal' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'SAML single sign-on' })).toBeVisible();

    await page.getByRole('link', { name: 'SAML single sign-on' }).click();
    await expect(page).toHaveURL(/\/portal\/features\//);
    await expect(page.getByRole('heading', { name: 'SAML single sign-on' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Follow updates' })).toBeVisible();
    await expect(page.getByText(/browse without an account/i)).toBeVisible();
    await expect(page.getByText(/RICE|confidence|effort|demand/i)).toHaveCount(0);
    await assertNoCrash(page);
  });

  test('a customer follows an idea and can revisit their own submission', async ({ page }) => {
    await page.goto('/login?next=%2Fportal');
    await page.locator('#email').fill('dana@customer.example.com');
    await page.locator('#password').fill('password123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole('link', { name: 'My ideas' })).toBeVisible();

    await page.getByRole('link', { name: 'Dark mode for portal' }).click();
    await page.getByRole('button', { name: 'Follow updates' }).click();
    await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();

    await page.getByRole('link', { name: 'My ideas' }).click();
    await expect(page.getByRole('heading', { name: 'My ideas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dark mode for portal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'SAML single sign-on' })).toBeVisible();

    await page.getByRole('link', { name: 'Roadmap', exact: true }).click();
    await page.getByRole('button', { name: 'Submit an idea' }).click();
    await page.getByLabel('Idea title').fill('Saved views for the public roadmap');
    await page.getByLabel('Idea details').fill('Let customers save the roadmap filters they use most.');
    await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();

    await expect(page).toHaveURL(/\/portal\/mine$/);
    await expect(page.getByText('Saved views for the public roadmap')).toBeVisible();
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
    await assertNoCrash(page);
  });
});
