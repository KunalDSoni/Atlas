/**
 * SPRINT ROLLOVER TESTS
 *
 * Two rules, one subject: what happens to an issue when the sprint under it
 * closes. It remembers where it came from, and nothing new can be put back.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { getDb, run } = require('../../database');

let app, headers, projectId, db;

beforeAll(async () => {
  app = await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
});

async function makeSprint(name) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/sprints`)
    .set(headers)
    .send({ name });
  return res.body.id;
}

async function completeSprint(id) {
  return request(app).put(`/api/sprints/${id}`).set(headers).send({ status: 'completed' });
}

async function makeIssue(title, sprintId) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/issues`)
    .set(headers)
    .send({ title, type: 'task', sprint_id: sprintId ?? null });
  return res.body.id;
}

const setSprint = (issueId, sprintId) =>
  request(app).put(`/api/issues/${issueId}`).set(headers).send({ sprint_id: sprintId });

const getIssue = (issueId) => request(app).get(`/api/issues/${issueId}`).set(headers);

describe('an issue remembers the sprints it rolled over from', () => {
  test('names the past sprint once that sprint is completed', async () => {
    const first = await makeSprint('Rollover One');
    const next = await makeSprint('Rollover Two');
    const issueId = await makeIssue('Carries over', first);

    await setSprint(issueId, next);
    await completeSprint(first);

    const res = await getIssue(issueId);
    expect(res.status).toBe(200);
    expect(res.body.previous_sprints.map((s) => s.name)).toEqual(['Rollover One']);
  });

  test('accumulates every completed sprint it passed through', async () => {
    const one = await makeSprint('Chain One');
    const two = await makeSprint('Chain Two');
    const three = await makeSprint('Chain Three');
    const issueId = await makeIssue('Slipped twice', one);

    await setSprint(issueId, two);
    await completeSprint(one);
    await setSprint(issueId, three);
    await completeSprint(two);

    const res = await getIssue(issueId);
    expect(res.body.previous_sprints.map((s) => s.name).sort())
      .toEqual(['Chain One', 'Chain Two']);
  });

  // Ordering is by when the issue left each sprint. A test that just makes the
  // moves back to back cannot prove it — every row lands in the same second,
  // and it would pass on whatever order the engine scanned. So the exit times
  // are written directly, days apart, and out of order.
  test('reads oldest first, by when the issue left each sprint', async () => {
    const june = await makeSprint('June Sprint');
    const july = await makeSprint('July Sprint');
    const august = await makeSprint('August Sprint');
    const issueId = await makeIssue('Two months late', june);

    await setSprint(issueId, july);
    await setSprint(issueId, august);
    await completeSprint(june);
    await completeSprint(july);

    await run(db, "UPDATE activity_log SET created_at = '2026-07-01 09:00:00' WHERE issue_id = ? AND old_value = ?", [issueId, june]);
    await run(db, "UPDATE activity_log SET created_at = '2026-08-01 09:00:00' WHERE issue_id = ? AND old_value = ?", [issueId, july]);

    const res = await getIssue(issueId);
    expect(res.body.previous_sprints.map((s) => s.name)).toEqual(['June Sprint', 'July Sprint']);

    // Same data, reversed exit times: the line follows the issue, not the
    // order the sprints were created in.
    await run(db, "UPDATE activity_log SET created_at = '2026-09-01 09:00:00' WHERE issue_id = ? AND old_value = ?", [issueId, june]);

    const flipped = await getIssue(issueId);
    expect(flipped.body.previous_sprints.map((s) => s.name)).toEqual(['July Sprint', 'June Sprint']);
  });

  // The distinction the whole feature rests on: leaving a sprint that never
  // closed is a correction, not a rollover.
  test('ignores a move between sprints that are still open', async () => {
    const wrong = await makeSprint('Wrong Sprint');
    const right = await makeSprint('Right Sprint');
    const issueId = await makeIssue('Filed against the wrong sprint', wrong);

    await setSprint(issueId, right);

    const res = await getIssue(issueId);
    expect(res.body.previous_sprints).toEqual([]);
  });

  test('never lists the sprint the issue is in right now', async () => {
    const home = await makeSprint('Home Sprint');
    const detour = await makeSprint('Detour Sprint');
    const issueId = await makeIssue('Went and came back', home);

    await setSprint(issueId, detour);
    await setSprint(issueId, home);
    await completeSprint(detour);

    const res = await getIssue(issueId);
    expect(res.body.previous_sprints.map((s) => s.name)).toEqual(['Detour Sprint']);
    expect(res.body.previous_sprints.map((s) => s.id)).not.toContain(home);
  });

  test('an issue that never moved has no history', async () => {
    const only = await makeSprint('Only Sprint');
    const issueId = await makeIssue('Stayed put', only);

    const res = await getIssue(issueId);
    expect(res.body.previous_sprints).toEqual([]);
  });

  // A board of 100 issues must not pay for a history read each.
  test('the list payload omits the history', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/issues`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((i) => i.previous_sprints === undefined)).toBe(true);
  });
});

describe('a completed sprint takes no new work', () => {
  let closed;

  beforeAll(async () => {
    closed = await makeSprint('Closed For Business');
    await completeSprint(closed);
  });

  test('PUT moving an issue into it returns 409', async () => {
    const issueId = await makeIssue('Late arrival', null);
    const res = await setSprint(issueId, closed);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Closed For Business');

    const after = await getIssue(issueId);
    expect(after.body.sprint_id).toBeNull();
  });

  test('POST creating an issue into it returns 409', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'Born too late', type: 'task', sprint_id: closed });

    expect(res.status).toBe(409);
  });

  test('the board move endpoint returns 409 too', async () => {
    const issueId = await makeIssue('Dragged in', null);
    const res = await request(app)
      .put(`/api/issues/${issueId}/move`)
      .set(headers)
      .send({ status: 'todo', sprint_id: closed });

    expect(res.status).toBe(409);
  });

  // The done work left behind at close still lives in the sprint, and the edit
  // dialog resubmits the whole record. Rejecting on presence would make those
  // issues unsavable.
  test('an issue already in it can still be edited', async () => {
    const sprintId = await makeSprint('Holds Its Own');
    const issueId = await makeIssue('Finished in time', sprintId);
    await completeSprint(sprintId);

    const res = await request(app)
      .put(`/api/issues/${issueId}`)
      .set(headers)
      .send({ title: 'Finished in time, renamed', sprint_id: sprintId });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Finished in time, renamed');
  });

  test('an issue can still be moved out of it', async () => {
    const sprintId = await makeSprint('Lets Go');
    const open = await makeSprint('Open Sprint');
    const issueId = await makeIssue('Leftover', sprintId);
    await completeSprint(sprintId);

    const res = await setSprint(issueId, open);
    expect(res.status).toBe(200);
    expect(res.body.sprint_id).toBe(open);
  });

  test('moving an issue to the backlog is never blocked', async () => {
    const sprintId = await makeSprint('Backlog Exit');
    const issueId = await makeIssue('Going back', sprintId);
    await completeSprint(sprintId);

    const res = await setSprint(issueId, null);
    expect(res.status).toBe(200);
    expect(res.body.sprint_id).toBeNull();
  });

  // Reopening restores the sprint, and with it the right to take work. Its own
  // project, because reopening is refused while any other sprint is active and
  // the seeded project has one.
  test('a reopened sprint accepts work again', async () => {
    const project = await request(app)
      .post('/api/projects')
      .set(headers)
      .send({ name: 'Reopen Rollover Project', key: 'RRP' });
    const otherProject = project.body.id;

    const sprint = await request(app)
      .post(`/api/projects/${otherProject}/sprints`)
      .set(headers)
      .send({ name: 'Second Chance' });
    const sprintId = sprint.body.id;
    await completeSprint(sprintId);

    const reopened = await request(app)
      .post(`/api/sprints/${sprintId}/reopen`)
      .set(headers)
      .send({ end_date: '2026-12-31' });
    expect(reopened.status).toBe(200);

    const issue = await request(app)
      .post(`/api/projects/${otherProject}/issues`)
      .set(headers)
      .send({ title: 'Welcome back', type: 'task' });

    const res = await setSprint(issue.body.id, sprintId);
    expect(res.status).toBe(200);
    expect(res.body.sprint_id).toBe(sprintId);
  });
});
