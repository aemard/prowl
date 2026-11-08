import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/preview',
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 900 },
    launchOptions: { executablePath: process.env.PROWL_CHROMIUM || undefined },
  },
  webServer: {
    command: 'pnpm dev:web',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
  },
});
