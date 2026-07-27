import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { OutcomeVerdict, PbFeatureOutcome } from '@/lib/types';
import { OUTCOME_VERDICT_LABELS, OUTCOME_VERDICT_OPTIONS } from '@/lib/product';

const NO_VERDICT = '__no_verdict__';

interface OutcomeDialogProps {
  featureId: string;
  featureName: string;
  outcome?: PbFeatureOutcome | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (outcome: PbFeatureOutcome) => void;
  prompted?: boolean;
}

export function OutcomeDialog({
  featureId, featureName, outcome, open, onOpenChange, onSaved, prompted = false,
}: OutcomeDialogProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    metric: '', target: '', baseline: '', measured: '', verdict: NO_VERDICT, notes: '',
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      metric: outcome?.metric ?? '',
      target: outcome?.target ?? '',
      baseline: outcome?.baseline ?? '',
      measured: outcome?.measured ?? '',
      verdict: outcome?.verdict ?? NO_VERDICT,
      notes: outcome?.notes ?? '',
    });
  }, [open, outcome, featureId]);

  async function save() {
    if (prompted && !form.metric.trim()) return;
    setSaving(true);
    try {
      const saved = await api.product.saveOutcome(featureId, {
        metric: form.metric,
        target: form.target,
        baseline: form.baseline,
        measured: form.measured,
        verdict: form.verdict === NO_VERDICT ? null : form.verdict as OutcomeVerdict,
        notes: form.notes,
      });
      onSaved(saved);
      onOpenChange(false);
      toast.success(saved.verdict ? 'Launch review saved' : 'Success measure saved');
    } catch (e) {
      toast.error('Could not save the outcome', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{prompted ? 'What should this launch change?' : `Review ${featureName}`}</DialogTitle>
          <DialogDescription>
            {prompted
              ? 'The feature is launched. Add a success measure now, or close this and come back later—the launch is already saved.'
              : 'Record the measure in the words your team uses. Atlas does not invent telemetry or turn free text into a fake chart.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block text-sm font-medium">Success metric
            <Input className="mt-1.5" value={form.metric}
              onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
              placeholder="e.g. Weekly active teams" autoFocus />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Baseline
              <Input className="mt-1.5" value={form.baseline}
                onChange={(e) => setForm((f) => ({ ...f, baseline: e.target.value }))}
                placeholder="120 teams" />
            </label>
            <label className="block text-sm font-medium">Target
              <Input className="mt-1.5" value={form.target}
                onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
                placeholder="180 teams within 60 days" />
            </label>
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Launch review</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">Measured result
                <Input className="mt-1.5" value={form.measured}
                  onChange={(e) => setForm((f) => ({ ...f, measured: e.target.value }))}
                  placeholder="166 teams after 60 days" />
              </label>
              <label className="block text-sm font-medium">Verdict
                <Select value={form.verdict} onValueChange={(verdict) => setForm((f) => ({ ...f, verdict }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_VERDICT}>Not reviewed</SelectItem>
                    {OUTCOME_VERDICT_OPTIONS.map((verdict) => (
                      <SelectItem key={verdict} value={verdict}>{OUTCOME_VERDICT_LABELS[verdict]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>

          <label className="block text-sm font-medium">Review notes
            <Textarea className="mt-1.5 min-h-24" value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="What did we learn, and what happens next?" />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || (prompted && !form.metric.trim())}>
            {saving ? 'Saving…' : form.verdict === NO_VERDICT ? 'Save measure' : 'Save review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
