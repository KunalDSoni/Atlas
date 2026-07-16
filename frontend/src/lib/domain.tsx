// Shared domain vocabulary: labels, colours, and icons for issue metadata.
// Every screen renders status/type/priority through here so they never drift apart.

import {
  ArrowDown, ArrowUp, Bug, ChevronsUp, Bookmark, CheckSquare, Minus,
} from 'lucide-react';
import type { IssueStatus, IssueType, LinkType, Priority, Role, SprintStatus } from './types';

export const STATUSES: IssueStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

export const STATUS_LABEL: Record<IssueStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

/** Column accent on the board — also drives the status pill. */
export const STATUS_TONE: Record<IssueStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-primary-muted text-accent-foreground',
  in_review: 'bg-info-muted text-info',
  done: 'bg-success-muted text-success',
};

export const TYPE_LABEL: Record<IssueType, string> = {
  story: 'Story',
  bug: 'Bug',
  task: 'Task',
};

export const TYPE_ICON: Record<IssueType, typeof Bug> = {
  story: Bookmark,
  bug: Bug,
  task: CheckSquare,
};

export const TYPE_COLOR: Record<IssueType, string> = {
  story: 'text-success',
  bug: 'text-destructive',
  task: 'text-primary',
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
  planned: 'bg-muted text-muted-foreground',
  active: 'bg-success-muted text-success',
  completed: 'bg-muted text-muted-foreground',
};

export function canManageSprints(role?: Role) {
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
