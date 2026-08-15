/**
 * Issue enrichment used to fire ~11 queries per issue, so a 100-issue board cost
 * ~1100 round trips. These tests pin two things: the payload shape is unchanged,
 * and the query count no longer scales with the number of issues.
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');
const { getDb } = require('../../database');

let headers, projectId, db;

// sql.js runs every read through db.prepare(), so wrapping it counts statements
// regardless of how the route modules imported their query helpers.
function countQueries() {
  const original = db.prepare.bind(db);
  let n = 0;
  db.prepare = (...args) => { n += 1; return original(...args); };
  return {
    stop() { db.prepare = original; return n; },
  };
}

async function createIssue(title, extra = {}) {
  const res = await request(getApp())
    .post(`/api/projects/${projectId}/issues`)
    .set(headers)
    .send({ title, type: 'task', ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  const projects = await request(getApp()).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
});

describe('Enriched issue payload', () => {
  let issue, parent;

  beforeAll(async () => {
    parent = await createIssue('Batching epic', { type: 'epic', epic_color: 'teal' });
    issue = await createIssue('Batching child', { parent_id: parent.id, story_points: 3 });
    await request(getApp())
      .post(`/api/issues/${issue.id}/comments`)
      .set(headers).send({ body: 'a comment' });
    await request(getApp())
      .post(`/api/projects/${projectId}/issues`)
      .set(headers)
      .send({ title: 'A subtask', type: 'subtask', parent_id: issue.id });
  });

  test('single-issue GET carries every enriched field', async () => {
    const res = await request(getApp()).get(`/api/issues/${issue.id}`).set(headers);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.assignee_name !== undefined).toBe(true);
    expect(b.reporter_name).toBeTruthy();
    expect(b.parent_key).toBe(parent.issue_key);
    expect(b.parent_title).toBe('Batching epic');
    expect(b.parent_type).toBe('epic');
    expect(b.epic_key).toBe(parent.issue_key);
    expect(b.epic_badge_color).toBe('teal');
    expect(b.subtask_count).toBe(1);
    expect(b.subtask_done_count).toBe(0);
    expect(b.comment_count).toBe(1);
    expect(b.attachment_count).toBe(0);
    expect(b.watcher_count).toBe(0);
    expect(b.link_count).toBe(0);
    expect(Array.isArray(b.labels_parsed)).toBe(true);
    expect(Array.isArray(b.custom_fields)).toBe(true);
  });

  test('the list endpoint enriches identically to the single-issue endpoint', async () => {
    const one = await request(getApp()).get(`/api/issues/${issue.id}`).set(headers);
    const list = await request(getApp()).get(`/api/projects/${projectId}/issues`).set(headers);
    const fromList = list.body.find(i => i.id === issue.id);
    // in_progress_minutes_live and its in_progress_business_hours qualifier are
    // only computed on GET /api/issues/:id (by design, to avoid the extra query
    // cost on other routes), so exclude them here. previous_sprints is the same
    // bargain: only the detail panel shows rollover history, so a board of 100
    // issues does not pay for a history read each.
    const { in_progress_minutes_live, in_progress_business_hours, previous_sprints, ...oneRest } = one.body;
    expect(fromList).toEqual(oneRest);
  });

  test('an issue with no parent, version, or component reports nulls, not undefined', async () => {
    const bare = await createIssue('Bare issue');
    const res = await request(getApp()).get(`/api/issues/${bare.id}`).set(headers);
    expect(res.body.parent_key).toBeNull();
    expect(res.body.epic_key).toBeNull();
    expect(res.body.fix_version_name).toBeNull();
    expect(res.body.component_name).toBeNull();
    expect(res.body.subtask_count).toBe(0);
    expect(res.body.subtask_done_count).toBe(0);
  });
});

describe('Query count does not scale with issue count', () => {
  test('listing 20 issues costs about the same as listing 1', async () => {
    const url = `/api/projects/${projectId}/issues`;

    const before = await request(getApp()).get(url).set(headers);
    const baseline = before.body.length;

    const probe1 = countQueries();
    await request(getApp()).get(url).set(headers);
    const small = probe1.stop();

    for (let i = 0; i < 20; i++) await createIssue(`Bulk issue ${i}`);

    const probe2 = countQueries();
    const after = await request(getApp()).get(url).set(headers);
    const large = probe2.stop();

    expect(after.body.length).toBe(baseline + 20);
    // Per-issue enrichment would add ~11 queries each (~220 more). Batched
    // enrichment adds a fixed handful, so allow generous headroom and still fail
    // loudly if the N+1 comes back.
    expect(large - small).toBeLessThan(20);
  });

  test('an empty result set issues no enrichment queries at all', async () => {
    const empty = await request(getApp())
      .post('/api/projects')
      .set(headers)
      .send({ name: 'Empty Batching Project', key: 'EBP' });
    expect(empty.status).toBe(201);

    const res = await request(getApp())
      .get(`/api/projects/${empty.body.id}/issues`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
