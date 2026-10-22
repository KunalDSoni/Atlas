// Entry for the website-only build (`npm run build:site`): the landing page and
// nothing else. vite.config.ts swaps it in for main.tsx in `--mode site`, so
// none of the app — routes, auth, API client — is bundled.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/context/theme-provider';
import Landing from '@/screens/landing';
import './index.css';

// Every unknown path falls back to this page, including old app links such as
// /login or /dashboard. Show them at the site's one real address.
if (window.location.pathname !== '/') {
  window.history.replaceState(null, '', '/' + window.location.hash);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Landing />
    </ThemeProvider>
  </StrictMode>,
);
