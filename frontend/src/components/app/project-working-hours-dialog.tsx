/**
 * A project's working hours — the default everyone on it inherits.
 *
 * This is the value the timer needs most. Without it there is no defensible
 * boundary for a timer somebody left running, so the segment is stopped with
 * no time logged at all; with it, the timer closes at the end of that working
 * day and keeps the hours up to it.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { BusinessHours, Project } from '@/lib/types';
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

export function ProjectWorkingHoursDialog({
  project,
  onOpenChange,
  onSaved,
}: {
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [hours, setHours] = useState<BusinessHours | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHours(parse(project?.business_hours));
  }, [project]);

  async function save(next: BusinessHours | null) {
    if (!project) return;
    setSaving(true);
    try {
      await api.projects.setBusinessHours(project.id, next);
      toast.success(next ? `Working hours saved for ${project.name}` : `Working hours cleared for ${project.name}`);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error('Could not save working hours', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Working hours{project ? ` — ${project.name}` : ''}</DialogTitle>
          <DialogDescription>
            Used to bound timers left running and to measure time spent in progress.
            Anyone can override this for themselves in Settings.
          </DialogDescription>
        </DialogHeader>

        {hours ? (
          <BusinessHoursFields value={hours} onChange={setHours} idPrefix="project" />
        ) : (
          <div className="space-y-3">
            <BusinessHoursUnsetNotice scope="project" />
            <Button variant="outline" size="sm" onClick={() => setHours(DEFAULT_BUSINESS_HOURS)}>
              Set working hours
            </Button>
          </div>
        )}

        <DialogFooter>
          {hours && parse(project?.business_hours) && (
            <Button variant="ghost" onClick={() => void save(null)} disabled={saving}>
              Clear
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void save(hours)} disabled={saving || !hours}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
