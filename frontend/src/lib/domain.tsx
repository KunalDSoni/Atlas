// Shared domain vocabulary: labels, colours, and icons for issue metadata.
// Every screen renders status/type/priority through here so they never drift apart.

import {
  ArrowDown, ArrowUp, Bug, ChevronsUp, Bookmark, CheckSquare, LifeBuoy, ListChecks, Minus, Zap,
} from 'lucide-react';
import type { IssueStatus, IssueType, LinkType, Priority, Role, SprintStatus } from './types';

export const STATUSES: IssueStatus[] = ['todo', 'in_progress', 'blocked', 'in_review', 'done'];

export const STATUS_LABEL: Record<IssueStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  in_review: 'In Review',
  done: 'Done',
};

/** Column accent on the board — also drives the status pill. */
export const STATUS_TONE: Record<IssueStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-primary-muted text-accent-foreground',
  blocked: 'bg-destructive-muted text-destructive',
  in_review: 'bg-info-muted text-info',
  done: 'bg-success-muted text-success',
};

/** Pill tone by workflow category, for custom statuses with no built-in tone. */
export const CATEGORY_TONE: Record<string, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-primary-muted text-accent-foreground',
  done: 'bg-success-muted text-success',
};

/** Label for any status key: built-in name, else humanized key ("code_review" → "Code Review"). */
export function statusLabel(status: string, custom?: { key: string; label: string }[]) {
  const hit = custom?.find((s) => s.key === status);
  if (hit) return hit.label;
  return STATUS_LABEL[status] ?? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Tone for any status key: built-in tone, else category tone, else muted. */
export function statusTone(status: string, custom?: { key: string; category: string }[]) {
  if (STATUS_TONE[status]) return STATUS_TONE[status];
  const hit = custom?.find((s) => s.key === status);
  return (hit && CATEGORY_TONE[hit.category]) || 'bg-muted text-muted-foreground';
}

// 'request' is a service desk request (epic 40 added it to issues.type). It is
// created through the help center rather than the issue composer, so it never
// appears in a type picker — but it does reach every surface that renders an
// issue, which is why it needs a label, icon and colour like any other type.
export const TYPE_LABEL: Record<IssueType, string> = {
  story: 'Story',
  bug: 'Bug',
  task: 'Task',
  epic: 'Epic',
  subtask: 'Subtask',
  request: 'Request',
};

export const TYPE_ICON: Record<IssueType, typeof Bug> = {
  story: Bookmark,
  bug: Bug,
  task: CheckSquare,
  epic: Zap,
  subtask: ListChecks,
  request: LifeBuoy,
};

export const TYPE_COLOR: Record<IssueType, string> = {
  story: 'text-success',
  bug: 'text-destructive',
  task: 'text-primary',
  epic: 'text-purple-500',
  subtask: 'text-sky-500',
  request: 'text-amber-500',
};

export const PRIORITIES: Priority[] = ['highest', 'high', 'medium', 'low'];

export const PRIORITY_LABEL: Record<Priority, string> = {
  highest: 'Highest',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const PRIORITY_ICON: Record<Priority, typeof ArrowUp> = {
  highest: ChevronsUp,
  high: ArrowUp,
  medium: Minus,
  low: ArrowDown,
};

export const PRIORITY_COLOR: Record<Priority, string> = {
  highest: 'text-destructive',
  high: 'text-destructive',
  medium: 'text-warning',
  low: 'text-muted-foreground',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  board_admin: 'Board Admin',
  user: 'User',
  client: 'Client',
};

export const SPRINT_TONE: Record<SprintStatus, string> = {
  planning: 'bg-muted text-muted-foreground',
  active: 'bg-success-muted text-success',
  completed: 'bg-muted text-muted-foreground',
};

export function canManageSprints(role?: Role) {
  return role === 'admin' || role === 'board_admin';
}
/** Mirrors `requireBoardAdmin` on POST /api/projects. */
export function canCreateProjects(role?: Role) {
  return role === 'admin' || role === 'board_admin';
}
export function canCreateIssues(role?: Role) {
  return role === 'admin' || role === 'board_admin' || role === 'user';
}
export function canDragIssues(role?: Role) {
  return canCreateIssues(role);
}
export function isAdmin(role?: Role) {
  return role === 'admin';
}

export const LINK_TYPES: LinkType[] = ['relates_to', 'blocks', 'is_blocked_by', 'duplicates', 'is_duplicated_by'];

/** A link row is shared by both issues, so each type reads differently per side. */
export const LINK_TYPE_LABEL: Record<LinkType, { out: string; in: string }> = {
  relates_to: { out: 'relates to', in: 'relates to' },
  blocks: { out: 'blocks', in: 'is blocked by' },
  is_blocked_by: { out: 'is blocked by', in: 'blocks' },
  duplicates: { out: 'duplicates', in: 'is duplicated by' },
  is_duplicated_by: { out: 'is duplicated by', in: 'duplicates' },
};

/** Named epic badge colors. Full literal class strings so Tailwind's scanner sees them. */
export const EPIC_COLORS: Record<string, { label: string; chip: string; swatch: string }> = {
  purple: { label: 'Purple', chip: 'bg-purple-500/15 text-purple-700 dark:text-purple-300', swatch: 'bg-purple-500' },
  blue:   { label: 'Blue',   chip: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',       swatch: 'bg-blue-500' },
  teal:   { label: 'Teal',   chip: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',       swatch: 'bg-teal-500' },
  green:  { label: 'Green',  chip: 'bg-green-500/15 text-green-700 dark:text-green-300',    swatch: 'bg-green-500' },
  yellow: { label: 'Yellow', chip: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300', swatch: 'bg-yellow-500' },
  orange: { label: 'Orange', chip: 'bg-orange-500/15 text-orange-700 dark:text-orange-300', swatch: 'bg-orange-500' },
  red:    { label: 'Red',    chip: 'bg-red-500/15 text-red-700 dark:text-red-300',          swatch: 'bg-red-500' },
  pink:   { label: 'Pink',   chip: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',       swatch: 'bg-pink-500' },
};

export const DEFAULT_EPIC_COLOR = 'purple';

export function epicColor(name?: string | null) {
  return EPIC_COLORS[name ?? ''] ?? EPIC_COLORS[DEFAULT_EPIC_COLOR];
}
