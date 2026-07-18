import { expect, type Page } from '@playwright/test';

/** Log in as the seeded admin and land in the app. */
export async function login(page: Page, email = 'kunal@example.com', password = 'password123') {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

/** Fail the test if the page rendered a blank body or a React error boundary. */
export async function assertNoCrash(page: Page) {
  const body = (await page.locator('body').innerText()).trim();
  expect(body.length, 'page body should not be empty').toBeGreaterThan(0);
  expect(body).not.toMatch(/something went wrong|application error|cannot read propert|is not a function/i);
}
