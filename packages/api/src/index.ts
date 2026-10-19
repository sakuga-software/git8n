import { serve } from '@hono/node-server';
import app from './app';
import { env } from './config/env';
import { connectDatabase } from './db';
import { logger } from './utils/logger';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is missing');

connectDatabase(env.DATABASE_URL, { tls: env.DATABASE_TLS });

serve({ fetch: app.fetch, port: env.PORT }, (info) => logger.info(`The API listens on port ${info.port}`));
