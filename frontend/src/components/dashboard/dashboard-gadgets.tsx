import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertCircle, ArrowDown, ArrowUp, BarChart3, CheckCircle2, CircleDot,
  Gauge, ListTodo, Maximize2, Minimize2, PieChart, Trash2, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { HBarChart } from '@/components/app/charts';
import { PriorityIcon, StatusPill, TypeIcon, UserAvatar } from '@/components/app/primitives';
import { STATUS_LABEL, TYPE_LABEL, statusLabel } from '@/lib/domain';
import { timeAgo } from '@/lib/format';
import { issueUrl, projectUrl } from '@/lib/urls';
import type {
  DashboardGadget, DashboardGadgetKey, Issue, ProjectStats, Sprint,
} from '@/lib/types';

interface GadgetDefinition {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  defaultSpan: 1 | 2;
}

export const GADGET_CATALOG: Record<DashboardGadgetKey, GadgetDefinition> = {
  summary: {
    title: 'Project snapshot',
    description: 'Headline issue counts for this project.',
    icon: Gauge,
    defaultSpan: 2,
  },
  status: {
    title: 'Progress by status',
    description: 'Completion and issue distribution by workflow status.',
    icon: BarChart3,
    defaultSpan: 1,
  },
  active_sprint: {
    title: 'Active sprint',
    description: 'Delivery progress for the sprint in flight.',
    icon: Activity,
    defaultSpan: 1,
  },
  recent_activity: {
    title: 'Recently updated',
    description: 'The latest issue changes in this project.',
    icon: ListTodo,
    defaultSpan: 2,
  },
  priority_breakdown: {
    title: 'Priority breakdown',
    description: 'Issue volume by priority.',
    icon: AlertCircle,
    defaultSpan: 1,
  },
  type_breakdown: {
    title: 'Issue types',
    description: 'Issue volume by work type.',
    icon: PieChart,
    defaultSpan: 1,
  },
  team_workload: {
    title: 'Team workload',
    description: 'Assigned work by person, including unassigned issues.',
    icon: Users,
    defaultSpan: 2,
  },
};

export const DEFAULT_DASHBOARD_LAYOUT: DashboardGadget[] = [
  { key: 'summary', span: 2 },
  { key: 'status', span: 1 },
  { key: 'active_sprint', span: 1 },
  { key: 'recent_activity', span: 2 },
];

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border-light bg-muted/20 p-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-md ${tone}`}>
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold leading-none tabular-nums">{value}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

function GadgetFrame({
  gadget,
  index,
  total,
  editing,
  onMove,
  onRemove,
  onToggleSpan,
  children,
}: {
  gadget: DashboardGadget;
  index: number;
  total: number;
  editing: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onToggleSpan: () => void;
  children: ReactNode;
}) {
  const definition = GADGET_CATALOG[gadget.key];
  const Icon = definition.icon;
  return (
    <Card
      data-testid={`dashboard-gadget-${gadget.key}`}
      className={`h-full ${editing ? 'ring-1 ring-primary/25' : ''}`}
    >
      <CardHeader className={editing ? 'grid-cols-[minmax(0,1fr)_auto] items-start gap-3' : undefined}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-muted text-accent-foreground">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate text-sm font-semibold">{definition.title}</CardTitle>
            {editing && <p className="mt-1 text-xs text-muted-foreground">{definition.description}</p>}
          </div>
        </div>
        {editing && (
          <div className="flex shrink-0 items-center gap-1" aria-label={`${definition.title} controls`}>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${definition.title} up`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${definition.title} down`}
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Make ${definition.title} ${gadget.span === 1 ? 'full width' : 'half width'}`}
              onClick={onToggleSpan}
            >
              {gadget.span === 1 ? <Maximize2 /> : <Minimize2 />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${definition.title}`}
              onClick={onRemove}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SummaryGadget({ stats }: { stats: ProjectStats }) {
  const count = (status: string) => Number(stats.byStatus.find((item) => item.status === status)?.count || 0);
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Stat label="Total issues" value={Number(stats.total)} icon={ListTodo} tone="bg-primary-muted text-accent-foreground" />
      <Stat label="In progress" value={count('in_progress')} icon={CircleDot} tone="bg-info-muted text-info" />
      <Stat label="In review" value={count('in_review')} icon={AlertCircle} tone="bg-warning-muted text-warning" />
      <Stat label="Done" value={count('done')} icon={CheckCircle2} tone="bg-success-muted text-success" />
    </div>
  );
}

function StatusGadget({ stats }: { stats: ProjectStats }) {
  const total = Number(stats.total) || 0;
  const count = (status: string) => Number(stats.byStatus.find((item) => item.status === status)?.count || 0);
  const done = count('done');
  const rows = ['todo', 'in_progress', 'in_review', 'done'];
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-sm">
          <span className="font-medium">Overall completion</span>
          <span className="tabular-nums text-muted-foreground">
            {done}/{total} · {total ? Math.round((done / total) * 100) : 0}%
          </span>
        </div>
        <Progress value={total ? (done / total) * 100 : 0} className="h-2" />
      </div>
      <div className="space-y-2.5">
        {rows.map((status) => {
          const value = count(status);
          return (
            <div key={status} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-3">
              <span className="truncate text-xs text-muted-foreground">{STATUS_LABEL[status] ?? statusLabel(status)}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${total ? (value / total) * 100 : 0}%` }}
                />
              </div>
              <span className="text-right text-xs tabular-nums text-muted-foreground">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActiveSprintGadget({ sprints, projectKey }: { sprints: Sprint[]; projectKey: string }) {
  const sprint = sprints.find((item) => item.status === 'active');
  if (!sprint) return <p className="py-6 text-center text-sm text-muted-foreground">No active sprint.</p>;
  const issuePct = sprint.issue_count ? (sprint.done_count / sprint.issue_count) * 100 : 0;
  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">{sprint.name}</p>
        {sprint.goal && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{sprint.goal}</p>}
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
          <span>Issues completed</span>
          <span className="tabular-nums">{sprint.done_count}/{sprint.issue_count}</span>
        </div>
        <Progress value={issuePct} className="h-2" />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Story points</span>
        <span className="tabular-nums">{sprint.done_points}/{sprint.total_points}</span>
      </div>
      <Button asChild variant="outline" size="sm" className="w-full">
        <Link to={projectUrl(projectKey, 'sprints')}>View sprints</Link>
      </Button>
    </div>
  );
}

function RecentActivityGadget({ issues }: { issues: Issue[] }) {
  const recent = [...issues]
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
    .slice(0, 6);
  if (!recent.length) return <p className="py-6 text-center text-sm text-muted-foreground">No issues yet.</p>;
  return (
    <ul className="-mx-6 -mb-6 divide-y divide-border-light">
      {recent.map((issue) => (
        <li key={issue.id}>
          <Link
            to={issueUrl(issue.issue_key)}
            className="flex items-center gap-3 px-6 py-2.5 hover:bg-muted/50"
          >
            <TypeIcon type={issue.type} />
            <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{issue.issue_key}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
            <PriorityIcon priority={issue.priority} className="hidden sm:block" />
            <StatusPill status={issue.status} className="hidden shrink-0 md:inline-flex" />
            <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground lg:block">
              {timeAgo(issue.updated_at)}
            </span>
            {issue.assignee_name ? (
              <UserAvatar name={issue.assignee_name} color={issue.assignee_color} />
            ) : (
              <span className="size-6 shrink-0 rounded-full border border-dashed border-border" />
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PriorityGadget({ issues }: { issues: Issue[] }) {
  const order = ['highest', 'high', 'medium', 'low', 'lowest'];
  const counts = new Map<string, number>();
  issues.forEach((issue) => counts.set(issue.priority, (counts.get(issue.priority) || 0) + 1));
  const data = [...counts.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([label, value]) => ({ label: statusLabel(label), value }));
  return <HBarChart data={data} colorIndex={2} />;
}

function TypeGadget({ stats }: { stats: ProjectStats }) {
  const data = stats.byType
    .map((item) => ({ label: TYPE_LABEL[item.type] ?? statusLabel(item.type), value: Number(item.count) }))
    .sort((a, b) => b.value - a.value);
  return <HBarChart data={data} colorIndex={3} />;
}

function TeamWorkloadGadget({ stats, issues }: { stats: ProjectStats; issues: Issue[] }) {
  const unassigned = issues.filter((issue) => !issue.assignee_id).length;
  const data = stats.byAssignee.map((item) => ({ label: item.name, value: Number(item.count) }));
  if (unassigned) data.push({ label: 'Unassigned', value: unassigned });
  return <HBarChart data={data.sort((a, b) => b.value - a.value)} colorIndex={1} />;
}

function GadgetContent({
  gadget,
  stats,
  issues,
  sprints,
  projectKey,
}: {
  gadget: DashboardGadget;
  stats: ProjectStats;
  issues: Issue[];
  sprints: Sprint[];
  projectKey: string;
}) {
  switch (gadget.key) {
    case 'summary': return <SummaryGadget stats={stats} />;
    case 'status': return <StatusGadget stats={stats} />;
    case 'active_sprint': return <ActiveSprintGadget sprints={sprints} projectKey={projectKey} />;
    case 'recent_activity': return <RecentActivityGadget issues={issues} />;
    case 'priority_breakdown': return <PriorityGadget issues={issues} />;
    case 'type_breakdown': return <TypeGadget stats={stats} />;
    case 'team_workload': return <TeamWorkloadGadget stats={stats} issues={issues} />;
  }
}

export function DashboardGadgetCard({
  gadget,
  index,
  total,
  editing,
  stats,
  issues,
  sprints,
  projectKey,
  onMove,
  onRemove,
  onToggleSpan,
}: {
  gadget: DashboardGadget;
  index: number;
  total: number;
  editing: boolean;
  stats: ProjectStats;
  issues: Issue[];
  sprints: Sprint[];
  projectKey: string;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onToggleSpan: () => void;
}) {
  return (
    <GadgetFrame
      gadget={gadget}
      index={index}
      total={total}
      editing={editing}
      onMove={onMove}
      onRemove={onRemove}
      onToggleSpan={onToggleSpan}
    >
      <GadgetContent
        gadget={gadget}
        stats={stats}
        issues={issues}
        sprints={sprints}
        projectKey={projectKey}
      />
    </GadgetFrame>
  );
}
