import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LifeBuoy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import type { RequestField, RequestType } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';

/** Renders one field of a request type's schema. */
function FieldInput({ field, value, onChange }: {
  field: RequestField;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `field-${field.key}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {field.type === 'textarea' && (
        <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={4} />
      )}
      {field.type === 'text' && (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.type === 'date' && (
        <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.type === 'select' && (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id}><SelectValue placeholder="Choose one" /></SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export default function HelpCenterScreen() {
  const navigate = useNavigate();
  const [types, setTypes] = useState<RequestType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<RequestType | null>(null);
  const [summary, setSummary] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTypes(await api.help.requestTypes());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the help center');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function open(t: RequestType) {
    setActive(t);
    setSummary('');
    setValues({});
  }

  // Mirrors the server's rule so the customer sees the problem before a round
  // trip. The server re-validates regardless — this is convenience, not trust.
  const missing = active
    ? active.fields.filter((f) => f.required && !(values[f.key] ?? '').trim()).map((f) => f.label)
    : [];
  const canSubmit = !!summary.trim() && missing.length === 0 && !submitting;

  async function submit() {
    if (!active) return;
    setSubmitting(true);
    try {
      const created = await api.help.raise({
        request_type_id: active.id,
        summary: summary.trim(),
        fields: values,
      });
      toast.success(`${created.key} raised`);
      setActive(null);
      navigate(`/help/requests/${created.key}`);
    } catch (e) {
      toast.error('Could not raise the request', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-4xl p-6"><RowsSkeleton /></div>;
  if (error) {
    return <div className="mx-auto max-w-4xl p-6"><ErrorState message={error} onRetry={load} /></div>;
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHeader
        title="How can we help?"
        description="Choose the kind of request you want to raise"
        actions={<Button variant="ghost" onClick={() => navigate('/help/requests')}>My requests</Button>}
      />
      {types.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          title="No request types yet"
          description="An administrator needs to create one before requests can be raised."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {types.map((t) => (
            <Card
              key={t.id}
              className="cursor-pointer p-5 transition hover:border-primary"
              onClick={() => open(t)}
            >
              <h3 className="font-semibold">{t.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{active?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="summary">
                Summary<span className="ml-1 text-destructive">*</span>
              </Label>
              <Input
                id="summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="A one-line description"
              />
            </div>
            {active?.fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={values[f.key] ?? ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
            <Button disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? 'Sending…' : 'Send request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
