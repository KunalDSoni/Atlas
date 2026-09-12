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

/**
 * Put at least one issue on `projectKey`'s board, and return its issue key.
 *
 * Sprints run on a calendar now, so every project has an active sprint and the
 * board scopes to it — including a project whose work all sits in the backlog,
 * whose board was previously unscoped and showed everything. A spec that needs
 * a card to click has to say so rather than inherit one.
 *
 * Setup only, through the API the app is already authenticated against; never
 * used to assert the behaviour under test. Idempotent — if the board already
 * has work, it leaves it alone and names what is there.
 */
export async function seedBoardIssue(page: Page, projectKey = 'atlas'): Promise<string> {
  return page.evaluate(async (key) => {
    const api = async (path: string, init?: RequestInit) => {
      const res = await fetch(`/api${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          'x-auth-token': localStorage.getItem('atlas_token') ?? '',
        },
      });
      return res.json();
    };

    const projects = await api('/projects');
    const project = projects.find((p: { key: string }) => p.key.toLowerCase() === key)
      ?? projects[0];

    const sprints = await api(`/projects/${project.id}/sprints`);
    const target = sprints.find((s: { status: string }) => s.status === 'active')
      ?? sprints.find((s: { status: string }) => s.status === 'planning');
    if (!target) throw new Error(`No open sprint in ${project.key} to put an issue in`);

    const issues = await api(`/projects/${project.id}/issues`);
    const already = issues.find((i: { sprint_id: string | null }) => i.sprint_id === target.id);
    if (already) return already.issue_key;

    // The hierarchy refuses both ends: an epic takes no sprint, and a subtask
    // follows its parent's rather than holding one of its own. Only the middle
    // level can be put on a board directly.
    const candidate = issues.find((i: { sprint_id: string | null; type: string }) =>
      !i.sprint_id && i.type !== 'subtask' && i.type !== 'epic');
    if (!candidate) throw new Error(`No spare story or task in ${project.key} to put on the board`);

    const updated = await api(`/issues/${candidate.id}`, {
      method: 'PUT',
      body: JSON.stringify({ sprint_id: target.id }),
    });
    // Fail loudly here. A rejected assignment would otherwise surface as a
    // 30-second wait for a card that is never coming.
    if (updated.sprint_id !== target.id) {
      throw new Error(`Could not put ${candidate.issue_key} in ${target.name}: ${JSON.stringify(updated)}`);
    }
    return candidate.issue_key;
  }, projectKey);
}
