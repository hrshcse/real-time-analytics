import { defineConfig, devices } from '@playwright/test';

/**
 * Runtime performance gate (WBS 21.2) against the PRODUCTION build (`vite preview`).
 * Requires `npm run build` first. Server at 200 frames/s (TICK_MS=5) to stress per-frame costs.
 */
export default defineConfig({
  testDir: './e2e-perf',
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
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
      reuseExistingServer: false,
      env: { TICK_MS: '5', ALLOWED_ORIGINS: 'http://localhost:4173', AUTH_TOKEN: '' },
    },
    {
      command: 'npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
    },
  ],
});
