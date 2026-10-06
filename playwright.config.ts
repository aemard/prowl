import { defineConfig } from '@playwright/test';

/**
 * E2E tests load the real extension (dist-e2e/, built with `vite build --mode e2e`)
 * into Chromium and point it at the mock GitHub server in tests/e2e/mock-github.
 * The mock server binds a fixed port, so tests run serially in one worker.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
