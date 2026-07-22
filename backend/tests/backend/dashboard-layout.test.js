const request = require('supertest');
const { createTestApp, adminHeaders, userHeaders } = require('./setup');
const {
  GADGET_DEFINITIONS,
  defaultDashboardGadgets,
  validateDashboardGadgets,
} = require('../../utils/dashboard-layout');

describe('dashboard layout contract', () => {
  test('the default is a valid subset of the closed gadget catalogue', () => {
    const defaults = defaultDashboardGadgets();
    expect(validateDashboardGadgets(defaults)).toEqual({ gadgets: defaults });
    expect(defaults.length).toBeLessThan(Object.keys(GADGET_DEFINITIONS).length);
  });

  test.each([
    [null, /array/],
    [[{ key: 'mystery', span: 1 }], /Unknown gadget/],
    [[{ key: 'summary', span: 3 }], /span must be 1 or 2/],
    [[{ key: 'summary', span: 1 }, { key: 'summary', span: 2 }], /Duplicate gadget/],
  ])('rejects malformed layouts %#', (gadgets, message) => {
    expect(validateDashboardGadgets(gadgets).error).toMatch(message);
  });
});

describe('personal dashboard layout API', () => {
  let app;
  let admin;
  let user;
  let projectId;
  let otherProjectId;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await adminHeaders();
    user = await userHeaders();
    const projects = await request(app).get('/api/projects').set(admin);
    projectId = projects.body.find((project) => project.key === 'ATLAS').id;
    otherProjectId = projects.body.find((project) => project.id !== projectId).id;
  });

  test('returns a useful default without creating a stored layout', async () => {
    const response = await request(app)
      .get(`/api/projects/${projectId}/dashboard-layout`).set(admin);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      gadgets: defaultDashboardGadgets(),
      customized: false,
      updated_at: null,
    });
  });

  test('saves order and span as one normalized document', async () => {
    const gadgets = [
      { key: 'priority_breakdown', span: 1, ignored: 'not persisted' },
      { key: 'recent_activity', span: 2 },
      { key: 'summary', span: 1 },
    ];
    const saved = await request(app)
      .put(`/api/projects/${projectId}/dashboard-layout`).set(admin).send({ gadgets });
    expect(saved.status).toBe(200);
    expect(saved.body.customized).toBe(true);
    expect(saved.body.updated_at).toBeTruthy();
    expect(saved.body.gadgets).toEqual(gadgets.map(({ key, span }) => ({ key, span })));

    const read = await request(app)
      .get(`/api/projects/${projectId}/dashboard-layout`).set(admin);
    expect(read.body.gadgets).toEqual(saved.body.gadgets);
  });

  test('layouts are isolated by user and project', async () => {
    const otherUser = await request(app)
      .get(`/api/projects/${projectId}/dashboard-layout`).set(user);
    expect(otherUser.body.customized).toBe(false);
    expect(otherUser.body.gadgets).toEqual(defaultDashboardGadgets());

    const otherProject = await request(app)
      .get(`/api/projects/${otherProjectId}/dashboard-layout`).set(admin);
    expect(otherProject.body.customized).toBe(false);
  });

  test('an intentionally empty dashboard remains empty on the next read', async () => {
    const saved = await request(app)
      .put(`/api/projects/${projectId}/dashboard-layout`).set(admin).send({ gadgets: [] });
    expect(saved.status).toBe(200);
    expect(saved.body.gadgets).toEqual([]);

    const read = await request(app)
      .get(`/api/projects/${projectId}/dashboard-layout`).set(admin);
    expect(read.body.customized).toBe(true);
    expect(read.body.gadgets).toEqual([]);
  });

  test.each([
    [{}, /array/],
    [{ gadgets: [{ key: 'summary', span: 9 }] }, /span/],
    [{ gadgets: [{ key: 'unknown', span: 1 }] }, /Unknown gadget/],
  ])('rejects an invalid replacement without changing the saved layout', async (body, error) => {
    const response = await request(app)
      .put(`/api/projects/${projectId}/dashboard-layout`).set(admin).send(body);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(error);

    const read = await request(app)
      .get(`/api/projects/${projectId}/dashboard-layout`).set(admin);
    expect(read.body.gadgets).toEqual([]);
  });

  test('unknown projects return 404 instead of storing an orphan layout', async () => {
    const response = await request(app)
      .put('/api/projects/not-a-project/dashboard-layout').set(admin)
      .send({ gadgets: defaultDashboardGadgets() });
    expect(response.status).toBe(404);
  });

  test('deleting a project removes its personal layouts', async () => {
    const created = await request(app).post('/api/projects').set(admin)
      .send({ name: 'Disposable dashboard project', key: 'DASH' });
    expect(created.status).toBe(201);
    await request(app).put(`/api/projects/${created.body.id}/dashboard-layout`).set(admin)
      .send({ gadgets: [{ key: 'summary', span: 2 }] });

    const removed = await request(app).delete(`/api/projects/${created.body.id}`).set(admin);
    expect(removed.status).toBe(200);
    const { getDb, queryOne } = require('../../database');
    expect(await queryOne(await getDb(),
      'SELECT id FROM dashboard_layouts WHERE project_id = ?', [created.body.id])).toBeNull();
  });
});
