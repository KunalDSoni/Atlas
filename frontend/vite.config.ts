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
});
