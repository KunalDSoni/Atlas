import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { CustomField } from '@/lib/types';

const NONE = '__none__';

/** Renders and edits an issue's custom field values. Saves each field on change. */
export function CustomFieldsEditor({
  issueId,
  fields,
  canEdit,
  onSaved,
}: {
  issueId: string;
  fields: CustomField[];
  canEdit: boolean;
  onSaved: (fieldId: string, value: string | null) => void;
}) {
  if (!fields.length) return null;

  async function save(fieldId: string, value: string) {
    try {
      await api.customFields.setValues(issueId, { [fieldId]: value });
      onSaved(fieldId, value === '' ? null : value);
    } catch (e) {
      toast.error('Could not save field', { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Custom fields</h3>
      <div className="space-y-2.5">
        {fields.map((f) => {
          const id = f.field_id ?? f.id;
          const value = f.value ?? '';
          return (
            <div key={id} className="grid grid-cols-[120px_1fr] items-center gap-2">
              <label className="truncate text-xs text-muted-foreground" title={f.name}>{f.name}</label>
              {f.field_type === 'select' ? (
                <Select value={value || NONE} onValueChange={(v) => void save(id, v === NONE ? '' : v)} disabled={!canEdit}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>—</SelectItem>
                    {f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : f.field_type === 'checkbox' ? (
                <Switch checked={value === '1'} disabled={!canEdit} onCheckedChange={(v) => void save(id, v ? 'true' : 'false')} />
              ) : (
                <Input
                  type={f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : 'text'}
                  className="h-8"
                  defaultValue={value}
                  disabled={!canEdit}
                  onBlur={(e) => { if (e.target.value !== value) void save(id, e.target.value); }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
