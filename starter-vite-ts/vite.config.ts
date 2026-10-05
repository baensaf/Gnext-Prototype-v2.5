import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import checker from 'vite-plugin-checker';

// ----------------------------------------------------------------------

const PORT = 8081;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    checker({
      typescript: true,
      overlay: {
        position: 'tl',
        initialIsOpen: false,
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: /^src(.+)/,
        replacement: path.resolve(process.cwd(), 'src/$1'),
      },
    ],
  },
  server: {
    port: PORT,
    host: true,
    // kiosk.localhost is how the kiosk host is tried out locally.
    allowedHosts: ['.localhost'],
    watch: {
      ignored: ['**/Dockerfile', '**/nginx.conf', '**/*.log', '**/.git/**', '**/dist/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
  preview: { port: PORT, host: true },
});
