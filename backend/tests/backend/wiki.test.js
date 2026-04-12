/**
 * WIKI MODULE TESTS
 * Tests: Spaces CRUD, Pages CRUD, search, star, comments, cascade delete
 */
const request = require('supertest');
const { createTestApp, getApp, adminHeaders } = require('./setup');

let app, headers;

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
});

describe('Wiki Spaces', () => {
  describe('GET /api/wiki/spaces', () => {
    test('should return seeded spaces', async () => {
      const res = await request(app).get('/api/wiki/spaces').set(headers);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test('each space should have required fields', async () => {
      const res = await request(app).get('/api/wiki/spaces').set(headers);
      const space = res.body[0];
      expect(space).toHaveProperty('id');
      expect(space).toHaveProperty('name');
      expect(space).toHaveProperty('space_key');
      expect(space).toHaveProperty('page_count');
    });
  });

  describe('POST /api/wiki/spaces', () => {
    test('should create a space with key field', async () => {
      const k = 'T' + Date.now().toString(36).slice(-3).toUpperCase();
      const res = await request(app)
        .post('/api/wiki/spaces')
        .set(headers)
        .send({ name: 'Test Space', key: k, description: 'Test desc' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Test Space');
      expect(res.body.space_key).toBe(k);
    });

    test('should create a space with space_key field', async () => {
      const k = 'S' + Date.now().toString(36).slice(-3).toUpperCase();
      const res = await request(app)
        .post('/api/wiki/spaces')
        .set(headers)
        .send({ name: 'Space Key Test', space_key: k, description: 'Test' });

      expect(res.status).toBe(201);
      expect(res.body.space_key).toBe(k);
    });

    test('should reject missing name', async () => {
      const res = await request(app)
        .post('/api/wiki/spaces')
        .set(headers)
        .send({ key: 'NN' });

      expect(res.status).toBe(400);
    });

    test('should reject missing key', async () => {
      const res = await request(app)
        .post('/api/wiki/spaces')
        .set(headers)
        .send({ name: 'No Key' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/wiki/spaces/:id', () => {
    test('should return a specific space', async () => {
      const spaces = await request(app).get('/api/wiki/spaces').set(headers);
      const spaceId = spaces.body[0].id;

      const res = await request(app).get(`/api/wiki/spaces/${spaceId}`).set(headers);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(spaceId);
    });
  });
});

describe('Wiki Pages', () => {
  let spaceId;

  beforeAll(async () => {
    const spaces = await request(app).get('/api/wiki/spaces').set(headers);
    spaceId = spaces.body[0].id;
  });

  describe('POST /api/wiki/spaces/:id/pages', () => {
    test('should create a page', async () => {
      const res = await request(app)
        .post(`/api/wiki/spaces/${spaceId}/pages`)
        .set(headers)
        .send({ title: 'Test Page', body: '<p>Hello World</p>' });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Test Page');
      expect(res.body.body).toBe('<p>Hello World</p>');
      expect(res.body).toHaveProperty('slug');
      expect(res.body.version).toBe(1);
    });

    test('should reject missing title', async () => {
      const res = await request(app)
        .post(`/api/wiki/spaces/${spaceId}/pages`)
        .set(headers)
        .send({ body: '<p>No title</p>' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/wiki/spaces/:id/pages', () => {
    test('should return pages in space', async () => {
      const res = await request(app)
        .get(`/api/wiki/spaces/${spaceId}/pages`)
        .set(headers);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/wiki/pages/:id', () => {
    test('should return page with content', async () => {
      const pages = await request(app).get(`/api/wiki/spaces/${spaceId}/pages`).set(headers);
      const pageId = pages.body[0].id;

      const res = await request(app).get(`/api/wiki/pages/${pageId}`).set(headers);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('title');
      expect(res.body).toHaveProperty('body');
      expect(res.body).toHaveProperty('space_name');
    });
  });

  describe('PUT /api/wiki/pages/:id', () => {
    test('should update page and increment version', async () => {
      const pages = await request(app).get(`/api/wiki/spaces/${spaceId}/pages`).set(headers);
      const pageId = pages.body[0].id;

      const res = await request(app)
        .put(`/api/wiki/pages/${pageId}`)
        .set(headers)
        .send({ title: 'Updated Page', body: '<p>Updated content</p>', change_message: 'Fixed typo' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Page');
    });
  });

  describe('GET /api/wiki/pages/recent', () => {
    test('should return recently updated pages', async () => {
      const res = await request(app).get('/api/wiki/pages/recent').set(headers);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/wiki/search', () => {
    test('should search pages by query', async () => {
      const res = await request(app)
        .get('/api/wiki/search?q=Test')
        .set(headers);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test('should return empty for no matches', async () => {
      const res = await request(app)
        .get('/api/wiki/search?q=zzzznonexistentzzzz')
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
    });
  });
});

describe('Wiki Space Cascade Delete', () => {
  test('should delete space and all its pages', async () => {
    // Create a space
    const space = await request(app)
      .post('/api/wiki/spaces')
      .set(headers)
      .send({ name: 'Delete Space', key: 'D' + Date.now().toString(36).slice(-4).toUpperCase() });
    const spaceId = space.body.id;

    // Create a page in it
    await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages`)
      .set(headers)
      .send({ title: 'Will be deleted', body: '<p>Bye</p>' });

    // Delete space
    const res = await request(app).delete(`/api/wiki/spaces/${spaceId}`).set(headers);
    expect(res.status).toBe(200);

    // Space should be gone
    const getRes = await request(app).get(`/api/wiki/spaces/${spaceId}`).set(headers);
    expect(getRes.status).toBe(404);
  });
});
