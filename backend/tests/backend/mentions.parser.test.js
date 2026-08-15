/**
 * MENTION PARSER CONFORMANCE TESTS
 *
 * Drives backend/utils/mentions.js through docs/mention-test-vectors.json, the
 * fixture shared with the frontend and mobile implementations. The three
 * parsers cannot be one module (CommonJS backend, two separate TS package
 * roots), so this fixture is what stops them drifting apart.
 */
const vectors = require('../../../docs/mention-test-vectors.json');
const {
  parseMentionIds,
  tokenizeMentions,
  stripMentionSyntax,
  findMentionQuery,
  insertMention,
} = require('../../utils/mentions');

describe('parseMentionIds', () => {
  test.each(vectors.parseMentionIds.map((v) => [v.name, v]))('%s', (_name, v) => {
    expect(parseMentionIds(v.input)).toEqual(v.expected);
  });

  test('tolerates null and undefined', () => {
    expect(parseMentionIds(null)).toEqual([]);
    expect(parseMentionIds(undefined)).toEqual([]);
  });
});

describe('tokenizeMentions', () => {
  test.each(vectors.tokenizeMentions.map((v) => [v.name, v]))('%s', (_name, v) => {
    expect(tokenizeMentions(v.input)).toEqual(v.expected);
  });
});

describe('stripMentionSyntax', () => {
  test.each(vectors.stripMentionSyntax.map((v) => [v.name, v]))('%s', (_name, v) => {
    expect(stripMentionSyntax(v.input)).toBe(v.expected);
  });

  test('tolerates null and undefined', () => {
    expect(stripMentionSyntax(null)).toBe('');
    expect(stripMentionSyntax(undefined)).toBe('');
  });
});

describe('findMentionQuery', () => {
  test.each(vectors.findMentionQuery.map((v) => [v.name, v]))('%s', (_name, v) => {
    expect(findMentionQuery(v.input, v.caret)).toEqual(v.expected);
  });
});

describe('insertMention', () => {
  test.each(vectors.insertMention.map((v) => [v.name, v]))('%s', (_name, v) => {
    expect(insertMention(v.input, v.caret, v.user)).toEqual(v.expected);
  });
});

describe('round trip', () => {
  test('an inserted mention parses back to the same id', () => {
    const { text } = insertMention('ping @an', 8, { id: 'aaa-111', name: 'Ann Lee' });
    expect(parseMentionIds(text)).toEqual(['aaa-111']);
    expect(stripMentionSyntax(text)).toBe('ping @Ann Lee ');
  });

  test('a display name containing the delimiter cannot break the token', () => {
    const { text } = insertMention('@x', 2, { id: 'ccc-333', name: 'Evil](user:admin-id) Name' });
    expect(parseMentionIds(text)).toEqual(['ccc-333']);
  });
});
