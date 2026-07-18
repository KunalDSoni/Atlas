/**
 * CUSTOM FIELDS TESTS (ATLAS-25)
 * Per-project field definitions, type validation, per-issue values, and
 * enrichment of the issue payload.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, userHeaders } = require('./setup');

let app, headers, clientHeaders, projectId, issueId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  clientHeaders = await userHeaders(); // priya — role 'client', not board admin
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'ATL').id;
  const issue = await request(app).post(`/api/projects/${projectId}/issues`).set(headers).send({ title: 'CF host', type: 'task' });
  issueId = issue.body.id;
});

describe('custom field definitions', () => {
  test('board admin creates fields; non-admin cannot', async () => {
    const text = await request(app).post(`/api/projects/${projectId}/fields`).set(headers)
      .send({ name: 'Team', field_type: 'text' });
    expect(text.status).toBe(201);

    const sel = await request(app).post(`/api/projects/${projectId}/fields`).set(headers)
      .send({ name: 'Severity', field_type: 'select', options: ['Low', 'High'] });
    expect(sel.status).toBe(201);
    expect(sel.body.options).toEqual(['Low', 'High']);

    const forbidden = await request(app).post(`/api/projects/${projectId}/fields`).set(clientHeaders)
      .send({ name: 'Nope', field_type: 'text' });
    expect(forbidden.status).toBe(403);
  });

  test('select fields require options', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/fields`).set(headers)
      .send({ name: 'Bad', field_type: 'select', options: [] });
    expect(res.status).toBe(400);
  });
});

describe('custom field values', () => {
  test('setting values validates by type and enriches the issue', async () => {
    const fields = await request(app).get(`/api/projects/${projectId}/fields`).set(headers);
    const team = fields.body.find((f) => f.name === 'Team');
    const severity = fields.body.find((f) => f.name === 'Severity');
    const num = (await request(app).post(`/api/projects/${projectId}/fields`).set(headers)
      .send({ name: 'Story pts est', field_type: 'number' })).body;

    // Invalid select value rejected.
    const bad = await request(app).put(`/api/issues/${issueId}/fields`).set(headers)
      .send({ values: { [severity.id]: 'Critical' } });
    expect(bad.status).toBe(400);

    // Invalid number rejected.
    const badNum = await request(app).put(`/api/issues/${issueId}/fields`).set(headers)
      .send({ values: { [num.id]: 'abc' } });
    expect(badNum.status).toBe(400);

    // Valid values persist.
    const ok = await request(app).put(`/api/issues/${issueId}/fields`).set(headers)
      .send({ values: { [team.id]: 'Platform', [severity.id]: 'High', [num.id]: '8' } });
    expect(ok.status).toBe(200);

    const enriched = await request(app).get(`/api/issues/${issueId}`).set(headers);
    const cf = enriched.body.custom_fields;
    expect(cf.find((f) => f.field_id === team.id).value).toBe('Platform');
    expect(cf.find((f) => f.field_id === severity.id).value).toBe('High');
    expect(cf.find((f) => f.field_id === num.id).value).toBe('8');
  });

  test('clearing a value removes it', async () => {
    const fields = await request(app).get(`/api/projects/${projectId}/fields`).set(headers);
    const team = fields.body.find((f) => f.name === 'Team');
    await request(app).put(`/api/issues/${issueId}/fields`).set(headers).send({ values: { [team.id]: '' } });
    const enriched = await request(app).get(`/api/issues/${issueId}`).set(headers);
    expect(enriched.body.custom_fields.find((f) => f.field_id === team.id).value).toBeNull();
  });
});
