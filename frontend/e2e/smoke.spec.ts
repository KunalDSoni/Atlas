import { test, expect } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

test.describe('auth', () => {
  test('rejects bad credentials and accepts good ones', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill('kunal@example.com');
    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login/);

    await login(page);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});

test.describe('every main screen renders without crashing', () => {
  const routes = [
    // Canonical, project-scoped.
    '/atlas', '/atlas/board', '/atlas/backlog', '/atlas/filters', '/atlas/epics', '/atlas/roadmap',
    '/atlas/sprints', '/atlas/releases', '/atlas/reports', '/atlas/automation',
    '/hd/servicedesk', '/hd/servicedesk/report', '/hd/servicedesk/settings',
    // Pre-scheme paths, kept so the redirects stay covered too.
    '/dashboard', '/board', '/backlog', '/filters', '/epics', '/roadmap', '/sprints',
    '/releases', '/reports', '/automation',
    '/product/insights', '/product/features', '/product/prioritize',
    '/product/roadmap', '/product/objectives', '/product/customers',
    '/product/outcomes', '/portal',
    '/wiki', '/profile', '/settings',
    '/admin', '/admin/users', '/admin/projects', '/admin/audit-log',
  ];

  test('navigates all routes', async ({ page }) => {
    await login(page);
    for (const route of routes) {
      await page.goto(route);
      // The app holds a persistent SSE connection, so 'networkidle' never
      // fires — wait for the always-present app-shell nav instead.
      await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 15_000 });
      await assertNoCrash(page);
    }
  });
});
