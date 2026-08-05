// Per-project workflow statuses (custom board columns). Falls back to the
// built-in five-status workflow while loading or when the API is unavailable.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { STATUSES, STATUS_LABEL } from '@/lib/domain';
import type { StatusCategory, WorkflowStatus } from '@/lib/types';

const DEFAULT_CATEGORY: Record<string, StatusCategory> = {
  todo: 'todo',
  in_progress: 'in_progress',
  blocked: 'in_progress',
  in_review: 'in_progress',
  done: 'done',
};

export function defaultWorkflow(projectId: string): WorkflowStatus[] {
  return STATUSES.map((key, i) => ({
    id: `default-${key}`,
    project_id: projectId,
    key,
    label: STATUS_LABEL[key],
    category: DEFAULT_CATEGORY[key] ?? 'in_progress',
    position: i,
    builtin: true,
  }));
}

export function useWorkflow(projectId: string | null | undefined) {
  const [statuses, setStatuses] = useState<WorkflowStatus[]>(projectId ? defaultWorkflow(projectId) : []);

  const reload = useCallback(async () => {
    if (!projectId) return;
    try {
      setStatuses(await api.workflow.list(projectId));
    } catch {
      setStatuses(defaultWorkflow(projectId));
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const keys = useMemo(() => statuses.map((s) => s.key), [statuses]);
  const label = useCallback(
    (key: string) => statuses.find((s) => s.key === key)?.label ?? key,
    [statuses],
  );
  const doneKeys = useMemo(
    () => statuses.filter((s) => s.category === 'done').map((s) => s.key),
    [statuses],
  );

  return { statuses, keys, label, doneKeys, reload };
}
