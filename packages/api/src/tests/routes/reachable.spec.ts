import '../setup-env';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../app';
import { clearReachableCache } from '@/services/i18n-reachable.service';
import { authHeaders, insertAccount, signedInAdmin } from '../db/fixtures';
import { useTestDb } from '../db/test-db';

/**
 * Two installations: `acme` reaches 110 repositories, `beta` reaches 10, and
 * both reach `acme/shared`. The picker reads them through one paginated route.
 */
const calls = vi.hoisted(() => ({ installations: 0 }));

vi.mock('@/services/github-app.service', async (original) => {
  const real = await original<typeof import('@/services/github-app.service')>();
  const named = (owner: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      owner,
      name: `repo-${String(index + 1).padStart(3, '0')}`,
      private: index % 2 === 0,
    }));

  return {
    ...real,
    installations: async () => {
      calls.installations += 1;

      return [
        { id: 1, account: 'acme' },
        { id: 2, account: 'beta' },
      ];
    },
    repositoriesOf: async (installationId: number) =>
      installationId === 1
        ? [...named('acme', 109), { owner: 'acme', name: 'shared', private: false }]
        : [...named('beta', 9), { owner: 'acme', name: 'shared', private: false }],
  };
});

useTestDb();

interface Page {
  rows: Array<{ installationId: number; account: string; owner: string; name: string; private: boolean }>;
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

const list = async (query: string, headers?: Record<string, string>) =>
  app.request(`/i18n/installations/repositories${query}`, { headers: headers ?? (await signedInAdmin()).headers });

const pageOf = async (query: string) => ((await (await list(query)).json()) as { data: Page }).data;

beforeEach(() => {
  clearReachableCache();
  calls.installations = 0;
});

describe('GET /i18n/installations/repositories', () => {
  it('answers 30 repositories a page by default, sorted, and says how many there are', async () => {
    const first = await pageOf('');

    // `acme/shared` is reached twice and listed once: 109 + 1 + 9.
    expect(first).toMatchObject({ page: 1, perPage: 30, total: 119, hasMore: true });
    expect(first.rows).toHaveLength(30);
    expect(first.rows[0]).toEqual({
      installationId: 1,
      account: 'acme',
      owner: 'acme',
      name: 'repo-001',
      private: true,
    });
  });

  it('walks every page, the last one short and with nothing after it', async () => {
    const seen: string[] = [];

    for (let page = 1; ; page += 1) {
      const answer = await pageOf(`?page=${page}&perPage=50`);

      seen.push(...answer.rows.map((row) => `${row.owner}/${row.name}`));

      if (!answer.hasMore) {
        expect(answer.page).toBe(3);
        expect(answer.rows).toHaveLength(19);
        break;
      }
    }

    expect(new Set(seen).size).toBe(119);
  });

  /** The search must reach a repository that no loaded page holds yet. */
  it('searches every page, whatever the case of the query', async () => {
    const found = await pageOf('?q=BETA/REPO-00');

    expect(found.total).toBe(9);
    expect(found.rows.map((row) => `${row.owner}/${row.name}`)).toContain('beta/repo-009');
    expect(found.hasMore).toBe(false);
  });

  it('answers an empty page for a search that matches nothing', async () => {
    expect(await pageOf('?q=nothing-like-this')).toMatchObject({ rows: [], total: 0, hasMore: false });
  });

  it('holds 100 repositories a page at most', async () => {
    expect((await pageOf('?perPage=100')).rows).toHaveLength(100);
    expect((await list('?perPage=101')).status).toBe(400);
    expect((await list('?page=0')).status).toBe(400);
  });

  /** GitHub is read once a minute, and again when the page asks for a fresh listing. */
  it('reads GitHub once for every page of a minute, and again when the listing must be fresh', async () => {
    await pageOf('?page=1');
    await pageOf('?page=2&q=repo');

    expect(calls.installations).toBe(1);

    await pageOf('?page=1&fresh=1');

    expect(calls.installations).toBe(2);
  });

  it('refuses an account that is no admin', async () => {
    const headers = await authHeaders(await insertAccount());

    expect((await list('', headers)).status).toBe(403);
  });
});
