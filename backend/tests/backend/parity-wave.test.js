/**
 * PARITY WAVE TESTS — Epics 3-12
 * search + saved filters, notifications + mentions + wiki watching, work logs,
 * releases + components, custom workflows, automation rules, wiki restrictions,
 * export + blog posts.
 */
const request = require('supertest');
const { createTestApp, adminHeaders, userHeaders } = require('./setup');

let app, headers, priyaHeaders, projectId, otherProjectId;

async function createIssue(body, pid = projectId) {
  return request(app).post(`/api/projects/${pid}/issues`).set(headers).send(body);
}

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  priyaHeaders = await userHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'ATL').id;
  otherProjectId = projects.body.find((p) => p.key === 'MOB').id;
});

// ===== Epic 3: search + saved filters =====
describe('global search', () => {
  test('finds issues across projects and wiki pages', async () => {
    const res = await request(app).get('/api/search?q=OAuth').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.issues.some((i) => i.title.includes('OAuth2'))).toBe(true);
    expect(res.body.issues[0].project_key).toBeDefined();

    const wiki = await request(app).get('/api/search?q=Architecture').set(headers);
    expect(wiki.body.pages.some((p) => p.title.includes('Architecture'))).toBe(true);
  });

  test('short queries return empty results, not errors', async () => {
    const res = await request(app).get('/api/search?q=a').set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ issues: [], pages: [] });
  });

  test('project_id narrows issue hits', async () => {
    const res = await request(app).get(`/api/search?q=push&project_id=${otherProjectId}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.issues.every((i) => i.project_id === otherProjectId)).toBe(true);
  });
});

describe('saved filters', () => {
  test('create, list (own only), delete', async () => {
    const created = await request(app)
      .post(`/api/projects/${projectId}/filters`).set(headers)
      .send({ name: 'My bugs', params: { type: 'bug', status: 'todo' } });
    expect(created.status).toBe(201);
    expect(created.body.params_parsed.type).toBe('bug');

    const mine = await request(app).get(`/api/projects/${projectId}/filters`).set(headers);
    expect(mine.body.some((f) => f.name === 'My bugs')).toBe(true);

    const theirs = await request(app).get(`/api/projects/${projectId}/filters`).set(priyaHeaders);
    expect(theirs.body.some((f) => f.name === 'My bugs')).toBe(false);

    const del = await request(app).delete(`/api/filters/${created.body.id}`).set(headers);
    expect(del.status).toBe(200);
  });

  test('cannot delete another user\'s filter', async () => {
    const created = await request(app)
      .post(`/api/projects/${projectId}/filters`).set(headers)
      .send({ name: 'Admin only', params: {} });
    const res = await request(app).delete(`/api/filters/${created.body.id}`).set(priyaHeaders);
    expect(res.status).toBe(403);
  });
});

// ===== Epic 4: notifications =====
describe('notifications', () => {
  let priyaId;

  beforeAll(async () => {
    const users = await request(app).get('/api/users').set(headers);
    priyaId = users.body.find((u) => u.email === 'priya@example.com').id;
  });

  test('assignment notifies the new assignee', async () => {
    const issue = await createIssue({ title: 'Notify Me Issue', type: 'task' });
    await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ assignee_id: priyaId });
    const inbox = await request(app).get('/api/notifications').set(priyaHeaders);
    expect(inbox.status).toBe(200);
    expect(inbox.body.some((n) => n.type === 'assigned' && n.message.includes(issue.body.issue_key))).toBe(true);
  });

  test('@mention in a comment notifies the mentioned user', async () => {
    const issue = await createIssue({ title: 'Mention Host', type: 'task' });
    await request(app).post(`/api/issues/${issue.body.id}/comments`).set(headers)
      .send({ body: 'Hey @Priya can you look at this?' });
    const inbox = await request(app).get('/api/notifications').set(priyaHeaders);
    expect(inbox.body.some((n) => n.type === 'mention' && n.message.includes(issue.body.issue_key))).toBe(true);
  });

  test('watcher gets a comment notification; unread count and read-all work', async () => {
    const issue = await createIssue({ title: 'Watched Issue', type: 'task' });
    await request(app).post(`/api/issues/${issue.body.id}/watchers`).set(priyaHeaders);
    await request(app).post(`/api/issues/${issue.body.id}/comments`).set(headers).send({ body: 'ping watchers' });

    const count = await request(app).get('/api/notifications/unread-count').set(priyaHeaders);
    expect(count.body.count).toBeGreaterThan(0);

    const markAll = await request(app).put('/api/notifications/read-all').set(priyaHeaders);
    expect(markAll.status).toBe(200);
    const after = await request(app).get('/api/notifications/unread-count').set(priyaHeaders);
    expect(after.body.count).toBe(0);
  });

  test('no self-notification on self-assign', async () => {
    const issue = await createIssue({ title: 'Self Assign', type: 'task' });
    await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ assignee_id: issue.body.reporter_id });
    const inbox = await request(app).get('/api/notifications').set(headers);
    expect(inbox.body.some((n) => n.message.includes(issue.body.issue_key))).toBe(false);
  });

  test('wiki page watching notifies on edit', async () => {
    const spaces = await request(app).get('/api/wiki/spaces').set(headers);
    const pages = await request(app).get(`/api/wiki/spaces/${spaces.body[0].id}/pages`).set(headers);
    const pageId = pages.body[0].id;

    await request(app).post(`/api/wiki/pages/${pageId}/watch`).set(priyaHeaders);
    const state = await request(app).get(`/api/wiki/pages/${pageId}/watchers`).set(priyaHeaders);
    expect(state.body.watching).toBe(true);

    await request(app).put(`/api/wiki/pages/${pageId}`).set(headers).send({ body: '<p>Edited for watchers</p>' });
    const inbox = await request(app).get('/api/notifications').set(priyaHeaders);
    expect(inbox.body.some((n) => n.type === 'wiki_update')).toBe(true);
  });
});

// ===== Epic 5: work logs =====
describe('work logs', () => {
  test('logging work accumulates time_spent; delete subtracts', async () => {
    const issue = await createIssue({ title: 'Timed Issue', type: 'task' });
    const log1 = await request(app).post(`/api/issues/${issue.body.id}/worklogs`).set(headers)
      .send({ minutes: 90, comment: 'API work' });
    expect(log1.status).toBe(201);
    await request(app).post(`/api/issues/${issue.body.id}/worklogs`).set(headers).send({ minutes: 30 });

    let fresh = await request(app).get(`/api/issues/${issue.body.id}`).set(headers);
    expect(Number(fresh.body.time_spent)).toBe(120);

    const logs = await request(app).get(`/api/issues/${issue.body.id}/worklogs`).set(headers);
    expect(logs.body.length).toBe(2);
    expect(logs.body.some((l) => l.comment === 'API work')).toBe(true);

    await request(app).delete(`/api/worklogs/${log1.body.id}`).set(headers);
    fresh = await request(app).get(`/api/issues/${issue.body.id}`).set(headers);
    expect(Number(fresh.body.time_spent)).toBe(30);
  });

  test('rejects non-positive minutes', async () => {
    const issue = await createIssue({ title: 'Bad Time', type: 'task' });
    const res = await request(app).post(`/api/issues/${issue.body.id}/worklogs`).set(headers).send({ minutes: 0 });
    expect(res.status).toBe(400);
  });

  test('only the author or an admin deletes a work log', async () => {
    const issue = await createIssue({ title: 'Protected Log', type: 'task' });
    const log = await request(app).post(`/api/issues/${issue.body.id}/worklogs`).set(headers).send({ minutes: 15 });
    const res = await request(app).delete(`/api/worklogs/${log.body.id}`).set(priyaHeaders);
    expect(res.status).toBe(403);
  });
});

// ===== Epic 6: releases + components =====
describe('releases and components', () => {
  test('version lifecycle with issue rollup', async () => {
    const v = await request(app).post(`/api/projects/${projectId}/versions`).set(headers)
      .send({ name: 'v9.9.0', description: 'Test release' });
    expect(v.status).toBe(201);

    const issue = await createIssue({ title: 'Release Me', type: 'task' });
    await request(app).put(`/api/issues/${issue.body.id}`).set(headers)
      .send({ fix_version_id: v.body.id, status: 'done' });

    const list = await request(app).get(`/api/projects/${projectId}/versions`).set(headers);
    const row = list.body.find((x) => x.id === v.body.id);
    expect(row.issue_count).toBe(1);
    expect(row.done_count).toBe(1);

    const enriched = await request(app).get(`/api/issues/${issue.body.id}`).set(headers);
    expect(enriched.body.fix_version_name).toBe('v9.9.0');

    const released = await request(app).put(`/api/versions/${v.body.id}`).set(headers).send({ status: 'released' });
    expect(released.body.status).toBe('released');

    await request(app).delete(`/api/versions/${v.body.id}`).set(headers);
    const orphan = await request(app).get(`/api/issues/${issue.body.id}`).set(headers);
    expect(orphan.body.fix_version_id).toBeNull();
  });

  test('component assignment and delete-nulls-issues', async () => {
    const c = await request(app).post(`/api/projects/${projectId}/components`).set(headers).send({ name: 'Backend' });
    expect(c.status).toBe(201);
    const issue = await createIssue({ title: 'Component Issue', type: 'bug' });
    await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ component_id: c.body.id });

    const enriched = await request(app).get(`/api/issues/${issue.body.id}`).set(headers);
    expect(enriched.body.component_name).toBe('Backend');

    await request(app).delete(`/api/components/${c.body.id}`).set(headers);
    const orphan = await request(app).get(`/api/issues/${issue.body.id}`).set(headers);
    expect(orphan.body.component_id).toBeNull();
  });

  test('version create requires board admin', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/versions`).set(priyaHeaders).send({ name: 'nope' });
    expect(res.status).toBe(403);
  });
});

// ===== Epic 9: custom workflows =====
describe('custom workflows', () => {
  test('defaults returned before customization', async () => {
    const res = await request(app).get(`/api/projects/${otherProjectId}/statuses`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.key)).toEqual(['todo', 'in_progress', 'blocked', 'in_review', 'done']);
    expect(res.body.every((s) => s.builtin)).toBe(true);
  });

  test('adding a status materializes defaults and appends; issues can use it', async () => {
    const added = await request(app).post(`/api/projects/${projectId}/statuses`).set(headers)
      .send({ label: 'Code Review', category: 'in_progress' });
    expect(added.status).toBe(201);
    expect(added.body.key).toBe('code_review');

    const list = await request(app).get(`/api/projects/${projectId}/statuses`).set(headers);
    expect(list.body.length).toBe(6);
    expect(list.body.every((s) => !s.builtin)).toBe(true);

    const issue = await createIssue({ title: 'Reviewed Issue', type: 'task' });
    const moved = await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ status: 'code_review' });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('code_review');
  });

  test('unknown statuses are rejected', async () => {
    const issue = await createIssue({ title: 'Bad Status', type: 'task' });
    const res = await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ status: 'nonsense' });
    expect(res.status).toBe(400);
  });

  test('deleting a status migrates its issues', async () => {
    const list = await request(app).get(`/api/projects/${projectId}/statuses`).set(headers);
    const codeReview = list.body.find((s) => s.key === 'code_review');
    const issue = await createIssue({ title: 'Migrate Me', type: 'task' });
    await request(app).put(`/api/issues/${issue.body.id}`).set(headers).send({ status: 'code_review' });

    const del = await request(app).delete(`/api/statuses/${codeReview.id}?migrate_to=in_progress`).set(headers);
    expect(del.status).toBe(200);
    const fresh = await request(app).get(`/api/issues/${issue.body.id}`).set(headers);
    expect(fresh.body.status).toBe('in_progress');
  });
});

// ===== Epic 10: automation =====
describe('automation rules', () => {
  test('issue_created rule with type condition applies label + assignee', async () => {
    const users = await request(app).get('/api/users').set(headers);
    const priyaId = users.body.find((u) => u.email === 'priya@example.com').id;

    const rule = await request(app).post(`/api/projects/${projectId}/automations`).set(headers).send({
      name: 'Bug triage',
      trigger_type: 'issue_created',
      conditions: [{ field: 'type', value: 'bug' }],
      actions: [{ type: 'add_label', value: 'triage' }, { type: 'set_assignee', value: priyaId }],
    });
    expect(rule.status).toBe(201);

    const bug = await createIssue({ title: 'Auto Bug', type: 'bug' });
    expect(bug.body.labels_parsed).toContain('triage');
    expect(bug.body.assignee_id).toBe(priyaId);

    const task = await createIssue({ title: 'Auto Task', type: 'task' });
    expect(task.body.labels_parsed).not.toContain('triage');

    await request(app).delete(`/api/automations/${rule.body.id}`).set(headers);
  });

  test('all_subtasks_done moves the parent to done', async () => {
    const rule = await request(app).post(`/api/projects/${projectId}/automations`).set(headers).send({
      name: 'Auto-done parent',
      trigger_type: 'all_subtasks_done',
      conditions: [],
      actions: [{ type: 'set_status', value: 'done' }],
    });
    const story = await createIssue({ title: 'Auto Parent', type: 'story' });
    const s1 = await createIssue({ title: 'Sub 1', type: 'subtask', parent_id: story.body.id });
    const s2 = await createIssue({ title: 'Sub 2', type: 'subtask', parent_id: story.body.id });

    await request(app).put(`/api/issues/${s1.body.id}`).set(headers).send({ status: 'done' });
    let parent = await request(app).get(`/api/issues/${story.body.id}`).set(headers);
    expect(parent.body.status).not.toBe('done');

    await request(app).put(`/api/issues/${s2.body.id}`).set(headers).send({ status: 'done' });
    parent = await request(app).get(`/api/issues/${story.body.id}`).set(headers);
    expect(parent.body.status).toBe('done');

    await request(app).delete(`/api/automations/${rule.body.id}`).set(headers);
  });

  test('disabled rules do not fire', async () => {
    const rule = await request(app).post(`/api/projects/${projectId}/automations`).set(headers).send({
      name: 'Disabled rule',
      trigger_type: 'issue_created',
      conditions: [],
      actions: [{ type: 'add_label', value: 'should-not-appear' }],
    });
    await request(app).put(`/api/automations/${rule.body.id}`).set(headers).send({ enabled: false });
    const issue = await createIssue({ title: 'No Automation', type: 'task' });
    expect(issue.body.labels_parsed).not.toContain('should-not-appear');
    await request(app).delete(`/api/automations/${rule.body.id}`).set(headers);
  });
});

// ===== Epic 11: wiki restrictions + quotes =====
describe('wiki collaboration', () => {
  let pageId;

  beforeAll(async () => {
    const spaces = await request(app).get('/api/wiki/spaces').set(headers);
    const page = await request(app).post(`/api/wiki/spaces/${spaces.body[0].id}/pages`).set(headers)
      .send({ title: 'Restricted Doc', body: '<p>Secret plans</p>' });
    pageId = page.body.id;
  });

  test('comment quotes round-trip', async () => {
    const res = await request(app).post(`/api/wiki/pages/${pageId}/comments`).set(headers)
      .send({ body: 'I disagree with this part', quote: 'Secret plans' });
    expect(res.status).toBe(201);
    expect(res.body.quote).toBe('Secret plans');
  });

  test('restrictions hide the page from unlisted users; author retains access', async () => {
    await request(app).put(`/api/wiki/pages/${pageId}/restrictions`).set(headers)
      .send({ restrictions: [] });
    let asPriya = await request(app).get(`/api/wiki/pages/${pageId}`).set(priyaHeaders);
    expect(asPriya.status).toBe(200);

    // Restrict to only the admin author (empty grant list for others).
    const users = await request(app).get('/api/users').set(headers);
    const sarahId = users.body.find((u) => u.email !== 'kunal@example.com' && u.email !== 'priya@example.com')?.id
      ?? users.body[0].id;
    await request(app).put(`/api/wiki/pages/${pageId}/restrictions`).set(headers)
      .send({ restrictions: [{ user_id: sarahId, can_edit: false }] });

    asPriya = await request(app).get(`/api/wiki/pages/${pageId}`).set(priyaHeaders);
    expect(asPriya.status).toBe(403);

    const asAuthor = await request(app).get(`/api/wiki/pages/${pageId}`).set(headers);
    expect(asAuthor.status).toBe(200);
    expect(asAuthor.body.restricted).toBe(1);
  });

  test('view-only users cannot edit an edit-restricted page', async () => {
    const users = await request(app).get('/api/users').set(headers);
    const priyaId = users.body.find((u) => u.email === 'priya@example.com').id;
    const kunalId = users.body.find((u) => u.email === 'kunal@example.com').id;
    await request(app).put(`/api/wiki/pages/${pageId}/restrictions`).set(headers)
      .send({ restrictions: [{ user_id: priyaId, can_edit: false }, { user_id: kunalId, can_edit: true }] });

    const view = await request(app).get(`/api/wiki/pages/${pageId}`).set(priyaHeaders);
    expect(view.status).toBe(200);
    expect(view.body.can_edit_page).toBe(0);

    const edit = await request(app).put(`/api/wiki/pages/${pageId}`).set(priyaHeaders).send({ body: '<p>hax</p>' });
    expect(edit.status).toBe(403);
  });

  test('only author or admin may set restrictions', async () => {
    const res = await request(app).put(`/api/wiki/pages/${pageId}/restrictions`).set(priyaHeaders)
      .send({ restrictions: [] });
    expect(res.status).toBe(403);
  });
});

// ===== Epic 12: export + blogs =====
describe('wiki publishing', () => {
  test('markdown export converts the sanitised tag subset', async () => {
    const spaces = await request(app).get('/api/wiki/spaces').set(headers);
    const page = await request(app).post(`/api/wiki/spaces/${spaces.body[0].id}/pages`).set(headers)
      .send({ title: 'Exportable', body: '<h2>Section</h2><p>Hello <strong>world</strong></p><ul><li>one</li></ul>' });

    const md = await request(app).get(`/api/wiki/pages/${page.body.id}/export?format=markdown`).set(headers);
    expect(md.status).toBe(200);
    expect(md.body.filename).toBe('exportable.md');
    expect(md.body.content).toContain('# Exportable');
    expect(md.body.content).toContain('## Section');
    expect(md.body.content).toContain('**world**');
    expect(md.body.content).toContain('- one');

    const html = await request(app).get(`/api/wiki/pages/${page.body.id}/export?format=html`).set(headers);
    expect(html.body.filename).toBe('exportable.html');
    expect(html.body.content).toContain('<!doctype html>');
  });

  test('blog posts are listed via type filter and kept out of the tree', async () => {
    const spaces = await request(app).get('/api/wiki/spaces').set(headers);
    const spaceId = spaces.body[0].id;
    const blog = await request(app).post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
      .send({ title: 'Shipping the parity wave', body: '<p>We shipped 12 epics.</p>', page_type: 'blog' });
    expect(blog.body.page_type).toBe('blog');

    const blogs = await request(app).get(`/api/wiki/spaces/${spaceId}/pages?type=blog`).set(headers);
    expect(blogs.body.some((p) => p.id === blog.body.id)).toBe(true);
    expect(blogs.body.every((p) => p.page_type === 'blog')).toBe(true);

    const tree = await request(app).get(`/api/wiki/spaces/${spaceId}/tree`).set(headers);
    const flat = JSON.stringify(tree.body);
    expect(flat).not.toContain(blog.body.id);
  });
});
