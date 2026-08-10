const { categoryOf, statusTimeline, hoursBetween, percentile } = require('../../utils/flow');

const STATUSES = [
  { key: 'todo', category: 'todo' },
  { key: 'in_progress', category: 'in_progress' },
  { key: 'qa', category: 'in_progress' },
  { key: 'done', category: 'done' },
];

describe('categoryOf', () => {
  test('uses the project status list', () => {
    expect(categoryOf('qa', STATUSES)).toBe('in_progress');
    expect(categoryOf('done', STATUSES)).toBe('done');
  });
  test('falls back to built-ins for keys missing from the list', () => {
    expect(categoryOf('in_review', STATUSES)).toBe('in_progress');
  });
  test('blocked falls back to the in_progress built-in category', () => {
    expect(categoryOf('blocked', STATUSES)).toBe('in_progress');
  });
  test('unknown keys are todo', () => {
    expect(categoryOf('someday', STATUSES)).toBe('todo');
  });
});

describe('statusTimeline', () => {
  const issue = { created_at: '2026-07-01 09:00:00', status: 'done' };

  test('replays transitions into contiguous segments', () => {
    const t = statusTimeline(issue, [
      { old_value: 'todo', new_value: 'in_progress', created_at: '2026-07-02 09:00:00' },
      { old_value: 'in_progress', new_value: 'done', created_at: '2026-07-04 09:00:00' },
    ]);
    expect(t).toEqual([
      { status: 'todo', from: '2026-07-01 09:00:00', to: '2026-07-02 09:00:00' },
      { status: 'in_progress', from: '2026-07-02 09:00:00', to: '2026-07-04 09:00:00' },
      { status: 'done', from: '2026-07-04 09:00:00', to: null },
    ]);
  });

  test('no transitions: one open segment in the current status', () => {
    expect(statusTimeline(issue, [])).toEqual([
      { status: 'done', from: '2026-07-01 09:00:00', to: null },
    ]);
  });

  test('first segment status comes from the first transition, not current status', () => {
    const t = statusTimeline({ ...issue, status: 'in_progress' }, [
      { old_value: 'todo', new_value: 'in_progress', created_at: '2026-07-03 09:00:00' },
    ]);
    expect(t[0].status).toBe('todo');
  });
});

describe('hoursBetween', () => {
  test('whole and fractional hours', () => {
    expect(hoursBetween('2026-07-01 09:00:00', '2026-07-01 12:30:00')).toBeCloseTo(3.5);
  });
  test('ISO-with-T inputs also parse', () => {
    expect(hoursBetween('2026-07-01T09:00:00', '2026-07-01T10:00:00')).toBeCloseTo(1);
  });
});

describe('percentile', () => {
  test('nearest-rank on sorted input', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.85)).toBe(40);
  });
  test('empty input is null, single element is itself', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.85)).toBe(7);
  });
});

const { businessMinutesBetween, resolveBusinessHours } = require('../../utils/flow');

describe('resolveBusinessHours', () => {
  const proj = JSON.stringify({ timezone: 'UTC', work_days: [1,2,3,4,5], start_hour: 9, end_hour: 17 });
  const user = JSON.stringify({ timezone: 'Asia/Kolkata', work_days: [1,2,3,4,5], start_hour: 10, end_hour: 19 });

  test('user override wins over project default', () => {
    expect(resolveBusinessHours(proj, user)).toEqual({ timezone: 'Asia/Kolkata', work_days: [1,2,3,4,5], start_hour: 10, end_hour: 19 });
  });
  test('falls back to project default when no user override', () => {
    expect(resolveBusinessHours(proj, null)).toEqual({ timezone: 'UTC', work_days: [1,2,3,4,5], start_hour: 9, end_hour: 17 });
  });
  test('null when neither is set', () => {
    expect(resolveBusinessHours(null, null)).toBeNull();
  });
  test('null when JSON is malformed', () => {
    expect(resolveBusinessHours('not json', null)).toBeNull();
  });
});

describe('businessMinutesBetween', () => {
  const utc95 = { timezone: 'UTC', work_days: [1,2,3,4,5], start_hour: 9, end_hour: 17 };

  test('null profile falls back to raw wall-clock minutes', () => {
    expect(businessMinutesBetween('2026-07-06 09:00:00', '2026-07-06 17:00:00', null)).toBe(480);
  });

  test('same-day partial overlap within business hours', () => {
    // Monday 2026-07-06, 10:00-14:00 UTC, fully inside 9-17
    expect(businessMinutesBetween('2026-07-06 10:00:00', '2026-07-06 14:00:00', utc95)).toBe(240);
  });

  test('segment entirely outside work hours is zero', () => {
    // Monday 2026-07-06, 20:00-22:00 UTC, after 17:00 close
    expect(businessMinutesBetween('2026-07-06 20:00:00', '2026-07-06 22:00:00', utc95)).toBe(0);
  });

  test('multi-day span crossing a weekend excludes Sat/Sun', () => {
    // Friday 2026-07-03 09:00 through Monday 2026-07-06 17:00, Mon-Fri 9-17 profile.
    // Fri: 8h, Sat/Sun: 0h, Mon: 8h = 16h = 960 minutes.
    expect(businessMinutesBetween('2026-07-03 09:00:00', '2026-07-06 17:00:00', utc95)).toBe(960);
  });

  test('Sun-Thu work week (Gulf-region profile) counts Sunday, excludes Friday', () => {
    const sunThu = { timezone: 'UTC', work_days: [7,1,2,3,4], start_hour: 9, end_hour: 17 };
    // Friday 2026-07-03 09:00 (not a work day) through Sunday 2026-07-05 17:00 (a work day).
    // Fri: 0h, Sat: 0h, Sun: 8h = 480 minutes.
    expect(businessMinutesBetween('2026-07-03 09:00:00', '2026-07-05 17:00:00', sunThu)).toBe(480);
  });

  test('timezone conversion: a segment framed in local time crossing midnight UTC', () => {
    // Asia/Kolkata is UTC+5:30. 2026-07-06 08:00 IST = 2026-07-06 02:30 UTC.
    // Segment 2026-07-06 02:30 UTC to 2026-07-06 06:30 UTC = 08:00-12:00 IST, fully inside a 9-18 IST window? No —
    // 08:00 IST is before a 9am start, so only 09:00-12:00 IST (3h) counts.
    const ist = { timezone: 'Asia/Kolkata', work_days: [1,2,3,4,5], start_hour: 9, end_hour: 18 };
    expect(businessMinutesBetween('2026-07-06 02:30:00', '2026-07-06 06:30:00', ist)).toBe(180);
  });
});

describe('localMidnightUtc / isoWeekdayInTz (exported for utils/timers.js)', () => {
  const { localMidnightUtc, isoWeekdayInTz } = require('../../utils/flow');

  test('localMidnightUtc resolves local midnight for a whole-hour timezone', () => {
    // 2026-07-06 14:00 UTC is 2026-07-06 in UTC; local midnight is 00:00 UTC.
    const d = new Date('2026-07-06T14:00:00Z');
    expect(localMidnightUtc(d, 'UTC').toISOString()).toBe('2026-07-06T00:00:00.000Z');
  });

  test('localMidnightUtc handles a half-hour offset timezone', () => {
    // Asia/Kolkata is UTC+5:30. 2026-07-06 14:00 UTC = 19:30 IST on 2026-07-06,
    // so local midnight is 2026-07-05 18:30 UTC.
    const d = new Date('2026-07-06T14:00:00Z');
    expect(localMidnightUtc(d, 'Asia/Kolkata').toISOString()).toBe('2026-07-05T18:30:00.000Z');
  });

  test('isoWeekdayInTz returns 1 for Monday', () => {
    // 2026-07-06 is a Monday.
    expect(isoWeekdayInTz(new Date('2026-07-06T12:00:00Z'), 'UTC')).toBe(1);
  });

  test('isoWeekdayInTz returns 7 for Sunday', () => {
    // 2026-07-05 is a Sunday.
    expect(isoWeekdayInTz(new Date('2026-07-05T12:00:00Z'), 'UTC')).toBe(7);
  });
});

describe('localMidnightUtc across the date line', () => {
  const { localMidnightUtc } = require('../../utils/flow');
  // The zone's UTC offset must be subtracted WITH ITS SIGN. Inferring it by
  // rendering 'Y-M-D 00:00Z' in the zone and reading back the hour silently
  // assumed east of Greenwich: in New York that guess renders as 19:00 on the
  // PREVIOUS day, so an offset of -5h was read as +19h and every result landed
  // a full calendar day early. Nothing caught it because every existing
  // fixture in this repo used timezone 'UTC', where the two agree.
  test.each([
    ['Asia/Kolkata', '2026-08-10T16:00:00Z', '2026-08-09T18:30:00.000Z'],
    ['UTC', '2026-08-10T16:00:00Z', '2026-08-10T00:00:00.000Z'],
    ['America/New_York', '2026-08-10T16:00:00Z', '2026-08-10T04:00:00.000Z'],
    ['America/Los_Angeles', '2026-08-10T16:00:00Z', '2026-08-10T07:00:00.000Z'],
    ['America/Sao_Paulo', '2026-08-10T16:00:00Z', '2026-08-10T03:00:00.000Z'],
    ['Australia/Sydney', '2026-08-10T16:00:00Z', '2026-08-10T14:00:00.000Z'],
    ['Asia/Kathmandu', '2026-08-10T16:00:00Z', '2026-08-09T18:15:00.000Z'],
    // DST transition days: the offset in force at the naive guess differs from
    // the one in force at real local midnight.
    ['America/New_York', '2026-03-08T18:00:00Z', '2026-03-08T05:00:00.000Z'],
    ['America/New_York', '2026-11-01T18:00:00Z', '2026-11-01T04:00:00.000Z'],
    ['Europe/London', '2026-03-29T12:00:00Z', '2026-03-29T00:00:00.000Z'],
  ])('%s at %s', (timezone, instant, expected) => {
    expect(localMidnightUtc(new Date(instant), timezone).toISOString()).toBe(expected);
  });
});

describe('businessMinutesBetween outside UTC', () => {
  const NEW_YORK = { timezone: 'America/New_York', work_days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 18 };

  test('counts a full workday west of Greenwich', () => {
    // Mon 2026-07-06, 09:00 -> 18:00 New York. Returned 0 while the day
    // window was built around the wrong calendar day.
    expect(businessMinutesBetween('2026-07-06 13:00:00', '2026-07-06 22:00:00', NEW_YORK)).toBe(540);
  });

  test('excludes the overnight gap between two working days', () => {
    // Mon 09:00 New York -> Tue 18:00 New York is two 9h days, not 33h.
    expect(businessMinutesBetween('2026-07-06 13:00:00', '2026-07-07 22:00:00', NEW_YORK)).toBe(1080);
  });

  test('excludes a weekend west of Greenwich', () => {
    // Fri 18:00 -> Mon 09:00 New York is entirely outside working hours.
    expect(businessMinutesBetween('2026-07-03 22:00:00', '2026-07-06 13:00:00', NEW_YORK)).toBe(0);
  });
});
