/**
 * VERSION REPORT TESTS
 * Tests: Version issues + rollup totals
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { getDb, queryOne, queryAll } = require('../../database');
const { v4: uuid } = require('uuid');

let app, headers;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
}, 30000);

describe('Version Report', () => {
  let projectId, versionId, issueIds;

  beforeAll(async () => {
    // Get the first seeded project (Atlas Platform)
    const db = await getDb();
    const project = await queryOne(db, 'SELECT id FROM projects WHERE key = ?', ['ATL']);
    projectId = project.id;

    // Create a version
    versionId = uuid();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    db.run(`
      INSERT INTO versions (id, project_id, name, slug, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [versionId, projectId, 'v1.0.0', 'v1-0-0', 'unreleased', now]);

    // Create 4 issues linked to version: 2 done (3 and 5 points), 2 in_progress (2 and 8 points)
    issueIds = [];
    const issueData = [
      { title: 'Feature A', status: 'done', points: 3 },
      { title: 'Feature B', status: 'done', points: 5 },
      { title: 'Feature C', status: 'in_progress', points: 2 },
      { title: 'Feature D', status: 'in_progress', points: 8 },
    ];

    for (let i = 0; i < issueData.length; i++) {
      const issueId = uuid();
      issueIds.push(issueId);
      const issueStatus = issueData[i].status;
      const issuePoints = issueData[i].points;
      const issueCreatedAt = new Date(Date.now() - (10 - i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      const issueUpdatedAt = issueStatus === 'done'
        ? new Date(Date.now() - (5 - i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
        : issueCreatedAt;

      db.run(`
        INSERT INTO issues (id, project_id, issue_key, issue_number, title, type, status, priority, story_points, fix_version_id, created_at, updated_at, reporter_id, board_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        issueId, projectId, `ATL-${2000 + i}`, 2000 + i, issueData[i].title, 'story',
        issueStatus, 'medium', issuePoints, versionId, issueCreatedAt, issueUpdatedAt, 'system', i
      ]);
    }
  });

  describe('GET /api/projects/:projectId/reports/versions/:versionId', () => {
    test('should return version with issues and rollup totals', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/versions/${versionId}`)
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('issues');
      expect(res.body).toHaveProperty('done_count');
      expect(res.body).toHaveProperty('total_count');
      expect(res.body).toHaveProperty('done_points');
      expect(res.body).toHaveProperty('total_points');
    });

    test('should return correct version metadata', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/versions/${versionId}`)
        .set(headers);

      expect(res.body.version.id).toBe(versionId);
      expect(res.body.version.name).toBe('v1.0.0');
    });

    test('should return 4 issues with correct fields', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/versions/${versionId}`)
        .set(headers);

      expect(res.body.issues).toHaveLength(4);
      const issue = res.body.issues[0];
      expect(issue).toHaveProperty('id');
      expect(issue).toHaveProperty('issue_key');
      expect(issue).toHaveProperty('title');
      expect(issue).toHaveProperty('status');
      expect(issue).toHaveProperty('points');
    });

    test('should return correct rollup totals: done_count=2, total_count=4, done_points=8, total_points=18', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/versions/${versionId}`)
        .set(headers);

      expect(res.body.done_count).toBe(2);
      expect(res.body.total_count).toBe(4);
      expect(res.body.done_points).toBe(8); // 3 + 5
      expect(res.body.total_points).toBe(18); // 3 + 5 + 2 + 8
    });

    test('should return 404 when version not found', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/versions/nonexistent-id`)
        .set(headers);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
});
