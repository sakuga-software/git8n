import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { i18nRepositories } from '@git8n/db';
import { env } from '@/config/env';
import { db } from '@/db';
import type { HonoEnv } from '@/types/hono';
import { forgetRepository } from '@/utils/cache';

/** Whether `signature` is the HMAC of `body` that GitHub sends in `X-Hub-Signature-256`. */
export const signedByGithub = (body: string, signature: string | undefined, secret: string): boolean => {
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const given = Buffer.from(signature ?? '');

  return given.length === expected.length && timingSafeEqual(given, expected);
};

interface PushEvent {
  repository?: { name?: string; owner?: { login?: string; name?: string } };
}

/**
 * The events of the GitHub App (DB-651).
 *
 * A push to a repository, a merge on GitHub included, drops what the API holds
 * of that repository. Then the next read shows the new commit, and not the one
 * of before, for five minutes. Without `GITHUB_WEBHOOK_SECRET`, the route does
 * not exist: an unsigned event must not empty the caches.
 */
const githubWebhook = new Hono<HonoEnv>();

githubWebhook.post('/', async (c) => {
  const secret = env.GITHUB_WEBHOOK_SECRET;

  if (!secret) return c.notFound();

  const body = await c.req.text();

  if (!signedByGithub(body, c.req.header('X-Hub-Signature-256'), secret)) {
    return c.json({ message: 'The signature does not match.' }, 401);
  }

  if (c.req.header('X-GitHub-Event') !== 'push') return c.body(null, 204);

  const { repository } = JSON.parse(body) as PushEvent;
  const owner = repository?.owner?.login ?? repository?.owner?.name;

  if (!owner || !repository?.name) return c.json({ message: 'The event names no repository.' }, 400);

  // GitHub does not count case in a name, and a row keeps the case of the day it was added.
  const rows = await db()
    .select({ id: i18nRepositories.id })
    .from(i18nRepositories)
    .where(
      sql`lower(${i18nRepositories.owner}) = ${owner.toLowerCase()} and lower(${i18nRepositories.name}) = ${repository.name.toLowerCase()}`,
    );

  for (const row of rows) forgetRepository(row.id);

  return c.json({ data: { forgotten: rows.length } });
});

export default githubWebhook;
