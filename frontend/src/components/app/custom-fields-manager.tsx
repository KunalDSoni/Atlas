import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { CustomField, CustomFieldType } from '@/lib/types';

const TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
];

/** Define per-project custom fields (board-admin surface). */
export function CustomFieldsManager({
  projectId,
  projectName,
  open,
  onOpenChange,
}: {
  projectId: string | null;
  projectName?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [optionsText, setOptionsText] = useState('');

  const load = useCallback(() => {
    if (!projectId) return;
    api.customFields.list(projectId).then(setFields).catch(() => setFields([]));
  }, [projectId]);
  useEffect(() => { if (open) load(); }, [open, load]);

  async function create() {
    if (!projectId || !name.trim()) return;
    const options = type === 'select' ? optionsText.split(',').map((o) => o.trim()).filter(Boolean) : undefined;
    if (type === 'select' && (!options || options.length === 0)) { toast.info('Add comma-separated options for a select field.'); return; }
    try {
      await api.customFields.create(projectId, { name: name.trim(), field_type: type, options });
      setName(''); setOptionsText(''); setType('text');
      load();
    } catch (e) {
      toast.error('Could not create field', { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Custom fields{projectName ? ` — ${projectName}` : ''}</DialogTitle>
          <DialogDescription>Add fields that appear on every issue in this project.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {fields.length === 0 ? (
            <p className="rounded-md border border-dashed border-border py-4 text-center text-xs text-muted-foreground">No custom fields yet.</p>
          ) : (
            <ul className="divide-y divide-border-light rounded-lg border border-border">
              {fields.map((f) => (
                <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <Badge variant="secondary">{f.field_type}</Badge>
                  {f.field_type === 'select' && <span className="truncate text-xs text-muted-foreground">{f.options.join(', ')}</span>}
                  <Button variant="ghost" size="icon" className="size-7 text-muted-foreground"
                    onClick={async () => { await api.customFields.remove(f.id); load(); }} aria-label="Delete field">
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="flex gap-2">
            <Input placeholder="Field name" value={name} onChange={(e) => setName(e.target.value)} />
            <Select value={type} onValueChange={(v) => setType(v as CustomFieldType)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {type === 'select' && (
            <Input className="mt-2" placeholder="Options, comma-separated (e.g. Low, Medium, High)" value={optionsText} onChange={(e) => setOptionsText(e.target.value)} />
          )}
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={() => void create()} disabled={!name.trim()}><Plus className="size-4" /> Add field</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
