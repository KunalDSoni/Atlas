// Small Atlas-specific building blocks layered on top of the shadcn primitives.

import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';
import {
  PRIORITY_COLOR, PRIORITY_ICON, PRIORITY_LABEL, STATUS_LABEL, STATUS_TONE,
  TYPE_COLOR, TYPE_ICON, TYPE_LABEL, epicColor,
} from '@/lib/domain';
import type { IssueStatus, IssueType, Priority } from '@/lib/types';

/** Avatar tinted with the user's stored colour; falls back to initials. */
export function UserAvatar({
  name,
  color,
  className,
}: {
  name: string | null | undefined;
  color?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn('size-6', className)}>
      <AvatarFallback
        className="text-[10px] font-semibold text-white"
        style={{ backgroundColor: color || 'var(--muted-foreground)' }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

export function StatusPill({ status, className }: { status: IssueStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        STATUS_TONE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Tinted epic chip shown on board cards and backlog rows. */
export function EpicBadge({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  return (
    <span className={cn('inline-block max-w-32 truncate rounded px-1.5 py-0.5 text-[10px] font-semibold', epicColor(color).chip, className)}>
      {name}
    </span>
  );
}

/** Compact "done/total" subtask rollup shown on board cards and backlog rows. */
export function SubtaskProgress({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  if (total === 0) return null;
  const Icon = TYPE_ICON.subtask;
  return (
    <span
      aria-label={`${done} of ${total} subtasks done`}
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums',
        done === total ? 'text-success' : 'text-muted-foreground',
        className,
      )}
    >
      <Icon className="size-3" />
      {done}/{total}
    </span>
  );
}

export function TypeIcon({ type, className }: { type: IssueType; className?: string }) {
  const Icon = TYPE_ICON[type] ?? TYPE_ICON.task;
  return <Icon aria-label={TYPE_LABEL[type]} className={cn('size-4 shrink-0', TYPE_COLOR[type], className)} />;
}

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const Icon = PRIORITY_ICON[priority] ?? PRIORITY_ICON.medium;
  return (
    <Icon
      aria-label={`${PRIORITY_LABEL[priority]} priority`}
      className={cn('size-4 shrink-0', PRIORITY_COLOR[priority], className)}
    />
  );
}

export function LabelChip({ children }: { children: ReactNode }) {
  return (
    <Badge variant="secondary" className="rounded-sm px-1.5 py-0 text-[11px] font-medium">
      {children}
    </Badge>
  );
}

/** Consistent page heading across every screen. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center">
      {Icon && <Icon className="mb-3 size-8 text-faint" />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive-muted px-4 py-3 text-sm text-destructive">
      <p className="font-medium">Something went wrong</p>
      <p className="mt-0.5 opacity-90">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 font-medium underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}

export function CardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-lg" />
      ))}
    </div>
  );
}

export function RowsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-11 rounded-md" />
      ))}
    </div>
  );
}
