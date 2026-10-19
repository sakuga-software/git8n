import { defineConfig } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

/** Where `pnpm -F @i18n-editor/api dev` answers. */
const API = process.env.API_PROXY ?? 'http://localhost:8001';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [reactRouter(), tailwindcss(), tsconfigPaths()],
  // The page and the API share one origin in production. In development, Vite
  // passes the calls of the API to it, so the session cookie stays on one origin too.
  server: {
    proxy: {
      '/api': API,
      '/i18n': API,
    },
  },
});
