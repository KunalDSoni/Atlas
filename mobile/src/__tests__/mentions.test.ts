/**
 * Drives mobile/src/utils/mentions.ts through docs/mention-test-vectors.json —
 * the same fixture the backend and web parsers use. Three copies of this parser
 * exist because the package layout gives them no shared build; this is what
 * stops them drifting apart.
 */
import vectors from '../../../docs/mention-test-vectors.json';
import {
  findMentionQuery,
  insertMention,
  parseMentionIds,
  stripMentionSyntax,
  tokenizeMentions,
} from '../utils/mentions';

describe('parseMentionIds', () => {
  test.each(vectors.parseMentionIds.map((v) => [v.name, v] as const))('%s', (_n, v) => {
    expect(parseMentionIds(v.input)).toEqual(v.expected);
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
