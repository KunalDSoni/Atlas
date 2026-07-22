const request = require('supertest');
const { createTestApp, adminHeaders, userHeaders } = require('./setup');
const {
  BACKLOG_DEFAULTS,
  parseStoredFilterParams,
  validateFilterName,
  validateSavedFilterParams,
} = require('../../utils/saved-filters');

describe('saved-filter document contract', () => {
  test('normalizes pre-kind backlog rows without losing their controls', () => {
    expect(parseStoredFilterParams(JSON.stringify({ query: 'login', type: 'bug' }), 'user-1')).toEqual({
      ...BACKLOG_DEFAULTS,
      query: 'login',
      type: 'bug',
    });
  });

  test('normalizes and validates JQL through the production compiler', () => {
    expect(validateSavedFilterParams({ kind: 'jql', jql: '  type = bug OR assignee = me  ' }, 'user-1')).toEqual({
      value: { kind: 'jql', jql: 'type = bug OR assignee = me' },
    });
    expect(validateSavedFilterParams({ kind: 'jql', jql: 'sla = brached' }, 'user-1').error)
      .toMatch(/Invalid value.*brached.*column/i);
  });

  test.each([
    [null, 'must be an object'],
    [[], 'must be an object'],
    [{ kind: 'shared' }, 'must be backlog or jql'],
    [{ kind: 'jql', jql: '' }, 'JQL query required'],
    [{ kind: 'jql', jql: 'type = bug', extra: true }, 'Unknown JQL filter field'],
    [{ kind: 'backlog', status: 42 }, 'Backlog status must be a string'],
    [{ kind: 'backlog', mystery: 'x' }, 'Unknown backlog filter field'],
  ])('rejects malformed params %#', (input, message) => {
    expect(validateSavedFilterParams(input, 'user-1').error).toContain(message);
  });

  test('trims names and bounds their length', () => {
    expect(validateFilterName('  Mine  ')).toEqual({ value: 'Mine' });
    expect(validateFilterName('')).toEqual({ error: 'Filter name required' });
    expect(validateFilterName('x'.repeat(81)).error).toMatch(/80 characters/);
  });
});

describe('personal JQL saved filters API', () => {
  let app;
  let headers;
  let otherHeaders;
  let projectId;
  let otherProjectId;

  beforeAll(async () => {
    app = await createTestApp();
    headers = await adminHeaders();
    otherHeaders = await userHeaders();
    const projects = await request(app).get('/api/projects').set(headers);
    projectId = projects.body.find((project) => project.key === 'ATL').id;
    otherProjectId = projects.body.find((project) => project.key === 'MOB').id;
  });

  async function createJql(name, jql = 'type = bug') {
    return request(app).post(`/api/projects/${projectId}/filters`).set(headers)
      .send({ name, params: { kind: 'jql', jql } });
  }

  test('legacy backlog creates remain compatible and gain an explicit kind', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/filters`).set(headers)
      .send({ name: 'Backlog preset', params: { type: 'bug', status: 'todo' } });
    expect(created.status).toBe(201);
    expect(created.body.params_parsed).toMatchObject({ kind: 'backlog', type: 'bug', status: 'todo' });
  });

  test('creates and lists a validated JQL filter for its owner only', async () => {
    const created = await createJql('My active bugs', 'type = bug AND category != done');
    expect(created.status).toBe(201);
    expect(created.body.params_parsed).toEqual({ kind: 'jql', jql: 'type = bug AND category != done' });

    const mine = await request(app).get(`/api/projects/${projectId}/filters`).set(headers);
    expect(mine.body.some((filter) => filter.id === created.body.id)).toBe(true);
    const theirs = await request(app).get(`/api/projects/${projectId}/filters`).set(otherHeaders);
    expect(theirs.body.some((filter) => filter.id === created.body.id)).toBe(false);
    const otherProject = await request(app).get(`/api/projects/${otherProjectId}/filters`).set(headers);
    expect(otherProject.body.some((filter) => filter.id === created.body.id)).toBe(false);
  });

  test('rejects duplicate names case-insensitively within one personal project', async () => {
    expect((await createJql('Release watch')).status).toBe(201);
    const duplicate = await createJql('  release WATCH  ', 'priority = high');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatch(/already exists/i);

    // The same human-readable name is not ambiguous in a different project.
    const elsewhere = await request(app).post(`/api/projects/${otherProjectId}/filters`).set(headers)
      .send({ name: 'Release watch', params: { kind: 'jql', jql: 'priority = high' } });
    expect(elsewhere.status).toBe(201);
  });

  test('invalid JQL is atomic and never writes a row', async () => {
    const before = await request(app).get(`/api/projects/${projectId}/filters`).set(headers);
    const invalid = await createJql('Broken filter', 'type = bug AND sla = brached');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatch(/brached.*column/i);
    const after = await request(app).get(`/api/projects/${projectId}/filters`).set(headers);
    expect(after.body).toHaveLength(before.body.length);
    expect(after.body.some((filter) => filter.name === 'Broken filter')).toBe(false);
  });

  test('owner can rename and replace JQL while another user cannot', async () => {
    const created = await createJql('Needs edit');
    const forbidden = await request(app).put(`/api/filters/${created.body.id}`).set(otherHeaders)
      .send({ name: 'Stolen' });
    expect(forbidden.status).toBe(403);

    const updated = await request(app).put(`/api/filters/${created.body.id}`).set(headers)
      .send({ name: 'Urgent work', params: { kind: 'jql', jql: 'priority = urgent OR priority = high' } });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Urgent work');
    expect(updated.body.params_parsed.jql).toBe('priority = urgent OR priority = high');

    const empty = await request(app).put(`/api/filters/${created.body.id}`).set(headers).send({});
    expect(empty.status).toBe(400);
  });

  test('admin delete override does not allow editing another user\'s personal filter', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/filters`).set(otherHeaders)
      .send({ name: 'Personal to Priya', params: { kind: 'jql', jql: 'type = task' } });
    expect(created.status).toBe(201);

    const edit = await request(app).put(`/api/filters/${created.body.id}`).set(headers)
      .send({ name: 'Admin rewrite' });
    expect(edit.status).toBe(403);
    expect((await request(app).delete(`/api/filters/${created.body.id}`).set(headers)).status).toBe(200);
  });

  test('missing projects and malformed params are rejected', async () => {
    expect((await request(app).get('/api/projects/missing/filters').set(headers)).status).toBe(404);
    const missing = await request(app).post('/api/projects/missing/filters').set(headers)
      .send({ name: 'No home', params: { kind: 'jql', jql: 'type = bug' } });
    expect(missing.status).toBe(404);

    const malformed = await request(app).post(`/api/projects/${projectId}/filters`).set(headers)
      .send({ name: 'Bad body', params: ['type = bug'] });
    expect(malformed.status).toBe(400);
  });

  test('project deletion removes its saved filters', async () => {
    const project = await request(app).post('/api/projects').set(headers)
      .send({ name: 'Disposable filters', key: 'DSPF' });
    expect(project.status).toBe(201);
    const filter = await request(app).post(`/api/projects/${project.body.id}/filters`).set(headers)
      .send({ name: 'Temporary', params: { kind: 'jql', jql: 'type = task' } });
    expect(filter.status).toBe(201);

    expect((await request(app).delete(`/api/projects/${project.body.id}`).set(headers)).status).toBe(200);
    const { getDb, queryOne } = require('../../database');
    const row = await queryOne(await getDb(), 'SELECT id FROM saved_filters WHERE id = ?', [filter.body.id]);
    expect(row).toBeNull();
  });
});
