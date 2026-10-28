import '../setup-env';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18nRepositories, newId } from '@git8n/db';
import app from '../../app';
import { db } from '@/db';
import { clearOverviewCache } from '@/services/i18n-overview.service';
import { authHeaders, grant, insertAccount, insertOrganization, signedInAdmin } from '../db/fixtures';
import { useTestDb } from '../db/test-db';

/**
 * The progress and the pull request come from GitHub. Here they come from the
 * name of the repository: `repo-07` has 7 keys of 10 published in English and
 * 3 of 10 in German, and `broken` makes GitHub fail.
 */
const calls = vi.hoisted(() => ({ progress: [] as string[], pulls: 0 }));

vi.mock('@/services/i18n-progress.service', async (original) => {
  const real = await original<typeof import('@/services/i18n-progress.service')>();

  return {
    ...real,
    progressOf: async (repository: { name: string }) => {
      calls.progress.push(repository.name);

      if (repository.name === 'broken') throw new Error('GitHub answered 502');

      const published = Number(repository.name.replace(/\D/g, '')) % 11;

      // The source comes first, all published, as `progressOf` answers it since DB-675.
      return [
        { language: 'fr', published: 10, proposed: 0, missing: 0, total: 10 },
        { language: 'en', published, proposed: 0, missing: 10 - published, total: 10 },
        { language: 'de', published: 3, proposed: 0, missing: 7, total: 10 },
      ];
    },
  };
});

vi.mock('@/services/i18n-pull-request.service', async (original) => {
  const real = await original<typeof import('@/services/i18n-pull-request.service')>();

  return {
    ...real,
    publishToken: async () => 'token',
    openPullOf: async (repository: { name: string }) => {
      calls.pulls += 1;

      return repository.name === 'repo-02' ? { number: 12, html_url: 'https://github.com/acme/repo-02/pull/12' } : null;
    },
  };
});

useTestDb();

interface Page {
  rows: Array<{
    owner: string;
    name: string;
    publishMode: string;
    progress: Array<{ language: string; published: number }> | null;
    progressError?: string;
    pullRequest: { number: number; url: string } | null;
  }>;
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

/** Twelve repositories, connected a day apart: `repo-01` first and `repo-10` last, `broken` in between. */
async function repositories() {
  const names = [
    'repo-01',
    'repo-02',
    'repo-03',
    'repo-04',
    'repo-05',
    'broken',
    'repo-06',
    'repo-07',
    'repo-08',
    'repo-09',
    'repo-10',
    'other-11',
  ];

  for (const [index, name] of names.entries()) {
    await db()
      .insert(i18nRepositories)
      .values({
        id: newId(),
        organizationId: await insertOrganization(),
        installationId: 42,
        owner: name === 'other-11' ? 'beta' : 'acme',
        name,
        branch: 'main',
        localesPath: 'src/locales',
        languages: ['fr', 'en', 'de'],
        publishMode: name === 'repo-02' || name === 'repo-03' ? 'pull_request' : 'commit',
        createdAt: new Date(Date.UTC(2026, 9, 1 + index)),
      } as never);
  }
}

const read = async (query: string, headers?: Record<string, string>) =>
  app.request(`/i18n/overview${query}`, { headers: headers ?? (await signedInAdmin()).headers });

const pageOf = async (query: string, headers?: Record<string, string>) =>
  ((await (await read(query, headers)).json()) as { data: Page }).data;

const names = (page: Page) => page.rows.map((row) => `${row.owner}/${row.name}`);

beforeEach(async () => {
  clearOverviewCache();
  calls.progress = [];
  calls.pulls = 0;
  await repositories();
});

describe('GET /i18n/overview', () => {
  it('answers 20 repositories a page by default, by name, and says how many there are', async () => {
    const first = await pageOf('?perPage=5');

    expect(first).toMatchObject({ page: 1, perPage: 5, total: 12, hasMore: true });
    expect(names(first)).toEqual(['acme/broken', 'acme/repo-01', 'acme/repo-02', 'acme/repo-03', 'acme/repo-04']);
    expect((await pageOf('')).perPage).toBe(20);
  });

  it('walks every page, the last one short and with nothing after it', async () => {
    const last = await pageOf('?perPage=5&page=3');

    expect(last).toMatchObject({ page: 3, total: 12, hasMore: false });
    expect(names(last)).toEqual(['acme/repo-10', 'beta/other-11']);
  });

  it('searches the owner and the name, whatever the case', async () => {
    expect(names(await pageOf('?q=BETA'))).toEqual(['beta/other-11']);
    expect(names(await pageOf('?q=acme/repo-0&perPage=3'))).toEqual(['acme/repo-01', 'acme/repo-02', 'acme/repo-03']);
    expect(await pageOf('?q=nothing')).toMatchObject({ rows: [], total: 0, hasMore: false });
  });

  it('sorts by the date of connection, both ways', async () => {
    expect(names(await pageOf('?sort=created&perPage=2'))).toEqual(['acme/repo-01', 'acme/repo-02']);
    expect(names(await pageOf('?sort=created&order=desc&perPage=2'))).toEqual(['beta/other-11', 'acme/repo-10']);
  });

  it('sorts by the share of keys published over every page, the unreadable ones first in ascending order', async () => {
    const ascending = await pageOf('?sort=progress&perPage=3');

    // `broken` has no progress, so it counts below 0 %. Then 10 % (other-11 % 11 = 0, plus 3 of 10 in German).
    expect(names(ascending)).toEqual(['acme/broken', 'beta/other-11', 'acme/repo-01']);

    const descending = await pageOf('?sort=progress&order=desc&perPage=2');

    expect(names(descending)).toEqual(['acme/repo-10', 'acme/repo-09']);
    // Each request reads the progress of each match once: the page reuses what the order read.
    expect(calls.progress.filter((name) => name === 'repo-10')).toHaveLength(2);
  });

  it('reads the progress of the rows of the page only, when the order is not by progress', async () => {
    await pageOf('?perPage=4');

    expect([...calls.progress].sort()).toEqual(['broken', 'repo-01', 'repo-02', 'repo-03']);
  });

  it('keeps a repository that GitHub refuses, and says why', async () => {
    const [broken] = (await pageOf('?q=broken')).rows;

    expect(broken).toMatchObject({ progress: null, progressError: expect.stringContaining('502') });
  });

  it('gives the open pull request of a repository that publishes by pull request, and holds it a minute', async () => {
    const page = await pageOf('?q=repo-0&perPage=3');

    expect(page.rows.map((row) => row.pullRequest)).toEqual([
      null,
      { number: 12, url: 'https://github.com/acme/repo-02/pull/12' },
      null,
    ]);
    // `repo-01` publishes by commit: only repo-02 and repo-03 ask GitHub.
    expect(calls.pulls).toBe(2);

    await pageOf('?q=repo-0&perPage=3');

    expect(calls.pulls).toBe(2);
  });

  /** The share of a repository is how far its translations are: the source is not in it (DB-675). */
  it('leaves the source out of the progress of a row', async () => {
    const [row] = (await pageOf('?q=repo-07')).rows;

    expect(row.progress?.map((entry) => entry.language)).toEqual(['en', 'de']);
  });

  it('answers a translator the progress of its languages only', async () => {
    const userId = await insertAccount();
    const [repo] = await db().select().from(i18nRepositories).where(eq(i18nRepositories.name, 'repo-07'));

    await grant(userId, repo.id, { languages: ['de'] });

    const [row] = (await pageOf('?q=repo-07', await authHeaders(userId))).rows;

    expect(row.progress).toEqual([expect.objectContaining({ language: 'de' })]);
  });

  /** A member reads the repositories where it is a member, and no other (DB-637). */
  it('answers a member only the repositories where it is a member', async () => {
    const userId = await insertAccount();
    const [repo] = await db().select().from(i18nRepositories).where(eq(i18nRepositories.name, 'repo-07'));

    await grant(userId, repo.id, { languages: ['de'] });

    const page = await pageOf('', await authHeaders(userId));

    expect(page.rows.map((row) => row.name)).toEqual(['repo-07']);
    expect(page.total).toBe(1);
  });

  it('refuses an account with no right, and a page past the limits', async () => {
    expect((await read('', await authHeaders(await insertAccount()))).status).toBe(403);
    expect((await read('?perPage=101')).status).toBe(400);
    expect((await read('?page=0')).status).toBe(400);
    expect((await read('?sort=size')).status).toBe(400);
  });
});
