import { useCallback, useEffect, useState } from 'react';
import { Headphones } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useProjects } from '@/hooks/use-projects';
import type { ServiceDeskReport } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, RowsSkeleton } from '@/components/app/primitives';
import { HBarChart, DataTable } from '@/components/app/charts';
import { formatDuration } from '@/lib/format';

/**
 * The honesty rule, inherited from the flow-metrics spec: every panel counts
 * only rows we actually store. Nothing is backfilled for requests raised before
 * a goal, an article or a rating existed — so each panel says so rather than
 * implying it covers all time.
 */
const SINCE = 'Since tracking began';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function ServiceDeskReportScreen() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id ?? null;

  const [report, setReport] = useState<ServiceDeskReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await api.serviceDeskReport(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the report');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  if (!currentProject) return <EmptyState icon={Headphones} title="No project selected" />;
  if (loading) return <RowsSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!report) return null;

  const { deflection, csat, median_minutes, volume_by_type, sla_breach_by_type } = report;
  const ratedTotal = csat.count;

  return (
    <>
      <PageHeader
        title="Service desk report"
        description={`${currentProject.name} — every panel counts only recorded rows, since tracking began`}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Deflection rate"
          value={pct(deflection.rate)}
          hint={`${deflection.helped} helped ÷ ${deflection.helped + deflection.requests_raised} total`}
        />
        <Stat
          label="CSAT"
          value={csat.average === null ? '—' : csat.average.toFixed(2)}
          hint={ratedTotal === 0 ? 'No ratings yet' : `${ratedTotal} rating${ratedTotal === 1 ? '' : 's'}`}
        />
        <Stat
          label="Median first response"
          value={median_minutes.first_response === null ? '—' : formatDuration(median_minutes.first_response)}
          hint="Stopped clocks only"
        />
        <Stat
          label="Median resolution"
          value={median_minutes.resolution === null ? '—' : formatDuration(median_minutes.resolution)}
          hint="Stopped clocks only"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Request volume by type</h2>
          {volume_by_type.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <HBarChart data={volume_by_type.map((v) => ({ label: v.name, value: v.count }))} />
          )}
          <p className="mt-2 text-xs text-muted-foreground">{SINCE}</p>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">SLA breach rate by request type</h2>
          {sla_breach_by_type.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No SLA clocks yet — set a goal on a request type to start measuring.
            </p>
          ) : (
            <DataTable
              caption="SLA breach rate by request type"
              columns={['Request type', 'Breached', 'Clocks', 'Rate']}
              rows={sla_breach_by_type.map((r) => [r.name, r.breached, r.total, pct(r.rate)])}
            />
          )}
          <p className="mt-2 text-xs text-muted-foreground">{SINCE}</p>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Satisfaction distribution</h2>
          {ratedTotal === 0 ? (
            <p className="text-sm text-muted-foreground">No ratings yet.</p>
          ) : (
            <HBarChart
              colorIndex={1}
              data={[5, 4, 3, 2, 1].map((star) => ({
                label: `${star} ★`,
                value: csat.distribution[String(star)] ?? 0,
              }))}
            />
          )}
          <p className="mt-2 text-xs text-muted-foreground">{SINCE}</p>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Deflection</h2>
          <p className="text-sm text-muted-foreground">
            {deflection.helped} customer{deflection.helped === 1 ? '' : 's'} said an article solved
            the problem; {deflection.requests_raised} went on to raise a request.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Both numbers are rows we store, so the denominator needs no form-open tracking. {SINCE}.
          </p>
        </Card>
      </div>
    </>
  );
}
