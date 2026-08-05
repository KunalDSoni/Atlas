/**
 * AVERAGE AGE REPORT TESTS
 * Tests: Average age of open issues grouped by status, and top 20 oldest issues
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { getDb, queryOne } = require('../../database');
const { v4: uuid } = require('uuid');

let app, headers;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
});

describe('Average Age Report', () => {
  let projectId;

  beforeAll(async () => {
    // Create a fresh project for these tests
    const db = await getDb();
    const freshProject = await request(app)
      .post('/api/projects')
      .set(headers)
      .send({ name: 'Average Age Test Project', key: 'AVGTEST' });
    projectId = freshProject.body.id;

    // Create open issues with different ages in different statuses
    const now = new Date();
    const issues = [
      // 'todo' status - 3 issues
      { title: 'Todo Issue 1', status: 'todo', daysAgo: 10 },
      { title: 'Todo Issue 2', status: 'todo', daysAgo: 20 },
      { title: 'Todo Issue 3', status: 'todo', daysAgo: 30 },

      // 'in_progress' status - 2 issues
      { title: 'In Progress Issue 1', status: 'in_progress', daysAgo: 5 },
      { title: 'In Progress Issue 2', status: 'in_progress', daysAgo: 15 },

      // 'blocked' status - 2 issues
      { title: 'Blocked Issue 1', status: 'blocked', daysAgo: 25 },
      { title: 'Blocked Issue 2', status: 'blocked', daysAgo: 40 },

      // 'in_review' status - 1 issue
      { title: 'In Review Issue 1', status: 'in_review', daysAgo: 12 },

      // 'done' status - should NOT appear in results (filtered out)
      { title: 'Done Issue 1', status: 'done', daysAgo: 5 },
    ];

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      const createdAt = new Date(now.getTime() - issue.daysAgo * 24 * 60 * 60 * 1000);
      const createdAtStr = createdAt.toISOString().slice(0, 19).replace('T', ' ');

      const issueId = uuid();
      db.run(`
        INSERT INTO issues (id, project_id, issue_key, issue_number, title, type, status, priority, created_at, reporter_id, board_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [issueId, projectId, `ATL-AGE-${1000 + i}`, 1000 + i, issue.title, 'task', issue.status, 'medium', createdAtStr, 'system', i]);
    }
  });

  describe('GET /api/projects/:projectId/reports/average-age', () => {
    test('should return by_status and oldest_issues properties', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/average-age`)
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('by_status');
      expect(res.body).toHaveProperty('oldest_issues');
    });

    test('should return by_status as an array with status, avg/max age per status, and count', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/average-age`)
        .set(headers);

      expect(Array.isArray(res.body.by_status)).toBe(true);
      expect(res.body.by_status.length).toBeGreaterThan(0);

      const entry = res.body.by_status[0];
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('age_days_avg');
      expect(entry).toHaveProperty('age_days_max');
      expect(entry).toHaveProperty('count');
    });

    test('should NOT include done status in results', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/average-age`)
        .set(headers);

      const statuses = res.body.by_status.map(s => s.status);
      expect(statuses).not.toContain('done');
    });

    test('should compute correct average and max age for todo status (10, 20, 30 days)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/average-age`)
        .set(headers);

      const todoStatus = res.body.by_status.find(s => s.status === 'todo');
      expect(todoStatus).toBeTruthy();
      expect(todoStatus.count).toBe(3);

      // Average of 10, 20, 30 = 20 days (within rounding tolerance)
      expect(Math.abs(todoStatus.age_days_avg - 20) <= 1).toBe(true);

      // Max of 10, 20, 30 = 30 days
      expect(Math.abs(todoStatus.age_days_max - 30) <= 1).toBe(true);
    });

    test('should compute correct average and max age for in_progress status (5, 15 days)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/average-age`)
        .set(headers);

      const inProgressStatus = res.body.by_status.find(s => s.status === 'in_progress');
      expect(inProgressStatus).toBeTruthy();
      expect(inProgressStatus.count).toBe(2);

      // Average of 5, 15 = 10 days (within rounding tolerance)
      expect(Math.abs(inProgressStatus.age_days_avg - 10) <= 1).toBe(true);

      // Max of 5, 15 = 15 days
      expect(Math.abs(inProgressStatus.age_days_max - 15) <= 1).toBe(true);
    });

    test('should compute correct average and max age for blocked status (25, 40 days)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/average-age`)
        .set(headers);

      const blockedStatus = res.body.by_status.find(s => s.status === 'blocked');
      expect(blockedStatus).toBeTruthy();
      expect(blockedStatus.count).toBe(2);

      // Average of 25, 40 = 32.5 days (within rounding tolerance)
      expect(Math.abs(blockedStatus.age_days_avg - 32.5) <= 1).toBe(true);

      // Max of 25, 40 = 40 days
      expect(Math.abs(blockedStatus.age_days_max - 40) <= 1).toBe(true);
    });

    test('should return oldest_issues as array sorted by age descending', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/average-age`)
        .set(headers);

      expect(Array.isArray(res.body.oldest_issues)).toBe(true);
      expect(res.body.oldest_issues.length).toBeGreaterThan(0);

      // Should be sorted descending by age
      for (let i = 1; i < res.body.oldest_issues.length; i++) {
        expect(res.body.oldest_issues[i - 1].age_days).toBeGreaterThanOrEqual(res.body.oldest_issues[i].age_days);
      }
    });

    test('should return oldest_issues with required fields', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/average-age`)
        .set(headers);

      const issue = res.body.oldest_issues[0];
      expect(issue).toHaveProperty('id');
      expect(issue).toHaveProperty('issue_key');
      expect(issue).toHaveProperty('title');
      expect(issue).toHaveProperty('status');
      expect(issue).toHaveProperty('created_at');
      expect(issue).toHaveProperty('age_days');
    });

    test('should return maximum 20 oldest issues', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/average-age`)
        .set(headers);

      expect(res.body.oldest_issues.length).toBeLessThanOrEqual(20);
    });

    test('oldest issue should be Blocked Issue 2 (40 days old)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/average-age`)
        .set(headers);

      const oldest = res.body.oldest_issues[0];
      expect(oldest.title).toBe('Blocked Issue 2');
      expect(Math.abs(oldest.age_days - 40) <= 1).toBe(true);
    });

    test('should not include done issues in oldest_issues', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/average-age`)
        .set(headers);

      const statuses = res.body.oldest_issues.map(i => i.status);
      expect(statuses).not.toContain('done');
    });
  });
});
