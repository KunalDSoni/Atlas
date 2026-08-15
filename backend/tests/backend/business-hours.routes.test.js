// Writing a business_hours profile through the API. Until this existed the
// column could only be set with raw SQL, which is why so few deployments had
// one — and an unconfigured project loses a forgotten timer's time entirely.
// See docs/superpowers/specs/2026-08-15-business-hours-configuration-design.md
const { createTestApp, getApp, adminHeaders, userHeaders } = require('./setup');
const request = require('supertest');
const { getDb, queryOne, run } = require('../../database');
const { closeStaleSegments, timerState } = require('../../utils/timers');
const { v4: uuidv4 } = require('uuid');

let headers, plainHeaders, db, projectId;

const profile = { timezone: 'UTC', work_days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 18 };

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  plainHeaders = await userHeaders();
  const projects = await request(getApp()).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
});

afterEach(async () => {
  await run(db, 'UPDATE projects SET business_hours = NULL WHERE id = ?', [projectId]);
});

describe('PUT /api/projects/:id business_hours', () => {
  test('a board admin sets the project profile', async () => {
    const res = await request(getApp())
      .put(`/api/projects/${projectId}`).set(headers).send({ business_hours: profile });

    expect(res.status).toBe(200);
    const row = await queryOne(db, 'SELECT business_hours FROM projects WHERE id = ?', [projectId]);
    expect(JSON.parse(row.business_hours)).toEqual(profile);
  });

  test('an invalid profile is rejected and nothing is written', async () => {
    const res = await request(getApp())
      .put(`/api/projects/${projectId}`).set(headers)
      .send({ business_hours: { ...profile, start_hour: 17, end_hour: 9 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/end_hour/);
    const row = await queryOne(db, 'SELECT business_hours FROM projects WHERE id = ?', [projectId]);
    expect(row.business_hours).toBeNull();
  });

  test('omitting the field leaves an existing profile untouched', async () => {
    // The profile form posts several unrelated fields. Without the
    // omitted-vs-null distinction, any such partial body would wipe the hours.
    await request(getApp()).put(`/api/projects/${projectId}`).set(headers).send({ business_hours: profile });

    await request(getApp()).put(`/api/projects/${projectId}`).set(headers).send({ description: 'unrelated edit' });

    const row = await queryOne(db, 'SELECT business_hours FROM projects WHERE id = ?', [projectId]);
    expect(JSON.parse(row.business_hours)).toEqual(profile);
  });

  test('an explicit null clears the profile', async () => {
    await request(getApp()).put(`/api/projects/${projectId}`).set(headers).send({ business_hours: profile });

    await request(getApp()).put(`/api/projects/${projectId}`).set(headers).send({ business_hours: null });

    const row = await queryOne(db, 'SELECT business_hours FROM projects WHERE id = ?', [projectId]);
    expect(row.business_hours).toBeNull();
  });

  test('a plain member cannot set the project profile', async () => {
    const res = await request(getApp())
      .put(`/api/projects/${projectId}`).set(plainHeaders).send({ business_hours: profile });

    expect(res.status).toBe(403);
  });
});

describe('PUT /api/profile business_hours', () => {
  test('a user sets their own override', async () => {
    const res = await request(getApp())
      .put('/api/profile').set(plainHeaders).send({ business_hours: profile });

    expect(res.status).toBe(200);
    const me = await request(getApp()).get('/api/auth/me').set(plainHeaders);
    const row = await queryOne(db, 'SELECT business_hours FROM users WHERE id = ?', [me.body.id]);
    expect(JSON.parse(row.business_hours)).toEqual(profile);
  });

  test('an invalid override is rejected', async () => {
    const res = await request(getApp())
      .put('/api/profile').set(plainHeaders).send({ business_hours: { ...profile, timezone: 'Mars/Olympus' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timezone/);
  });

  test('editing an unrelated profile field leaves the override untouched', async () => {
    await request(getApp()).put('/api/profile').set(plainHeaders).send({ business_hours: profile });

    await request(getApp()).put('/api/profile').set(plainHeaders).send({ job_title: 'Engineer' });

    const me = await request(getApp()).get('/api/auth/me').set(plainHeaders);
    const row = await queryOne(db, 'SELECT business_hours FROM users WHERE id = ?', [me.body.id]);
    expect(JSON.parse(row.business_hours)).toEqual(profile);
  });
});

describe('the payoff: a configured profile rescues a forgotten timer', () => {
  async function forgottenOvernightTimer() {
    const issue = (await request(getApp())
      .post(`/api/projects/${projectId}/issues`).set(headers)
      .send({ title: 'Left running overnight', type: 'task' })).body;
    const userId = uuidv4();
    await run(db, 'INSERT INTO users (id, email, name, password, role) VALUES (?, ?, ?, ?, ?)',
      [userId, `bh-${userId}@example.com`, 'Overnight', 'x', 'user']);

    // Started 14:00 UTC on an earlier weekday, never paused. At least two days
    // back so the no-profile case is past ABANDONED_AFTER_MINUTES (24h) and is
    // genuinely abandoned rather than a timer that is still legitimately
    // running — the workday-end rule needs only an earlier calendar day.
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 2);
    while (![1, 2, 3, 4, 5].includes(start.getUTCDay() === 0 ? 7 : start.getUTCDay())) {
      start.setUTCDate(start.getUTCDate() - 1);
    }
    start.setUTCHours(14, 0, 0, 0);
    await run(db, 'INSERT INTO timer_segments (id, issue_id, user_id, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
      [uuidv4(), issue.id, userId, start.toISOString().slice(0, 19).replace('T', ' '), start.toISOString().slice(0, 19).replace('T', ' ')]);
    return { issue, userId };
  }

  test('without a profile it credits nothing', async () => {
    const { issue, userId } = await forgottenOvernightTimer();

    await closeStaleSegments(db, { userId });

    expect((await timerState(db, issue.id, userId)).elapsed_minutes).toBe(0);
  });

  test('with a profile it credits up to the end of that working day', async () => {
    await request(getApp()).put(`/api/projects/${projectId}`).set(headers).send({ business_hours: profile });
    const { issue, userId } = await forgottenOvernightTimer();

    await closeStaleSegments(db, { userId });

    // 14:00 start, 18:00 close = 4h credited rather than zero or a fabrication.
    expect((await timerState(db, issue.id, userId)).elapsed_minutes).toBe(240);
  });
});
