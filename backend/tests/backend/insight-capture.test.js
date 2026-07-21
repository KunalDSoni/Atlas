/**
 * INSIGHT CAPTURE — Epic 47
 * Origin resolution, the capture endpoint, excerpt snapshotting, inbox triage.
 *
 * The rule under test throughout: capture reads text that already exists in
 * Atlas into the product module, and the caller must be allowed to see that
 * text. "Staff" is not the same as "may read every restricted wiki page".
 */
const request = require('supertest');
const { createTestApp, adminHeaders, userHeaders, loginAs } = require('./setup');

let app, headers, staffHeaders, clientHeaders, projectId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  staffHeaders = await userHeaders();
  clientHeaders = await loginAs('dana@customer.example.com', 'password123');
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'ATL').id;
});

async function anyIssueId() {
  const issues = await request(app).get(`/api/projects/${projectId}/issues`).set(headers);
  return issues.body.find((i) => i.type !== 'epic').id;
}

describe('origin resolution', () => {
  test('resolves an issue comment into an excerpt and a title', async () => {
    const { resolveOrigin } = require('../../utils/insight-origin');
    const { getDb, queryOne } = require('../../database');
    const db = await getDb();

    const issueId = await anyIssueId();
    const me = await queryOne(db, 'SELECT id, role FROM users WHERE email = ?', ['kunal@example.com']);
    const created = await request(app).post(`/api/issues/${issueId}/comments`).set(headers)
      .send({ body: 'Exporting to CSV every Monday is killing us.' });
    expect(created.status).toBe(201);

    const out = await resolveOrigin(db, 'comment', created.body.id, me.id, me.role);
    expect(out.ok).toBe(true);
    expect(out.excerpt).toContain('killing us');
    expect(out.title).toBeTruthy();
  });

  test('rejects an unknown origin kind with 400', async () => {
    const { resolveOrigin } = require('../../utils/insight-origin');
    const { getDb, queryOne } = require('../../database');
    const db = await getDb();
    const me = await queryOne(db, 'SELECT id, role FROM users WHERE email = ?', ['kunal@example.com']);

    const out = await resolveOrigin(db, 'telepathy', 'whatever', me.id, me.role);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
  });

  test('manual and portal are not capturable through this path', async () => {
    const { resolveOrigin } = require('../../utils/insight-origin');
    const { getDb, queryOne } = require('../../database');
    const db = await getDb();
    const me = await queryOne(db, 'SELECT id, role FROM users WHERE email = ?', ['kunal@example.com']);

    for (const kind of ['manual', 'portal']) {
      const out = await resolveOrigin(db, kind, 'anything', me.id, me.role);
      expect(out.ok).toBe(false);
      expect(out.status).toBe(400);
    }
  });

  test('a missing source row is a 404, not a crash', async () => {
    const { resolveOrigin } = require('../../utils/insight-origin');
    const { getDb, queryOne } = require('../../database');
    const db = await getDb();
    const me = await queryOne(db, 'SELECT id, role FROM users WHERE email = ?', ['kunal@example.com']);

    const out = await resolveOrigin(db, 'comment', 'no-such-comment', me.id, me.role);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(404);
  });

  test('an ordinary issue is rejected as a request origin', async () => {
    const { resolveOrigin } = require('../../utils/insight-origin');
    const { getDb, queryOne } = require('../../database');
    const db = await getDb();
    const me = await queryOne(db, 'SELECT id, role FROM users WHERE email = ?', ['kunal@example.com']);

    const issueId = await anyIssueId();
    const out = await resolveOrigin(db, 'request', issueId, me.id, me.role);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
  });

  test('a restricted wiki page is refused to a staff user who is not on the list', async () => {
    const { resolveOrigin } = require('../../utils/insight-origin');
    const { getDb, queryOne } = require('../../database');
    const db = await getDb();

    const spaces = await request(app).get('/api/wiki/spaces').set(headers);
    const page = await request(app)
      .post(`/api/wiki/spaces/${spaces.body[0].id}/pages`).set(headers).send({
        title: 'Board-only compensation notes',
        body: '<p>Salary bands for the next cycle.</p>',
      });
    expect(page.status).toBe(201);

    // Restrict to the admin alone. pageAccess() then denies everyone else.
    const admin = await queryOne(db, 'SELECT id FROM users WHERE email = ?', ['kunal@example.com']);
    const restricted = await request(app)
      .put(`/api/wiki/pages/${page.body.id}/restrictions`).set(headers)
      .send({ restrictions: [{ user_id: admin.id, can_edit: 1 }] });
    expect(restricted.status).toBe(200);

    const priya = await queryOne(db, 'SELECT id, role FROM users WHERE email = ?', ['priya@example.com']);
    const denied = await resolveOrigin(db, 'wiki', page.body.id, priya.id, priya.role);
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe(403);

    const allowed = await resolveOrigin(db, 'wiki', page.body.id, admin.id, 'admin');
    expect(allowed.ok).toBe(true);
    expect(allowed.excerpt).toContain('Salary bands');
  });

  test('the excerpt is plain text and bounded', async () => {
    const { resolveOrigin, MAX_EXCERPT } = require('../../utils/insight-origin');
    const { getDb, queryOne } = require('../../database');
    const db = await getDb();

    const issueId = await anyIssueId();
    const me = await queryOne(db, 'SELECT id, role FROM users WHERE email = ?', ['kunal@example.com']);
    const long = `<p>${'sustained frustration '.repeat(80)}</p>`;
    const created = await request(app).post(`/api/issues/${issueId}/comments`).set(headers)
      .send({ body: long });

    const out = await resolveOrigin(db, 'comment', created.body.id, me.id, me.role);
    expect(out.ok).toBe(true);
    expect(out.excerpt).not.toContain('<p>');
    expect(out.excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT);
  });
});

describe('capture endpoint', () => {
  let commentId;

  beforeAll(async () => {
    const issueId = await anyIssueId();
    const c = await request(app).post(`/api/issues/${issueId}/comments`).set(headers)
      .send({ body: 'We need bulk CSV export before renewal.' });
    commentId = c.body.id;
  });

  test('captures a comment into an unprocessed insight carrying its snapshot', async () => {
    const res = await request(app).post('/api/product/insights/capture').set(headers)
      .send({ origin_kind: 'comment', origin_id: commentId });

    expect(res.status).toBe(201);
    expect(res.body.origin_kind).toBe('comment');
    expect(res.body.origin_id).toBe(commentId);
    expect(res.body.origin_excerpt).toContain('bulk CSV export');
    expect(res.body.processed).toBe(0);
    expect(res.body.source).toBe('support');
  });

  test('the excerpt survives the source comment being deleted', async () => {
    const issueId = await anyIssueId();
    const c = await request(app).post(`/api/issues/${issueId}/comments`).set(headers)
      .send({ body: 'Ephemeral but important.' });

    const captured = await request(app).post('/api/product/insights/capture').set(headers)
      .send({ origin_kind: 'comment', origin_id: c.body.id });
    expect(captured.status).toBe(201);

    const removed = await request(app).delete(`/api/comments/${c.body.id}`).set(headers);
    expect(removed.status).toBe(200);

    const after = await request(app).get(`/api/product/insights/${captured.body.id}`).set(headers);
    expect(after.status).toBe(200);
    expect(after.body.origin_excerpt).toContain('Ephemeral but important');
  });

  test('rejects an unknown origin kind with 400', async () => {
    const res = await request(app).post('/api/product/insights/capture').set(headers)
      .send({ origin_kind: 'telepathy', origin_id: commentId });
    expect(res.status).toBe(400);
  });

  test('a missing source is a 404', async () => {
    const res = await request(app).post('/api/product/insights/capture').set(headers)
      .send({ origin_kind: 'comment', origin_id: 'no-such-comment' });
    expect(res.status).toBe(404);
  });

  test('a client cannot reach the capture endpoint', async () => {
    const res = await request(app).post('/api/product/insights/capture').set(clientHeaders)
      .send({ origin_kind: 'comment', origin_id: commentId });
    expect(res.status).toBe(403);
  });

  test('an explicit title overrides the one derived from the source', async () => {
    const res = await request(app).post('/api/product/insights/capture').set(headers)
      .send({ origin_kind: 'comment', origin_id: commentId, title: 'Bulk export blocks renewal' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Bulk export blocks renewal');
  });
});
