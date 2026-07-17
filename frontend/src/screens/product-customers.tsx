import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { PbCompany, PbCustomer } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { TIER_CLASS, TIER_LABELS, TIER_OPTIONS, TIER_WEIGHT } from '@/lib/product';
import { cn } from '@/lib/utils';

function formatArr(arr: number | null): string {
  if (arr == null) return '—';
  if (arr >= 1000) return `$${(arr / 1000).toFixed(arr % 1000 === 0 ? 0 : 1)}k`;
  return `$${arr}`;
}

export default function ProductCustomersScreen() {
  const [companies, setCompanies] = useState<PbCompany[]>([]);
  const [customers, setCustomers] = useState<PbCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companyOpen, setCompanyOpen] = useState(false);
  const [companyForm, setCompanyForm] = useState({ name: '', tier: 'standard', arr: '' });
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', email: '', company_id: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [co, cu] = await Promise.all([api.product.companies(), api.product.customers()]);
      setCompanies(co);
      setCustomers(cu);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createCompany() {
    if (!companyForm.name.trim()) return;
    try {
      await api.product.createCompany({
        name: companyForm.name.trim(),
        tier: companyForm.tier,
        arr: companyForm.arr ? Number(companyForm.arr) : null,
      });
      setCompanyOpen(false);
      setCompanyForm({ name: '', tier: 'standard', arr: '' });
      toast.success('Company added');
      void load();
    } catch (e) {
      toast.error('Failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function createCustomer() {
    if (!customerForm.name.trim()) return;
    try {
      await api.product.createCustomer({
        name: customerForm.name.trim(),
        email: customerForm.email.trim() || undefined,
        company_id: customerForm.company_id || undefined,
      });
      setCustomerOpen(false);
      setCustomerForm({ name: '', email: '', company_id: '' });
      toast.success('Customer added');
      void load();
    } catch (e) {
      toast.error('Failed', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function removeCompany(id: string) {
    try { await api.product.removeCompany(id); toast.success('Company removed'); void load(); }
    catch (e) { toast.error('Failed', { description: e instanceof Error ? e.message : undefined }); }
  }
  async function removeCustomer(id: string) {
    try { await api.product.removeCustomer(id); toast.success('Customer removed'); void load(); }
    catch (e) { toast.error('Failed', { description: e instanceof Error ? e.message : undefined }); }
  }

  if (loading) return (<><PageHeader title="Customers" description="Companies and segments" /><RowsSkeleton /></>);
  if (error) return (<><PageHeader title="Customers" /><ErrorState message={error} onRetry={() => void load()} /></>);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Company tiers weight feature impact — strategic ×3, growth ×2, standard ×1"
        actions={(
          <>
            <Button variant="outline" onClick={() => setCustomerOpen(true)}><UserPlus className="size-4" /> Customer</Button>
            <Button onClick={() => setCompanyOpen(true)}><Plus className="size-4" /> Company</Button>
          </>
        )}
      />

      {companies.length === 0 && customers.length === 0 ? (
        <EmptyState icon={Building2} title="No companies yet" description="Add companies and customers to attribute feedback."
          action={<Button onClick={() => setCompanyOpen(true)}><Plus className="size-4" /> Add company</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {companies.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge className={cn('font-medium', TIER_CLASS[c.tier])}>{TIER_LABELS[c.tier]} ·×{TIER_WEIGHT[c.tier]}</Badge>
                    <span className="text-xs text-muted-foreground">{formatArr(c.arr)} ARR</span>
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={() => void removeCompany(c.id)}><Trash2 className="size-3.5" /></Button>
              </div>
              <div className="mt-3 space-y-1 border-t border-border pt-2">
                {customers.filter((cu) => cu.company_id === c.id).map((cu) => (
                  <div key={cu.id} className="group flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{cu.name}{cu.email ? <span className="text-muted-foreground"> · {cu.email}</span> : ''}</span>
                    <button className="text-muted-foreground opacity-0 transition group-hover:opacity-100" onClick={() => void removeCustomer(cu.id)}><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
                {customers.filter((cu) => cu.company_id === c.id).length === 0 && (
                  <p className="text-xs text-muted-foreground">No contacts yet.</p>
                )}
              </div>
            </Card>
          ))}

          {customers.some((cu) => !cu.company_id) && (
            <Card className="p-4">
              <p className="font-semibold text-muted-foreground">Unaffiliated</p>
              <div className="mt-3 space-y-1 border-t border-border pt-2">
                {customers.filter((cu) => !cu.company_id).map((cu) => (
                  <div key={cu.id} className="group flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{cu.name}{cu.email ? <span className="text-muted-foreground"> · {cu.email}</span> : ''}</span>
                    <button className="text-muted-foreground opacity-0 transition group-hover:opacity-100" onClick={() => void removeCustomer(cu.id)}><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Company dialog */}
      <Dialog open={companyOpen} onOpenChange={setCompanyOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add company</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Company name" value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Select value={companyForm.tier} onValueChange={(v) => setCompanyForm({ ...companyForm, tier: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIER_OPTIONS.map((t) => <SelectItem key={t} value={t}>{TIER_LABELS[t]} (×{TIER_WEIGHT[t]})</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" placeholder="ARR ($)" value={companyForm.arr} onChange={(e) => setCompanyForm({ ...companyForm, arr: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCompanyOpen(false)}>Cancel</Button>
            <Button onClick={() => void createCompany()} disabled={!companyForm.name.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer dialog */}
      <Dialog open={customerOpen} onOpenChange={setCustomerOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add customer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Name" value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} />
            <Input placeholder="Email" value={customerForm.email} onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })} />
            <Select value={customerForm.company_id || 'none'} onValueChange={(v) => setCustomerForm({ ...customerForm, company_id: v === 'none' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Company" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No company</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCustomerOpen(false)}>Cancel</Button>
            <Button onClick={() => void createCustomer()} disabled={!customerForm.name.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
