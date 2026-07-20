const request = require('supertest');
const { createTestApp, getApp, adminHeaders, loginAs } = require('./setup');
const { getDb, run, queryAll } = require('../../database');

let headers, otherHeaders, db, spaceId, projectId;

const TASK_BODY = '<ul><li>[ ] Ship the thing</li><li>[ ] Write the docs</li></ul>';

async function mkPage(title, body = TASK_BODY) {
  const res = await request(getApp())
    .post(`/api/wiki/spaces/${spaceId}/pages`).set(headers).send({ title, body });
  expect(res.status).toBe(201);
  return res.body;
}

async function getPage(id, h = headers) {
  return (await request(getApp()).get(`/api/wiki/pages/${id}`).set(h)).body;
}

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  otherHeaders = await loginAs('priya@example.com', 'password123');
  const spaces = await request(getApp()).get('/api/wiki/spaces').set(headers);
  spaceId = spaces.body[0].id;
  const projects = await request(getApp()).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
});

describe('tasks on a page', () => {
  test('a page exposes its tasks, unchecked by default', async () => {
    const page = await mkPage('Task page');
    const got = await getPage(page.id);
    expect(got.tasks.map((t) => t.text)).toEqual(['Ship the thing', 'Write the docs']);
    expect(got.tasks.every((t) => t.checked === false)).toBe(true);
    expect(got.tasks.every((t) => t.issue_id === null)).toBe(true);
  });

  test('a page with no task markers has an empty task list', async () => {
    const page = await mkPage('No tasks', '<p>Just prose</p><ul><li>a bullet</li></ul>');
    expect((await getPage(page.id)).tasks).toEqual([]);
  });

  test('checking a task persists and records who checked it', async () => {
    const page = await mkPage('Check me');
    const { tasks } = await getPage(page.id);
    const res = await request(getApp())
      .put(`/api/wiki/pages/${page.id}/tasks/${tasks[0].key}`).set(headers)
      .send({ checked: true });
    expect(res.status).toBe(200);
    expect(res.body.checked).toBe(true);
    expect(res.body.checked_by_name).toBeTruthy();

    const after = await getPage(page.id);
    expect(after.tasks[0].checked).toBe(true);
    expect(after.tasks[1].checked).toBe(false);
  });

  test('unchecking clears the checker', async () => {
    const page = await mkPage('Uncheck me');
    const { tasks } = await getPage(page.id);
    const url = `/api/wiki/pages/${page.id}/tasks/${tasks[0].key}`;
    await request(getApp()).put(url).set(headers).send({ checked: true });
    const res = await request(getApp()).put(url).set(headers).send({ checked: false });
    expect(res.body.checked).toBe(false);
    expect(res.body.checked_by).toBeNull();
  });

  test('checking a task does NOT bump the page version', async () => {
    // State lives outside the body precisely so ticking a box is not an edit.
    const page = await mkPage('Version stability');
    const before = await getPage(page.id);
    await request(getApp())
      .put(`/api/wiki/pages/${page.id}/tasks/${before.tasks[0].key}`).set(headers)
      .send({ checked: true });
    const after = await getPage(page.id);
    expect(after.version).toBe(before.version);
  });

  test('checking a task does NOT stale an approval', async () => {
    const page = await mkPage('Approved with tasks');
    await request(getApp()).post(`/api/wiki/pages/${page.id}/approve`).set(headers).send({});
    const before = await getPage(page.id);
    expect(before.approval.stale).toBe(false);

    await request(getApp())
      .put(`/api/wiki/pages/${page.id}/tasks/${before.tasks[0].key}`).set(headers)
      .send({ checked: true });

    const after = await getPage(page.id);
    expect(after.approval.approved).toBe(true);
    expect(after.approval.stale).toBe(false);
  });

  test('checked state survives reordering the list', async () => {
    const page = await mkPage('Reorder', '<ul><li>[ ] Alpha</li><li>[ ] Beta</li></ul>');
    const before = await getPage(page.id);
    const beta = before.tasks.find((t) => t.text === 'Beta');
    await request(getApp())
      .put(`/api/wiki/pages/${page.id}/tasks/${beta.key}`).set(headers).send({ checked: true });

    await request(getApp()).put(`/api/wiki/pages/${page.id}`).set(headers)
      .send({ body: '<ul><li>[ ] Beta</li><li>[ ] Alpha</li></ul>' });

    const after = await getPage(page.id);
    expect(after.tasks.find((t) => t.text === 'Beta').checked).toBe(true);
    expect(after.tasks.find((t) => t.text === 'Alpha').checked).toBe(false);
  });

  test('an unknown task key is rejected rather than silently stored', async () => {
    const page = await mkPage('Unknown key');
    const res = await request(getApp())
      .put(`/api/wiki/pages/${page.id}/tasks/deadbeefdeadbeef-0`).set(headers)
      .send({ checked: true });
    expect(res.status).toBe(404);
  });

  test('a user who cannot view a restricted page cannot check its tasks', async () => {
    const page = await mkPage('Restricted tasks');
    const { tasks } = await getPage(page.id);
    await run(db, 'INSERT INTO wiki_page_restrictions (page_id, user_id, can_edit) VALUES (?, ?, 1)',
      [page.id, headers['x-user-id']]);
    const res = await request(getApp())
      .put(`/api/wiki/pages/${page.id}/tasks/${tasks[0].key}`).set(otherHeaders)
      .send({ checked: true });
    expect(res.status).toBe(403);
  });
});

describe('converting a task into an issue', () => {
  test('creates a real issue and links it to the task', async () => {
    const page = await mkPage('Convert me');
    const { tasks } = await getPage(page.id);
    const res = await request(getApp())
      .post(`/api/wiki/pages/${page.id}/tasks/${tasks[0].key}/convert`).set(headers)
      .send({ project_id: projectId });
    expect(res.status).toBe(201);
    expect(res.body.issue.title).toBe('Ship the thing');
    expect(res.body.issue.issue_key).toBeTruthy();

    const after = await getPage(page.id);
    expect(after.tasks[0].issue_id).toBe(res.body.issue.id);
    expect(after.tasks[0].issue_key).toBe(res.body.issue.issue_key);
  });

  test('the created issue links back to the page it came from', async () => {
    const page = await mkPage('Backlink check');
    const { tasks } = await getPage(page.id);
    const res = await request(getApp())
      .post(`/api/wiki/pages/${page.id}/tasks/${tasks[0].key}/convert`).set(headers)
      .send({ project_id: projectId });

    const pages = await request(getApp())
      .get(`/api/issues/${res.body.issue.id}/pages`).set(headers);
    expect(pages.body.some((p) => p.id === page.id)).toBe(true);
  });

  test('converting twice returns the existing issue rather than duplicating', async () => {
    const page = await mkPage('Convert once');
    const { tasks } = await getPage(page.id);
    const url = `/api/wiki/pages/${page.id}/tasks/${tasks[0].key}/convert`;
    const first = await request(getApp()).post(url).set(headers).send({ project_id: projectId });
    const second = await request(getApp()).post(url).set(headers).send({ project_id: projectId });
    expect(second.status).toBe(200);
    expect(second.body.issue.id).toBe(first.body.issue.id);
  });

  test('a converted task reports the issue status so the page reflects real progress', async () => {
    const page = await mkPage('Status mirror');
    const { tasks } = await getPage(page.id);
    const res = await request(getApp())
      .post(`/api/wiki/pages/${page.id}/tasks/${tasks[0].key}/convert`).set(headers)
      .send({ project_id: projectId });
    await request(getApp()).put(`/api/issues/${res.body.issue.id}/move`).set(headers)
      .send({ status: 'done' });

    const after = await getPage(page.id);
    expect(after.tasks[0].issue_status).toBe('done');
  });

  test('converting requires a project the caller named', async () => {
    const page = await mkPage('No project');
    const { tasks } = await getPage(page.id);
    const res = await request(getApp())
      .post(`/api/wiki/pages/${page.id}/tasks/${tasks[0].key}/convert`).set(headers)
      .send({});
    expect(res.status).toBe(400);
  });

  test('deleting the page removes its task rows', async () => {
    const page = await mkPage('Doomed tasks');
    const { tasks } = await getPage(page.id);
    await request(getApp())
      .put(`/api/wiki/pages/${page.id}/tasks/${tasks[0].key}`).set(headers).send({ checked: true });
    await request(getApp()).delete(`/api/wiki/pages/${page.id}`).set(headers);
    const rows = await queryAll(db, 'SELECT page_id FROM wiki_page_tasks WHERE page_id = ?', [page.id]);
    expect(rows).toEqual([]);
  });
});
