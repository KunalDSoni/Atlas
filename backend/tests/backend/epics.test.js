/**
 * EPIC SUPPORT TESTS — hierarchy validation, parent join, epic_color
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

let app, headers, projectId, otherProjectId;

async function createIssue(body, pid = projectId) {
  const res = await request(app).post(`/api/projects/${pid}/issues`).set(headers).send(body);
  return res;
}

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  // Select by key, not index: the projects list is ORDER BY created_at and all
  // seed rows share one timestamp, so index order is not guaranteed once the
  // ATLAS project is seeded (Task 3). ATL also has the sprint these tests need.
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'ATL').id;
  otherProjectId = projects.body.find((p) => p.key === 'MOB').id;
});

describe('creating epics', () => {
  test('creates an epic with a color', async () => {
    const res = await createIssue({ title: 'Big Epic', type: 'epic', epic_color: 'teal' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('epic');
    expect(res.body.epic_color).toBe('teal');
  });

  test('epic_color defaults to purple', async () => {
    const res = await createIssue({ title: 'Default Color Epic', type: 'epic' });
    expect(res.status).toBe(201);
    expect(res.body.epic_color).toBe('purple');
  });

  test('rejects an epic with a sprint', async () => {
    const sprints = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    const res = await createIssue({ title: 'Bad Epic', type: 'epic', sprint_id: sprints.body[0].id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sprint/i);
  });

  test('rejects an epic with a parent', async () => {
    const epic = await createIssue({ title: 'Parent Epic A', type: 'epic' });
    const res = await createIssue({ title: 'Nested Epic', type: 'epic', parent_id: epic.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parent/i);
  });

  test('rejects an invalid epic color on create', async () => {
    const res = await createIssue({ title: 'Bad Color', type: 'epic', epic_color: 'chartreuse' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/color/i);
  });

  test('rejects an invalid epic color on update', async () => {
    const epic = await createIssue({ title: 'Recolor Me', type: 'epic' });
    const res = await request(app).put(`/api/issues/${epic.body.id}`).set(headers).send({ epic_color: null });
    expect(res.status).toBe(400);
  });
});

describe('assigning issues to epics', () => {
  let epicId;
  beforeAll(async () => {
    const epic = await createIssue({ title: 'Container Epic', type: 'epic' });
    epicId = epic.body.id;
  });

  test('creates a story under an epic and returns join fields', async () => {
    const res = await createIssue({ title: 'Child Story', type: 'story', parent_id: epicId });
    expect(res.status).toBe(201);
    expect(res.body.parent_id).toBe(epicId);
    expect(res.body.epic_title).toBe('Container Epic');
    expect(res.body.epic_badge_color).toBe('purple');
    expect(res.body.epic_key).toMatch(/-\d+$/);
  });

  test('assigns an existing issue to an epic via PUT', async () => {
    const issue = await createIssue({ title: 'Adopt Me', type: 'task' });
    const res = await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ parent_id: epicId });
    expect(res.status).toBe(200);
    expect(res.body.parent_id).toBe(epicId);
    expect(res.body.epic_title).toBe('Container Epic');
  });

  test('clears the epic link with parent_id null', async () => {
    const issue = await createIssue({ title: 'Leave Me', type: 'task', parent_id: epicId });
    const res = await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ parent_id: null });
    expect(res.status).toBe(200);
    expect(res.body.parent_id).toBeNull();
    expect(res.body.epic_key).toBeNull();
  });

  test('rejects a parent that is not an epic', async () => {
    const story = await createIssue({ title: 'Not An Epic', type: 'story' });
    const res = await createIssue({ title: 'Bad Child', type: 'task', parent_id: story.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/epic/i);
  });

  test('rejects a missing parent', async () => {
    const res = await createIssue({ title: 'Orphan', type: 'task', parent_id: 'no-such-id' });
    expect(res.status).toBe(400);
  });

  test('rejects a parent epic from another project', async () => {
    const foreignEpic = await createIssue({ title: 'Foreign Epic', type: 'epic' }, otherProjectId);
    const res = await createIssue({ title: 'Cross Child', type: 'task', parent_id: foreignEpic.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/project/i);
  });
});

describe('type-change guards', () => {
  test('cannot convert an epic with children to a story', async () => {
    const epic = await createIssue({ title: 'Guarded Epic', type: 'epic' });
    await createIssue({ title: 'Its Child', type: 'task', parent_id: epic.body.id });
    const res = await request(app).put(`/api/issues/${epic.body.id}`).set(headers).send({ type: 'story' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/child/i);
  });

  test('cannot convert an issue in a sprint to an epic', async () => {
    const sprints = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    // Any sprint that can still take work: the list now includes completed
    // calendar windows, and creating into one is refused before the type guard
    // under test ever gets a chance to speak.
    const open = sprints.body.find((s) => s.status !== 'completed');
    const issue = await createIssue({ title: 'Sprinted', type: 'task', sprint_id: open.id });
    const res = await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ type: 'epic' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sprint/i);
  });

  test('cannot move an epic into a sprint via /move', async () => {
    const epic = await createIssue({ title: 'Unmovable Epic', type: 'epic' });
    const sprints = await request(app).get(`/api/projects/${projectId}/sprints`).set(headers);
    const res = await request(app)
      .put(`/api/issues/${epic.body.id}/move`)
      .set(headers)
      .send({ sprint_id: sprints.body[0].id });
    expect(res.status).toBe(400);
  });

  test('epic status can still change via /move (board excludes epics, API stays generic)', async () => {
    const epic = await createIssue({ title: 'Progressing Epic', type: 'epic' });
    const res = await request(app)
      .put(`/api/issues/${epic.body.id}/move`)
      .set(headers)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });

  test('records an "epic" activity entry when parent changes', async () => {
    const epic = await createIssue({ title: 'Activity Epic', type: 'epic' });
    const issue = await createIssue({ title: 'Activity Child', type: 'task' });
    await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ parent_id: epic.body.id });
    const act = await request(app).get(`/api/issues/${issue.body.id}/activity`).set(headers);
    expect(act.status).toBe(200);
    expect(act.body.some((a) => a.field === 'epic')).toBe(true);
  });
});

describe('epic rollup + children endpoints', () => {
  let epicId;

  beforeAll(async () => {
    const epic = await createIssue({ title: 'Rollup Epic', type: 'epic', epic_color: 'green' });
    epicId = epic.body.id;
    await createIssue({ title: 'Rollup Child 1', type: 'story', parent_id: epicId, story_points: 5 });
    const c2 = await createIssue({ title: 'Rollup Child 2', type: 'task', parent_id: epicId, story_points: 3 });
    await request(app).put(`/api/issues/${c2.body.id}`).set(headers).send({ status: 'done' });
  });

  test('GET /projects/:id/epics returns rollup counts and points', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/epics`).set(headers);
    expect(res.status).toBe(200);
    const epic = res.body.find((e) => e.id === epicId);
    expect(epic).toBeDefined();
    expect(epic.child_count).toBe(2);
    expect(epic.done_count).toBe(1);
    expect(epic.total_points).toBe(8);
    expect(epic.done_points).toBe(3);
    expect(res.body.every((e) => e.type === 'epic')).toBe(true);
  });

  test('GET /issues/:id/children lists the epic children enriched', async () => {
    const res = await request(app).get(`/api/issues/${epicId}/children`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0]).toHaveProperty('assignee_name');
    expect(res.body.map((c) => c.title).sort()).toEqual(['Rollup Child 1', 'Rollup Child 2']);
  });

  test('deleting an epic orphans its children instead of deleting them', async () => {
    const epic = await createIssue({ title: 'Doomed Epic', type: 'epic' });
    const child = await createIssue({ title: 'Survivor', type: 'task', parent_id: epic.body.id });

    const del = await request(app).delete(`/api/issues/${epic.body.id}`).set(headers);
    expect(del.status).toBe(200);

    const survivor = await request(app).get(`/api/issues/${child.body.id}`).set(headers);
    expect(survivor.status).toBe(200);
    expect(survivor.body.parent_id).toBeNull();
    expect(survivor.body.epic_key).toBeNull();
  });
});

describe('Atlas Development dogfood seed', () => {
  test('seeds the ATLAS project with 54 roadmap epics, Epic support done', async () => {
    const projects = await request(app).get('/api/projects').set(headers);
    const atlas = projects.body.find((p) => p.key === 'ATLAS');
    expect(atlas).toBeDefined();
    expect(atlas.name).toBe('Atlas Development');

    const epics = await request(app).get(`/api/projects/${atlas.id}/epics`).set(headers);
    expect(epics.status).toBe(200);
    // 12 parity + 6 Productboard + 1 wiki UX + 1 wiki AI + 5 platform-depth + 3 hardening
    // + 2 data-layer/perf + 2 wiki-link + 2 flow/jql + 2 ops/approvals + 2 tasks
    // + 1 wiki focus mode + 6 service desk (foundation, help center, queues, SLAs,
    // deflection, CSAT + report)
    // + 4 product discovery (capture, demand, themes, spec drafting)
    // + 2 loop-closing epics (outcome tracking, Portal v2)
    // + 1 JQL v2/SLA-aware queues epic
    // + 1 customizable dashboard gadgets epic
    // + 1 personal JQL saved filters epic. Epic 46 is a reserved ordinal, not
    // a seeded epic, so 54 rows carry roadmap ordinals through Epic 55.
    expect(epics.body.length).toBe(54);

    const first = epics.body.find((e) => e.issue_key === 'ATLAS-1');
    expect(first.title).toBe('Epic support');
    expect(first.status).toBe('done');
    const second = epics.body.find((e) => e.issue_key === 'ATLAS-2');
    expect(second.title).toBe('Subtasks');
    expect(second.status).toBe('done');
    // Every roadmap epic is seeded done.
    expect(epics.body.filter((e) => e.status === 'done').length).toBe(54);
    expect(epics.body.some((e) => e.title === 'Product: Insights inbox')).toBe(true);
    expect(epics.body.some((e) => e.title === 'Wiki AI assistant')).toBe(true);
    expect(epics.body.some((e) => e.title === 'Custom fields')).toBe(true);
    expect(epics.body.some((e) => e.title === 'E2E verification harness')).toBe(true);
    expect(epics.body.some((e) => e.title === 'Batched issue enrichment')).toBe(true);
    expect(epics.body.some((e) => e.title === 'Page back-links')).toBe(true);
    expect(epics.body.some((e) => e.title === 'Flow metrics')).toBe(true);
    expect(epics.body.some((e) => e.title === 'Product: Outcome tracking')).toBe(true);
    expect(epics.body.some((e) => e.title === 'Product: Portal v2')).toBe(true);
    expect(epics.body.some((e) => e.title === 'JQL v2 and SLA-aware queues')).toBe(true);
    expect(epics.body.some((e) => e.title === 'Customizable dashboard gadgets')).toBe(true);
    expect(epics.body.some((e) => e.title === 'Personal JQL saved filters')).toBe(true);
    expect(epics.body.some((e) => e.title === 'Page approvals')).toBe(true);
    expect(epics.body.some((e) => e.title === 'Wiki task lists')).toBe(true);
  });
});
