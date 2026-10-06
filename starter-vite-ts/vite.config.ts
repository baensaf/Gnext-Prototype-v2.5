import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import checker from 'vite-plugin-checker';

// ----------------------------------------------------------------------
// Writes dist/build-manifest.json after `vite build` (agent-protocol §19.7).
//
// The branch agent downloads the cloud's frontend build and serves it from disk. It fetches this
// file first: if `build_id` is the one it already serves, nothing else is downloaded; otherwise it
// fetches only the files whose sha256 it does not hold yet.
//
//   { "build_id": "9f2c41d7ab03e5c8",
//     "built_at": "2026-10-06T09:30:00.000Z",
//     "files": [ { "path": "index.html", "sha256": "…", "size": 1234 }, … ] }
//
// `files` lists every file of the build except the manifest itself, with `/` in paths.
// `build_id` is the first 16 hex characters of the SHA-256 of the sorted "path NUL sha256 LF"
// lines. The agent only compares it; it never recomputes it.

const MANIFEST = 'build-manifest.json';

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function buildManifestPlugin(): Plugin {
  let outDir = '';
  let ssr = false;
  let log: (msg: string) => void = () => {};
  return {
    name: 'gnext-build-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      ssr = !!config.build.ssr;
      log = (msg) => config.logger.info(msg);
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        // Only the browser build: an SSR build has no frontend to serve.
        if (ssr || !fs.existsSync(outDir)) return;
        const files = listFiles(outDir)
          .filter((p) => p !== MANIFEST)
          .sort()
          .map((p) => {
            const data = fs.readFileSync(path.join(outDir, p));
            return { path: p, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length };
          });
        const id = crypto.createHash('sha256');
        for (const f of files) id.update(`${f.path}\0${f.sha256}\n`);
        const manifest = { build_id: id.digest('hex').slice(0, 16), built_at: new Date().toISOString(), files };
        fs.writeFileSync(path.join(outDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
        log(`${MANIFEST}: build ${manifest.build_id}, ${files.length} files`);
      },
    },
  };
}

// ----------------------------------------------------------------------

const PORT = 8081;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    buildManifestPlugin(),
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
