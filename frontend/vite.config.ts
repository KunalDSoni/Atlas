import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    // Express serves this directory (backend/server.js -> ../frontend/build)
    outDir: 'build',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split the dependencies out of the entry chunk. This does not shrink
        // the first visit — the app shell needs React, the router and the Radix
        // primitives before it can paint anything — but it stops every app
        // change from invalidating the ~450 kB of vendor code that did not
        // change, which is what a returning user re-downloads today.
        //
        // One vendor chunk, not several: splitting a dependency graph by
        // package invites a chunk that runs before the one it initialises from,
        // and the failure mode is a blank page rather than a build error.
        manualChunks(id: string) {
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
  server: {
    // `npm run dev` proxies the API to the Express backend
    proxy: { '/api': 'http://localhost:3001' },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Unit tests only. Without this vitest sweeps the whole tree, picks up the
    // Playwright specs in e2e/, and fails ~20 files on an unresolvable
    // @playwright/test import — so `npm test` greeted everyone with a wall of
    // red that meant nothing, and buried any real failure in it.
    // The browser specs run under `npm run test:e2e`.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
} as any);
