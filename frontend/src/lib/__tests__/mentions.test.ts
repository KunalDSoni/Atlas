/**
 * Drives frontend/src/lib/mentions.ts through docs/mention-test-vectors.json,
 * the same fixture the backend and mobile parsers use. Three copies exist
 * because the package layout gives them no shared build; this is what stops
 * them drifting apart.
 */
import { describe, expect, test } from 'vitest';
import vectors from '../../../../docs/mention-test-vectors.json';
import {
  findMentionQuery,
  insertMention,
  parseMentionIds,
  stripMentionSyntax,
  tokenizeMentions,
} from '../mentions';

describe('parseMentionIds', () => {
  test.each(vectors.parseMentionIds.map((v) => [v.name, v] as const))('%s', (_n, v) => {
    expect(parseMentionIds(v.input)).toEqual(v.expected);
  });

  test('tolerates null and undefined', () => {
    expect(parseMentionIds(null)).toEqual([]);
    expect(parseMentionIds(undefined)).toEqual([]);
  });
});

describe('tokenizeMentions', () => {
  test.each(vectors.tokenizeMentions.map((v) => [v.name, v] as const))('%s', (_n, v) => {
    expect(tokenizeMentions(v.input)).toEqual(v.expected);
  });
});

describe('stripMentionSyntax', () => {
  test.each(vectors.stripMentionSyntax.map((v) => [v.name, v] as const))('%s', (_n, v) => {
    expect(stripMentionSyntax(v.input)).toBe(v.expected);
  });
});

describe('findMentionQuery', () => {
  test.each(vectors.findMentionQuery.map((v) => [v.name, v] as const))('%s', (_n, v) => {
    expect(findMentionQuery(v.input, v.caret)).toEqual(v.expected);
  });
});

describe('insertMention', () => {
  test.each(vectors.insertMention.map((v) => [v.name, v] as const))('%s', (_n, v) => {
    expect(insertMention(v.input, v.caret, v.user)).toEqual(v.expected);
  });
});

describe('round trip', () => {
  test('an inserted mention parses back to the same id', () => {
    const { text } = insertMention('ping @an', 8, { id: 'aaa-111', name: 'Ann Lee' });
    expect(parseMentionIds(text)).toEqual(['aaa-111']);
    expect(stripMentionSyntax(text)).toBe('ping @Ann Lee ');
  });

  test('a display name containing the delimiter cannot forge a second token', () => {
    const { text } = insertMention('@x', 2, {
      id: 'ccc-333',
      name: 'Evil](user:admin-id) Name',
    });
    expect(parseMentionIds(text)).toEqual(['ccc-333']);
  });
});
