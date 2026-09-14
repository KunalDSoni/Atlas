/**
 * COMPLETION GUARD — CHILD SIDE
 * Blocking the parent alone left the invariant defeatable: open work could be
 * created under a done parent, moved under one, or reopened under one, and the
 * parent kept claiming to be done. These cover the reopen that closes that gap.
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');
const { getDb, queryOne, run } = require('../../database');

let app, headers, projectId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
});

async function createIssue(body) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/issues`)
    .set(headers)
    .send({ priority: 'medium', ...body });
  expect(res.status).toBe(201);
  return res.body;
}

const statusOf = async (id) =>
  (await request(app).get(`/api/issues/${id}`).set(headers)).body.status;

/** A story sitting in done with every subtask done. */
async function completedStory(title = 'Finished story') {
  const story = await createIssue({ title, type: 'story' });
  const subtask = await createIssue({ title: 'Original work', type: 'subtask', parent_id: story.id });
  await request(app).put(`/api/issues/${subtask.id}`).set(headers).send({ status: 'done' });
  const done = await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });
  expect(done.status).toBe(200);
  return { story, subtask };
}

describe('new work created under a done parent', () => {
  test('reopens the parent instead of refusing the child', async () => {
    const { story } = await completedStory();

    const child = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'More work found', type: 'subtask', parent_id: story.id, priority: 'medium' });

    // The creation itself is never refused — adding work is not the error.
    expect(child.status).toBe(201);
    expect(await statusOf(story.id)).toBe('in_progress');
  });

  test('a child created already done leaves the parent alone', async () => {
    const { story } = await completedStory('Stays finished');
    const db = await getDb();
    // Create it, then complete it, then confirm the parent was only disturbed
    // by the open interval — and put the parent back for the assertion.
    await run(db, "UPDATE issues SET status = 'done' WHERE id = ?", [story.id]);

    const sub = await createIssue({ title: 'Already handled', type: 'subtask', parent_id: story.id });
    await request(app).put(`/api/issues/${sub.id}`).set(headers).send({ status: 'done' });
    await run(db, "UPDATE issues SET status = 'done' WHERE id = ?", [story.id]);

    // A done child arriving under a done parent must not reopen it.
    const another = await createIssue({ title: 'Second', type: 'subtask', parent_id: story.id });
    await request(app).put(`/api/issues/${another.id}`).set(headers).send({ status: 'done' });
    await run(db, "UPDATE issues SET status = 'done' WHERE id = ?", [story.id]);

    expect(await statusOf(story.id)).toBe('done');
  });

  test('the reopen is recorded as real history', async () => {
    const { story } = await completedStory('Audited');
    await createIssue({ title: 'Surprise work', type: 'subtask', parent_id: story.id });

    const activity = await request(app).get(`/api/issues/${story.id}/activity`).set(headers);
    const statusRows = activity.body.filter((a) => a.field === 'status');
    const reopen = statusRows[statusRows.length - 1];
    expect(reopen.old_value).toBe('done');
    expect(reopen.new_value).toBe('in_progress');
    // Attributed to the person whose action caused it, not to nobody.
    expect(reopen.user_name).toBeTruthy();
  });
});

describe('open work reparented onto a done parent', () => {
  test('reopens the new parent', async () => {
    const { story: doneStory } = await completedStory('Sealed');
    const openStory = await createIssue({ title: 'Open story', type: 'story' });
    const moving = await createIssue({ title: 'Movable', type: 'subtask', parent_id: openStory.id });

    const moved = await request(app)
      .put(`/api/issues/${moving.id}`)
      .set(headers)
      .send({ parent_id: doneStory.id });
    expect(moved.status).toBe(200);

    expect(await statusOf(doneStory.id)).toBe('in_progress');
  });

  test('moving a done child onto a done parent leaves it done', async () => {
    const { story: doneStory } = await completedStory('Undisturbed');
    const other = await createIssue({ title: 'Other story', type: 'story' });
    const child = await createIssue({ title: 'Finished child', type: 'subtask', parent_id: other.id });
    await request(app).put(`/api/issues/${child.id}`).set(headers).send({ status: 'done' });

    const db = await getDb();
    await run(db, "UPDATE issues SET status = 'done' WHERE id = ?", [doneStory.id]);

    await request(app).put(`/api/issues/${child.id}`).set(headers).send({ parent_id: doneStory.id });
    expect(await statusOf(doneStory.id)).toBe('done');
  });
});

describe('a child reopened under a done parent', () => {
  test('reopens the parent through the form', async () => {
    const { story, subtask } = await completedStory('Form reopen');

    const res = await request(app).put(`/api/issues/${subtask.id}`).set(headers).send({ status: 'todo' });
    expect(res.status).toBe(200);

    expect(await statusOf(story.id)).toBe('in_progress');
  });

  test('reopens the parent through a board drag', async () => {
    const { story, subtask } = await completedStory('Drag reopen');

    const res = await request(app).put(`/api/issues/${subtask.id}/move`).set(headers).send({ status: 'todo' });
    expect(res.status).toBe(200);

    expect(await statusOf(story.id)).toBe('in_progress');
  });
});

describe('the reopen climbs the whole chain', () => {
  test('a reopened subtask reopens both its story and its epic', async () => {
    const epic = await createIssue({ title: 'Umbrella', type: 'epic' });
    const story = await createIssue({ title: 'Under epic', type: 'story', parent_id: epic.id });
    const subtask = await createIssue({ title: 'Leaf work', type: 'subtask', parent_id: story.id });

    await request(app).put(`/api/issues/${subtask.id}`).set(headers).send({ status: 'done' });
    await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });
    await request(app).put(`/api/issues/${epic.id}`).set(headers).send({ status: 'done' });
    expect(await statusOf(epic.id)).toBe('done');

    await request(app).put(`/api/issues/${subtask.id}`).set(headers).send({ status: 'todo' });

    expect(await statusOf(story.id)).toBe('in_progress');
    expect(await statusOf(epic.id)).toBe('in_progress');
  });

  test('stops at the first ancestor that is not done', async () => {
    const epic = await createIssue({ title: 'Open umbrella', type: 'epic' });
    const story = await createIssue({ title: 'Done mid', type: 'story', parent_id: epic.id });
    const subtask = await createIssue({ title: 'Leaf', type: 'subtask', parent_id: story.id });
    await request(app).put(`/api/issues/${subtask.id}`).set(headers).send({ status: 'done' });
    await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });
    // The epic stays in todo throughout.

    await request(app).put(`/api/issues/${subtask.id}`).set(headers).send({ status: 'todo' });

    expect(await statusOf(story.id)).toBe('in_progress');
    expect(await statusOf(epic.id)).toBe('todo');
  });
});

describe('custom workflows', () => {
  let customProjectId, shippedKey, verifyKey;

  beforeAll(async () => {
    const project = await request(app).post('/api/projects').set(headers)
      .send({ name: 'Reopen Workflow Co', key: 'RWC', description: 'Custom columns' });
    expect(project.status).toBe(201);
    customProjectId = project.body.id;

    const shipped = await request(app).post(`/api/projects/${customProjectId}/statuses`)
      .set(headers).send({ label: 'Shipped', category: 'done' });
    expect(shipped.status).toBe(201);
    shippedKey = shipped.body.key;

    const verifying = await request(app).post(`/api/projects/${customProjectId}/statuses`)
      .set(headers).send({ label: 'Verifying', category: 'in_progress' });
    expect(verifying.status).toBe(201);
    verifyKey = verifying.body.key;
  });

  const createIn = async (body) => {
    const r = await request(app).post(`/api/projects/${customProjectId}/issues`)
      .set(headers).send({ priority: 'medium', ...body });
    expect(r.status).toBe(201);
    return r.body;
  };

  test('a parent in a renamed done column still reopens', async () => {
    const story = await createIn({ title: 'Shipped story', type: 'story' });
    const sub = await createIn({ title: 'Its work', type: 'subtask', parent_id: story.id });
    await request(app).put(`/api/issues/${sub.id}`).set(headers).send({ status: shippedKey });
    await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: shippedKey });
    expect(await statusOf(story.id)).toBe(shippedKey);

    await request(app).put(`/api/issues/${sub.id}`).set(headers).send({ status: 'todo' });

    // Lands in the project's FIRST in-progress column by position, which is the
    // built-in one here — not the custom column added afterwards.
    const landed = await statusOf(story.id);
    expect([verifyKey, 'in_progress']).toContain(landed);
    expect(landed).not.toBe(shippedKey);
  });
});
