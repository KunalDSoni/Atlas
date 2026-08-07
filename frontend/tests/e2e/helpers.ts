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
  // Poll rather than sample once. Every route is lazy-loaded behind a Suspense
  // fallback that renders only a spinner ICON, so innerText is legitimately ''
  // for a beat after navigation — login() resolves on the URL changing, which
  // happens before the route chunk has loaded. Sampling instantly made this
  // assertion a race that any bundle-size increase could tip over; the intent
  // is "the app rendered", not "the app rendered within zero milliseconds".
  await expect
    .poll(async () => (await page.locator('body').innerText()).trim().length,
      { message: 'page body should not be empty' })
    .toBeGreaterThan(0);

  const body = (await page.locator('body').innerText()).trim();
  expect(body).not.toMatch(/something went wrong|application error|cannot read propert|is not a function/i);
}
