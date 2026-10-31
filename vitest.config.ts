import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testing Library registers its automatic cleanup through the global
    // afterEach. Without this, DOM from one test leaks into the next.
    globals: true,
    projects: [
      {
        // core must not touch the DOM, so its tests run without one.
        extends: true,
        test: { name: 'core', environment: 'node', include: ['src/core/**/*.test.ts'] },
      },
      {
        // The markdown contract reads real files, so it lives outside src.
        extends: true,
        test: { name: 'contract', environment: 'node', include: ['test/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['src/core/**'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/index.ts'],
      // A ratchet, not a target: set just under what the suite covers today so
      // a change that drops coverage fails instead of passing quietly. Raise
      // these when you raise the coverage, never lower them to go green.
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 90,
        lines: 85,
      },
    },
  },
});
