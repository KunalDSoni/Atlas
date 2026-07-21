/**
 * HELP CENTER — the customer surface. Security rules from spec §Security.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { toPublicRequest } = require('../../utils/servicedesk');

describe('toPublicRequest projection', () => {
  // A raw issue row carrying every internal field a customer must never see.
  const rawIssue = {
    id: 'i1', project_id: 'p1', issue_key: 'HD-1', issue_number: 1,
    title: 'Laptop will not boot', description: 'rendered summary',
    type: 'request', status: 'in_progress', priority: 'highest',
    assignee_id: 'u-agent', reporter_id: 'u-customer', sprint_id: 's1',
    story_points: 8, labels: '["internal-escalation"]', original_estimate: '3h',
    time_spent: '1h', parent_id: 'i0', board_order: 3, epic_color: 'red',
    request_type_id: 'rt1', sd_fields: '{"model":"X1"}',
    created_at: '2026-07-01 10:00:00', updated_at: '2026-07-02 10:00:00',
  };

  const projected = toPublicRequest(rawIssue, {
    requestType: { id: 'rt1', name: 'Hardware problem', icon: 'laptop' },
    statusLabel: 'In Progress',
    statusCategory: 'in_progress',
    comments: [
      { id: 'c1', body: 'public reply', visibility: 'public', author_name: 'Agent', created_at: '2026-07-01 11:00:00' },
      { id: 'c2', body: 'internal note', visibility: 'internal', author_name: 'Agent', created_at: '2026-07-01 12:00:00' },
    ],
  });

  test('exposes only the allow-listed keys', () => {
    expect(Object.keys(projected).sort()).toEqual([
      'comments', 'created_at', 'description', 'fields', 'key',
      'request_type', 'status', 'status_category', 'summary', 'updated_at',
    ]);
  });

  test.each([
    'assignee_id', 'reporter_id', 'story_points', 'labels', 'sprint_id',
    'original_estimate', 'time_spent', 'parent_id', 'board_order', 'priority',
    'project_id', 'id', 'request_type_id',
  ])('does not leak %s', (field) => {
    expect(projected).not.toHaveProperty(field);
  });

  test('drops internal comments', () => {
    expect(projected.comments).toHaveLength(1);
    expect(projected.comments[0].body).toBe('public reply');
  });

  test('surfaces the status label rather than the raw key', () => {
    expect(projected.status).toBe('In Progress');
    expect(projected.status_category).toBe('in_progress');
  });

  test('parses sd_fields into an object', () => {
    expect(projected.fields).toEqual({ model: 'X1' });
  });
});
