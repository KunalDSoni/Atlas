import { createContext, useContext, useEffect, type ReactNode } from 'react';

// Atlas is light-theme only. The provider is kept as a thin shim so existing
// consumers of useTheme() keep working, but the theme is always 'light' and
// setTheme is a no-op — there is no dark mode to switch to.
type Theme = 'light';

interface ThemeContextValue {
  theme: Theme;
  resolved: 'light';
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Guard against any stale `.dark` class from a previous build or localStorage.
  useEffect(() => {
    document.documentElement.classList.remove('dark');
  }, []);

  const value: ThemeContextValue = { theme: 'light', resolved: 'light', setTheme: () => {} };
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
