import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--js-flags=--expose-gc',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
