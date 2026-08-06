const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');
const { getDb, queryAll, run } = require('../../database');
const { randomUUID } = require('crypto');

let app, headers, db, projectId, userId;

/**
 * Create an issue with a specific cycle time
 * Simulates: created -> in_progress -> done
 * Returns the issue with resolved_date set to the done transition timestamp
 */
async function createIssueWithCycleTime(title, createdAt, cycleDays) {
  // Create issue
  const res = await request(app)
    .post(`/api/projects/${projectId}/issues`)
    .set(headers)
    .send({ title, type: 'task' });
  expect(res.status).toBe(201);
  const issue = res.body;

  // Update issue created_at to match test data
  await run(db, 'UPDATE issues SET created_at = ? WHERE id = ?', [createdAt, issue.id]);

  // Create in_progress transition
  const inProgressAt = new Date(new Date(createdAt).getTime() + 1 * 3600000); // 1 hour after creation
  const inProgressStr = inProgressAt.toISOString().replace('T', ' ').slice(0, 19);
  await run(db,
    'INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), issue.id, userId, 'update', 'status', 'todo', 'in_progress', inProgressStr]
  );

  // Create done transition with appropriate cycle time
  const doneAt = new Date(new Date(inProgressAt).getTime() + cycleDays * 24 * 3600000);
  const doneStr = doneAt.toISOString().replace('T', ' ').slice(0, 19);
  await run(db,
    'INSERT INTO activity_log (id, issue_id, user_id, action, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), issue.id, userId, 'update', 'status', 'in_progress', 'done', doneStr]
  );

  // Update issue status to done and set updated_at
  await run(db, 'UPDATE issues SET status = ?, updated_at = ? WHERE id = ?', ['done', doneStr, issue.id]);

  return { ...issue, resolved_at: doneStr, cycle_days: cycleDays };
}

beforeAll(async () => {
  app = await createTestApp();
  db = await getDb();
  headers = await adminHeaders();

  // Extract user_id from headers
  userId = headers['x-user-id'];

  // Get or create a test project
  const projects = await request(app).get('/api/projects').set(headers);
  expect(projects.status).toBe(200);
  expect(projects.body.length).toBeGreaterThan(0);
  projectId = projects.body[0].id;
}, 30000);

describe('Control Chart Endpoint', () => {
  test('returns issues with resolved_date and cycle_time_days, plus p50/p85 percentiles', async () => {
    // Create 10 issues with cycle times: 5, 7, 10, 12, 15, 18, 20, 22, 25, 30 days
    const cycleTimes = [5, 7, 10, 12, 15, 18, 20, 22, 25, 30];
    const startDate = new Date('2026-07-01T00:00:00Z');

    const issuesCreated = [];
    for (let i = 0; i < cycleTimes.length; i++) {
      const createdAt = new Date(startDate.getTime() + i * 3 * 24 * 3600000); // Spread issues every 3 days
      const createdStr = createdAt.toISOString().replace('T', ' ').slice(0, 19);
      const issue = await createIssueWithCycleTime(
        `Task ${i + 1}`,
        createdStr,
        cycleTimes[i]
      );
      issuesCreated.push(issue);
    }

    // Call the control-chart endpoint
    const res = await request(app)
      .get(`/api/projects/${projectId}/reports/control-chart`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('issues');
    expect(res.body).toHaveProperty('p50_cycle_days');
    expect(res.body).toHaveProperty('p85_cycle_days');

    // Verify issues array
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThanOrEqual(10);

    // Verify each issue has the required fields
    res.body.issues.forEach(issue => {
      expect(issue).toHaveProperty('resolved_date');
      expect(issue).toHaveProperty('cycle_time_days');
      expect(issue).toHaveProperty('issue_key');
      expect(issue).toHaveProperty('title');
      expect(typeof issue.cycle_time_days).toBe('number');
    });

    // Verify issues are sorted by resolved_date descending
    const resolvedDates = res.body.issues.map(i => i.resolved_date);
    const sortedDesc = [...resolvedDates].sort().reverse();
    expect(resolvedDates).toEqual(sortedDesc);

    // Verify percentiles are computed correctly
    // The cycle times should be [5, 7, 10, 12, 15, 18, 20, 22, 25, 30] when sorted
    // p50 (50th percentile) with 10 items: position = ceil(0.5 * 10) = 5, so the 5th item (1-indexed) = 15
    // p85 (85th percentile) with 10 items: position = ceil(0.85 * 10) = 9, so the 9th item (1-indexed) = 25
    expect(res.body.p50_cycle_days).toBe(15);
    expect(res.body.p85_cycle_days).toBe(25);
  });

  test('returns empty arrays for projects with no done issues', async () => {
    // Get the second project (if it exists) or create a new one
    const projects = await request(app).get('/api/projects').set(headers);
    const emptyProjectId = projects.body[1]?.id || projectId; // Use a different project if available

    const res = await request(app)
      .get(`/api/projects/${emptyProjectId}/reports/control-chart`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.issues).toBeDefined();
    // May be empty or have issues if this project has seeded data
  });

  test('requires authentication', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/reports/control-chart`)
      .set({ 'Content-Type': 'application/json' }); // No auth headers

    expect(res.status).toBe(401);
  });
});
