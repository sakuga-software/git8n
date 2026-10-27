import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { auth } from './auth';
import { env } from './config/env';
import { errorHandler } from './middlewares/error-handler';
import i18nRoutes from './routes/i18n';
import type { HonoEnv } from './types/hono';

const app = new Hono<HonoEnv>();

app.onError(errorHandler);

// The organization plugin opens routes to every signed-in account: a member
// could change their own role. The routes of `/i18n` do these changes, with their own checks.
app.all('/api/auth/organization/*', (c) => c.notFound());

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth().handler(c.req.raw));

app.route('/i18n', i18nRoutes);

app.get('/health', (c) => c.json({ status: 'ok' }));

// The page and the API are on one origin, so the session cookie needs no CORS.
const webRoot = env.WEB_ROOT;

if (webRoot) {
  app.use('/*', serveStatic({ root: webRoot }));
  // The application is a single page: every other address opens it, and the router reads the path.
  app.get('/*', async (c, next) => {
    if (/^\/(api|i18n)(\/|$)/.test(c.req.path)) return c.notFound();

    return serveStatic({ root: webRoot, path: 'index.html' })(c, next);
  });
}

export default app;
