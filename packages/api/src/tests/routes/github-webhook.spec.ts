import '../setup-env';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18nRepositories, newId } from '@git8n/db';
import app from '../../app';
import { env } from '@/config/env';
import { clearI18nCatalogueCache } from '@/services/i18n-catalogue.service';
import { authHeaders, grant, insertAccount, insertOrganization } from '../db/fixtures';
import { useTestDb } from '../db/test-db';
import { fakeRepo, type FakeRepo } from '../services/fake-github-repo';

vi.mock('@/services/github-app.service', async (original) => {
  const real = await original<typeof import('@/services/github-app.service')>();

  return { ...real, installationToken: async () => 'installation-token', installations: async () => [] };
});

const { db } = useTestDb();

const LOCALES = 'src/locales';
const SECRET = 'a-webhook-secret-for-the-tests';

let repo: FakeRepo;

beforeEach(() => {
  clearI18nCatalogueCache();
  Object.assign(env, { I18N_APP: { appId: '123456', privateKey: 'PEM' }, GITHUB_WEBHOOK_SECRET: SECRET });
  repo = fakeRepo({
    owner: 'acme',
    name: 'acme-app',
    baseBranch: 'main',
    files: {
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
    },
  });
  vi.stubGlobal('fetch', repo.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(env, { I18N_APP: undefined, GITHUB_WEBHOOK_SECRET: undefined });
});

async function reader() {
  const [row] = await db()
    .insert(i18nRepositories)
    .values({
      id: newId(),
      organizationId: await insertOrganization(),
      installationId: 42,
      owner: 'acme',
      name: 'acme-app',
      branch: 'main',
      localesPath: LOCALES,
      languages: ['fr', 'en'],
    } as never)
    .returning();
  const userId = await insertAccount();

  await grant(userId, row.id, { languages: ['en'], role: 'translator' });

  return { id: row.id as string, headers: await authHeaders(userId) };
}

const englishOf = async (repositoryId: string, headers: Record<string, string>): Promise<string | null> => {
  const res = await app.request(`/i18n/catalogue?repository=${repositoryId}&language=en`, { headers });

  expect(res.status).toBe(200);

  const { entries } = ((await res.json()) as { data: { entries: Array<{ value: string | null }> } }).data;

  return entries[0].value;
};

const deliver = (event: string, payload: unknown, secret = SECRET) => {
  const body = JSON.stringify(payload);

  return app.request('/api/github/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    body,
  });
};

/** A merge on GitHub, which the editor did not write. */
const mergeOnGithub = () => repo.moveBranch('main', { [`${LOCALES}/en/common.json`]: { hello: 'Hi' } });

const push = { ref: 'refs/heads/main', repository: { name: 'Acme-App', owner: { login: 'ACME' } } };

describe('POST /api/github/webhook', () => {
  it('a push drops the held catalogue, so the next read shows the merge', async () => {
    const { id, headers } = await reader();

    expect(await englishOf(id, headers)).toBe('Hello');

    mergeOnGithub();

    expect(await englishOf(id, headers)).toBe('Hello');

    const res = await deliver('push', push);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { forgotten: 1 } });
    expect(await englishOf(id, headers)).toBe('Hi');
  });

  it('refuses an event with a wrong signature, and keeps the cache', async () => {
    const { id, headers } = await reader();

    await englishOf(id, headers);
    mergeOnGithub();

    expect((await deliver('push', push, 'another-secret-of-enough-length')).status).toBe(401);
    expect(await englishOf(id, headers)).toBe('Hello');
  });

  it('takes no event when no secret is set', async () => {
    Object.assign(env, { GITHUB_WEBHOOK_SECRET: undefined });

    expect((await deliver('push', push)).status).toBe(404);
  });

  it('answers the other events and drops nothing', async () => {
    const { id, headers } = await reader();

    await englishOf(id, headers);
    mergeOnGithub();

    expect((await deliver('ping', { zen: 'Keep it logically awesome.' })).status).toBe(204);
    expect(await englishOf(id, headers)).toBe('Hello');
  });
});
