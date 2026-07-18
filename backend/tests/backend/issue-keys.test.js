const { extractIssueKeys } = require('../../utils/issue-keys');

describe('extractIssueKeys', () => {
  test('finds keys in prose', () => {
    expect(extractIssueKeys('<p>Fixed in ATLAS-29 today.</p>')).toEqual(['ATLAS-29']);
  });

  test('dedupes repeated keys', () => {
    expect(extractIssueKeys('<p>ATLAS-29 and ATLAS-29 again</p>')).toEqual(['ATLAS-29']);
  });

  test('finds multiple distinct keys in document order', () => {
    expect(extractIssueKeys('<p>ATLAS-29 then PROJ-7</p>')).toEqual(['ATLAS-29', 'PROJ-7']);
  });

  test('ignores keys inside code, pre, and anchor elements', () => {
    expect(extractIssueKeys('<p><code>ATLAS-1</code> <pre>ATLAS-2</pre> <a href="#">ATLAS-3</a></p>')).toEqual([]);
  });

  test('still finds keys outside a code block in the same document', () => {
    expect(extractIssueKeys('<p><code>ATLAS-1</code> but ATLAS-2 is open</p>')).toEqual(['ATLAS-2']);
  });

  test('does not match lowercase keys', () => {
    expect(extractIssueKeys('<p>atlas-29</p>')).toEqual([]);
  });

  test('does not treat an attribute value as prose', () => {
    expect(extractIssueKeys('<p title="ATLAS-99">nothing here</p>')).toEqual([]);
  });

  test('returns [] for empty, null, and non-string input', () => {
    expect(extractIssueKeys('')).toEqual([]);
    expect(extractIssueKeys(null)).toEqual([]);
    expect(extractIssueKeys(undefined)).toEqual([]);
    expect(extractIssueKeys(42)).toEqual([]);
  });

  test('returns pattern-matching non-issues; resolution is what filters them', () => {
    // COVID-19 matches the key pattern. The extractor is deliberately naive —
    // Task 3 resolves keys against the issues table, so junk creates no rows.
    expect(extractIssueKeys('<p>COVID-19 policy</p>')).toEqual(['COVID-19']);
  });
});
