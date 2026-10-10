import { defineConfig } from 'vitest/config';

// Relative base so the build works from any sub-path (e.g. GitHub Pages /alvoxisworld/).
export default defineConfig({
  base: './',
  build: { target: 'es2020', outDir: 'dist' },
  // Long deterministic scenarios (years of simulation, large maps) take several seconds,
  // more when test files run in parallel; the default 5 s limit made them flaky.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
});
