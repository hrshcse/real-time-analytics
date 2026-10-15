import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

/**
 * End-to-end tests (WBS 18.3). Starts the real WebSocket server and the Vite dev server, then
 * drives Chromium. First run on a new machine: `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // one server, shared stream
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Lets a pre-installed Chromium be used instead of Playwright's download (containers).
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev -w @rta/server',
      cwd: '../..',
      port: 8080,
      reuseExistingServer: !CI,
      env: { ALLOWED_ORIGINS: 'http://localhost:5173', AUTH_TOKEN: '' },
    },
    {
      command: 'npm run dev -w @rta/web',
      cwd: '../..',
      url: 'http://localhost:5173',
      reuseExistingServer: !CI,
    },
  ],
});
