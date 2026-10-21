import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 and 8080 are both taken by other apps on the current dev machine,
    // so this project pins its own pair: web 5174, API 8787.
    port: 5174,
    proxy: {
      // Keeps the browser same-origin in dev, so there is no CORS preflight on
      // the latency-critical tab request.
      // xfwd: pass the browser's address on, so the API rate-limits and audits
      // each user rather than seeing everyone as this machine.
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, xfwd: true },
    },
  },
  build: {
    // ECharts is the bulk of the bundle and never changes between deploys;
    // splitting it keeps the app chunk small and cacheable.
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts', 'echarts-for-react'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
} as never);
