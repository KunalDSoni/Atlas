/**
 * AUTOMATION × COMPLETION GUARD TESTS
 * A rule's set_status action answers to the same guard as a human transition,
 * so a rule cannot close a parent out from under its open children.
 * Also covers all_subtasks_done firing on a renamed done column.
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');

let app, headers, projectId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const project = await request(app)
    .post('/api/projects')
    .set(headers)
    .send({ name: 'Automation Guard Co', key: 'AGC', description: 'Rules meet the guard' });
  expect(project.status).toBe(201);
  projectId = project.body.id;
});

async function createIssue(body) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/issues`)
    .set(headers)
    .send({ priority: 'medium', ...body });
  expect(res.status).toBe(201);
  return res.body;
}

async function createRule(body) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/automations`)
    .set(headers)
    .send(body);
  expect(res.status).toBe(201);
  return res.body;
}

async function statusOf(id) {
  const res = await request(app).get(`/api/issues/${id}`).set(headers);
  return res.body.status;
}

describe('a rule cannot close a parent with open children', () => {
  test('set_status to done is skipped while a subtask is open', async () => {
    // Fires when any issue moves to in_review and forces it straight to done.
    await createRule({
      name: 'Review means shipped',
      trigger_type: 'status_changed',
      conditions: [{ field: 'status', value: 'in_review' }],
      actions: [{ type: 'set_status', value: 'done' }],
    });

    const story = await createIssue({ title: 'Rule target', type: 'story' });
    await createIssue({ title: 'Open subtask', type: 'subtask', parent_id: story.id });

    const moved = await request(app)
      .put(`/api/issues/${story.id}/move`)
      .set(headers)
      .send({ status: 'in_review' });

    // The user's own move is legal — in_review is not a done category.
    expect(moved.status).toBe(200);
    // The rule's attempt to push it to done is not.
    expect(await statusOf(story.id)).toBe('in_review');
  });

  test('the same rule does fire once the subtask is done', async () => {
    const story = await createIssue({ title: 'Clearable target', type: 'story' });
    const subtask = await createIssue({ title: 'Closing subtask', type: 'subtask', parent_id: story.id });
    await request(app).put(`/api/issues/${subtask.id}`).set(headers).send({ status: 'done' });

    const moved = await request(app)
      .put(`/api/issues/${story.id}/move`)
      .set(headers)
      .send({ status: 'in_review' });
    expect(moved.status).toBe(200);

    expect(await statusOf(story.id)).toBe('done');
  });

  test('non-status actions still run on a blocked issue', async () => {
    await createRule({
      name: 'Label on review',
      trigger_type: 'status_changed',
      conditions: [{ field: 'status', value: 'blocked' }],
      actions: [{ type: 'add_label', value: 'needs-attention' }],
    });

    const story = await createIssue({ title: 'Labelled parent', type: 'story' });
    await createIssue({ title: 'Still open', type: 'subtask', parent_id: story.id });

    await request(app).put(`/api/issues/${story.id}/move`).set(headers).send({ status: 'blocked' });

    const after = await request(app).get(`/api/issues/${story.id}`).set(headers);
    expect(after.body.labels).toContain('needs-attention');
  });
});

describe('all_subtasks_done recognizes a renamed done column', () => {
  test('fires when the last subtask lands in a custom done status', async () => {
    const added = await request(app)
      .post(`/api/projects/${projectId}/statuses`)
      .set(headers)
      .send({ label: 'Shipped', category: 'done' });
    expect(added.status).toBe(201);
    const shippedKey = added.body.key;

    await createRule({
      name: 'Flag the parent',
      trigger_type: 'all_subtasks_done',
      conditions: [],
      actions: [{ type: 'add_label', value: 'all-subtasks-done' }],
    });

    const story = await createIssue({ title: 'Rollup parent', type: 'story' });
    const subtask = await createIssue({ title: 'Only subtask', type: 'subtask', parent_id: story.id });

    // Before this fix the comparison was `status = 'done'`, so a subtask in
    // any other done-category column never completed the rollup.
    const moved = await request(app)
      .put(`/api/issues/${subtask.id}/move`)
      .set(headers)
      .send({ status: shippedKey });
    expect(moved.status).toBe(200);

    const after = await request(app).get(`/api/issues/${story.id}`).set(headers);
    expect(after.body.labels).toContain('all-subtasks-done');
  });
});
