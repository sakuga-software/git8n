import { defineConfig } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { DEMO, DEMO_BASE } from './demo.config.ts';

/** Where `pnpm -F @git8n/api dev` answers. */
const API = process.env.API_PROXY ?? 'http://localhost:8001';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [reactRouter(), tailwindcss(), tsconfigPaths()],
  base: DEMO ? DEMO_BASE : '/',
  define: { __DEMO__: JSON.stringify(DEMO) },
  // The page and the API share one origin in production. In development, Vite
  // passes the calls of the API to it, so the session cookie stays on one origin too.
  // The demo answers these calls itself.
  server: DEMO
    ? {}
    : {
        proxy: {
          '/api': API,
          '/i18n': API,
        },
      },
});
