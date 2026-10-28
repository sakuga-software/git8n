import '../setup-env';
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
const FILES = ['common', 'menu', 'quiz'];

let repo: FakeRepo;

beforeEach(() => {
  clearI18nCatalogueCache();
  Object.assign(env, { I18N_APP: { appId: '123456', privateKey: 'PEM' } });
  repo = fakeRepo({
    owner: 'acme',
    name: 'acme-app',
    baseBranch: 'main',
    files: Object.fromEntries(
      FILES.flatMap((file) => [
        [`${LOCALES}/fr/${file}.json`, { hello: `Bonjour ${file}` }],
        [`${LOCALES}/en/${file}.json`, { hello: `Hello ${file}` }],
      ]),
    ),
  });
  vi.stubGlobal('fetch', repo.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(env, { I18N_APP: undefined });
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

/** The lines of the answer, each parsed. */
const linesOf = async (id: string, headers: Record<string, string>, language = 'en') => {
  const res = await app.request(`/i18n/catalogue/stream?repository=${id}&language=${language}`, { headers });

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/x-ndjson');

  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
};

describe('GET /i18n/catalogue/stream (DB-654)', () => {
  it('says how many files are read, then answers the catalogue', async () => {
    const { id, headers } = await reader();
    const lines = await linesOf(id, headers);
    const progress = lines.slice(0, -1).map((line) => line.progress);

    expect(progress).toEqual([0, 1, 2, 3].map((done) => ({ done, total: FILES.length })));
    expect(lines.at(-1)!.catalogue.entries.map((entry: { value: string }) => entry.value)).toEqual(
      FILES.map((file) => `Hello ${file}`),
    );
  });

  it('answers a catalogue already read in one line', async () => {
    const { id, headers } = await reader();

    await linesOf(id, headers);

    const lines = await linesOf(id, headers);

    expect(lines).toHaveLength(1);
    expect(lines[0].catalogue.language).toBe('en');
  });

  it('carries a failure of the read in a line, with its status', async () => {
    const { id, headers } = await reader();
    const lines = await linesOf(id, headers, 'de');

    expect(lines).toEqual([{ error: { status: 400, message: expect.stringContaining('de is not one of') } }]);
  });
});
