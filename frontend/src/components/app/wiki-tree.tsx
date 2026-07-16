import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronRight, FileText } from 'lucide-react';
import type { WikiTreeNode } from '@/lib/types';
import { cn } from '@/lib/utils';

/** One node of the page tree; children collapse/expand. */
function TreeItem({ node, depth, activeId }: { node: WikiTreeNode; depth: number; activeId?: string }) {
  // Expand by default on the path to the active page, and at the top level.
  const [open, setOpen] = useState(() => depth === 0 || containsActive(node, activeId));
  const hasChildren = node.children?.length > 0;

  return (
    <li>
      <div className="flex items-center">
        {hasChildren ? (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? `Collapse ${node.title}` : `Expand ${node.title}`}
            aria-expanded={open}
            className="grid size-5 shrink-0 place-items-center rounded text-faint hover:bg-muted hover:text-foreground"
            style={{ marginLeft: depth * 12 }}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-5 shrink-0" style={{ marginLeft: depth * 12 }} />
        )}
        <NavLink
          to={`/wiki/page/${node.id}`}
          className={({ isActive }) =>
            cn(
              'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors',
              isActive
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          <FileText className="size-3.5 shrink-0" />
          <span className="truncate">{node.title}</span>
        </NavLink>
      </div>

      {hasChildren && open && (
        <ul>
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} depth={depth + 1} activeId={activeId} />
          ))}
        </ul>
      )}
    </li>
  );
}

function containsActive(node: WikiTreeNode, activeId?: string): boolean {
  if (!activeId) return false;
  if (node.id === activeId) return true;
  return (node.children ?? []).some((c) => containsActive(c, activeId));
}

export function WikiTree({ nodes, activeId }: { nodes: WikiTreeNode[]; activeId?: string }) {
  if (!nodes.length) {
    return <p className="px-2 py-3 text-xs text-muted-foreground">No pages yet.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {nodes.map((n) => (
        <TreeItem key={n.id} node={n} depth={0} activeId={activeId} />
      ))}
    </ul>
  );
}
