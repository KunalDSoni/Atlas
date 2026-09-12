/**
 * AUTOMATIC SPRINT SCHEDULING TESTS
 *
 * Sprints run on a fixed semi-monthly calendar: the 1st-15th, and the 16th to
 * the end of the month. Atlas creates each window, activates it when the window
 * opens, completes the outgoing one, and sweeps unfinished work forward.
 *
 * `now` is passed explicitly everywhere rather than mocked or waited for, so a
 * boundary, a leap February and a December rollover are all just arguments.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { getDb, queryOne, queryAll, run } = require('../../database');
const { windowFor, nextWindow, currentAndNext, calendarDay } = require('../../utils/sprint-windows');
const { reconcileProject } = require('../../utils/auto-sprints');

let app, headers, projectId, db;

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

beforeAll(async () => {
  app = await createTestApp();
  db = await getDb();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
});

/** A project of its own, so one test's sweep cannot disturb another's. */
async function freshProject(name) {
  const res = await request(app)
    .post('/api/projects')
    .set(headers)
    .send({ name, key: name.replace(/[^A-Z]/gi, '').slice(0, 6).toUpperCase() + Math.floor(Math.random() * 900 + 100) });
  expect(res.status).toBe(201);
  return res.body.id;
}

// Deliberately the same ordering the route serves (SPRINT_LIST_ORDER in
// routes/sprints.js). Both windows are written in the same second, so ordering
// by created_at alone leaves them tied and the tiebreak is a random UUID — a
// test asserting positional order against that passes or fails by coin flip.
const sprintsOf = (pid) => queryAll(db,
  'SELECT * FROM sprints WHERE project_id = ? ORDER BY (start_date IS NULL), start_date, created_at, id',
  [pid]);

const byKey = async (pid, key) =>
  queryOne(db, 'SELECT * FROM sprints WHERE project_id = ? AND auto_key = ?', [pid, key]);

/**
 * POST /issues always assigns the project's first workflow status and ignores a
 * supplied one, so a test that needs an issue to already be finished has to
 * write the status itself rather than ask for it at creation.
 */
async function makeIssue(pid, title, sprintId, { status, ...extra } = {}) {
  const res = await request(app)
    .post(`/api/projects/${pid}/issues`)
    .set(headers)
    .send({ title, type: 'task', sprint_id: sprintId ?? null, ...extra });
  expect(res.status).toBe(201);
  if (status) await run(db, 'UPDATE issues SET status = ? WHERE id = ?', [status, res.body.id]);
  return res.body;
}

const sprintOfIssue = async (id) =>
  (await queryOne(db, 'SELECT sprint_id FROM issues WHERE id = ?', [id])).sprint_id;

// ===== The calendar itself =====

describe('window math', () => {
  test('splits a month at the 15th/16th', () => {
    expect(windowFor(utc(2026, 9, 1))).toMatchObject({ key: '2026-09-1', start_date: '2026-09-01', end_date: '2026-09-15' });
    expect(windowFor(utc(2026, 9, 15))).toMatchObject({ key: '2026-09-1' });
    expect(windowFor(utc(2026, 9, 16))).toMatchObject({ key: '2026-09-2', start_date: '2026-09-16', end_date: '2026-09-30' });
    expect(windowFor(utc(2026, 9, 30))).toMatchObject({ key: '2026-09-2' });
  });

  test('ends the second window on the real last day of the month', () => {
    expect(windowFor(utc(2026, 1, 20)).end_date).toBe('2026-01-31');   // 31 days
    expect(windowFor(utc(2026, 4, 20)).end_date).toBe('2026-04-30');   // 30 days
    expect(windowFor(utc(2026, 2, 20)).end_date).toBe('2026-02-28');   // common year
    expect(windowFor(utc(2028, 2, 20)).end_date).toBe('2028-02-29');   // leap year
  });

  test('rolls the year at December', () => {
    expect(nextWindow(windowFor(utc(2026, 12, 20)))).toMatchObject({ key: '2027-01-1', start_date: '2027-01-01' });
  });

  test('names a window with its year, since a sprint list outlives one', () => {
    expect(windowFor(utc(2026, 9, 3)).name).toBe('Sep 1–15, 2026');
    expect(windowFor(utc(2026, 9, 20)).name).toBe('Sep 16–30, 2026');
  });

  // The whole point of naming a zone: these instants are one date in UTC and the
  // next date in IST, and the window has to follow the team's calendar. Noon-UTC
  // fixtures elsewhere cannot show this — they fall on the same day either way.
  describe('boundaries are cut on IST, not UTC', () => {
    test('the 16th begins at IST midnight, not UTC midnight', () => {
      // 18:29 UTC on the 15th is 23:59 IST on the 15th — still the first window.
      expect(windowFor(new Date('2026-09-15T18:29:00Z')).key).toBe('2026-09-1');
      // One minute later is 00:00 IST on the 16th.
      expect(windowFor(new Date('2026-09-15T18:30:00Z')).key).toBe('2026-09-2');
    });

    test('a month turns over on the IST calendar too', () => {
      expect(windowFor(new Date('2026-09-30T18:29:00Z')).key).toBe('2026-09-2');
      expect(windowFor(new Date('2026-09-30T18:30:00Z')).key).toBe('2026-10-1');
    });

    test('and so does a year', () => {
      expect(windowFor(new Date('2026-12-31T18:30:00Z')).key).toBe('2027-01-1');
    });

    test('calendarDay reads the same clock the windows are cut on', () => {
      expect(calendarDay(new Date('2026-09-15T18:29:00Z'))).toBe('2026-09-15');
      expect(calendarDay(new Date('2026-09-15T18:30:00Z'))).toBe('2026-09-16');
    });
  });

  test('offers the current window and the one after it, never a past one', () => {
    const { current, next } = currentAndNext(utc(2026, 9, 20));
    expect(current.key).toBe('2026-09-2');
    expect(next.key).toBe('2026-10-1');
  });
});

// ===== Reconciliation =====

describe('reconciling a project against the calendar', () => {
  test('creates the current window active and the next one planning', async () => {
    const pid = await freshProject('AutoCreate');
    await reconcileProject(db, pid, utc(2026, 9, 3));

    const rows = await sprintsOf(pid);
    expect(rows.map((s) => [s.auto_key, s.status])).toEqual([
      ['2026-09-1', 'active'],
      ['2026-09-2', 'planning'],
    ]);
    expect(rows[0]).toMatchObject({ name: 'Sep 1–15, 2026', start_date: '2026-09-01', end_date: '2026-09-15' });
  });

  test('is idempotent — repeated calls change nothing', async () => {
    const pid = await freshProject('Idempotent');
    await reconcileProject(db, pid, utc(2026, 9, 3));
    const first = await sprintsOf(pid);

    await reconcileProject(db, pid, utc(2026, 9, 4));
    await reconcileProject(db, pid, utc(2026, 9, 5));

    expect(await sprintsOf(pid)).toEqual(first);
  });

  test('crossing the 15th/16th boundary hands over to the next window', async () => {
    const pid = await freshProject('Boundary');
    await reconcileProject(db, pid, utc(2026, 9, 10));
    await reconcileProject(db, pid, utc(2026, 9, 16));

    expect(await byKey(pid, '2026-09-1')).toMatchObject({ status: 'completed' });
    expect(await byKey(pid, '2026-09-2')).toMatchObject({ status: 'active' });
    // The window after the new current one is materialised too.
    expect(await byKey(pid, '2026-10-1')).toMatchObject({ status: 'planning' });
  });

  test('hands over on the IST boundary, not the UTC one', async () => {
    const pid = await freshProject('IstHandover');
    // 17:00 UTC on the 15th = 22:30 IST, still the 15th.
    await reconcileProject(db, pid, new Date('2026-09-15T17:00:00Z'));
    expect(await byKey(pid, '2026-09-1')).toMatchObject({ status: 'active' });

    // 18:30 UTC = 00:00 IST on the 16th. The window has turned over.
    await reconcileProject(db, pid, new Date('2026-09-15T18:30:00Z'));
    expect(await byKey(pid, '2026-09-1')).toMatchObject({ status: 'completed' });
    expect(await byKey(pid, '2026-09-2')).toMatchObject({ status: 'active' });
  });

  test('crossing a month end hands over to the next month', async () => {
    const pid = await freshProject('MonthEnd');
    await reconcileProject(db, pid, utc(2026, 9, 20));
    await reconcileProject(db, pid, utc(2026, 10, 1));

    expect(await byKey(pid, '2026-09-2')).toMatchObject({ status: 'completed' });
    expect(await byKey(pid, '2026-10-1')).toMatchObject({ status: 'active' });
  });

  test('never leaves two sprints active', async () => {
    const pid = await freshProject('OneActive');
    for (const day of [utc(2026, 9, 3), utc(2026, 9, 16), utc(2026, 10, 2), utc(2026, 10, 20)]) {
      await reconcileProject(db, pid, day);
      const active = (await sprintsOf(pid)).filter((s) => s.status === 'active');
      expect(active).toHaveLength(1);
    }
  });

  test('skips windows it was never awake for, rather than backfilling them', async () => {
    const pid = await freshProject('Dormant');
    await reconcileProject(db, pid, utc(2026, 9, 3));
    await reconcileProject(db, pid, utc(2026, 12, 20));

    const keys = (await sprintsOf(pid)).map((s) => s.auto_key).sort();
    // Sep (now completed), plus the December window and January — nothing for
    // October or November, which this project never worked in.
    expect(keys).toEqual(['2026-09-1', '2026-09-2', '2026-12-2', '2027-01-1']);
  });
});

// ===== What happens to the work =====

describe('sweeping work at a boundary', () => {
  test('moves unfinished work forward and leaves finished work behind', async () => {
    const pid = await freshProject('Sweep');
    await reconcileProject(db, pid, utc(2026, 9, 10));
    const first = await byKey(pid, '2026-09-1');

    const open = await makeIssue(pid, 'Still going', first.id);
    const shipped = await makeIssue(pid, 'Finished', first.id, { status: 'done' });

    await reconcileProject(db, pid, utc(2026, 9, 16));
    const second = await byKey(pid, '2026-09-2');

    expect(await sprintOfIssue(open.id)).toBe(second.id);
    expect(await sprintOfIssue(shipped.id)).toBe(first.id);
  });

  test('records the roll, so the issue remembers where it came from', async () => {
    const pid = await freshProject('History');
    await reconcileProject(db, pid, utc(2026, 9, 10));
    const first = await byKey(pid, '2026-09-1');
    const issue = await makeIssue(pid, 'Carried over', first.id);

    await reconcileProject(db, pid, utc(2026, 9, 16));

    const res = await request(app).get(`/api/issues/${issue.id}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.previous_sprints.map((s) => s.name)).toEqual(['Sep 1–15, 2026']);
  });

  // The guard that refuses to complete a sprint holding an unfinished subtask is
  // kept, not bypassed: the sweep makes it true before completion runs. A parent
  // that is itself done but still has an open subtask has to leave too, or the
  // sprint could never close and the next one could never start.
  test('takes a done parent with an unfinished subtask, and still completes', async () => {
    const pid = await freshProject('SubtaskGuard');
    await reconcileProject(db, pid, utc(2026, 9, 10));
    const first = await byKey(pid, '2026-09-1');

    const parent = await makeIssue(pid, 'Done parent', first.id, { status: 'done' });
    const child = await makeIssue(pid, 'Open subtask', null, { type: 'subtask', parent_id: parent.id });

    await reconcileProject(db, pid, utc(2026, 9, 16));
    const second = await byKey(pid, '2026-09-2');

    expect(await sprintOfIssue(parent.id)).toBe(second.id);
    expect(await byKey(pid, '2026-09-1')).toMatchObject({ status: 'completed' });
    // The subtask follows its parent implicitly; it carries no sprint of its own.
    expect(await sprintOfIssue(child.id)).toBeNull();
  });

  test('reads done from the project workflow, not the literal word', async () => {
    const pid = await freshProject('ShippedColumn');
    await run(db,
      "INSERT INTO project_statuses (id, project_id, key, label, category, position) VALUES (?, ?, 'shipped', 'Shipped', 'done', 99)",
      [`ps-${Date.now()}`, pid]);

    await reconcileProject(db, pid, utc(2026, 9, 10));
    const first = await byKey(pid, '2026-09-1');
    const shipped = await makeIssue(pid, 'Out the door', first.id, { status: 'shipped' });

    await reconcileProject(db, pid, utc(2026, 9, 16));

    // 'shipped' maps to the done category, so it is finished and stays put.
    expect(await sprintOfIssue(shipped.id)).toBe(first.id);
  });
});

// ===== Living alongside hand-made sprints =====

describe('sprints a person made', () => {
  test('sweeps an in-flight manual sprint at the first reconcile', async () => {
    const pid = await freshProject('ManualActive');
    const manual = await request(app)
      .post(`/api/projects/${pid}/sprints`).set(headers).send({ name: 'Hand rolled' });
    await run(db, "UPDATE sprints SET status = 'active' WHERE id = ?", [manual.body.id]);
    const issue = await makeIssue(pid, 'Mid-flight work', manual.body.id);

    await reconcileProject(db, pid, utc(2026, 9, 10));

    expect(await queryOne(db, 'SELECT status FROM sprints WHERE id = ?', [manual.body.id]))
      .toMatchObject({ status: 'completed' });
    expect(await sprintOfIssue(issue.id)).toBe((await byKey(pid, '2026-09-1')).id);
  });

  test('leaves a manual sprint in planning alone', async () => {
    const pid = await freshProject('ManualPlanning');
    const manual = await request(app)
      .post(`/api/projects/${pid}/sprints`).set(headers).send({ name: 'Someday' });
    const issue = await makeIssue(pid, 'Parked', manual.body.id);

    await reconcileProject(db, pid, utc(2026, 9, 10));

    expect(await queryOne(db, 'SELECT status FROM sprints WHERE id = ?', [manual.body.id]))
      .toMatchObject({ status: 'planning' });
    expect(await sprintOfIssue(issue.id)).toBe(manual.body.id);
  });

  test('lets a sprint somebody started keep running', async () => {
    const pid = await freshProject('ManualStarted');
    await reconcileProject(db, pid, utc(2026, 9, 3));

    // Started by hand mid-window, the way anyone would.
    const manual = await request(app)
      .post(`/api/projects/${pid}/sprints`).set(headers).send({ name: 'Mine' });
    await run(db, "UPDATE sprints SET status = 'active' WHERE id = ?", [manual.body.id]);

    await reconcileProject(db, pid, utc(2026, 9, 4));

    // Completing it here would be circular — a hand-made sprint carries no end
    // date, so its own presence would trigger the handover that kills it, and
    // nobody could ever run a sprint of their own.
    expect(await queryOne(db, 'SELECT status FROM sprints WHERE id = ?', [manual.body.id]))
      .toMatchObject({ status: 'active' });
  });

  test('sweeps that sprint at the next real handover', async () => {
    const pid = await freshProject('ManualUntilBoundary');
    await reconcileProject(db, pid, utc(2026, 9, 3));
    const manual = await request(app)
      .post(`/api/projects/${pid}/sprints`).set(headers).send({ name: 'Mine too' });
    await run(db, "UPDATE sprints SET status = 'active' WHERE id = ?", [manual.body.id]);
    const issue = await makeIssue(pid, 'Work in mine', manual.body.id);

    await reconcileProject(db, pid, utc(2026, 9, 16));

    expect(await queryOne(db, 'SELECT status FROM sprints WHERE id = ?', [manual.body.id]))
      .toMatchObject({ status: 'completed' });
    expect(await sprintOfIssue(issue.id)).toBe((await byKey(pid, '2026-09-2')).id);
  });

  test('does not resurrect a window somebody completed early', async () => {
    const pid = await freshProject('ClosedEarly');
    await reconcileProject(db, pid, utc(2026, 9, 3));
    const first = await byKey(pid, '2026-09-1');
    await run(db, "UPDATE sprints SET status = 'completed' WHERE id = ?", [first.id]);

    await reconcileProject(db, pid, utc(2026, 9, 4));

    // Coming back from completed is what reopen is for, and it stays a
    // deliberate, audited, human decision.
    expect(await byKey(pid, '2026-09-1')).toMatchObject({ status: 'completed' });
  });

  // The calendar acts at a handover. Between handovers a person is in charge —
  // without which the scheduler re-activates the current window on every read
  // and quietly takes two abilities away.
  test('leaves the active slot empty when a person parks the running sprint', async () => {
    const pid = await freshProject('Parked');
    await reconcileProject(db, pid, utc(2026, 9, 3));
    const first = await byKey(pid, '2026-09-1');
    await run(db, "UPDATE sprints SET status = 'planning' WHERE id = ?", [first.id]);

    await reconcileProject(db, pid, utc(2026, 9, 4));

    // Re-activating here would make POST /sprints/:id/reopen permanently
    // unreachable, since reopen refuses while another sprint is active.
    expect(await byKey(pid, '2026-09-1')).toMatchObject({ status: 'planning' });
    expect((await sprintsOf(pid)).filter((s) => s.status === 'active')).toHaveLength(0);
  });

  test('does not undo a reopened sprint on the next read', async () => {
    const pid = await freshProject('Reopened');
    await reconcileProject(db, pid, utc(2026, 9, 3));
    const first = await byKey(pid, '2026-09-1');

    // The real flow: park the running sprint, then reopen a completed one with
    // a new end date — which is how a person says "this runs until then".
    await run(db, "UPDATE sprints SET status = 'completed' WHERE id = ?", [first.id]);
    await run(db, "UPDATE sprints SET status = 'active', end_date = '2026-12-31' WHERE id = ?", [first.id]);

    await reconcileProject(db, pid, utc(2026, 9, 4));

    expect(await byKey(pid, '2026-09-1')).toMatchObject({ status: 'active' });
  });

  test('resumes at the next handover, once the reopened sprint has run out', async () => {
    const pid = await freshProject('ResumeAfterReopen');
    await reconcileProject(db, pid, utc(2026, 9, 3));
    const first = await byKey(pid, '2026-09-1');
    await run(db, "UPDATE sprints SET end_date = '2026-09-20' WHERE id = ?", [first.id]);

    // Past that end date the calendar takes the slot back.
    await reconcileProject(db, pid, utc(2026, 9, 21));

    expect(await byKey(pid, '2026-09-1')).toMatchObject({ status: 'completed' });
    expect(await byKey(pid, '2026-09-2')).toMatchObject({ status: 'active' });
  });

  test('tolerates a manual sprint already holding the slug a window wants', async () => {
    const pid = await freshProject('SlugClash');
    await request(app).post(`/api/projects/${pid}/sprints`).set(headers)
      .send({ name: 'sprint 2026 09 1' });

    await reconcileProject(db, pid, utc(2026, 9, 3));

    const generated = await byKey(pid, '2026-09-1');
    expect(generated).toBeTruthy();
    // Identity lives in auto_key, so a suffixed slug costs nothing.
    expect(generated.slug).not.toBe('sprint-2026-09-1');
  });
});

// ===== The route that actually triggers it =====

describe('the sprints endpoint reconciles on read', () => {
  test('a plain GET is what makes the calendar happen', async () => {
    const pid = await freshProject('OnRead');
    expect(await sprintsOf(pid)).toHaveLength(0);

    const res = await request(app).get(`/api/projects/${pid}/sprints`).set(headers);

    expect(res.status).toBe(200);
    const keys = res.body.map((s) => s.auto_key).filter(Boolean);
    expect(keys).toHaveLength(2);
    expect(res.body.filter((s) => s.status === 'active')).toHaveLength(1);
  });
});
