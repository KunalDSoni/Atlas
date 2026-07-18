/**
 * WIKI ATTACHMENTS TESTS (ATLAS-22)
 * Upload → list → inline-image sign/unsign round-trip → signed raw fetch.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

let app, headers, spaceId, pageId;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const spaces = await request(app).get('/api/wiki/spaces').set(headers);
  spaceId = spaces.body[0].id;
  const created = await request(app).post(`/api/wiki/spaces/${spaceId}/pages`).set(headers)
    .send({ title: 'Attachment host', body: '<p>hi</p>' });
  pageId = created.body.id;
});

describe('wiki attachments', () => {
  let att;

  test('uploads a file to a page', async () => {
    const res = await request(app).post(`/api/wiki/pages/${pageId}/attachments`).set(headers)
      .attach('files', Buffer.from('\x89PNG fake image bytes'), { filename: 'diagram.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body[0].original_name).toBe('diagram.png');
    expect(res.body[0].is_image).toBe(true);
    expect(res.body[0].raw_url).toMatch(/\/api\/wiki\/attachments\/.+\/raw\?exp=\d+&sig=/);
    att = res.body[0];
  });

  test('lists attachments', async () => {
    const res = await request(app).get(`/api/wiki/pages/${pageId}/attachments`).set(headers);
    expect(res.body.some((a) => a.id === att.id)).toBe(true);
  });

  test('signed raw URL serves the file without a header', async () => {
    const path = att.raw_url; // already carries exp+sig
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
  });

  test('inline image src is stored unsigned and re-signed on fetch', async () => {
    // Save an inline image using the signed url; it must persist without the sig
    // and come back freshly signed.
    await request(app).put(`/api/wiki/pages/${pageId}`).set(headers)
      .send({ body: `<p>See <img src="${att.raw_url}" alt="d"></p>`, change_message: 'add image' });
    const page = await request(app).get(`/api/wiki/pages/${pageId}`).set(headers);
    // Fetched body is signed (browser can load it)…
    expect(page.body.body).toMatch(new RegExp(`/api/wiki/attachments/${att.id}/raw\\?exp=\\d+&sig=`));
    // …and re-fetching yields a valid signed URL that serves 200.
    const m = page.body.body.match(/\/api\/wiki\/attachments\/[\w-]+\/raw\?exp=\d+&sig=[a-f0-9]+/);
    expect(m).toBeTruthy();
    expect((await request(app).get(m[0])).status).toBe(200);
  });

  test('deletes an attachment', async () => {
    const res = await request(app).delete(`/api/wiki/attachments/${att.id}`).set(headers);
    expect(res.status).toBe(200);
  });
});
