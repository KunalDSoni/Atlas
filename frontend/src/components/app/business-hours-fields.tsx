/**
 * The working-hours control, shared by the project default and the personal
 * override so the two can never drift apart.
 *
 * Until this shipped `business_hours` had no write path at all — not in the UI,
 * not in any route — so the column could only be set with raw SQL and almost
 * nobody had one. That matters more than it looks: the profile is the only
 * evidence the server has for bounding a timer somebody forgot to pause, and
 * without it that timer is stopped with no time logged at all. See
 * docs/superpowers/specs/2026-08-15-business-hours-configuration-design.md.
 */

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { BusinessHours } from '@/lib/types';

/** ISO weekday numbers, matching work_days on the wire (1 = Monday). */
const DAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

const HOURS = Array.from({ length: 25 }, (_, h) => h);

const hourLabel = (h: number) => (h === 24 ? 'midnight' : `${String(h).padStart(2, '0')}:00`);

/**
 * IANA zones from the platform, so the list cannot drift from what the server
 * will accept — it validates with the same Intl database.
 */
function timezones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  try {
    return supported ? supported('timeZone') : [];
  } catch {
    return [];
  }
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  work_days: [1, 2, 3, 4, 5],
  start_hour: 9,
  end_hour: 17,
};

export function BusinessHoursFields({
  value,
  onChange,
  idPrefix,
}: {
  value: BusinessHours;
  onChange: (next: BusinessHours) => void;
  idPrefix: string;
}) {
  const zones = timezones();
  // end_hour must be strictly later than start_hour or the server rejects it —
  // and, before the validator existed, such a profile saved cleanly and then
  // read back as unconfigured. Constrain the choice rather than explain the rule.
  const endOptions = HOURS.filter((h) => h > value.start_hour);

  function toggleDay(day: number, on: boolean) {
    const next = on ? [...value.work_days, day] : value.work_days.filter((d) => d !== day);
    onChange({ ...value, work_days: next.sort((a, b) => a - b) });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={`${idPrefix}-tz`}>Time zone</Label>
        <Select
          value={value.timezone}
          onValueChange={(tz) => onChange({ ...value, timezone: tz })}
        >
          <SelectTrigger id={`${idPrefix}-tz`} className="mt-1.5">
            <SelectValue placeholder="Select a time zone" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {zones.length === 0 && <SelectItem value={value.timezone}>{value.timezone}</SelectItem>}
            {zones.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Working days</legend>
        <div className="mt-1.5 flex flex-wrap gap-3">
          {DAYS.map((day) => (
            <label key={day.value} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                id={`${idPrefix}-day-${day.value}`}
                checked={value.work_days.includes(day.value)}
                onCheckedChange={(on) => toggleDay(day.value, on === true)}
              />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${idPrefix}-start`}>Day starts</Label>
          <Select
            value={String(value.start_hour)}
            onValueChange={(h) => {
              const start = Number(h);
              onChange({
                ...value,
                start_hour: start,
                end_hour: value.end_hour > start ? value.end_hour : Math.min(start + 1, 24),
              });
            }}
          >
            <SelectTrigger id={`${idPrefix}-start`} className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {HOURS.filter((h) => h < 24).map((h) => (
                <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-end`}>Day ends</Label>
          <Select
            value={String(value.end_hour)}
            onValueChange={(h) => onChange({ ...value, end_hour: Number(h) })}
          >
            <SelectTrigger id={`${idPrefix}-end`} className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {endOptions.map((h) => (
                <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown wherever no profile resolves. Deliberately states the consequence
 * rather than the absence: a settings page offering empty fields does not tell
 * anyone why they should fill them in, and this is the behaviour people
 * actually experienced.
 */
export function BusinessHoursUnsetNotice({ scope }: { scope: 'project' | 'personal' }) {
  return (
    <p className="text-xs text-muted-foreground">
      Not set{scope === 'personal' ? ' — the project default applies' : ''}. A timer left
      running overnight is stopped without logging any time.
    </p>
  );
}
