const { frameOptionsFor } = require('../../utils/frame-options');

describe('frameOptionsFor', () => {
  test('the demo may be framed by its own origin', () => {
    expect(frameOptionsFor('/demo')).toBe('SAMEORIGIN');
    expect(frameOptionsFor('/demo/')).toBe('SAMEORIGIN');
    expect(frameOptionsFor('/demo/atl/board')).toBe('SAMEORIGIN');
  });

  test('everything else stays unframeable', () => {
    for (const p of ['/', '/login', '/dashboard', '/api/auth/me', '/demonstration', '/atl/demo']) {
      expect(frameOptionsFor(p)).toBe('DENY');
    }
  });
});
