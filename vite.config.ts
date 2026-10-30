import { defineConfig } from 'vitest/config';

// Relative base so the site works at any GitHub Pages subpath.
export default defineConfig({
  base: './',
  test: { environment: 'node', include: ['src/**/*.test.ts', 'tests/**/*.test.ts'] },
});
