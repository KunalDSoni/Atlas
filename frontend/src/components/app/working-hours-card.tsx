/**
 * The signed-in user's personal working hours — an override of the project's.
 *
 * Opt-in: the switch is off by default, because the project default is the
 * right answer for most people and an override nobody asked for is a way to
 * get a wrong one. Off means "clear it" (an explicit null), which the server
 * distinguishes from an omitted field.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import type { BusinessHours } from '@/lib/types';
import {
  BusinessHoursFields, BusinessHoursUnsetNotice, DEFAULT_BUSINESS_HOURS,
} from './business-hours-fields';

function parse(stored: string | null | undefined): BusinessHours | null {
  if (!stored) return null;
  try {
    return JSON.parse(stored) as BusinessHours;
  } catch {
    return null;
  }
}

export function WorkingHoursCard() {
  const [hours, setHours] = useState<BusinessHours | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.profile.get()
      .then((p) => {
        const stored = parse(p.business_hours);
        setHours(stored);
        setEnabled(Boolean(stored));
      })
      .catch(() => { /* leave the card in its unset state rather than erroring the page */ })
      .finally(() => setLoading(false));
  }, []);

  async function save(next: BusinessHours | null) {
    setSaving(true);
    try {
      await api.profile.setBusinessHours(next);
      setHours(next);
      toast.success(next ? 'Working hours saved' : 'Using the project default');
    } catch (e) {
      // The server validates too, so a rejection here is a real message worth
      // showing rather than a generic failure.
      toast.error('Could not save working hours', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  function toggle(on: boolean) {
    setEnabled(on);
    if (on) {
      setHours(hours ?? DEFAULT_BUSINESS_HOURS);
    } else {
      void save(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Working hours</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="own-hours">Use my own hours</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Overrides the project's hours for your timers and tracked time.
            </p>
          </div>
          <Switch id="own-hours" checked={enabled} onCheckedChange={toggle} disabled={loading || saving} />
        </div>

        {enabled && hours ? (
          <>
            <BusinessHoursFields value={hours} onChange={setHours} idPrefix="own" />
            <Button size="sm" onClick={() => void save(hours)} disabled={saving}>
              {saving ? 'Saving…' : 'Save working hours'}
            </Button>
          </>
        ) : (
          !loading && <BusinessHoursUnsetNotice scope="personal" />
        )}
      </CardContent>
    </Card>
  );
}
