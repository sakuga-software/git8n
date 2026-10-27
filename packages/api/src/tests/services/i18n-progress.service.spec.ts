import '../setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { I18nRepository } from '@i18n-editor/db';
import { clearI18nCatalogueCache, getCatalogue } from '@/services/i18n-catalogue.service';
import { propose, proposedKeys } from '@/services/i18n-git.service';
import { clearI18nProgressCache, forgetProgress, progressOf } from '@/services/i18n-progress.service';
import { fakeRepo, type FakeRepo } from './fake-github-repo';

vi.mock('@/services/github-app.service', async (original) => ({
  ...(await original<typeof import('@/services/github-app.service')>()),
  installationToken: async () => 'installation-token',
}));

/**
 * How far each language is (DB-268). The side panel of the editor shows these
 * numbers, and they must be the ones its table counts for the same language.
 */

const LOCALES = 'src/locales';

const repository: I18nRepository = {
  id: 'repo-1',
  installationId: 42,
  owner: 'acme',
  name: 'acme-app',
  branch: 'main',
  localesPath: LOCALES,
  manifestPath: null,
  languages: ['fr', 'en', 'de'],
  publishMode: 'commit',
  proposalCommitTemplate: null,
  publicationCommitTemplate: null,
  pullRequestTitleTemplate: null,
  pullRequestBodyTemplate: null,
  createdAt: new Date('2026-09-24T00:00:00Z'),
};

const translator = { name: 'Camille', email: 'camille@users.noreply.invalid' };

let repo: FakeRepo;

const start = (extra: Record<string, unknown> = {}) => {
  repo = fakeRepo({
    owner: repository.owner,
    name: repository.name,
    baseBranch: 'main',
    files: {
      [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour', bye: 'Au revoir', back: 'Retour', next: 'Suivant' },
      [`${LOCALES}/fr/guide.json`]: { title: 'The guide' },
      [`${LOCALES}/en/common.json`]: { hello: 'Hello', bye: 'Bye' },
      [`${LOCALES}/de/common.json`]: { hello: 'Hallo' },
      [`${LOCALES}/manifest.json`]: { source: 'fr', files: { guide: { en: 'disabled' } } },
      ...extra,
    },
  });
  vi.stubGlobal('fetch', repo.fetch);

  return repo;
};

const of = (rows: Awaited<ReturnType<typeof progressOf>>, language: string) =>
  rows.find((row) => row.language === language);

beforeEach(() => {
  clearI18nCatalogueCache();
  clearI18nProgressCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearI18nCatalogueCache();
  clearI18nProgressCache();
});

describe('the progress of each language', () => {
  it('answers every target, and not the source', async () => {
    start();

    expect((await progressOf(repository)).map((row) => row.language)).toEqual(['en', 'de']);
  });

  it('puts every key of the source in one of the four counts', async () => {
    start();

    const progress = await progressOf(repository);

    // English holds no version of `guide`: its key is in no count there.
    expect(of(progress, 'en')).toEqual({
      language: 'en',
      published: 2,
      proposed: 0,
      missing: 2,
      review: 0,
      empty: 0,
      total: 4,
    });
    // German has no manifest entry, so the file counts, and its key is missing.
    expect(of(progress, 'de')).toEqual({
      language: 'de',
      published: 1,
      proposed: 0,
      missing: 4,
      review: 0,
      empty: 0,
      total: 5,
    });
  });

  /** The table shows such a key under « Proposées », so it is not published here either. */
  it('counts a key that waits as proposed, with or without a published value', async () => {
    start();

    const readAt = repo.refs.get('main')!;

    await propose(
      repository,
      'en',
      [
        { file: 'common', key: 'hello', value: 'Hi' },
        { file: 'common', key: 'back', value: 'Back' },
      ],
      translator,
      readAt,
    );

    expect(of(await progressOf(repository), 'en')).toEqual({
      language: 'en',
      published: 1,
      proposed: 2,
      missing: 1,
      review: 0,
      empty: 0,
      total: 4,
    });
  });

  it('counts what the catalogue and the keys that wait say, for each language', async () => {
    start();
    await propose(
      repository,
      'de',
      [{ file: 'common', key: 'bye', value: 'Tschüss' }],
      translator,
      repo.refs.get('main')!,
    );

    const progress = await progressOf(repository);

    for (const language of ['en', 'de']) {
      const catalogue = await getCatalogue(repository, language);
      const waiting = new Set((await proposedKeys(repository, language)).map((row) => `${row.file}\n${row.key}`));
      const row = of(progress, language)!;

      expect(row.total).toBe(catalogue.entries.length);
      expect(row.proposed).toBe(waiting.size);
      expect(row.published + row.proposed + row.missing).toBe(row.total);
    }
  });
});

describe('what the progress costs', () => {
  it('asks GitHub nothing for a second read inside a minute', async () => {
    start();
    await progressOf(repository, { now: new Date('2026-10-08T10:00:00Z') });

    const calls = repo.fetch.mock.calls.length;

    await progressOf(repository, { now: new Date('2026-10-08T10:00:59Z') });

    expect(repo.fetch.mock.calls.length).toBe(calls);
  });

  it('reads again after a minute', async () => {
    start();
    await progressOf(repository, { now: new Date('2026-10-08T10:00:00Z') });

    const calls = repo.fetch.mock.calls.length;

    await progressOf(repository, { now: new Date('2026-10-08T10:01:01Z') });

    expect(repo.fetch.mock.calls.length).toBeGreaterThan(calls);
  });

  /** Two panels that open together must not read every language twice. */
  it('shares one read between two callers that ask together', async () => {
    start();

    const [first, second] = await Promise.all([progressOf(repository), progressOf(repository)]);

    expect(second).toBe(first);
  });

  /** Whoever proposed must not read the numbers of before. */
  it('reads again once a write dropped what was held', async () => {
    start();

    const before = await progressOf(repository);

    await propose(
      repository,
      'en',
      [{ file: 'common', key: 'back', value: 'Back' }],
      translator,
      repo.refs.get('main')!,
    );
    forgetProgress(repository.id);

    const after = await progressOf(repository);

    expect(of(before, 'en')!.proposed).toBe(0);
    expect(of(after, 'en')!.proposed).toBe(1);
  });

  it('holds nothing of a read that failed', async () => {
    start();
    vi.stubGlobal('fetch', async () => new Response('{"message":"Bad gateway"}', { status: 502 }));
    await expect(progressOf(repository)).rejects.toThrow();
    vi.stubGlobal('fetch', repo.fetch);
    clearI18nCatalogueCache();

    expect(await progressOf(repository)).toHaveLength(2);
  });
});
