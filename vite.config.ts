import { defineConfig } from 'vitest/config';

// Relative base so the build works from any sub-path (e.g. GitHub Pages /alvoxisworld/).
export default defineConfig({
  base: './',
  build: { target: 'es2020', outDir: 'dist' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
