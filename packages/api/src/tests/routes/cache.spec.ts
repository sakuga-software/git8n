import '../setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18nRepositories, i18nTranslators, newId } from '@i18n-editor/db';
import app from '../../app';
import { env } from '@/config/env';
import { clearI18nCatalogueCache } from '@/services/i18n-catalogue.service';
import { clearI18nProgressCache } from '@/services/i18n-progress.service';
import { authHeaders, insertAccount, signedInAdmin } from '../db/fixtures';
import { useTestDb } from '../db/test-db';
import { fakeRepo, type FakeRepo } from '../services/fake-github-repo';

vi.mock('@/services/github-app.service', async (original) => {
  const real = await original<typeof import('@/services/github-app.service')>();

  return { ...real, installationToken: async () => 'installation-token', installations: async () => [] };
});

const { db } = useTestDb();

/**
 * A read after a write answers the result of the write (DB-639).
 *
 * The reads of the GitHub state are held for a minute or more. Each test reads
 * once to fill the cache, writes, and reads again. Without the invalidation of
 * the write, the second read answers the first.
 */

const LOCALES = 'src/locales';

let repo: FakeRepo;

beforeEach(() => {
  clearI18nCatalogueCache();
  clearI18nProgressCache();
  Object.assign(env, { I18N_APP: { appId: '123456', privateKey: 'PEM' } });
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
  Object.assign(env, { I18N_APP: undefined });
});

async function repository(publishMode: 'commit' | 'pull_request' = 'commit') {
  const [row] = await db()
    .insert(i18nRepositories)
    .values({
      id: newId(),
      installationId: 42,
      owner: 'acme',
      name: 'acme-app',
      branch: 'main',
      localesPath: LOCALES,
      languages: ['fr', 'en'],
      publishMode,
    } as never)
    .returning();

  return row;
}

/** A reviewer of English who also writes the source: one account does every write. */
async function writer() {
  const userId = await insertAccount();

  await db()
    .insert(i18nTranslators)
    .values({ userId, languages: ['en'], role: 'reviewer', writesSource: true } as never);

  return authHeaders(userId);
}

const send = (method: string, path: string, headers: Record<string, string>, body: unknown) =>
  app.request(path, {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const read = async <T>(path: string, headers: Record<string, string>): Promise<T> => {
  const res = await app.request(path, { headers });

  expect(res.status, path).toBe(200);

  return ((await res.json()) as { data: T }).data;
};

const propose = async (repositoryId: string, headers: Record<string, string>) => {
  const res = await send('POST', '/i18n/proposals', headers, {
    repository: repositoryId,
    language: 'en',
    readAt: repo.refs.get('main'),
    values: [{ file: 'common', key: 'hello', value: 'Hi' }],
  });

  expect(res.status).toBe(200);

  return ((await res.json()) as { data: { commit: string } }).data.commit;
};

type Pull = { pullRequest: { number: number } | null };

describe('a read after a write', () => {
  it('POST /proposals: the keys and the batches that wait list the new proposal', async () => {
    const row = await repository();
    const headers = await writer();
    const q = `repository=${row.id}&language=en`;

    expect(await read(`/i18n/proposals/keys?${q}`, headers)).toEqual([]);
    expect(await read(`/i18n/proposals?${q}`, headers)).toEqual([]);

    await propose(row.id, headers);

    expect(await read(`/i18n/proposals/keys?${q}`, headers)).toMatchObject([{ key: 'hello', value: 'Hi' }]);
    expect(await read(`/i18n/proposals?${q}`, headers)).toHaveLength(1);
  });

  it('POST /publications: the pull request shows, and the published key waits no more', async () => {
    const row = await repository('pull_request');
    const headers = await writer();
    const commit = await propose(row.id, headers);
    const q = `repository=${row.id}&language=en`;

    expect(await read<Pull>(`/i18n/publication?repository=${row.id}`, headers)).toMatchObject({ pullRequest: null });
    expect(await read(`/i18n/proposals/keys?${q}`, headers)).toHaveLength(1);

    const published = await send('POST', '/i18n/publications', headers, {
      repository: row.id,
      language: 'en',
      approved: [{ file: 'common', key: 'hello', commit }],
    });

    expect(published.status).toBe(200);
    expect(await read<Pull>(`/i18n/publication?repository=${row.id}`, headers)).toMatchObject({
      pullRequest: { number: 1 },
    });
    expect(await read(`/i18n/proposals/keys?${q}`, headers)).toEqual([]);
  });

  it('POST /keys: the pull request that carries the new key shows', async () => {
    const row = await repository('pull_request');
    const headers = await writer();

    expect(await read<Pull>(`/i18n/publication?repository=${row.id}`, headers)).toMatchObject({ pullRequest: null });

    const created = await send('POST', '/i18n/keys', headers, {
      repository: row.id,
      values: [{ file: 'common', key: 'bye', value: 'Au revoir' }],
    });

    expect(created.status).toBe(200);
    expect(await read<Pull>(`/i18n/publication?repository=${row.id}`, headers)).toMatchObject({
      pullRequest: { number: 1 },
    });
  });

  it('POST /reviews: the pull request that carries the kept translation shows', async () => {
    const row = await repository('pull_request');
    const headers = await writer();

    repo.moveBranch('main', { [`${LOCALES}/fr/common.json`]: { hello: 'Salut' } });

    expect(await read<Pull>(`/i18n/publication?repository=${row.id}`, headers)).toMatchObject({ pullRequest: null });

    const kept = await send('POST', '/i18n/reviews', headers, {
      repository: row.id,
      language: 'en',
      keys: [{ file: 'common', key: 'hello' }],
    });

    expect(kept.status).toBe(200);
    expect(await read<Pull>(`/i18n/publication?repository=${row.id}`, headers)).toMatchObject({
      pullRequest: { number: 1 },
    });
  });

  it('PATCH /repositories/:id: the keys that wait are read against the new branch', async () => {
    const row = await repository();
    const headers = await writer();
    const admin = await signedInAdmin();
    const q = `repository=${row.id}&language=en`;

    await propose(row.id, headers);

    // A branch where the proposal is already published.
    repo.refs.set('next', repo.refs.get('main')!);
    repo.moveBranch('next', { [`${LOCALES}/en/common.json`]: { hello: 'Hi' } });

    expect(await read(`/i18n/proposals/keys?${q}`, headers)).toHaveLength(1);

    const changed = await send('PATCH', `/i18n/repositories/${row.id}`, admin.headers, { branch: 'next' });

    expect(changed.status).toBe(200);
    expect(await read(`/i18n/proposals/keys?${q}`, headers)).toEqual([]);
  });

  it('a read in flight during a write is not held: the next read shows the write', async () => {
    const row = await repository('pull_request');
    const headers = await writer();
    const real = repo.fetch.getMockImplementation()!;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gated = false;

    // GitHub answers the first list of pull requests before the write, and
    // the answer arrives after it.
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const answer = await real(url, init);

      if (!gated && String(url).includes('/pulls?')) {
        gated = true;
        await released;
      }

      return answer;
    });

    const inFlight = read<Pull>(`/i18n/publication?repository=${row.id}`, headers);

    await vi.waitFor(() => expect(gated).toBe(true));

    const created = await send('POST', '/i18n/keys', headers, {
      repository: row.id,
      values: [{ file: 'common', key: 'bye', value: 'Au revoir' }],
    });

    expect(created.status).toBe(200);

    release();

    expect(await inFlight).toMatchObject({ pullRequest: null });
    expect(await read<Pull>(`/i18n/publication?repository=${row.id}`, headers)).toMatchObject({
      pullRequest: { number: 1 },
    });
  });
});

describe('two reads with no write between them', () => {
  it('ask GitHub once for the keys that wait', async () => {
    const row = await repository();
    const headers = await writer();
    const path = `/i18n/proposals/keys?repository=${row.id}&language=en`;

    await propose(row.id, headers);
    await read(path, headers);

    const before = repo.fetch.mock.calls.length;

    await read(path, headers);

    expect(repo.fetch.mock.calls.length).toBe(before);
  });
});
