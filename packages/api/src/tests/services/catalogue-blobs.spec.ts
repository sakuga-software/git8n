import '../setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { I18nRepository } from '@git8n/db';
import { clearI18nCatalogueCache, forgetCatalogues, getCatalogue } from '@/services/i18n-catalogue.service';
import { fakeRepo, type FakeRepo } from './fake-github-repo';

vi.mock('@/services/github-app.service', async (original) => ({
  ...(await original<typeof import('@/services/github-app.service')>()),
  installationToken: async () => 'installation-token',
}));

/**
 * A cold catalogue reads only what changed, and reads it in parallel (DB-654).
 *
 * One by one, the 43 files of a real repository took 12 s.
 */

const LOCALES = 'src/locales';
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

const repository: I18nRepository = {
  id: 'repo-blobs',
  installationId: 42,
  owner: 'acme',
  name: 'acme-app',
  branch: 'main',
  localesPath: LOCALES,
  manifestPath: null,
  languages: ['fr', 'en'],
  publishMode: 'commit',
  proposalCommitTemplate: null,
  publicationCommitTemplate: null,
  pullRequestTitleTemplate: null,
  pullRequestBodyTemplate: null,
  organizationId: 'organization-1',
  createdAt: new Date('2026-09-24T00:00:00Z'),
};

let repo: FakeRepo;

const blobReads = () => repo.fetch.mock.calls.filter(([url]) => String(url).includes('/git/blobs/')).length;

beforeEach(() => {
  clearI18nCatalogueCache();
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

afterEach(() => vi.unstubAllGlobals());

describe('the files of a catalogue', () => {
  it('after a push, asks again only for the file that changed', async () => {
    await getCatalogue(repository, 'en');

    const cold = blobReads();

    repo.moveBranch('main', { [`${LOCALES}/en/c.json`]: { hello: 'Hi c' } });
    forgetCatalogues(repository.id);

    const after = await getCatalogue(repository, 'en');

    expect(cold).toBe(FILES.length * 2);
    expect(blobReads() - cold).toBe(1);
    expect(after.entries.find((entry) => entry.file === 'c')?.value).toBe('Hi c');
  });

  it('reads several files at once, and never more than eight files (two blobs each)', async () => {
    let inFlight = 0;
    let most = 0;
    const answer = repo.fetch.getMockImplementation()!;

    repo.fetch.mockImplementation(async (url, init) => {
      if (!String(url).includes('/git/blobs/')) return answer(url, init);

      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((done) => setTimeout(done, 5));
      inFlight -= 1;

      return answer(url, init);
    });

    await getCatalogue(repository, 'en');

    expect(most).toBeGreaterThan(2);
    expect(most).toBeLessThanOrEqual(16);
  });
});
