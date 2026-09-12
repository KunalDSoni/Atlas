/**
 * COMPLETION GUARD TESTS
 * A parent issue cannot enter a done-category status while its direct children
 * are still open — at both levels of the hierarchy, through both write paths,
 * and for projects that renamed or added their own done column.
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');

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

/** A story with `count` open subtasks under it. */
async function storyWithSubtasks(count, title = 'Parent story') {
  const story = await createIssue({ title, type: 'story' });
  const subtasks = [];
  for (let i = 0; i < count; i += 1) {
    subtasks.push(await createIssue({ title: `Subtask ${i + 1}`, type: 'subtask', parent_id: story.id }));
  }
  return { story, subtasks };
}

describe('PUT /api/issues/:id — story blocked by open subtasks', () => {
  test('rejects done with 409 and lists every open subtask', async () => {
    const { story, subtasks } = await storyWithSubtasks(3);

    const res = await request(app)
      .put(`/api/issues/${story.id}`)
      .set(headers)
      .send({ status: 'done' });

    expect(res.status).toBe(409);
    expect(res.body.blockers).toHaveLength(3);
    expect(res.body.blockers.map((b) => b.issue_key).sort())
      .toEqual(subtasks.map((s) => s.issue_key).sort());
    // Every blocker carries the state it is actually in, so the client can
    // say "ATL-14 (To Do)" without a second round trip.
    for (const blocker of res.body.blockers) {
      expect(blocker.status).toBe('todo');
      expect(blocker.status_label).toBe('To Do');
      expect(blocker.type).toBe('subtask');
      expect(typeof blocker.title).toBe('string');
    }
    expect(res.body.error).toContain('3 open subtasks');
    for (const subtask of subtasks) expect(res.body.error).toContain(subtask.issue_key);

    // `summary` is the same headline with no list in it, so a client that
    // renders `blockers` itself has a title that does not repeat the rows.
    expect(res.body.summary).toBe(`${story.issue_key} has 3 open subtasks. Finish them first.`);
    for (const subtask of subtasks) expect(res.body.summary).not.toContain(subtask.issue_key);
  });

  test('the rejected story is left untouched', async () => {
    const { story } = await storyWithSubtasks(1);
    await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });

    const after = await request(app).get(`/api/issues/${story.id}`).set(headers);
    expect(after.body.status).toBe('todo');
  });

  test('allows done once every subtask is done', async () => {
    const { story, subtasks } = await storyWithSubtasks(2);
    for (const subtask of subtasks) {
      const done = await request(app).put(`/api/issues/${subtask.id}`).set(headers).send({ status: 'done' });
      expect(done.status).toBe(200);
    }

    const res = await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
  });

  test('a childless story is never blocked', async () => {
    const story = await createIssue({ title: 'Lone story', type: 'story' });
    const res = await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });
    expect(res.status).toBe(200);
  });

  test('non-done transitions are not blocked', async () => {
    const { story } = await storyWithSubtasks(2);
    const res = await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });

  test('edits that do not touch status are not blocked', async () => {
    const { story } = await storyWithSubtasks(2);
    const res = await request(app).put(`/api/issues/${story.id}`).set(headers).send({ title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Renamed');
  });

  test('message uses the singular for a single blocker', async () => {
    const { story } = await storyWithSubtasks(1);
    const res = await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });
    expect(res.body.error).toContain('1 open subtask.');
    expect(res.body.error).toContain('Finish it first');
  });

  test('names at most five blockers inline, then summarizes the rest', async () => {
    const { story } = await storyWithSubtasks(7);
    const res = await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });
    expect(res.status).toBe(409);
    // The full set is always in the structured payload, however long it is.
    expect(res.body.blockers).toHaveLength(7);
    expect(res.body.error).toContain('and 2 more');
  });
});

describe('PUT /api/issues/:id/move — the board drag is the same transition', () => {
  test('a drag onto the done column is rejected with the same body', async () => {
    const { story } = await storyWithSubtasks(2);

    const res = await request(app)
      .put(`/api/issues/${story.id}/move`)
      .set(headers)
      .send({ status: 'done', board_order: 0 });

    expect(res.status).toBe(409);
    expect(res.body.blockers).toHaveLength(2);
  });

  test('a drag between non-done columns still works', async () => {
    const { story } = await storyWithSubtasks(2);
    const res = await request(app)
      .put(`/api/issues/${story.id}/move`)
      .set(headers)
      .send({ status: 'in_review', board_order: 0 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_review');
  });

  test('a blocked drag writes no status history', async () => {
    const { story } = await storyWithSubtasks(1);
    await request(app).put(`/api/issues/${story.id}/move`).set(headers).send({ status: 'done' });

    const activity = await request(app).get(`/api/issues/${story.id}/activity`).set(headers);
    const statusRows = (activity.body || []).filter((a) => a.field === 'status');
    expect(statusRows).toHaveLength(0);
  });
});

describe('epics are blocked by open stories, tasks and bugs', () => {
  test('an epic cannot close over an open child story', async () => {
    const epic = await createIssue({ title: 'Parent epic', type: 'epic' });
    const child = await createIssue({ title: 'Child story', type: 'story', parent_id: epic.id });

    const res = await request(app).put(`/api/issues/${epic.id}`).set(headers).send({ status: 'done' });

    expect(res.status).toBe(409);
    expect(res.body.blockers).toHaveLength(1);
    expect(res.body.blockers[0].issue_key).toBe(child.issue_key);
    // Epic children are not subtasks, so the wording has to change with them.
    expect(res.body.error).toContain('1 open child issue');
  });

  test('an epic closes once its children are done', async () => {
    const epic = await createIssue({ title: 'Closable epic', type: 'epic' });
    const child = await createIssue({ title: 'Child task', type: 'task', parent_id: epic.id });
    await request(app).put(`/api/issues/${child.id}`).set(headers).send({ status: 'done' });

    const res = await request(app).put(`/api/issues/${epic.id}`).set(headers).send({ status: 'done' });
    expect(res.status).toBe(200);
  });

  test('only direct children count — a done story shields its own subtasks', async () => {
    // The story could only have reached done with its subtasks done, so the
    // epic never needs to walk deeper than one level. Here the story is forced
    // done first, which is the only way this state is reachable.
    const epic = await createIssue({ title: 'Two level epic', type: 'epic' });
    const story = await createIssue({ title: 'Mid story', type: 'story', parent_id: epic.id });
    const subtask = await createIssue({ title: 'Leaf', type: 'subtask', parent_id: story.id });
    await request(app).put(`/api/issues/${subtask.id}`).set(headers).send({ status: 'done' });
    await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });

    const res = await request(app).put(`/api/issues/${epic.id}`).set(headers).send({ status: 'done' });
    expect(res.status).toBe(200);
  });
});

describe('done is a category, not the key "done"', () => {
  let customProjectId;
  let shippedKey;

  beforeAll(async () => {
    const project = await request(app)
      .post('/api/projects')
      .set(headers)
      .send({ name: 'Custom Workflow Co', key: 'CWC', description: 'Renamed done column' });
    expect(project.status).toBe(201);
    customProjectId = project.body.id;

    // Adding a status materializes the defaults alongside it.
    const added = await request(app)
      .post(`/api/projects/${customProjectId}/statuses`)
      .set(headers)
      .send({ label: 'Shipped', category: 'done' });
    expect(added.status).toBe(201);
    shippedKey = added.body.key;
  });

  async function createIn(projectIdForIssue, body) {
    const res = await request(app)
      .post(`/api/projects/${projectIdForIssue}/issues`)
      .set(headers)
      .send({ priority: 'medium', ...body });
    expect(res.status).toBe(201);
    return res.body;
  }

  test('a second done column blocks just like the built-in one', async () => {
    const story = await createIn(customProjectId, { title: 'Custom parent', type: 'story' });
    await createIn(customProjectId, { title: 'Custom child', type: 'subtask', parent_id: story.id });

    const res = await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: shippedKey });
    expect(res.status).toBe(409);
    expect(res.body.blockers).toHaveLength(1);
  });

  test('a child parked in a non-default done column does not block', async () => {
    const story = await createIn(customProjectId, { title: 'Shipped-child parent', type: 'story' });
    const child = await createIn(customProjectId, { title: 'Shipped child', type: 'subtask', parent_id: story.id });
    const moved = await request(app).put(`/api/issues/${child.id}`).set(headers).send({ status: shippedKey });
    expect(moved.status).toBe(200);

    const res = await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });
    expect(res.status).toBe(200);
  });

  test('moving between two done columns is never blocked', async () => {
    // Reachable for rows that predate the guard: a parent already done, with a
    // child that is still open. Re-filing it under another done column is not
    // a new completion and must not be rejected.
    const story = await createIn(customProjectId, { title: 'Already done', type: 'story' });
    await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });
    await createIn(customProjectId, { title: 'Late child', type: 'subtask', parent_id: story.id });

    const res = await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: shippedKey });
    expect(res.status).toBe(200);
  });

  test('reopening a done parent with open children is never blocked', async () => {
    const story = await createIn(customProjectId, { title: 'Reopenable', type: 'story' });
    await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'done' });
    await createIn(customProjectId, { title: 'Added later', type: 'subtask', parent_id: story.id });

    const res = await request(app).put(`/api/issues/${story.id}`).set(headers).send({ status: 'in_progress' });
    expect(res.status).toBe(200);
  });
});
