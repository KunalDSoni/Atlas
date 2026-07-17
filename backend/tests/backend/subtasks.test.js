/**
 * SUBTASK TESTS — hierarchy rules, sprint rejection, type-change guards
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

let app, headers, projectId, otherProjectId, storyId;

async function createIssue(body, pid = projectId) {
  const res = await request(app).post(`/api/projects/${pid}/issues`).set(headers).send(body);
  return res;
}

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'ATL').id;
  otherProjectId = projects.body.find((p) => p.key === 'MOB').id;
  const story = await createIssue({ title: 'Host Story', type: 'story' });
  storyId = story.body.id;
});

describe('creating subtasks', () => {
  test('creates a subtask under a story', async () => {
    const res = await createIssue({ title: 'My Subtask', type: 'subtask', parent_id: storyId });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('subtask');
    expect(res.body.parent_id).toBe(storyId);
  });

  test('creates a subtask under a task and a bug', async () => {
    const task = await createIssue({ title: 'Host Task', type: 'task' });
    const bug = await createIssue({ title: 'Host Bug', type: 'bug' });
    const s1 = await createIssue({ title: 'Under Task', type: 'subtask', parent_id: task.body.id });
    const s2 = await createIssue({ title: 'Under Bug', type: 'subtask', parent_id: bug.body.id });
    expect(s1.status).toBe(201);
    expect(s2.status).toBe(201);
  });

  test('rejects a subtask without a parent', async () => {
    const res = await createIssue({ title: 'Orphan Subtask', type: 'subtask' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parent/i);
  });

  test('rejects a subtask whose parent is an epic', async () => {
    const epic = await createIssue({ title: 'An Epic', type: 'epic' });
    const res = await createIssue({ title: 'Bad Subtask', type: 'subtask', parent_id: epic.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/story, task, or bug/i);
  });

  test('rejects a subtask whose parent is another subtask', async () => {
    const sub = await createIssue({ title: 'Level One', type: 'subtask', parent_id: storyId });
    const res = await createIssue({ title: 'Level Two', type: 'subtask', parent_id: sub.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/story, task, or bug/i);
  });

  test('rejects a subtask whose parent is in another project', async () => {
    const foreign = await createIssue({ title: 'Foreign Story', type: 'story' }, otherProjectId);
    const res = await createIssue({ title: 'Cross Subtask', type: 'subtask', parent_id: foreign.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/project/i);
  });

  test('rejects a subtask created with a sprint', async () => {
    const sprints = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    const res = await createIssue({ title: 'Sprinted Subtask', type: 'subtask', parent_id: storyId, sprint_id: sprints.body[0].id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sprint/i);
  });
});

describe('updating subtasks', () => {
  test('rejects assigning a sprint to a subtask via PUT', async () => {
    const sub = await createIssue({ title: 'No Sprint For Me', type: 'subtask', parent_id: storyId });
    const sprints = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    const res = await request(app).put(`/api/issues/${sub.body.id}`).set(headers).send({ sprint_id: sprints.body[0].id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sprint/i);
  });

  test('rejects moving a subtask into a sprint via /move', async () => {
    const sub = await createIssue({ title: 'Unmovable Subtask', type: 'subtask', parent_id: storyId });
    const sprints = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    const res = await request(app)
      .put(`/api/issues/${sub.body.id}/move`)
      .set(headers)
      .send({ sprint_id: sprints.body[0].id });
    expect(res.status).toBe(400);
  });

  test('subtask status can change via /move (used by detail sheet)', async () => {
    const sub = await createIssue({ title: 'Progressing Subtask', type: 'subtask', parent_id: storyId });
    const res = await request(app)
      .put(`/api/issues/${sub.body.id}/move`)
      .set(headers)
      .send({ status: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
  });

  test('reparents a subtask to another story', async () => {
    const other = await createIssue({ title: 'New Home', type: 'story' });
    const sub = await createIssue({ title: 'Mover', type: 'subtask', parent_id: storyId });
    const res = await request(app).put(`/api/issues/${sub.body.id}`).set(headers).send({ parent_id: other.body.id });
    expect(res.status).toBe(200);
    expect(res.body.parent_id).toBe(other.body.id);
  });

  test('rejects clearing a subtask parent without a type change', async () => {
    const sub = await createIssue({ title: 'Clingy', type: 'subtask', parent_id: storyId });
    const res = await request(app).put(`/api/issues/${sub.body.id}`).set(headers).send({ parent_id: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parent/i);
  });
});

describe('type-change guards', () => {
  test('a story with subtasks cannot become a subtask', async () => {
    const host = await createIssue({ title: 'Busy Story', type: 'story' });
    await createIssue({ title: 'Its Sub', type: 'subtask', parent_id: host.body.id });
    const res = await request(app).put(`/api/issues/${host.body.id}`).set(headers).send({ type: 'subtask', parent_id: storyId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subtask/i);
  });

  test('a story with subtasks cannot become an epic', async () => {
    const host = await createIssue({ title: 'Busy Story 2', type: 'story' });
    await createIssue({ title: 'Its Sub 2', type: 'subtask', parent_id: host.body.id });
    const res = await request(app).put(`/api/issues/${host.body.id}`).set(headers).send({ type: 'epic' });
    expect(res.status).toBe(400);
  });

  test('a story with subtasks CAN become a task', async () => {
    const host = await createIssue({ title: 'Flexible Story', type: 'story' });
    await createIssue({ title: 'Its Sub 3', type: 'subtask', parent_id: host.body.id });
    const res = await request(app).put(`/api/issues/${host.body.id}`).set(headers).send({ type: 'task' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('task');
  });

  test('a subtask becomes a task when the parent is cleared in the same request', async () => {
    const sub = await createIssue({ title: 'Promote Me', type: 'subtask', parent_id: storyId });
    const res = await request(app).put(`/api/issues/${sub.body.id}`).set(headers).send({ type: 'task', parent_id: null });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('task');
    expect(res.body.parent_id).toBeNull();
  });

  test('a subtask cannot become a task while keeping its story parent', async () => {
    const sub = await createIssue({ title: 'Stuck', type: 'subtask', parent_id: storyId });
    const res = await request(app).put(`/api/issues/${sub.body.id}`).set(headers).send({ type: 'task' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/epic/i);
  });

  test('a task cannot become a subtask without a valid parent', async () => {
    const task = await createIssue({ title: 'Demote Me', type: 'task' });
    const res = await request(app).put(`/api/issues/${task.body.id}`).set(headers).send({ type: 'subtask' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parent/i);
  });

  test('epics with children still cannot change type (regression)', async () => {
    const epic = await createIssue({ title: 'Guarded Epic X', type: 'epic' });
    await createIssue({ title: 'Epic Child X', type: 'task', parent_id: epic.body.id });
    const res = await request(app).put(`/api/issues/${epic.body.id}`).set(headers).send({ type: 'story' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/child/i);
  });
});
