import React from 'react';
import { Paperclip } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface RequestCountBadgeProps {
  count: number;
  /** Marks a count that arrived by merge rather than directly. */
  merged?: boolean;
}

export const RequestCountBadge: React.FC<RequestCountBadgeProps> = ({ count, merged = false }) => (
  <Badge
    variant="secondary"
    className={merged ? 'bg-warning-muted text-warning-foreground' : 'bg-primary-muted text-accent-foreground'}
  >
    {count} request{count !== 1 ? 's' : ''}
    {merged && <Paperclip className="size-3" aria-label="from a merge" />}
  </Badge>
);
