import { test, expect, type Page } from '@playwright/test';
import { login, assertNoCrash } from './helpers';

// What the previous version of this file did NOT do was merge anything. It
// created features, asserted a dialog opened, and passed — while all four merge
// calls in the app were hitting a path the server does not serve, with no auth
// header and a snake_case body, and the UI toasted "Features merged
// successfully" over the resulting 404. A merge spec has to perform a merge.

/** The session token the SPA stores after login, in the header shape the API wants. */
async function authHeaders(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('atlas_token'));
  expect(token, 'expected a session token after login').toBeTruthy();
  return { 'x-auth-token': token as string, 'Content-Type': 'application/json' };
}

type Headers = Record<string, string>;

async function firstProjectId(page: Page, headers: Headers) {
  const projects = await (await page.request.get('/api/projects', { headers })).json();
  return projects[0].id as string;
}

async function createFeature(page: Page, headers: Headers, projectId: string, name: string, description: string) {
  const res = await page.request.post('/api/product/features', {
    headers,
    data: { name, description, project_id: projectId, status: 'idea' },
  });
  expect(res.status(), 'feature fixture should be created').toBe(201);
  return (await res.json()).id as string;
}

/** Files a piece of customer feedback against a feature — the only thing that moves request_count. */
async function fileRequest(page: Page, headers: Headers, featureId: string, title: string) {
  const insight = await page.request.post('/api/product/insights', {
    headers,
    data: { title, content: title, source: 'portal' },
  });
  expect(insight.status()).toBe(201);
  const link = await page.request.post(`/api/product/insights/${(await insight.json()).id}/links`, {
    headers,
    data: { feature_id: featureId, importance: 2 },
  });
  expect(link.status()).toBe(201);
}

async function getFeature(page: Page, headers: Headers, id: string) {
  const res = await page.request.get(`/api/product/features/${id}`, { headers });
  expect(res.status()).toBe(200);
  return res.json();
}

test.describe('Feature merge — API contract', () => {
  test('rolls the child request count and its evidence into the parent', async ({ page }) => {
    await login(page);
    const headers = await authHeaders(page);
    const projectId = await firstProjectId(page, headers);

    const parentId = await createFeature(page, headers, projectId, `Bulk edit ${Date.now()}`, 'Edit many issues at once');
    const childId = await createFeature(page, headers, projectId, `Bulk editing ${Date.now()}`, 'Edit many issues at once');

    await fileRequest(page, headers, parentId, 'Parent-side request');
    await fileRequest(page, headers, childId, 'Child-side request');
    await fileRequest(page, headers, childId, 'Another child-side request');

    const merge = await page.request.post(`/api/product/features/${parentId}/merge`, {
      headers,
      data: { childFeatureIds: [childId] },
    });
    expect(merge.status(), 'merge must succeed without a reason').toBe(200);

    const parent = await getFeature(page, headers, parentId);
    expect(parent.request_count).toBe(3);
    expect(parent.insight_count).toBe(3);
  });

  test('refuses a merge that would create a cycle, with a readable message', async ({ page }) => {
    await login(page);
    const headers = await authHeaders(page);
    const projectId = await firstProjectId(page, headers);

    const parentId = await createFeature(page, headers, projectId, `Cycle parent ${Date.now()}`, 'cycle fixture');
    const childId = await createFeature(page, headers, projectId, `Cycle child ${Date.now()}`, 'cycle fixture');

    expect((await page.request.post(`/api/product/features/${parentId}/merge`, {
      headers, data: { childFeatureIds: [childId] },
    })).status()).toBe(200);

    const again = await page.request.post(`/api/product/features/${parentId}/merge`, {
      headers, data: { childFeatureIds: [childId] },
    });
    expect(again.status()).toBe(400);
    // The client renders `message`; a body carrying only `error: true` shows
    // the user the word "true".
    expect((await again.json()).message).toBeTruthy();
  });

  test('undo returns the count and the evidence to the child', async ({ page }) => {
    await login(page);
    const headers = await authHeaders(page);
    const projectId = await firstProjectId(page, headers);

    const parentId = await createFeature(page, headers, projectId, `Undo parent ${Date.now()}`, 'undo fixture');
    const childId = await createFeature(page, headers, projectId, `Undo child ${Date.now()}`, 'undo fixture');

    await fileRequest(page, headers, parentId, 'Stays with the parent');
    await fileRequest(page, headers, childId, 'Goes back to the child');

    await page.request.post(`/api/product/features/${parentId}/merge`, {
      headers, data: { childFeatureIds: [childId] },
    });
    expect((await getFeature(page, headers, parentId)).request_count).toBe(2);

    const undo = await page.request.post(`/api/product/features/${parentId}/unmerge`, {
      headers, data: { childFeatureId: childId },
    });
    expect(undo.status()).toBe(200);

    expect((await getFeature(page, headers, parentId)).request_count).toBe(1);
    expect((await getFeature(page, headers, childId)).insight_count).toBe(1);
  });
});

test.describe('Feature merge — through the UI', () => {
  test('merges a duplicate from the feature sheet and shows the combined count', async ({ page }) => {
    await login(page);
    const headers = await authHeaders(page);
    const projectId = await firstProjectId(page, headers);

    // Identical name and description puts the pair well over the server's 0.6
    // similarity threshold, so the child is offered as a merge candidate.
    const stamp = Date.now();
    const sharedName = `Single sign-on ${stamp}`;
    const parentId = await createFeature(page, headers, projectId, sharedName, 'Let people sign in with their IdP');
    await createFeature(page, headers, projectId, sharedName, 'Let people sign in with their IdP');

    await fileRequest(page, headers, parentId, 'Parent request');

    await page.goto('/product/features');
    await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible({ timeout: 15_000 });

    // Open the parent's detail sheet.
    await page.getByText(sharedName).first().click();
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    // The suggestion list is the first thing a broken path breaks: a 404 there
    // used to render as the reassuring "No duplicate features found".
    const suggestion = sheet.getByRole('checkbox', { name: new RegExp(`Select ${sharedName}`) });
    await expect(suggestion).toBeVisible({ timeout: 10_000 });
    await suggestion.check();

    await sheet.getByRole('button', { name: /^Merge 1 feature$/ }).click();

    const confirm = page.getByRole('dialog').filter({ hasText: 'Confirm merge' });
    await expect(confirm).toBeVisible({ timeout: 5_000 });
    await confirm.getByRole('button', { name: /^Merge 1 feature$/ }).click();

    // A success toast must mean the server said yes.
    await expect(page.getByText('Merged 1 feature')).toBeVisible({ timeout: 10_000 });
    await assertNoCrash(page);

    const parent = await getFeature(page, headers, parentId);
    expect(parent.merged_from_ids, 'the merge must have reached the database').not.toBe('[]');

    // And the undo the merge promises is offered.
    await expect(sheet.getByRole('button', { name: 'Undo' }).first()).toBeVisible({ timeout: 10_000 });
  });

  // The "success toast over a failed request" half of this is asserted where it
  // can actually be provoked: src/lib/__tests__/api-merge.test.ts drives the
  // client against a 400 and requires it to reject.
  test('a duplicate already merged away is no longer offered', async ({ page }) => {
    await login(page);
    const headers = await authHeaders(page);
    const projectId = await firstProjectId(page, headers);

    const stamp = Date.now();
    const sharedName = `Audit export ${stamp}`;
    const parentId = await createFeature(page, headers, projectId, sharedName, 'Export the audit log');
    const childId = await createFeature(page, headers, projectId, sharedName, 'Export the audit log');

    // Merge it server-side first, so the merge the UI attempts is refused.
    await page.request.post(`/api/product/features/${parentId}/merge`, {
      headers, data: { childFeatureIds: [childId] },
    });

    await page.goto('/product/features');
    await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible({ timeout: 15_000 });
    await page.getByText(sharedName).first().click();

    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    // A merged child is filtered out of the candidates, so there is nothing to
    // select — which is itself the correct behaviour and worth asserting.
    await expect(sheet.getByText('No duplicate features found')).toBeVisible({ timeout: 10_000 });
    await assertNoCrash(page);
  });
});
