/**
 * PORTAL V2 — Epic 52
 * Projection safety, anonymous browsing, identity boundaries, follows, a
 * customer's own submissions, and the status-change notification loop.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, loginAs } = require('./setup');
const { PUBLIC_FEATURE_FIELDS, toPublicFeature } = require('../../utils/portal');

let app, headers, staffHeaders, clientHeaders, staffUser;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  staffHeaders = await loginAs('priya@example.com', 'password123');
  clientHeaders = await loginAs('dana@customer.example.com', 'password123');
  const users = await request(app).get('/api/users').set(headers);
  staffUser = users.body.find((user) => user.email === 'priya@example.com');
});

async function createPublicFeature(name = 'Portal test feature', portal_status = 'under_consideration') {
  const res = await request(app).post('/api/product/features').set(headers)
    .send({
      name,
      description: 'Public description',
      portal_status,
      effort: 8,
      value: 9,
      reach: 1200,
      impact: 3,
      confidence: 70,
    });
  expect(res.status).toBe(201);
  return res.body;
}

describe('public projection', () => {
  test('is an explicit allow-list even when handed a raw internal feature', () => {
    const raw = {
      id: 'f-1', name: 'Safe name', description: 'Safe copy', portal_status: 'planned',
      vote_count: '4', follower_count: 2, has_voted: 1, is_following: 0,
      status: 'in_progress', timeframe: 'now', effort: 8, value: 9, reach: 500,
      impact: 3, confidence: 90, rice: 168.75, demand: 250000,
      owner_id: 'secret-user', owner_name: 'Internal PM', project_id: 'secret-project',
      insight_count: 12, delivery_total: 3, created_by: 'secret-user', spec_page_id: 'secret-page',
    };

    const projected = toPublicFeature(raw);
    expect(Object.keys(projected).sort()).toEqual([...PUBLIC_FEATURE_FIELDS].sort());
    expect(projected).toEqual({
      id: 'f-1', name: 'Safe name', description: 'Safe copy', portal_status: 'planned',
      vote_count: 4, follower_count: 2, has_voted: true, is_following: false,
    });
    for (const internal of Object.keys(raw).filter((key) => !PUBLIC_FEATURE_FIELDS.includes(key))) {
      expect(projected).not.toHaveProperty(internal);
    }
  });

  test('anonymous callers can browse the roadmap and one public detail', async () => {
    const feature = await createPublicFeature('Anonymous roadmap feature');
    const list = await request(app).get('/api/portal/features');
    expect(list.status).toBe(200);
    const listed = list.body.find((row) => row.id === feature.id);
    expect(Object.keys(listed).sort()).toEqual([...PUBLIC_FEATURE_FIELDS].sort());
    expect(listed.has_voted).toBe(false);
    expect(listed.is_following).toBe(false);

    const detail = await request(app).get(`/api/portal/features/${feature.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual(listed);
    expect(detail.body).not.toHaveProperty('effort');
    expect(detail.body).not.toHaveProperty('timeframe');
    expect(detail.body).not.toHaveProperty('demand');
  });

  test('private features are indistinguishable from missing features', async () => {
    const feature = await request(app).post('/api/product/features').set(headers)
      .send({ name: 'Internal only', effort: 2 });
    expect((await request(app).get(`/api/portal/features/${feature.body.id}`)).status).toBe(404);
    expect((await request(app).get('/api/portal/features/not-real')).status).toBe(404);
  });
});

describe('identity boundary and customer loop', () => {
  test('anonymous identity-dependent endpoints return 401', async () => {
    const feature = await createPublicFeature('Sign-in required feature');
    expect((await request(app).post(`/api/portal/features/${feature.id}/vote`)).status).toBe(401);
    expect((await request(app).post(`/api/portal/features/${feature.id}/follow`)).status).toBe(401);
    expect((await request(app).delete(`/api/portal/features/${feature.id}/follow`)).status).toBe(401);
    expect((await request(app).get('/api/portal/me')).status).toBe(401);
    expect((await request(app).post('/api/portal/ideas').send({ title: 'Anonymous' })).status).toBe(401);
  });

  test('a client can use portal actions but remains blocked from product APIs', async () => {
    const feature = await createPublicFeature('Client-safe feature');
    expect((await request(app).get('/api/portal/features').set(clientHeaders)).status).toBe(200);
    expect((await request(app).post(`/api/portal/features/${feature.id}/vote`).set(clientHeaders)).status).toBe(200);
    expect((await request(app).post('/api/portal/ideas').set(clientHeaders)
      .send({ title: 'Customer submission', content: 'Please close this loop.' })).status).toBe(201);
    expect((await request(app).get('/api/product/features').set(clientHeaders)).status).toBe(403);
  });

  test('follow and unfollow are idempotent and reflected in My ideas', async () => {
    const feature = await createPublicFeature('Follow me');
    const first = await request(app).post(`/api/portal/features/${feature.id}/follow`).set(clientHeaders);
    const second = await request(app).post(`/api/portal/features/${feature.id}/follow`).set(clientHeaders);
    expect(first.body.is_following).toBe(true);
    expect(second.body.is_following).toBe(true);
    expect(second.body.follower_count).toBe(first.body.follower_count);

    const mine = await request(app).get('/api/portal/me').set(clientHeaders);
    expect(mine.status).toBe(200);
    expect(mine.body.follows.some((row) => row.id === feature.id)).toBe(true);
    expect(mine.body.submissions.some((row) => row.title === 'Customer submission')).toBe(true);
    expect(mine.body.submissions[0]).not.toHaveProperty('processed');
    expect(['submitted', 'reviewed', 'closed']).toContain(mine.body.submissions[0].status);

    const removed = await request(app).delete(`/api/portal/features/${feature.id}/follow`).set(clientHeaders);
    const removedAgain = await request(app).delete(`/api/portal/features/${feature.id}/follow`).set(clientHeaders);
    expect(removed.body.is_following).toBe(false);
    expect(removedAgain.body.is_following).toBe(false);
    expect(removedAgain.body.follower_count).toBe(removed.body.follower_count);
  });

  test('a portal status change notifies followers in-app and through email', async () => {
    const feature = await createPublicFeature('Notify my followers');
    await request(app).post(`/api/portal/features/${feature.id}/follow`).set(staffHeaders);

    const email = require('../../utils/email');
    email.clearOutbox();
    const changed = await request(app).put(`/api/product/features/${feature.id}`).set(headers)
      .send({ portal_status: 'planned' });
    expect(changed.status).toBe(200);

    const notifications = await request(app).get('/api/notifications').set(staffHeaders);
    const hit = notifications.body.find((item) => item.type === 'portal_status_changed'
      && item.link === `/portal/features/${feature.id}`);
    expect(hit).toBeTruthy();
    expect(hit.message).toContain('Notify my followers is now Planned');
    expect(email.getOutbox().some((mail) => mail.to === staffUser.email
      && mail.subject.includes('Notify my followers'))).toBe(true);
  });
});
