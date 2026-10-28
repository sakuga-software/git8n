import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { auth } from './auth';
import { env } from './config/env';
import { errorHandler } from './middlewares/error-handler';
import accessTokens from './routes/access-tokens';
import githubWebhook from './routes/github-webhook';
import i18nRoutes from './routes/i18n';
import type { HonoEnv } from './types/hono';

const app = new Hono<HonoEnv>();

app.onError(errorHandler);

// The organization plugin opens routes to every signed-in account: a member
// could change their own role. The routes of `/i18n` do these changes, with their own checks.
app.all('/api/auth/organization/*', (c) => c.notFound());

// A person approves a device code on the page, with the session of the browser. A session token of
// the command line that approves a second code would keep an access after the person signs it out.
app.on(['GET', 'POST'], '/api/auth/*', async (c, next) => {
  if (/^\/api\/auth\/device(\/(approve|deny))?\/*$/i.test(c.req.path) && c.req.header('authorization')) {
    return c.json({ message: 'Approve a device code on the page of the editor.' }, 403);
  }

  await next();
});

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth().handler(c.req.raw));

app.route('/i18n/tokens', accessTokens);

app.route('/i18n', i18nRoutes);

app.route('/api/github/webhook', githubWebhook);

app.get('/health', (c) => c.json({ status: 'ok' }));

// The page and the API are on one origin, so the session cookie needs no CORS.
const webRoot = env.WEB_ROOT;

if (webRoot) {
  // The site of the documentation is in `<WEB_ROOT>/docs`, with each page also as Markdown under `raw/`.
  app.get('/docs', (c) => c.redirect('/docs/', 301));
  app.use('/docs/*', async (c, next) => {
    await next();

    if (c.res.status === 200 && c.req.path.endsWith('.md')) c.header('Content-Type', 'text/markdown; charset=utf-8');
  });
  app.use('/*', serveStatic({ root: webRoot }));
  // The demo of the home page of the documentation is the editor as a single page too (DB-673).
  app.get('/docs/demo/*', (c, next) => serveStatic({ root: webRoot, path: 'docs/demo/index.html' })(c, next));
  // The application is a single page: every other address opens it, and the router reads the path.
  app.get('/*', async (c, next) => {
    if (/^\/(api|i18n|docs)(\/|$)/.test(c.req.path)) return c.notFound();

    return serveStatic({ root: webRoot, path: 'index.html' })(c, next);
  });
}

export default app;
