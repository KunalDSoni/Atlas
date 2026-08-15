/**
 * FEATURE REQUEST AGGREGATION
 *
 * The merge design calls request_count "total customer feedback count" and says
 * a merge must "transfer all linked feedback records to parent". Neither half
 * was implemented: nothing in the app ever wrote request_count, so every
 * feature reported "0 requests" forever, and a merge moved a number while
 * leaving the evidence pointed at the swallowed child.
 *
 * These cover the counter and the transfer together, because either one alone
 * is wrong: a count with no evidence behind it is the bug that shipped, and
 * evidence with a stale count is the bug the fix could introduce.
 */
const request = require('supertest');
const { createTestApp, adminHeaders } = require('./setup');

let app, headers, projectId;

const createFeature = async (name, description = 'aggregation fixture') => {
  const res = await request(app).post('/api/product/features').set(headers)
    .send({ name, description, project_id: projectId, status: 'idea' });
  expect(res.status).toBe(201);
  return res.body.id;
};

/** Files a piece of customer feedback against a feature, the way triage does. */
const linkFeedback = async (featureId, title) => {
  const insight = await request(app).post('/api/product/insights').set(headers)
    .send({ title, content: title, source: 'portal' });
  expect(insight.status).toBe(201);

  const link = await request(app).post(`/api/product/insights/${insight.body.id}/links`).set(headers)
    .send({ feature_id: featureId, importance: 2 });
  expect(link.status).toBe(201);

  return { insightId: insight.body.id, linkId: link.body.id };
};

const getFeature = async (id) => {
  const res = await request(app).get(`/api/product/features/${id}`).set(headers);
  expect(res.status).toBe(200);
  return res.body;
};

beforeAll(async () => {
  app = await createTestApp();
  headers = await adminHeaders();
  const projects = await request(app).get('/api/projects').set(headers);
  projectId = projects.body[0].id;
});

describe('request_count tracks linked feedback', () => {
  test('a new feature starts at zero', async () => {
    const id = await createFeature('Zero requests to begin with');
    expect((await getFeature(id)).request_count).toBe(0);
  });

  test('linking feedback raises the count', async () => {
    const id = await createFeature('Counts its feedback');

    await linkFeedback(id, 'Customer A wants this');
    expect((await getFeature(id)).request_count).toBe(1);

    await linkFeedback(id, 'Customer B wants this too');
    expect((await getFeature(id)).request_count).toBe(2);
  });

  test('unlinking feedback lowers the count', async () => {
    const id = await createFeature('Gives feedback back');
    const { linkId } = await linkFeedback(id, 'Customer C wants this');
    await linkFeedback(id, 'Customer D wants this');
    expect((await getFeature(id)).request_count).toBe(2);

    const res = await request(app).delete(`/api/product/insight-links/${linkId}`).set(headers);
    expect(res.status).toBe(200);
    expect((await getFeature(id)).request_count).toBe(1);
  });

  test('the count never goes negative', async () => {
    const id = await createFeature('Cannot go below zero');
    const { linkId } = await linkFeedback(id, 'The only piece of feedback');

    await request(app).delete(`/api/product/insight-links/${linkId}`).set(headers);
    // A second delete of the same link is a no-op, not a decrement.
    await request(app).delete(`/api/product/insight-links/${linkId}`).set(headers);

    expect((await getFeature(id)).request_count).toBe(0);
  });
});

describe('merging aggregates requests and their evidence', () => {
  test('the parent inherits the child count and the child insights', async () => {
    const parentId = await createFeature('Bulk edit issues on the board');
    const childId = await createFeature('Board bulk editing for issues');

    await linkFeedback(parentId, 'Parent-side request');
    const child = await linkFeedback(childId, 'Child-side request');
    await linkFeedback(childId, 'Second child-side request');

    const merge = await request(app).post(`/api/product/features/${parentId}/merge`).set(headers)
      .send({ childFeatureIds: [childId], reason: 'same request' });
    expect(merge.status).toBe(200);

    const parent = await getFeature(parentId);
    expect(parent.request_count).toBe(3);
    // The evidence moved, not just the tally — this is what the merge was for.
    expect(parent.insight_count).toBe(3);
    expect(parent.insights.map(i => i.id)).toContain(child.insightId);
  });

  test('undoing a merge hands the evidence back', async () => {
    const parentId = await createFeature('Schedule a report by email');
    const childId = await createFeature('Email scheduled reports');

    await linkFeedback(parentId, 'Parent keeps this one');
    const moved = await linkFeedback(childId, 'Child gets this one back');

    await request(app).post(`/api/product/features/${parentId}/merge`).set(headers)
      .send({ childFeatureIds: [childId] });
    expect((await getFeature(parentId)).request_count).toBe(2);

    const undo = await request(app).post(`/api/product/features/${parentId}/unmerge`).set(headers)
      .send({ childFeatureId: childId });
    expect(undo.status).toBe(200);

    const parent = await getFeature(parentId);
    const restored = await getFeature(childId);

    expect(parent.request_count).toBe(1);
    expect(parent.insight_count).toBe(1);
    // The parent's own evidence stayed put; only what the merge moved went back.
    expect(parent.insights.map(i => i.id)).not.toContain(moved.insightId);
    expect(restored.insight_count).toBe(1);
    expect(restored.insights.map(i => i.id)).toContain(moved.insightId);
  });

  test('feedback the parent gained after the merge stays with the parent', async () => {
    const parentId = await createFeature('Dark mode for the whole app');
    const childId = await createFeature('App-wide dark mode');

    const moved = await linkFeedback(childId, 'Arrived before the merge');

    await request(app).post(`/api/product/features/${parentId}/merge`).set(headers)
      .send({ childFeatureIds: [childId] });

    const after = await linkFeedback(parentId, 'Arrived after the merge');

    await request(app).post(`/api/product/features/${parentId}/unmerge`).set(headers)
      .send({ childFeatureId: childId });

    const parent = await getFeature(parentId);
    const ids = parent.insights.map(i => i.id);
    expect(ids).toContain(after.insightId);
    expect(ids).not.toContain(moved.insightId);
  });

  test('the swallowed duplicate leaves the list, and comes back on undo', async () => {
    const parentId = await createFeature('Import issues from a CSV');
    const childId = await createFeature('CSV issue import');

    const listed = async () => {
      const res = await request(app).get(`/api/product/features?project_id=${projectId}`).set(headers);
      return res.body.map(f => f.id);
    };

    expect(await listed()).toContain(childId);

    await request(app).post(`/api/product/features/${parentId}/merge`).set(headers)
      .send({ childFeatureIds: [childId] });

    // The whole point of merging duplicates: one of them stops being listed.
    const afterMerge = await listed();
    expect(afterMerge).toContain(parentId);
    expect(afterMerge).not.toContain(childId);

    // Still reachable by id, so an existing link or bookmark does not 404.
    expect((await getFeature(childId)).id).toBe(childId);

    await request(app).post(`/api/product/features/${parentId}/unmerge`).set(headers)
      .send({ childFeatureId: childId });
    expect(await listed()).toContain(childId);
  });

  test('a merged-away duplicate stops being offered as a candidate', async () => {
    const parentId = await createFeature('Two-factor authentication', 'Protect accounts with 2FA');
    const childId = await createFeature('2FA authentication', 'Protect accounts with 2FA');

    const candidateIds = async (id) => {
      const res = await request(app).get(`/api/product/features/${id}/merge-candidates`).set(headers);
      expect(res.status).toBe(200);
      return res.body.data.map(c => c.feature.id);
    };

    expect(await candidateIds(parentId)).toContain(childId);

    await request(app).post(`/api/product/features/${parentId}/merge`).set(headers)
      .send({ childFeatureIds: [childId] });

    // It used to keep offering the child as a duplicate of the very feature
    // that had just absorbed it.
    expect(await candidateIds(parentId)).not.toContain(childId);
  });

  test('an insight both features already carried is not duplicated onto the parent', async () => {
    const parentId = await createFeature('Single sign-on with Okta');
    const childId = await createFeature('Okta single sign-on');

    // One piece of feedback filed against both — pb_insight_links is unique per
    // (insight, feature), so a naive re-point would collide.
    const insight = await request(app).post('/api/product/insights').set(headers)
      .send({ title: 'We need Okta', content: 'We need Okta', source: 'portal' });
    for (const featureId of [parentId, childId]) {
      const link = await request(app).post(`/api/product/insights/${insight.body.id}/links`).set(headers)
        .send({ feature_id: featureId, importance: 1 });
      expect(link.status).toBe(201);
    }

    const merge = await request(app).post(`/api/product/features/${parentId}/merge`).set(headers)
      .send({ childFeatureIds: [childId] });
    expect(merge.status).toBe(200);

    const parent = await getFeature(parentId);
    expect(parent.insights.filter(i => i.id === insight.body.id)).toHaveLength(1);
  });
});
