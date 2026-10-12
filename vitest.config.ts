import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    testTimeout: 30000,
    include: ['tests/unit/**/*.{test,spec}.ts', 'tests/harness/**/*.{test,spec}.ts'],
  },
});
