import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { useTheme } from '@/context/theme-provider';
import type { Settings } from '@/lib/types';

interface SettingsContextValue {
  settings: Settings | null;
  loading: boolean;
  /** Optimistic update; rolls back and toasts if the server rejects it. */
  patch: (body: Partial<Settings>) => Promise<void>;
  /** Denser spacing in lists and boards. */
  compact: boolean;
  /** Page size for paginated lists. */
  pageSize: number;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setSettings(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await api.settings.get();
        if (cancelled) return;
        setSettings(s);

        // The account's saved theme is the source of truth on sign-in, so the
        // preference follows the user across browsers instead of being stranded
        // in one localStorage.
        if (s.theme && s.theme !== theme && ['light', 'dark', 'system'].includes(s.theme)) {
          setTheme(s.theme as 'light' | 'dark' | 'system');
        }
      } catch {
        // Settings are a preference layer — the app stays usable on defaults.
        if (!cancelled) setSettings(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the user only: re-running when `theme` changes would
    // fight the user's own toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const patch = useCallback(
    async (body: Partial<Settings>) => {
      if (!settings) return;
      const previous = settings;
      setSettings({ ...settings, ...body });
      try {
        await api.settings.update(body);
      } catch (e) {
        setSettings(previous);
        toast.error('Could not save setting', { description: e instanceof Error ? e.message : undefined });
      }
    },
    [settings],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      loading,
      patch,
      compact: Boolean(settings?.compact_view),
      pageSize: settings?.items_per_page || 25,
    }),
    [settings, loading, patch],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
