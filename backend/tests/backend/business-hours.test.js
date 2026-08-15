// Writes to business_hours validate strictly, unlike the tolerant reader.
// parseBusinessHours returning null on bad input is right for a reader
// ("unconfigured, fall back to wall-clock") and silently wrong for a writer:
// a profile saved as 5pm-9am would read back as unconfigured while the
// settings page displayed what the user typed.
// See docs/superpowers/specs/2026-08-15-business-hours-configuration-design.md
const { validateBusinessHours } = require('../../utils/flow');

const valid = { timezone: 'America/New_York', work_days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 18 };

describe('validateBusinessHours', () => {
  test('accepts a valid profile and returns it serialised', () => {
    const result = validateBusinessHours(valid);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.json)).toEqual(valid);
  });

  test('accepts null as an explicit clear', () => {
    expect(validateBusinessHours(null)).toEqual({ ok: true, json: null });
  });

  test('rejects an end_hour at or before start_hour', () => {
    // workdayEndFor returns null when end <= start, so an inverted profile
    // behaves exactly like no profile — the silent failure this prevents.
    const result = validateBusinessHours({ ...valid, start_hour: 17, end_hour: 9 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/end_hour/);
  });

  test('rejects an end_hour equal to start_hour', () => {
    expect(validateBusinessHours({ ...valid, start_hour: 9, end_hour: 9 }).ok).toBe(false);
  });

  test('rejects an unknown timezone', () => {
    const result = validateBusinessHours({ ...valid, timezone: 'Mars/Olympus' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timezone/);
  });

  test('rejects empty work_days', () => {
    const result = validateBusinessHours({ ...valid, work_days: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/work_days/);
  });

  test('rejects duplicate work_days', () => {
    expect(validateBusinessHours({ ...valid, work_days: [1, 1, 2] }).ok).toBe(false);
  });

  test('rejects a weekday outside 1-7', () => {
    expect(validateBusinessHours({ ...valid, work_days: [0, 1] }).ok).toBe(false);
    expect(validateBusinessHours({ ...valid, work_days: [1, 8] }).ok).toBe(false);
  });

  test('rejects hours outside 0-24', () => {
    expect(validateBusinessHours({ ...valid, start_hour: -1 }).ok).toBe(false);
    expect(validateBusinessHours({ ...valid, end_hour: 25 }).ok).toBe(false);
  });

  test('rejects non-integer hours', () => {
    expect(validateBusinessHours({ ...valid, start_hour: 9.5 }).ok).toBe(false);
  });

  test('rejects a missing field', () => {
    const { timezone, ...noTimezone } = valid;
    expect(validateBusinessHours(noTimezone).ok).toBe(false);
  });

  test('a validated profile is readable by the parser that consumes it', () => {
    // The two must agree, or a write could succeed and still read as
    // unconfigured — which is the whole failure this validator exists to stop.
    const { parseBusinessHours } = require('../../utils/flow');
    expect(parseBusinessHours(validateBusinessHours(valid).json)).toEqual(valid);
  });
});
