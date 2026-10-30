import { defineConfig } from 'vitest/config';

// Unit tests for the pure logic in src/lib. Pages are covered by `astro check` and the build.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
