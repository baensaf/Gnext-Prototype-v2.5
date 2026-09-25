import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ----------------------------------------------------------------------

// The offline till screen (docs/agent-gateway/HANDOFF-offline-pos.md, P4b-2): the web POS's
// register built on its own, for the branch agent to embed and serve at /till/. Run it with
// `npm run build:till`, which clears the agent's tillui folder first.

export default defineConfig({
  plugins: [react()],
  base: '/till/',
  // The till calls the cloud only through the agent that serves it (§16.4): same origin, always,
  // whatever VITE_SERVER_URL the web app is built with.
  define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify('') },
  // The web app's public folder holds its images and demo assets; the till bundles only the
  // fonts it imports.
  publicDir: false,
  resolve: {
    alias: [
      {
        find: /^src(.+)/,
        replacement: path.resolve(process.cwd(), 'src/$1'),
      },
    ],
  },
  build: {
    outDir: path.resolve(process.cwd(), '../agent/internal/localui/tillui'),
    emptyOutDir: false,
    rollupOptions: { input: { index: path.resolve(process.cwd(), 'till.html') } },
    chunkSizeWarningLimit: 4000,
  },
  // `npm run dev:till` with the agent running: the screen on :8082, its API from the agent.
  server: {
    port: 8082,
    proxy: {
      '/api': { target: 'http://127.0.0.1:47800', changeOrigin: true, headers: { Origin: 'http://127.0.0.1:47800' } },
    },
  },
});
