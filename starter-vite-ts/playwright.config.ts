import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60000,
  expect: {
    timeout: 15000,
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
      command: 'cmd /c npx ts-node -r tsconfig-paths/register src/main.ts',
      cwd: '../backend',
      url: 'http://localhost:3100/health/ready',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: 'cmd /c npm run dev -- --port 8081',
      cwd: '.',
      url: 'http://localhost:8081',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});
