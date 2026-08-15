/**
 * SPRINTS MODULE TESTS
 * Tests: CRUD, status transitions, issue assignment
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders, userHeaders } = require('./setup');

let app, headers, projectId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
});

describe('GET /api/projects/:id/sprints', () => {
  test('should return sprints for project', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/projects/:id/sprints', () => {
  test('should create a sprint', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: 'Test Sprint', goal: 'Finish tests', start_date: '2026-04-01', end_date: '2026-04-14' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Sprint');
    expect(res.body.status).toBe('planning');
  });

  test('should reject missing name', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ goal: 'No name sprint' });

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/sprints/:id', () => {
  let sprintId;

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: 'Update Sprint' });
    sprintId = res.body.id;
  });

  test('should update sprint name', async () => {
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({ name: 'Updated Sprint Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Sprint Name');
  });

  test('should activate sprint', async () => {
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({ status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  test('should complete sprint', async () => {
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });
});

// Jira's rules, which Atlas follows: a completed sprint can be renamed but not
// re-dated, re-statused or deleted. Reopening is its own endpoint.
describe('a completed sprint is partly frozen', () => {
  let sprintId;

  beforeEach(async () => {
    const created = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: `Frozen Sprint ${Date.now()}`, goal: 'Original goal', end_date: '2026-05-01' });
    sprintId = created.body.id;
    await request(app).put(`/api/sprints/${sprintId}`).set(headers).send({ status: 'completed' });
  });

  test('should allow renaming it', async () => {
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({ name: 'Renamed after the fact' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed after the fact');
  });

  test('should allow editing its goal', async () => {
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({ goal: 'Retrospective notes' });

    expect(res.status).toBe(200);
    expect(res.body.goal).toBe('Retrospective notes');
  });

  test('should refuse to change its dates', async () => {
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({ end_date: '2026-09-09' });

    expect(res.status).toBe(409);

    const after = await request(app).get(`/api/sprints/${sprintId}`).set(headers);
    expect(after.body.end_date).not.toBe('2026-09-09');
  });

  test('should refuse to re-status it through PUT', async () => {
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({ status: 'active' });

    expect(res.status).toBe(409);

    const after = await request(app).get(`/api/sprints/${sprintId}`).set(headers);
    expect(after.body.status).toBe('completed');
  });

  // The edit dialog submits the whole record, so an unchanged date and status ride
  // along with every rename. Refusing those would block the rename Jira allows.
  test('should accept a rename that resubmits unchanged dates and status', async () => {
    const before = await request(app).get(`/api/sprints/${sprintId}`).set(headers);
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({
        name: 'Renamed with full payload',
        goal: before.body.goal,
        start_date: before.body.start_date,
        end_date: before.body.end_date,
        status: before.body.status,
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed with full payload');
  });

  test('should treat a cleared date as unchanged when it was already empty', async () => {
    const res = await request(app)
      .put(`/api/sprints/${sprintId}`)
      .set(headers)
      .send({ name: 'Renamed with empty start', start_date: '' });

    expect(res.status).toBe(200);
  });

  test('should refuse to delete it', async () => {
    const res = await request(app).delete(`/api/sprints/${sprintId}`).set(headers);

    expect(res.status).toBe(409);

    const after = await request(app).get(`/api/sprints/${sprintId}`).set(headers);
    expect(after.status).toBe(200);
  });
});

describe('POST /api/sprints/:id/reopen', () => {
  let seededActive = null;

  // The demo project ships with a running sprint, and Atlas refuses to reopen
  // alongside one. Park every active sprint before each case so a leftover from a
  // failed assertion cannot cascade into the next test, and restore the seeded one
  // when the block finishes.
  beforeAll(async () => {
    const list = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    const running = list.body.find((s) => s.status === 'active');
    seededActive = running ? running.id : null;
  });

  beforeEach(async () => {
    const list = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    for (const s of list.body.filter((s) => s.status === 'active')) {
      await request(app).put(`/api/sprints/${s.id}`).set(headers).send({ status: 'planning' });
    }
  });

  afterAll(async () => {
    if (seededActive) {
      await request(app).put(`/api/sprints/${seededActive}`).set(headers).send({ status: 'active' });
    }
  });

  async function completedSprint(name) {
    const created = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: `${name} ${Date.now()}`, end_date: '2026-05-01' });
    await request(app).put(`/api/sprints/${created.body.id}`).set(headers).send({ status: 'completed' });
    return created.body.id;
  }

  test('should reopen a completed sprint with a new end date', async () => {
    const sprintId = await completedSprint('Reopen Me');

    const res = await request(app)
      .post(`/api/sprints/${sprintId}/reopen`)
      .set(headers)
      .send({ end_date: '2026-12-01' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(String(res.body.end_date).slice(0, 10)).toBe('2026-12-01');

    // Put it back so it cannot collide with later reopen tests.
    await request(app).put(`/api/sprints/${sprintId}`).set(headers).send({ status: 'completed' });
  });

  test('should refuse to reopen a sprint that is not completed', async () => {
    const created = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: `Never Completed ${Date.now()}` });

    const res = await request(app)
      .post(`/api/sprints/${created.body.id}/reopen`)
      .set(headers)
      .send({ end_date: '2026-12-01' });

    expect(res.status).toBe(409);
  });

  test('should refuse to reopen while another sprint is active', async () => {
    const sprintId = await completedSprint('Blocked Reopen');
    const other = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: `Running Sprint ${Date.now()}` });
    await request(app).put(`/api/sprints/${other.body.id}`).set(headers).send({ status: 'active' });

    const res = await request(app)
      .post(`/api/sprints/${sprintId}/reopen`)
      .set(headers)
      .send({ end_date: '2026-12-01' });

    expect(res.status).toBe(409);

    const after = await request(app).get(`/api/sprints/${sprintId}`).set(headers);
    expect(after.body.status).toBe('completed');

    await request(app).put(`/api/sprints/${other.body.id}`).set(headers).send({ status: 'completed' });
  });

  test('should require a new end date', async () => {
    const sprintId = await completedSprint('No End Date');

    const res = await request(app).post(`/api/sprints/${sprintId}/reopen`).set(headers).send({});

    expect(res.status).toBe(400);
  });

  test('should 404 an unknown sprint', async () => {
    const res = await request(app)
      .post('/api/sprints/does-not-exist/reopen')
      .set(headers)
      .send({ end_date: '2026-12-01' });

    expect(res.status).toBe(404);
  });

  test('should refuse a non-admin', async () => {
    const sprintId = await completedSprint('Permission Check');
    const memberHeaders = await userHeaders();

    const res = await request(app)
      .post(`/api/sprints/${sprintId}/reopen`)
      .set(memberHeaders)
      .send({ end_date: '2026-12-01' });

    expect(res.status).toBe(403);
  });
});

describe('completing a sprint with unfinished subtasks', () => {
  test('should refuse while a subtask is unfinished, and allow it once done', async () => {
    const sprint = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: `Subtask Sprint ${Date.now()}` });

    const parent = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Parent story', type: 'story', priority: 'medium', sprint_id: sprint.body.id });

    const subtask = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Loose end', type: 'subtask', priority: 'medium', parent_id: parent.body.id });

    const blocked = await request(app)
      .put(`/api/sprints/${sprint.body.id}`)
      .set(headers)
      .send({ status: 'completed' });

    expect(blocked.status).toBe(409);
    expect(blocked.body.blocked_by).toContain(parent.body.issue_key);

    await request(app).put(`/api/issues/${subtask.body.id}`).set(headers).send({ status: 'done' });

    const allowed = await request(app)
      .put(`/api/sprints/${sprint.body.id}`)
      .set(headers)
      .send({ status: 'completed' });

    expect(allowed.status).toBe(200);
    expect(allowed.body.status).toBe('completed');
  });

  // parent_id carries story->epic links too. An epic with unfinished stories is
  // ordinary in-progress work, not a blocked sprint.
  test('should not be blocked by an epic with unfinished stories', async () => {
    const sprint = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: `Epic Sprint ${Date.now()}` });

    const epic = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Parent epic', type: 'epic', priority: 'medium', sprint_id: sprint.body.id });

    await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Child story', type: 'story', priority: 'medium', parent_id: epic.body.id });

    const res = await request(app)
      .put(`/api/sprints/${sprint.body.id}`)
      .set(headers)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/sprints/:id', () => {
  // "The next sprint in the list" depends on what else is in the project, and the
  // demo project is shared with every other block in this file. Own project, own
  // list, no coupling.
  let projectId;

  beforeAll(async () => {
    const suffix = Date.now().toString().slice(-6);
    const created = await request(app)
      .post('/api/projects')
      .set(headers)
      .send({ name: `Sprint Deletion ${suffix}`, key: `SD${suffix}` });
    projectId = created.body.id;
  });

  test('should refuse to delete an active sprint', async () => {
    const sprint = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: `Running ${Date.now()}` });
    await request(app).put(`/api/sprints/${sprint.body.id}`).set(headers).send({ status: 'active' });

    const res = await request(app).delete(`/api/sprints/${sprint.body.id}`).set(headers);
    expect(res.status).toBe(409);

    const after = await request(app).get(`/api/sprints/${sprint.body.id}`).set(headers);
    expect(after.status).toBe(200);

    await request(app).put(`/api/sprints/${sprint.body.id}`).set(headers).send({ status: 'completed' });
  });

  // created_at has second resolution, so sprints created back to back in a test tie
  // and the list has no meaningful order between them. Let the clock tick over so
  // "the next sprint in the list" means what it means in production.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1100));

  // Jira moves them to the next sprint in the list, not to the backlog.
  test('should move issues to the next sprint when one follows', async () => {
    const doomed = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: `Doomed ${Date.now()}` });

    await tick();

    const successor = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: `Successor ${Date.now()}` });

    const issue = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Carried over', type: 'task', priority: 'medium', sprint_id: doomed.body.id });

    const res = await request(app).delete(`/api/sprints/${doomed.body.id}`).set(headers);
    expect(res.status).toBe(200);

    const issueRes = await request(app).get(`/api/issues/${issue.body.id}`).set(headers);
    expect(issueRes.body.sprint_id).toBe(successor.body.id);
  });

  test('should fall back to the backlog when no sprint follows', async () => {
    // Strictly the newest sprint in the project, so nothing follows it in the list.
    await tick();
    const sprint = await request(app)
      .post(`/api/projects/${projectId}/sprints`)
      .set(headers)
      .send({ name: `Last Sprint ${Date.now()}` });

    const issue = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Sprint Issue', type: 'task', priority: 'medium', sprint_id: sprint.body.id });

    const res = await request(app).delete(`/api/sprints/${sprint.body.id}`).set(headers);
    expect(res.status).toBe(200);

    const issueRes = await request(app).get(`/api/issues/${issue.body.id}`).set(headers);
    expect(issueRes.body.sprint_id).toBeNull();
  });
});
