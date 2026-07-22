const { parseJql, isJqlLike, FIELDS } = require('../../utils/jql');

describe('JQL v2 SQL compiler', () => {
  test.each([
    ['status = done AND type = bug', 'LOWER(i.status) = ? AND LOWER(i.type) = ?', ['done', 'bug']],
    ['project = ATLAS AND priority != low', 'LOWER(p.key) = ? AND LOWER(i.priority) != ?', ['atlas', 'low']],
    ['assignee = me', 'i.assignee_id = ?', ['user-1']],
    ['assignee = unassigned', 'i.assignee_id IS NULL', []],
    ['assignee != unassigned', 'i.assignee_id IS NOT NULL', []],
    ['reporter = Priya Patel', 'i.reporter_id IN (SELECT id FROM users WHERE LOWER(name) = ?)', ['priya patel']],
    ['label != backend', 'NOT (i.labels LIKE ?)', ['%"backend"%']],
  ])('keeps v1 SQL stable for %s', (query, where, params) => {
    expect(parseJql(query, 'user-1')).toEqual({ where, params });
  });

  test('compiles precedence, grouping and set membership with bound values', () => {
    const result = parseJql('status = todo AND (priority IN (high, urgent) OR assignee IS EMPTY)', 'u1');
    expect(result.where).toBe(
      'LOWER(i.status) = ? AND (LOWER(i.priority) IN (?, ?) OR i.assignee_id IS NULL)',
    );
    expect(result.params).toEqual(['todo', 'high', 'urgent']);
  });

  test('NOT wraps a whole expression rather than changing parameter order', () => {
    const result = parseJql('NOT (status = done OR type = bug)', 'u1');
    expect(result.where).toBe('NOT (LOWER(i.status) = ? OR LOWER(i.type) = ?)');
    expect(result.params).toEqual(['done', 'bug']);
  });

  test('the registry exposes every service desk field', () => {
    expect(Object.keys(FIELDS)).toEqual(expect.arrayContaining([
      'sla', 'first_response', 'resolution', 'request_type', 'category',
      'waiting_for_customer',
    ]));
  });

  test.each(['sla', 'first_response', 'resolution'])(
    '%s compiles through an active-clock EXISTS query',
    (field) => {
      const result = parseJql(`${field} = breached`, 'u1');
      expect(result.where).toMatch(/EXISTS \(SELECT 1 FROM sd_sla_clocks c/);
      expect(result.where).toMatch(/c\.stopped_at IS NULL/);
      expect(result.where).toMatch(/c\.due_at <= COALESCE\(c\.paused_at, CURRENT_TIMESTAMP\)/);
      if (field !== 'sla') expect(result.params).toEqual([field]);
    },
  );

  test('paused remains orthogonal to breached', () => {
    const result = parseJql('sla = paused AND sla = breached', 'u1');
    expect(result.where).toContain('c.paused_at IS NOT NULL');
    expect(result.where).toContain('c.due_at <= COALESCE(c.paused_at, CURRENT_TIMESTAMP)');
  });

  test('request type, category and waiting state compile without interpolating values', () => {
    const result = parseJql(
      'request_type = "Hardware problem" AND category = in_progress AND waiting_for_customer = true',
      'u1',
    );
    expect(result.where).toContain('SELECT id FROM sd_request_types');
    expect(result.where).toContain('project_statuses');
    expect(result.params).toEqual(['hardware problem', 'in_progress', 1]);
  });

  test('enumerated SLA typos fail with the value offset', () => {
    const query = 'type = request AND sla = brached';
    const result = parseJql(query, 'u1');
    expect(result.error).toContain('Invalid value "brached" for "sla"');
    expect(result.column).toBe(query.indexOf('brached'));
    expect(result.error).toContain(`column ${query.indexOf('brached') + 1}`);
  });

  test('unknown fields fail with the full registered field list', () => {
    const query = 'stat = done';
    const result = parseJql(query, 'u1');
    expect(result.error).toMatch(/Unknown field "stat".*sla.*waiting_for_customer/);
    expect(result.column).toBe(0);
  });

  test('values that look like SQL remain parameters', () => {
    const result = parseJql('project = "ATLAS\' OR 1=1"', 'u1');
    expect(result.where).toBe('LOWER(p.key) = ?');
    expect(result.params).toEqual(["atlas' or 1=1"]);
  });

  test('JQL detection includes v2-only operators without catching plain prose', () => {
    expect(isJqlLike('priority IN (high, urgent)')).toBe(true);
    expect(isJqlLike('assignee IS EMPTY')).toBe(true);
    expect(isJqlLike('log in now')).toBe(false);
  });
});
