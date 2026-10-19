import { defineConfig } from 'vitest/config';

// The plugin of React Router reads the routes and starts a build. The tests
// read functions, so they load without it.
export default defineConfig({ test: { include: ['app/**/*.test.ts'] } });
