import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8081',
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npx ts-node -r tsconfig-paths/register src/main.ts',
      cwd: '../backend',
      url: 'http://localhost:3100/health/ready',
      reuseExistingServer: true,
      timeout: 60000,
      env: {
        DB_PORT: '5433',
        DB_USER: 'postgres',
        DB_PASSWORD: 'postgres',
        DB_NAME: 'appdb_test',
        PORT: '3100',
      },
    },
    {
      command: 'npx vite --port 8081',
      url: 'http://localhost:8081',
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});
