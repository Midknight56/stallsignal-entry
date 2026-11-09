import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0, // Repeating a sandbox test can create more payments.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.SS_BASE || 'http://127.0.0.1:8799',
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    // Buyer helpers stop tracing before PayPal login; no credential snapshots or videos.
    screenshot: 'off',
    video: 'off',
    ...(process.env.SS_BROWSER_CHANNEL ? { channel: process.env.SS_BROWSER_CHANNEL } : {}),
  },
});
