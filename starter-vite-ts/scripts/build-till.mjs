// Builds the offline till screen into the branch agent (agent/internal/localui/tillui), which
// embeds it and serves it at /till/. The folder keeps only its stand-in, NOT-BUILT.html, in git.
import path from 'node:path';
import { build } from 'vite';
import { rm, rename, readdir } from 'node:fs/promises';

const out = path.resolve(process.cwd(), '../agent/internal/localui/tillui');

for (const entry of await readdir(out)) {
  if (entry !== 'NOT-BUILT.html') await rm(path.join(out, entry), { recursive: true, force: true });
}

await build({ configFile: path.resolve(process.cwd(), 'vite.till.config.ts') });

// Vite names the page after its source; the agent serves index.html.
await rename(path.join(out, 'till.html'), path.join(out, 'index.html'));
console.log(`offline till built into ${out}`);
