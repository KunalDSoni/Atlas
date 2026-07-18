/**
 * EMAIL NOTIFICATION TESTS (ATLAS-21)
 * SMTP is unconfigured in tests, so deliveries are captured in the email util's
 * in-memory outbox. Verifies notifications fan out to email, respect the user's
 * toggles, and that the status endpoint reports delivery is off.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

let app, headers, email, projectId, priya;

beforeAll(async () => {
  delete process.env.SMTP_HOST; delete process.env.SMTP_URL;
  app = await createTestApp();
  headers = await adminHeaders();
  // Require the util AFTER app creation so we share the same cached instance the
  // routes use (setup clears the module cache on each createTestApp).
  email = require('../../utils/email');
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body.find((p) => p.key === 'ATL').id;
  const users = await request(app).get('/api/users').set(headers);
  priya = users.body.find((u) => u.email === 'priya@example.com');
});

beforeEach(() => email.clearOutbox());

describe('email delivery', () => {
  test('email-status reports delivery is off when SMTP is unconfigured', async () => {
    const res = await request(app).get('/api/settings/email-status').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.email_configured).toBe(false);
  });

  test('assigning an issue queues an email to the assignee', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/issues`).set(headers)
      .send({ title: 'Email me', type: 'task' });
    await request(app).put(`/api/issues/${created.body.id}`).set(headers)
      .send({ assignee_id: priya.id });

    const box = email.getOutbox();
    expect(box.some((m) => m.to === priya.email)).toBe(true);
  });

  test('respects the recipient master email toggle', async () => {
    // Priya turns off all email notifications.
    const priyaLogin = await request(app).post('/api/auth/login').send({ email: 'priya@example.com', password: 'password123' });
    const priyaHeaders = { 'x-auth-token': priyaLogin.body.token, 'Content-Type': 'application/json' };
    await request(app).put('/api/settings').set(priyaHeaders).send({ email_notifications: false });

    email.clearOutbox();
    const created = await request(app).post(`/api/projects/${projectId}/issues`).set(headers)
      .send({ title: 'No email please', type: 'task' });
    await request(app).put(`/api/issues/${created.body.id}`).set(headers).send({ assignee_id: priya.id });

    expect(email.getOutbox().some((m) => m.to === priya.email)).toBe(false);
  });
});
