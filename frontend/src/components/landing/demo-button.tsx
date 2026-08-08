import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/auth-provider';
import { LANDING_COPY } from '@/lib/landing-content';

export function DemoButton({ variant = 'primary' }: { variant?: 'primary' | 'inverse' }) {
  const navigate = useNavigate();
  const { adoptSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const authed = await api.auth.demoLogin();
      adoptSession(authed);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // 404 means this deployment has no demo configured. Sending the visitor
      // to the sign-in page is more useful than an error they cannot act on.
      if (err instanceof ApiError && err.status === 404) {
        navigate('/login');
        return;
      }
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Too many demo sessions right now. Try again in a minute.'
          : 'The demo is unavailable right now.',
      );
      setBusy(false);
    }
  }

  const base = 'inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 font-semibold disabled:opacity-60';
  const tone = variant === 'inverse'
    ? 'bg-primary-foreground text-primary hover:opacity-90'
    : 'bg-primary text-primary-foreground hover:bg-primary-hover';

  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" onClick={start} disabled={busy} className={`${base} ${tone}`}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {busy ? 'Starting demo…' : LANDING_COPY.nav.demo}
      </button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} <a href="/login" className="underline">Sign in instead</a>
        </p>
      )}
    </div>
  );
}
