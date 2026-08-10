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
