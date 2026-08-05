/**
 * EPIC REPORT TESTS
 * Tests: Epic children + rollup totals, burndown series calculation
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { getDb, queryOne, queryAll } = require('../../database');
const { v4: uuid } = require('uuid');

let app, headers;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
});

describe('Epic Report', () => {
  let projectId, epicId, childIssueIds;

  beforeAll(async () => {
    // Get the first seeded project (Atlas Platform)
    const db = await getDb();
    const project = await queryOne(db, 'SELECT id FROM projects WHERE key = ?', ['ATL']);
    projectId = project.id;

    // Create an epic
    epicId = uuid();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '); // 10 days ago

    db.run(`
      INSERT INTO issues (id, project_id, issue_key, issue_number, title, type, status, priority, created_at, reporter_id, board_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [epicId, projectId, 'ATL-EPIC-1', 999, 'Q2 Feature Release', 'epic', 'todo', 'high', createdAt, 'system', 0]);

    // Create 4 child issues: 2 done (3 and 5 points), 2 todo (2 and 8 points)
    childIssueIds = [];
    const childData = [
      { title: 'Child Issue 1', status: 'done', points: 3 },
      { title: 'Child Issue 2', status: 'done', points: 5 },
      { title: 'Child Issue 3', status: 'todo', points: 2 },
      { title: 'Child Issue 4', status: 'todo', points: 8 },
    ];

    for (let i = 0; i < childData.length; i++) {
      const childId = uuid();
      childIssueIds.push(childId);
      const childStatus = childData[i].status;
      const childPoints = childData[i].points;
      const childCreatedAt = new Date(Date.now() - (10 - i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      const childUpdatedAt = childStatus === 'done'
        ? new Date(Date.now() - (5 - i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
        : childCreatedAt;

      db.run(`
        INSERT INTO issues (id, project_id, issue_key, issue_number, title, type, status, priority, story_points, parent_id, created_at, updated_at, reporter_id, board_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        childId, projectId, `ATL-${1000 + i}`, 1000 + i, childData[i].title, 'story',
        childStatus, 'medium', childPoints, epicId, childCreatedAt, childUpdatedAt, 'system', i
      ]);
    }
  });

  describe('GET /api/projects/:projectId/reports/epics/:epicId', () => {
    test('should return epic with children and rollup totals', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/epics/${epicId}`)
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('epic');
      expect(res.body).toHaveProperty('children');
      expect(res.body).toHaveProperty('done_count');
      expect(res.body).toHaveProperty('total_count');
      expect(res.body).toHaveProperty('done_points');
      expect(res.body).toHaveProperty('total_points');
    });

    test('should return correct epic metadata', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/epics/${epicId}`)
        .set(headers);

      expect(res.body.epic.id).toBe(epicId);
      expect(res.body.epic.name).toBe('Q2 Feature Release');
      expect(res.body.epic.created_at).toBeDefined();
    });

    test('should return 4 child issues with correct fields', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/epics/${epicId}`)
        .set(headers);

      expect(res.body.children).toHaveLength(4);
      const child = res.body.children[0];
      expect(child).toHaveProperty('id');
      expect(child).toHaveProperty('issue_key');
      expect(child).toHaveProperty('title');
      expect(child).toHaveProperty('status');
      expect(child).toHaveProperty('points');
    });

    test('should return correct rollup totals: done_count=2, total_count=4, done_points=8, total_points=18', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/epics/${epicId}`)
        .set(headers);

      expect(res.body.done_count).toBe(2);
      expect(res.body.total_count).toBe(4);
      expect(res.body.done_points).toBe(8); // 3 + 5
      expect(res.body.total_points).toBe(18); // 3 + 5 + 2 + 8
    });

    test('should return burndown array with daily remaining_points', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/epics/${epicId}`)
        .set(headers);

      expect(res.body).toHaveProperty('burndown');
      expect(Array.isArray(res.body.burndown)).toBe(true);
      expect(res.body.burndown.length).toBeGreaterThan(0);

      const dayEntry = res.body.burndown[0];
      expect(dayEntry).toHaveProperty('date');
      expect(dayEntry).toHaveProperty('remaining_points');
    });

    test('should return burndown from epic created_at to today', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/epics/${epicId}`)
        .set(headers);

      const burndown = res.body.burndown;
      expect(burndown.length).toBeGreaterThanOrEqual(9); // at least 10 days from creation

      // First entry should show all 18 points remaining (epic just created, no issues marked done yet on first day)
      expect(burndown[0].remaining_points).toBeLessThanOrEqual(18);

      // Last entry should show 10 points remaining (2 issues done = 8 points, 18 - 8 = 10)
      const lastEntry = burndown[burndown.length - 1];
      expect(lastEntry.remaining_points).toBeLessThanOrEqual(10);
    });

    test('should return 404 when epic not found', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/reports/epics/nonexistent-id`)
        .set(headers);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
});
