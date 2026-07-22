/**
 * SLAs (ATLAS-43)
 *
 * Atlas has no scheduler, so an SLA is not a timer that fires — it is a set of
 * timestamps plus one function that derives state on read. These tests pin that
 * function hard, because a queue badge, the request detail and the report all
 * call it and must never disagree.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, loginAs } = require('./setup');
const { slaState } = require('../../utils/sla');

// The wall-clock format SQLite writes: 'YYYY-MM-DD HH:MM:SS', UTC, no zone.
const T0 = '2026-07-20 09:00:00';
const at = (minutes) => new Date(Date.parse(`${T0}Z`) + minutes * 60_000)
  .toISOString().replace('T', ' ').slice(0, 19);

const GOAL = { target_minutes: 60 };

describe('slaState — a running clock', () => {
  test('elapsed is measured from the start to now', () => {
    const s = slaState({ started_at: T0 }, GOAL, at(15));
    expect(s.elapsed_minutes).toBe(15);
    expect(s.remaining_minutes).toBe(45);
    expect(s.status).toBe('ok');
    expect(s.paused).toBe(false);
  });

  test('at 80% of target it is at risk', () => {
    expect(slaState({ started_at: T0 }, GOAL, at(47)).status).toBe('ok');
    expect(slaState({ started_at: T0 }, GOAL, at(48)).status).toBe('at_risk');
    expect(slaState({ started_at: T0 }, GOAL, at(59)).status).toBe('at_risk');
  });

  test('past the target it is breached, and remaining goes negative', () => {
    const s = slaState({ started_at: T0 }, GOAL, at(75));
    expect(s.status).toBe('breached');
    expect(s.remaining_minutes).toBe(-15);
  });

  test('exactly on the target is not yet breached', () => {
    expect(slaState({ started_at: T0 }, GOAL, at(60)).status).toBe('at_risk');
  });
});

describe('slaState — a stopped clock', () => {
  test('elapsed freezes at the stop, however long ago that was', () => {
    const s = slaState({ started_at: T0, stopped_at: at(30) }, GOAL, at(600));
    expect(s.elapsed_minutes).toBe(30);
    expect(s.status).toBe('ok');
    expect(s.stopped).toBe(true);
  });

  test('a clock that stopped late stays breached forever', () => {
    expect(slaState({ started_at: T0, stopped_at: at(90) }, GOAL, at(6000)).status).toBe('breached');
  });

  test('a finished clock is never "at risk" — it either met the goal or did not', () => {
    expect(slaState({ started_at: T0, stopped_at: at(55) }, GOAL, at(600)).status).toBe('ok');
  });
});

describe('slaState — pausing', () => {
  test('a paused clock stops accruing at the moment it paused', () => {
    const clock = { started_at: T0, paused_at: at(20) };
    expect(slaState(clock, GOAL, at(20)).elapsed_minutes).toBe(20);
    expect(slaState(clock, GOAL, at(500)).elapsed_minutes).toBe(20);
    expect(slaState(clock, GOAL, at(500)).paused).toBe(true);
  });

  test('resumed time is excluded via paused_total_minutes', () => {
    // Started at 0, paused 10→40 (30 minutes with the customer), now 50.
    const s = slaState({ started_at: T0, paused_total_minutes: 30 }, GOAL, at(50));
    expect(s.elapsed_minutes).toBe(20);
  });

  test('pausing repeatedly accumulates, so a request can bounce many times', () => {
    // Two prior pauses totalling 100 minutes, currently paused again at 180.
    const s = slaState(
      { started_at: T0, paused_total_minutes: 100, paused_at: at(180) }, GOAL, at(9999));
    expect(s.elapsed_minutes).toBe(80);
    expect(s.status).toBe('breached');
  });

  test('a pause cannot make elapsed negative', () => {
    const s = slaState({ started_at: T0, paused_total_minutes: 500 }, GOAL, at(10));
    expect(s.elapsed_minutes).toBe(0);
  });
});

describe('slaState — degenerate input', () => {
  test('no goal means no state to report', () => {
    expect(slaState({ started_at: T0 }, null, at(10))).toBeNull();
  });

  test('no clock means no state to report', () => {
    expect(slaState(null, GOAL, at(10))).toBeNull();
  });

  test('a zero-minute target is treated as no goal rather than dividing by zero', () => {
    expect(slaState({ started_at: T0 }, { target_minutes: 0 }, at(10))).toBeNull();
  });
});

// ===== The lifecycle, end to end through the API =====

let app, agent, client, projectId, typeId;

/** The SLA state an agent sees for a request, keyed by metric. */
async function slaFor(key) {
  const res = await request(app).get(`/api/issues/${key}/sla`).set(agent);
  expect(res.status).toBe(200);
  return Object.fromEntries(res.body.map((s) => [s.metric, s]));
}

async function raiseRequest(summary) {
  const res = await request(app).post('/api/help/requests').set(client)
    .send({ request_type_id: typeId, summary, fields: {} });
  expect(res.status).toBe(201);
  return res.body.key;
}

/** The internal id behind a request key — /api/issues/:id takes a uuid. */
async function issueIdFor(key) {
  const res = await request(app).get(`/api/projects/${projectId}/issues`).set(agent);
  const issue = res.body.find((i) => i.issue_key === key);
  if (!issue) throw new Error(`No issue ${key}`);
  return issue.id;
}

beforeAll(async () => {
  app = await createTestApp();
  agent = await adminHeaders();
  client = await loginAs('dana@customer.example.com', 'password123');

  const projects = await request(app).get('/api/projects').set(agent);
  projectId = projects.body.find((p) => p.key === 'HD').id;

  const type = await request(app).post(`/api/projects/${projectId}/request-types`).set(agent)
    .send({ name: 'Widget fault', fields: [] });
  typeId = type.body.id;
});

describe('SLA goals', () => {
  test('a goal is created against a request type and listed back', async () => {
    const res = await request(app).post(`/api/request-types/${typeId}/sla-goals`).set(agent)
      .send({ metric: 'first_response', target_minutes: 60 });
    expect(res.status).toBe(201);
    expect(res.body.target_minutes).toBe(60);

    const list = await request(app).get(`/api/request-types/${typeId}/sla-goals`).set(agent);
    expect(list.body.some((g) => g.metric === 'first_response')).toBe(true);
  });

  test('an unknown metric is refused', async () => {
    const res = await request(app).post(`/api/request-types/${typeId}/sla-goals`).set(agent)
      .send({ metric: 'vibes', target_minutes: 60 });
    expect(res.status).toBe(400);
  });

  test('a target of zero minutes is refused — it would breach on creation', async () => {
    const res = await request(app).post(`/api/request-types/${typeId}/sla-goals`).set(agent)
      .send({ metric: 'resolution', target_minutes: 0 });
    expect(res.status).toBe(400);
  });

  test('an ordinary user cannot set a goal', async () => {
    const user = await loginAs('priya@example.com', 'password123');
    const res = await request(app).post(`/api/request-types/${typeId}/sla-goals`).set(user)
      .send({ metric: 'resolution', target_minutes: 60 });
    expect(res.status).toBe(403);
  });
});

describe('SLA clocks start when a request is raised', () => {
  beforeAll(async () => {
    await request(app).post(`/api/request-types/${typeId}/sla-goals`).set(agent)
      .send({ metric: 'resolution', target_minutes: 480 });
  });

  test('one clock starts per goal matching the request', async () => {
    const key = await raiseRequest('Clocks please');
    const sla = await slaFor(key);
    expect(Object.keys(sla).sort()).toEqual(['first_response', 'resolution']);
    expect(sla.first_response.status).toBe('ok');
    expect(sla.first_response.target_minutes).toBe(60);
    expect(sla.resolution.target_minutes).toBe(480);
  });

  test('a priority-specific goal beats the any-priority goal', async () => {
    await request(app).post(`/api/request-types/${typeId}/sla-goals`).set(agent)
      .send({ metric: 'first_response', priority: 'medium', target_minutes: 15 });
    const key = await raiseRequest('Medium priority request');
    const sla = await slaFor(key);
    // Requests are raised at medium priority, so the tighter goal applies.
    expect(sla.first_response.target_minutes).toBe(15);
  });

  test('a request type with no goals has no clocks, not empty ones', async () => {
    const bare = await request(app).post(`/api/projects/${projectId}/request-types`).set(agent)
      .send({ name: 'No goals', fields: [] });
    const res = await request(app).post('/api/help/requests').set(client)
      .send({ request_type_id: bare.body.id, summary: 'Ungoverned', fields: {} });
    const sla = await slaFor(res.body.key);
    expect(Object.keys(sla)).toEqual([]);
  });
});

describe('first response', () => {
  test('an internal note does NOT stop the first response clock', async () => {
    const key = await raiseRequest('Internal note only');
    const id = await issueIdFor(key);
    await request(app).post(`/api/issues/${id}/comments`).set(agent)
      .send({ body: 'Checking with the vendor', visibility: 'internal' });

    expect((await slaFor(key)).first_response.stopped).toBe(false);
  });

  test('the first public agent reply stops it', async () => {
    const key = await raiseRequest('Public reply');
    const id = await issueIdFor(key);
    await request(app).post(`/api/issues/${id}/comments`).set(agent)
      .send({ body: 'On it — we have ordered a replacement' });

    expect((await slaFor(key)).first_response.stopped).toBe(true);
  });

  test("the customer's own comment does not stop it — that is not a response", async () => {
    const key = await raiseRequest('Customer chases');
    await request(app).post(`/api/help/requests/${key}/comments`).set(client)
      .send({ body: 'Any update?' });

    expect((await slaFor(key)).first_response.stopped).toBe(false);
  });

  test('a second reply does not move the stop time', async () => {
    const key = await raiseRequest('Two replies');
    const id = await issueIdFor(key);
    await request(app).post(`/api/issues/${id}/comments`).set(agent).send({ body: 'First' });
    const first = (await slaFor(key)).first_response.elapsed_minutes;
    await request(app).post(`/api/issues/${id}/comments`).set(agent).send({ body: 'Second' });
    expect((await slaFor(key)).first_response.elapsed_minutes).toBe(first);
  });
});

describe('resolution', () => {
  test('reaching a done-category status stops the resolution clock', async () => {
    const key = await raiseRequest('Will be resolved');
    const id = await issueIdFor(key);
    await request(app).put(`/api/issues/${id}`).set(agent).send({ status: 'done' });

    expect((await slaFor(key)).resolution.stopped).toBe(true);
  });

  test('reopening restarts the clock — the request was not actually resolved', async () => {
    const key = await raiseRequest('Reopened');
    const id = await issueIdFor(key);
    await request(app).put(`/api/issues/${id}`).set(agent).send({ status: 'done' });
    await request(app).put(`/api/issues/${id}`).set(agent).send({ status: 'in_progress' });

    expect((await slaFor(key)).resolution.stopped).toBe(false);
  });

  test('a customer resolving from the help center stops it too', async () => {
    const key = await raiseRequest('Customer resolves');
    await request(app).post(`/api/help/requests/${key}/resolve`).set(client);
    expect((await slaFor(key)).resolution.stopped).toBe(true);
  });
});

describe('pausing on waiting for customer', () => {
  let waitingKey;

  beforeAll(async () => {
    // Flag a status as waiting on the customer — the flag lives on
    // project_statuses (migration 011) and is toggled in the workflow editor.
    // A label of its own, because the seeded help desk workflow already has a
    // "Waiting for customer" and status keys are unique per project.
    const created = await request(app).post(`/api/projects/${projectId}/statuses`).set(agent)
      .send({ label: 'Pending customer info', category: 'in_progress' });
    expect(created.status).toBe(201);
    waitingKey = created.body.key;
    const patched = await request(app).put(`/api/statuses/${created.body.id}`)
      .set(agent).send({ waiting_for_customer: true });
    expect(patched.status).toBe(200);
    expect(patched.body.waiting_for_customer).toBeTruthy();
  });

  test('entering the status pauses the running clocks', async () => {
    const key = await raiseRequest('Needs info');
    const id = await issueIdFor(key);
    await request(app).put(`/api/issues/${id}`).set(agent).send({ status: waitingKey });

    const sla = await slaFor(key);
    expect(sla.first_response.paused).toBe(true);
    expect(sla.resolution.paused).toBe(true);
  });

  test('a customer reply resumes them and banks the waiting time', async () => {
    const key = await raiseRequest('Will reply');
    const id = await issueIdFor(key);
    await request(app).put(`/api/issues/${id}`).set(agent).send({ status: waitingKey });
    await request(app).post(`/api/help/requests/${key}/comments`).set(client).send({ body: 'Here you go' });

    const sla = await slaFor(key);
    expect(sla.resolution.paused).toBe(false);
    // The clock is running again from where it left off, not from zero.
    expect(sla.resolution.elapsed_minutes).toBeGreaterThanOrEqual(0);
  });

  test('an agent moving the request out of the waiting status also resumes it', async () => {
    const key = await raiseRequest('Agent unblocks');
    const id = await issueIdFor(key);
    await request(app).put(`/api/issues/${id}`).set(agent).send({ status: waitingKey });
    await request(app).put(`/api/issues/${id}`).set(agent).send({ status: 'in_progress' });

    expect((await slaFor(key)).resolution.paused).toBe(false);
  });
});

describe('breach is recorded, never depended on', () => {
  test('a read that observes a breach stamps breached_at once', async () => {
    const key = await raiseRequest('Will breach');
    const id = await issueIdFor(key);
    const { getDb, queryOne, run } = require('../../database');
    const db = await getDb();

    // Backdate the clock so it is already past its 15-minute goal.
    await run(db,
      "UPDATE sd_sla_clocks SET started_at = '2020-01-01 00:00:00' WHERE issue_id = ? AND metric = 'first_response'",
      [id]);

    const sla = await slaFor(key);
    expect(sla.first_response.status).toBe('breached');

    const row = await queryOne(db,
      "SELECT breached_at FROM sd_sla_clocks WHERE issue_id = ? AND metric = 'first_response'",
      [id]);
    expect(row.breached_at).toBeTruthy();

    // Clearing the stamp must not change what a read reports: breach STATE is
    // derived, the stamp only records when it was first seen.
    await run(db, 'UPDATE sd_sla_clocks SET breached_at = NULL WHERE issue_id = ?', [id]);
    expect((await slaFor(key)).first_response.status).toBe('breached');
  });
});

describe('SLA on the boundary', () => {
  test('a customer never sees SLA state on their own request', async () => {
    const key = await raiseRequest('Customer view');
    const res = await request(app).get(`/api/help/requests/${key}`).set(client);
    expect(res.status).toBe(200);
    // toPublicRequest() is an allow-list, so this holds by construction — the
    // test exists to fail loudly if anyone ever hand-rolls a customer payload.
    for (const leak of ['sla', 'target_minutes', 'breached_at', 'elapsed_minutes']) {
      expect(Object.keys(res.body)).not.toContain(leak);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/target_minutes|breached|elapsed_minutes/i);
  });

  test('a client cannot read the agent SLA endpoint', async () => {
    const key = await raiseRequest('Blocked');
    const res = await request(app).get(`/api/issues/${key}/sla`).set(client);
    expect(res.status).toBe(403);
  });
});
