const request = require('supertest');
const { createTestApp, adminHeaders, loginAs } = require('./setup');
const { slaBoundaries, slaState, parseTime } = require('../../utils/sla');

let app, agent, client, projectId, requestTypeId, waitingStatus;

async function raise(summary) {
  const response = await request(app).post('/api/help/requests').set(client)
    .send({ request_type_id: requestTypeId, summary, fields: {} });
  expect(response.status).toBe(201);
  const { getDb, queryOne } = require('../../database');
  const db = await getDb();
  return queryOne(db, 'SELECT * FROM issues WHERE issue_key = ?', [response.body.key]);
}

async function clock(issueId, metric) {
  const { getDb, queryOne } = require('../../database');
  return queryOne(await getDb(),
    'SELECT * FROM sd_sla_clocks WHERE issue_id = ? AND metric = ?', [issueId, metric]);
}

beforeAll(async () => {
  app = await createTestApp();
  agent = await adminHeaders();
  client = await loginAs('dana@customer.example.com', 'password123');
  const projects = await request(app).get('/api/projects').set(agent);
  projectId = projects.body.find((project) => project.key === 'HD').id;

  const type = await request(app).post(`/api/projects/${projectId}/request-types`).set(agent)
    .send({ name: 'Boundary checks', fields: [] });
  requestTypeId = type.body.id;
  await request(app).post(`/api/request-types/${requestTypeId}/sla-goals`).set(agent)
    .send({ metric: 'first_response', target_minutes: 60 });
  await request(app).post(`/api/request-types/${requestTypeId}/sla-goals`).set(agent)
    .send({ metric: 'resolution', target_minutes: 480 });

  const statuses = await request(app).get(`/api/projects/${projectId}/statuses`).set(agent);
  waitingStatus = statuses.body.find((status) => status.waiting_for_customer);
});

describe('stored SLA query boundaries', () => {
  test('request creation stores both boundaries from the shared helper', async () => {
    const issue = await raise('Start boundaries');
    for (const metric of ['first_response', 'resolution']) {
      const stored = await clock(issue.id, metric);
      expect({ due_at: stored.due_at, at_risk_at: stored.at_risk_at })
        .toEqual(slaBoundaries(stored));
      expect(parseTime(stored.at_risk_at)).toBeLessThan(parseTime(stored.due_at));
    }
  });

  test('pause freezes the state and resume moves both boundaries by the banked interval', async () => {
    const issue = await raise('Pause and resume boundaries');
    const before = await clock(issue.id, 'resolution');

    const paused = await request(app).put(`/api/issues/${issue.id}`).set(agent)
      .send({ status: waitingStatus.key });
    expect(paused.status).toBe(200);
    const frozen = await clock(issue.id, 'resolution');
    expect(frozen.paused_at).toBeTruthy();
    expect(frozen.due_at).toBe(before.due_at);
    expect(frozen.at_risk_at).toBe(before.at_risk_at);

    // Simulate a 30-minute wait without sleeping. The real resume hook still
    // performs the banking and boundary rewrite.
    const { getDb, run } = require('../../database');
    const db = await getDb();
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000)
      .toISOString().replace('T', ' ').slice(0, 19);
    await run(db, 'UPDATE sd_sla_clocks SET paused_at = ? WHERE issue_id = ?',
      [thirtyMinutesAgo, issue.id]);

    const reply = await request(app).post(`/api/help/requests/${issue.issue_key}/comments`).set(client)
      .send({ body: 'The requested information' });
    expect(reply.status).toBe(201);
    const resumed = await clock(issue.id, 'resolution');
    expect(resumed.paused_at).toBeNull();
    expect(Number(resumed.paused_total_minutes)).toBeGreaterThanOrEqual(30);
    expect(parseTime(resumed.due_at) - parseTime(before.due_at)).toBeGreaterThanOrEqual(30 * 60_000);
    expect(parseTime(resumed.at_risk_at) - parseTime(before.at_risk_at)).toBeGreaterThanOrEqual(30 * 60_000);
    expect({ due_at: resumed.due_at, at_risk_at: resumed.at_risk_at })
      .toEqual(slaBoundaries(resumed));
  });

  test('stop leaves final boundaries intact and reopen restarts resolution', async () => {
    const issue = await raise('Stop and restart boundaries');
    const beforeFirst = await clock(issue.id, 'first_response');
    const beforeResolution = await clock(issue.id, 'resolution');

    await request(app).post(`/api/issues/${issue.id}/comments`).set(agent)
      .send({ body: 'First public answer', visibility: 'public' });
    const stoppedFirst = await clock(issue.id, 'first_response');
    expect(stoppedFirst.stopped_at).toBeTruthy();
    expect(stoppedFirst.due_at).toBe(beforeFirst.due_at);
    expect(stoppedFirst.at_risk_at).toBe(beforeFirst.at_risk_at);

    await request(app).put(`/api/issues/${issue.id}`).set(agent).send({ status: 'done' });
    expect((await clock(issue.id, 'resolution')).stopped_at).toBeTruthy();
    await request(app).put(`/api/issues/${issue.id}`).set(agent).send({ status: 'in_progress' });
    const restarted = await clock(issue.id, 'resolution');
    expect(restarted.stopped_at).toBeNull();
    expect(restarted.due_at).toBe(beforeResolution.due_at);
    expect(restarted.at_risk_at).toBe(beforeResolution.at_risk_at);
    expect({ due_at: restarted.due_at, at_risk_at: restarted.at_risk_at })
      .toEqual(slaBoundaries(restarted));
  });

  test('a clock breached before pause remains breached at any later wall time', async () => {
    const issue = await raise('Breach then pause');
    const { getDb, run } = require('../../database');
    const { refreshBoundaries } = require('../../utils/sla-clocks');
    const db = await getDb();
    await run(db,
      "UPDATE sd_sla_clocks SET started_at = '2020-01-01 00:00:00' WHERE issue_id = ? AND metric = 'resolution'",
      [issue.id]);
    await refreshBoundaries(db, issue.id, 'resolution');
    await request(app).put(`/api/issues/${issue.id}`).set(agent).send({ status: waitingStatus.key });

    const paused = await clock(issue.id, 'resolution');
    expect(paused.paused_at).toBeTruthy();
    expect(slaState(paused, paused, new Date('2035-01-01T00:00:00Z')).status).toBe('breached');
    expect(slaState(paused, paused, new Date('2035-01-01T00:00:00Z')).paused).toBe(true);
  });
});
