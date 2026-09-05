import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}', 'entrypoints/**/*.{ts,tsx}'],
      exclude: ['entrypoints/*/main.tsx'],
      thresholds: {
        statements: 65,
        branches: 55,
        functions: 55,
        lines: 65,
      },
    },
  },
});
