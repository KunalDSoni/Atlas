import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, clearToken, getToken, onUnauthorized, setToken } from '@/lib/api';
import type { User } from '@/lib/types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Start loading only if a token exists — otherwise we already know we're logged out.
  const [loading, setLoading] = useState(() => Boolean(getToken()));

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api.auth.me());
    } catch {
      // 401 clears the token in the client; anything else leaves us logged out too.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Restore the session on boot.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A rejected token anywhere in the app drops us to the login screen.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const login = useCallback(async (email: string, password: string) => {
    const authed = await api.auth.login(email, password);
    setToken(authed.token);
    const { token: _token, ...rest } = authed;
    setUser(rest as User);
  }, []);

  const logout = useCallback(async () => {
    // Nothing to sign out of: start the demo over instead.
    if (__ATLAS_DEMO__) {
      window.location.assign('/demo/');
      return;
    }
    try {
      await api.auth.logout();
    } catch {
      // Logging out locally matters even if the server call fails.
    }
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
