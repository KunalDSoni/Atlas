const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { createTestApp, getApp, adminHeaders } = require('./setup');
const { getDb, run } = require('../../database');

let headers, db, projectId;

// Insert an issue with a fixed created_at, then hand-written status rows.
async function seedIssue({ title, createdAt, status, transitions }) {
  const res = await request(getApp())
    .post(`/api/projects/${projectId}/issues`).set(headers)
    .send({ title, type: 'task' });
  expect(res.status).toBe(201);
  const id = res.body.id;
  await run(db, 'UPDATE issues SET created_at = ?, status = ? WHERE id = ?', [createdAt, status, id]);
  // The route API stamps 'now'; write history rows directly for determinism.
  await run(db, 'DELETE FROM activity_log WHERE issue_id = ?', [id]);
  for (const t of transitions) {
    await run(db,
      `INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at)
       VALUES (?, ?, ?, 'update', 'status', ?, ?, ?)`,
      [uuidv4(), id, headers['x-user-id'], t.from, t.to, t.at]);
  }
  return id;
}

beforeAll(async () => {
  await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  // A fresh project so seeded demo issues don't pollute the numbers.
  const proj = await request(getApp()).post('/api/projects').set(headers)
    .send({ name: 'Flow Fixtures', key: 'FLW' });
  expect(proj.status).toBe(201);
  projectId = proj.body.id;

  // Issue A: todo 1d → in_progress 2d → done. Lead 72h, cycle 48h.
  await seedIssue({
    title: 'A', createdAt: '2026-07-01 00:00:00', status: 'done',
    transitions: [
      { from: 'todo', to: 'in_progress', at: '2026-07-02 00:00:00' },
      { from: 'in_progress', to: 'done', at: '2026-07-04 00:00:00' },
    ],
  });
  // Issue B: todo 12h → in_progress 12h → done. Lead 24h, cycle 12h.
  await seedIssue({
    title: 'B', createdAt: '2026-07-01 00:00:00', status: 'done',
    transitions: [
      { from: 'todo', to: 'in_progress', at: '2026-07-01 12:00:00' },
      { from: 'in_progress', to: 'done', at: '2026-07-02 00:00:00' },
    ],
  });
  // Issue C: done with NO recorded transitions (legacy) — excluded from cycle time.
  await seedIssue({ title: 'C', createdAt: '2026-07-01 00:00:00', status: 'done', transitions: [] });
  // Issue D: still in progress — not completed, excluded from cycle time.
  await seedIssue({
    title: 'D', createdAt: '2026-07-01 00:00:00', status: 'in_progress',
    transitions: [{ from: 'todo', to: 'in_progress', at: '2026-07-03 00:00:00' }],
  });
});

describe('cycle-time report', () => {
  test('computes lead and cycle hours from recorded transitions only', async () => {
    const res = await request(getApp())
      .get(`/api/projects/${projectId}/reports/cycle-time`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2); // A and B; C has no transitions, D not done
    const a = res.body.issues.find(i => i.title === 'A');
    expect(a.lead_time_h).toBeCloseTo(72);
    expect(a.cycle_time_h).toBeCloseTo(48);
    expect(res.body.avg_cycle_h).toBeCloseTo(30); // (48+12)/2
    expect(res.body.p50_cycle_h).toBeCloseTo(12); // nearest-rank of [12,48]
    expect(res.body.p85_cycle_h).toBeCloseTo(48);
  });

  test('a project with no history returns nulls and zero count, never NaN', async () => {
    const empty = await request(getApp()).post('/api/projects').set(headers)
      .send({ name: 'Empty Flow', key: 'EFW' });
    const res = await request(getApp())
      .get(`/api/projects/${empty.body.id}/reports/cycle-time`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.avg_cycle_h).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/NaN/);
  });
});

describe('time-in-status report', () => {
  test('sums hours per status across issues', async () => {
    const res = await request(getApp())
      .get(`/api/projects/${projectId}/reports/time-in-status`).set(headers);
    expect(res.status).toBe(200);
    const todo = res.body.statuses.find(s => s.status === 'todo');
    // A: 24h todo, B: 12h todo, C: none recorded (open segment in done), D: 48h todo.
    expect(todo.total_h).toBeCloseTo(84);
    expect(todo.issues).toBe(3);
    const inProg = res.body.statuses.find(s => s.status === 'in_progress');
    expect(inProg.total_h).toBeGreaterThanOrEqual(60); // A 48h + B 12h + D open ≥ 0
  });
});

describe('cumulative-flow report', () => {
  test('reconstructs daily category counts', async () => {
    const res = await request(getApp())
      .get(`/api/projects/${projectId}/reports/cumulative-flow?days=30`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.days.length).toBe(30);
    for (const d of res.body.days) {
      expect(d).toHaveProperty('date');
      expect(typeof d.todo).toBe('number');
      expect(typeof d.in_progress).toBe('number');
      expect(typeof d.done).toBe('number');
    }
    // The final day reflects current reality: A,B,C done; D in progress.
    const last = res.body.days[res.body.days.length - 1];
    expect(last.done).toBe(3);
    expect(last.in_progress).toBe(1);
  });

  test('days param is clamped to 90', async () => {
    const res = await request(getApp())
      .get(`/api/projects/${projectId}/reports/cumulative-flow?days=500`).set(headers);
    expect(res.body.days.length).toBe(90);
  });
});

describe('query discipline', () => {
  test('cycle-time query count stays flat as issues grow', async () => {
    const measure = async () => {
      const original = db.prepare.bind(db);
      let n = 0;
      db.prepare = (...a) => { n += 1; return original(...a); };
      await request(getApp()).get(`/api/projects/${projectId}/reports/cycle-time`).set(headers);
      db.prepare = original;
      return n;
    };
    const small = await measure();
    for (let i = 0; i < 10; i++) {
      await seedIssue({
        title: `Bulk ${i}`, createdAt: '2026-07-01 00:00:00', status: 'done',
        transitions: [
          { from: 'todo', to: 'in_progress', at: '2026-07-02 00:00:00' },
          { from: 'in_progress', to: 'done', at: '2026-07-03 00:00:00' },
        ],
      });
    }
    const large = await measure();
    expect(large - small).toBeLessThanOrEqual(1);
  });
});

describe('GET /reports/time-tracking', () => {
  test('splits minutes by sprint and by user, by source', async () => {
    const sprintRes = await request(getApp())
      .post(`/api/projects/${projectId}/sprints`).set(headers)
      .send({ name: 'Rollup Sprint', start_date: '2026-07-01', end_date: '2026-07-14' });
    expect(sprintRes.status).toBe(201);
    const sprintId = sprintRes.body.id;

    const issueRes = await request(getApp())
      .post(`/api/projects/${projectId}/issues`).set(headers)
      .send({ title: 'Rollup test', type: 'task', sprint_id: sprintId });
    const issue = issueRes.body;
    // The rollup groups by assignee, so assign the issue to its reporter for a deterministic match below.
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ assignee_id: issue.reporter_id });
    await request(getApp()).post(`/api/issues/${issue.id}/worklogs`).set(headers).send({ minutes: 20, comment: 'manual' });

    await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, source) VALUES (?, ?, ?, ?, 'auto')",
      [uuidv4(), issue.id, issue.reporter_id, 40]);

    const res = await request(getApp()).get(`/api/projects/${projectId}/reports/time-tracking`).set(headers);
    expect(res.status).toBe(200);
    const sprintRow = res.body.by_sprint.find((s) => s.sprint_id === sprintId);
    expect(sprintRow.manual_minutes).toBeGreaterThanOrEqual(20);
    expect(sprintRow.auto_minutes).toBeGreaterThanOrEqual(40);
    expect(sprintRow.total_minutes).toBe(sprintRow.manual_minutes + sprintRow.auto_minutes);

    const userRow = res.body.by_user.find((u) => u.user_id === issue.reporter_id);
    expect(userRow.total_minutes).toBeGreaterThanOrEqual(60);
  });

  test('credits a timer work log to the user who tracked it, not the issue\'s current assignee', async () => {
    // Regression guard: the by-user breakdown used to group by i.assignee_id,
    // so tracked time authored by a different user than the current assignee
    // (e.g. two people splitting a ticket) was silently credited to whoever
    // the assignee happens to be now, defeating the whole point of the
    // stopwatch's per-user attribution.
    const otherHeaders = await require('./setup').userHeaders();
    const other = await request(getApp()).get('/api/auth/me').set(otherHeaders);

    const issueRes = await request(getApp())
      .post(`/api/projects/${projectId}/issues`).set(headers)
      .send({ title: 'Timer credited to tracker, not assignee', type: 'task' });
    const issue = issueRes.body;
    // Assignee is the admin (issue.reporter_id); the timer time below is
    // tracked by a DIFFERENT user and must still be credited to them.
    await request(getApp()).put(`/api/issues/${issue.id}`).set(headers).send({ assignee_id: issue.reporter_id });

    await run(db, "INSERT INTO work_logs (id, issue_id, user_id, minutes, source) VALUES (?, ?, ?, ?, 'timer')",
      [uuidv4(), issue.id, other.body.id, 77]);

    const res = await request(getApp()).get(`/api/projects/${projectId}/reports/time-tracking`).set(headers);
    expect(res.status).toBe(200);

    const trackerRow = res.body.by_user.find((u) => u.user_id === other.body.id);
    expect(trackerRow).toBeTruthy();
    expect(trackerRow.timer_minutes).toBeGreaterThanOrEqual(77);

    const assigneeRow = res.body.by_user.find((u) => u.user_id === issue.reporter_id);
    if (assigneeRow) expect(assigneeRow.timer_minutes).toBe(0); // not credited to the assignee
  });
});

describe('GET /reports/time-tracking/export/csv', () => {
  test('returns a CSV with sprint and user breakdown', async () => {
    const res = await request(getApp()).get(`/api/projects/${projectId}/reports/time-tracking/export/csv`).set(headers);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('Sprint');
  });
});

describe('GET /reports/export/csv includes time spent', () => {
  test('issue export has a Time Spent column', async () => {
    const res = await request(getApp()).get(`/api/projects/${projectId}/reports/export/csv`).set(headers);
    expect(res.text.split('\n')[0]).toContain('Time Spent');
  });
});
