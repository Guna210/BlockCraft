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
    baseURL: 'http://localhost:3000',
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
        '--enable-precise-memory-info',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run build && npm run preview',
      port: 3000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        'npm run server -- --port 3001 --world artifacts/m21-world --seed blockcraft-test-seed-42 --reset-world',
      url: 'http://localhost:3001/health',
      reuseExistingServer: false,
    },
    {
      command:
        'npm run server -- --port 3002 --world artifacts/m21-delayed-world --seed blockcraft-test-seed-42 --delay-ms 150 --reset-world',
      url: 'http://localhost:3002/health',
      reuseExistingServer: false,
    },
  ],
});
