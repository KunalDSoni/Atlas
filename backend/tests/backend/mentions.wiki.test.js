/**
 * WIKI MENTION FAN-OUT TESTS
 *
 * Confluence-side parity: mentioning someone in a page body or a page comment
 * notifies them. Page bodies are HTML and carry the reference as a
 * data-mention-id span; comments are composed as plain text and carry a token.
 * Both must resolve to the same person.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');
const { getDb, queryAll, run } = require('../../database');
const { formatMention } = require('../../utils/mentions');

let app, adminH, db, spaceId, users;

beforeAll(async () => {
  app = await createTestApp();
  db = await getDb();
  adminH = await adminHeaders();
  const spaces = await request(app).get('/api/wiki/spaces').set(adminH);
  spaceId = spaces.body[0].id;

  const rows = await queryAll(db, 'SELECT id, name, email FROM users');
  users = Object.fromEntries(rows.map((u) => [u.email.split('@')[0], u]));
});

beforeEach(async () => { await run(db, 'DELETE FROM notifications', []); });

function mention(key) {
  return formatMention({ id: users[key].id, name: users[key].name });
}

function span(key) {
  return `<p>Please review <span data-mention-id="${users[key].id}">@${users[key].name}</span></p>`;
}

async function mentionsFor(key) {
  return queryAll(db,
    "SELECT * FROM notifications WHERE user_id = ? AND type = 'mention'", [users[key].id]);
}

async function createPage(body, title = 'Mention page') {
  const res = await request(app)
    .post(`/api/wiki/spaces/${spaceId}/pages`)
    .set(adminH)
    .send({ title, body });
  return res.body;
}

describe('page bodies', () => {
  test('a mention span in a new page notifies', async () => {
    await createPage(span('sarah'));
    const got = await mentionsFor('sarah');
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe('mention');
    expect(got[0].wiki_page_id).toBeTruthy();
  });

  test('the notification links to the page', async () => {
    const page = await createPage(span('sarah'));
    const [got] = await mentionsFor('sarah');
    expect(got.link).toBe(`/wiki/page/${page.id}`);
  });

  test('the sanitizer preserves data-mention-id', async () => {
    const page = await createPage(span('sarah'));
    expect(page.body).toContain(`data-mention-id="${users.sarah.id}"`);
  });

  test('editing elsewhere on the page does not notify again', async () => {
    const page = await createPage(span('sarah'));
    expect(await mentionsFor('sarah')).toHaveLength(1);

    await request(app).put(`/api/wiki/pages/${page.id}`).set(adminH)
      .send({ body: `${span('sarah')}<p>An extra paragraph.</p>` });

    expect(await mentionsFor('sarah')).toHaveLength(1);
  });

  test('adding a mention on edit notifies only the new person', async () => {
    const page = await createPage(span('sarah'));
    await run(db, 'DELETE FROM notifications', []);

    await request(app).put(`/api/wiki/pages/${page.id}`).set(adminH)
      .send({ body: `${span('sarah')}${span('alex')}` });

    expect(await mentionsFor('sarah')).toHaveLength(0);
    expect(await mentionsFor('alex')).toHaveLength(1);
  });

  test('a title-only edit notifies nobody new', async () => {
    const page = await createPage(span('sarah'));
    await run(db, 'DELETE FROM notifications', []);
    await request(app).put(`/api/wiki/pages/${page.id}`).set(adminH).send({ title: 'Renamed' });
    expect(await mentionsFor('sarah')).toHaveLength(0);
  });
});

describe('page comments', () => {
  test('a token mention in a comment notifies', async () => {
    const page = await createPage('<p>Body</p>');
    await request(app).post(`/api/wiki/pages/${page.id}/comments`).set(adminH)
      .send({ body: `${mention('alex')} thoughts?` });

    const got = await mentionsFor('alex');
    expect(got).toHaveLength(1);
    expect(got[0].message).toContain('a comment on');
  });

  test('a comment mentioning nobody notifies nobody', async () => {
    const page = await createPage('<p>Body</p>');
    await request(app).post(`/api/wiki/pages/${page.id}/comments`).set(adminH)
      .send({ body: 'Looks good to me' });
    expect(await mentionsFor('alex')).toHaveLength(0);
  });

  test('mentioning yourself in a comment is silent', async () => {
    const page = await createPage('<p>Body</p>');
    await request(app).post(`/api/wiki/pages/${page.id}/comments`).set(adminH)
      .send({ body: `${mention('kunal')} remember this` });
    expect(await mentionsFor('kunal')).toHaveLength(0);
  });
});
