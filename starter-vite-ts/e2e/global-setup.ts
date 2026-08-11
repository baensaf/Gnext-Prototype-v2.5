import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function globalSetup() {
  console.log('[Playwright Global Setup] Initializing disposable PostgreSQL test database...');
  const backendDir = path.resolve(__dirname, '../../backend');
  try {
    const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    execSync(`${cmd} ts-node -r tsconfig-paths/register src/scripts/migration-fresh.ts`, {
      cwd: backendDir,
      stdio: 'inherit',
    });
    console.log('[Playwright Global Setup] Database migrations & seeding complete!');
  } catch (err) {
    console.error('[Playwright Global Setup] Failed to run database setup:', err);
    throw err;
  }
}
