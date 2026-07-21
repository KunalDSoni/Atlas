/**
 * HELP CENTER — the customer surface. Security rules from spec §Security.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { toPublicRequest } = require('../../utils/servicedesk');

describe('toPublicRequest projection', () => {
  // A raw issue row carrying every internal field a customer must never see.
  const rawIssue = {
    id: 'i1', project_id: 'p1', issue_key: 'HD-1', issue_number: 1,
    title: 'Laptop will not boot', description: 'rendered summary',
    type: 'request', status: 'in_progress', priority: 'highest',
    assignee_id: 'u-agent', reporter_id: 'u-customer', sprint_id: 's1',
    story_points: 8, labels: '["internal-escalation"]', original_estimate: '3h',
    time_spent: '1h', parent_id: 'i0', board_order: 3, epic_color: 'red',
    request_type_id: 'rt1', sd_fields: '{"model":"X1"}',
    created_at: '2026-07-01 10:00:00', updated_at: '2026-07-02 10:00:00',
  };

  const projected = toPublicRequest(rawIssue, {
    requestType: { id: 'rt1', name: 'Hardware problem', icon: 'laptop' },
    statusLabel: 'In Progress',
    statusCategory: 'in_progress',
    comments: [
      { id: 'c1', body: 'public reply', visibility: 'public', author_name: 'Agent', created_at: '2026-07-01 11:00:00' },
      { id: 'c2', body: 'internal note', visibility: 'internal', author_name: 'Agent', created_at: '2026-07-01 12:00:00' },
    ],
  });

  test('exposes only the allow-listed keys', () => {
    expect(Object.keys(projected).sort()).toEqual([
      'comments', 'created_at', 'description', 'fields', 'key',
      'request_type', 'status', 'status_category', 'summary', 'updated_at',
    ]);
  });

  test.each([
    'assignee_id', 'reporter_id', 'story_points', 'labels', 'sprint_id',
    'original_estimate', 'time_spent', 'parent_id', 'board_order', 'priority',
    'project_id', 'id', 'request_type_id',
  ])('does not leak %s', (field) => {
    expect(projected).not.toHaveProperty(field);
  });

  test('drops internal comments', () => {
    expect(projected.comments).toHaveLength(1);
    expect(projected.comments[0].body).toBe('public reply');
  });

  test('surfaces the status label rather than the raw key', () => {
    expect(projected.status).toBe('In Progress');
    expect(projected.status_category).toBe('in_progress');
  });

  test('parses sd_fields into an object', () => {
    expect(projected.fields).toEqual({ model: 'X1' });
  });
});

describe('help center lifecycle', () => {
  let app, headers, clientHeaders, otherClientHeaders, sdProjectId, typeId, raisedKey;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();

    // Key must NOT be 'HD': projects.key is UNIQUE and the demo seed uses it.
    const created = await request(app).post('/api/projects').set(headers)
      .send({ name: 'Test Service Desk', key: 'SD', description: 'Service desk' });
    sdProjectId = created.body.id;
    await request(app).put(`/api/projects/${sdProjectId}`).set(headers).send({ is_service_desk: true });

    const type = await request(app).post(`/api/projects/${sdProjectId}/request-types`).set(headers).send({
      name: 'Hardware problem',
      fields: [
        { key: 'model', label: 'Device model', type: 'text', required: true },
        { key: 'urgency', label: 'Urgency', type: 'select', options: ['Low', 'High'] },
      ],
    });
    typeId = type.body.id;

    async function makeClient(name, email) {
      const u = await request(app).post('/api/users').set(headers).send({ name, email, role: 'client' });
      const login = await request(app).post('/api/auth/login').send({ email, password: u.body.initial_password });
      return { 'x-auth-token': login.body.token, 'Content-Type': 'application/json' };
    }
    clientHeaders = await makeClient('Casey Client', 'casey.help@example.com');
    otherClientHeaders = await makeClient('Robin Rival', 'robin.help@example.com');
  });

  test('a client lists the request types they can raise', async () => {
    const res = await request(app).get('/api/help/request-types').set(clientHeaders);
    expect(res.status).toBe(200);
    expect(res.body.some((t) => t.name === 'Hardware problem')).toBe(true);
  });

  test('raises a request and returns the projected shape', async () => {
    const res = await request(app).post('/api/help/requests').set(clientHeaders).send({
      request_type_id: typeId,
      summary: 'Laptop will not boot',
      fields: { model: 'X1 Carbon', urgency: 'High' },
    });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^SD-/);
    expect(res.body.summary).toBe('Laptop will not boot');
    expect(res.body.fields.model).toBe('X1 Carbon');
    expect(res.body).not.toHaveProperty('assignee_id');
    raisedKey = res.body.key;
  });

  test('rejects a submission missing a required field', async () => {
    const res = await request(app).post('/api/help/requests').set(clientHeaders)
      .send({ request_type_id: typeId, summary: 'No model given', fields: { urgency: 'Low' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Device model/i);
  });

  test('rejects a value outside a select field options', async () => {
    const res = await request(app).post('/api/help/requests').set(clientHeaders)
      .send({ request_type_id: typeId, summary: 'Bad urgency', fields: { model: 'T14', urgency: 'Catastrophic' } });
    expect(res.status).toBe(400);
  });

  test('drops unknown field keys rather than storing them', async () => {
    const res = await request(app).post('/api/help/requests').set(clientHeaders)
      .send({ request_type_id: typeId, summary: 'Extra keys', fields: { model: 'T14', injected: 'evil' } });
    expect(res.status).toBe(201);
    expect(res.body.fields).not.toHaveProperty('injected');
  });

  test('lists only my own requests', async () => {
    const mine = await request(app).get('/api/help/requests').set(clientHeaders);
    expect(mine.body.length).toBeGreaterThan(0);
    const theirs = await request(app).get('/api/help/requests').set(otherClientHeaders);
    expect(theirs.body.length).toBe(0);
  });

  test('another customer gets 404 — not 403 — for a request they do not own', async () => {
    const res = await request(app).get(`/api/help/requests/${raisedKey}`).set(otherClientHeaders);
    expect(res.status).toBe(404);
  });

  test('the reporter can read their own request', async () => {
    const res = await request(app).get(`/api/help/requests/${raisedKey}`).set(clientHeaders);
    expect(res.status).toBe(200);
    expect(res.body.key).toBe(raisedKey);
  });

  test('a customer reply is always public', async () => {
    const res = await request(app).post(`/api/help/requests/${raisedKey}/comments`).set(clientHeaders)
      .send({ body: 'Any update?', visibility: 'internal' });
    expect(res.status).toBe(201);
    const detail = await request(app).get(`/api/help/requests/${raisedKey}`).set(clientHeaders);
    expect(detail.body.comments.some((c) => c.body === 'Any update?')).toBe(true);
  });

  test('an agent internal note never reaches the customer', async () => {
    const issues = await request(app).get(`/api/projects/${sdProjectId}/issues`).set(headers);
    const issue = issues.body.find((i) => i.issue_key === raisedKey);
    await request(app).post(`/api/issues/${issue.id}/comments`).set(headers)
      .send({ body: 'Ordering a replacement part', visibility: 'internal' });

    const detail = await request(app).get(`/api/help/requests/${raisedKey}`).set(clientHeaders);
    expect(detail.body.comments.some((c) => c.body === 'Ordering a replacement part')).toBe(false);
  });

  test('the customer can resolve their own request', async () => {
    const res = await request(app).post(`/api/help/requests/${raisedKey}/resolve`).set(clientHeaders);
    expect(res.status).toBe(200);
    expect(res.body.status_category).toBe('done');
  });

  test('an unauthenticated caller gets 401', async () => {
    const res = await request(app).get('/api/help/requests');
    expect(res.status).toBe(401);
  });
});
