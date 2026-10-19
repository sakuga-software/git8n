import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./src/tests/setup-env.ts'],
    hookTimeout: 60_000,
  },
});
