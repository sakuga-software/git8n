import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from './config/env';
import { errorHandler } from './middlewares/error-handler';
import i18nRoutes from './routes/i18n';
import type { HonoEnv } from './types/hono';

const app = new Hono<HonoEnv>();

app.onError(errorHandler);

app.use('/*', cors({ origin: env.KNOWN_HOSTS, credentials: true }));

app.route('/i18n', i18nRoutes);

app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
