import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Whether the server has an Anthropic key configured. Cached in-module so the
// status endpoint is hit at most once per page load; AI affordances gate on this.
let cached: boolean | null = null;
const listeners = new Set<(v: boolean) => void>();

export function useAIEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(cached ?? false);

  useEffect(() => {
    if (cached !== null) {
      setEnabled(cached);
      return;
    }
    listeners.add(setEnabled);
    api.ai.status()
      .then((s) => { cached = s.enabled; listeners.forEach((l) => l(s.enabled)); })
      .catch(() => { cached = false; listeners.forEach((l) => l(false)); });
    return () => { listeners.delete(setEnabled); };
  }, []);

  return enabled;
}
