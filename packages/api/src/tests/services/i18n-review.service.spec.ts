import '../setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { I18nRepository } from '@git8n/db';
import { clearI18nCatalogueCache, getCatalogue } from '@/services/i18n-catalogue.service';
import { acknowledge, propose, proposedKeys, publish } from '@/services/i18n-git.service';
import { clearI18nProgressCache, progressOf } from '@/services/i18n-progress.service';
import { reviewedKeysOf, reviewedLine } from '@/services/i18n-review.service';
import { fakeRepo, type FakeRepo } from './fake-github-repo';
import { lineDiff } from './line-diff';

vi.mock('@/services/github-app.service', async (original) => ({
  ...(await original<typeof import('@/services/github-app.service')>()),
  installationToken: async () => 'installation-token',
}));

/**
 * The source is written as a target is, and a translation of a changed source
 * is to read again (DB-607).
 */

const LOCALES = 'src/locales';
const FR = `${LOCALES}/fr/woodlock.json`;
const EN = `${LOCALES}/en/woodlock.json`;

/** Shaped like the hints of `woodlock.json`: keys that look like integers beside others, and tabs. */
const HINTS_FR =
  '{\n\t"hints": {\n\t\t"1": "Un",\n\t\t"3": "Trois",\n\t\t"3_image": "/img/3.png",\n\t\t"5_image": "",\n\t\t"12": "Douze"\n\t}\n}\n';
const HINTS_EN =
  '{\n\t"hints": {\n\t\t"1": "One",\n\t\t"3": "Three",\n\t\t"3_image": "",\n\t\t"5_image": "/img/3.png",\n\t\t"12": "Twelve"\n\t}\n}\n';

const repository: I18nRepository = {
  id: 'repo-review',
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

const writer = { name: 'Sacha', email: 'sacha@users.noreply.invalid' };
const reviewer = { name: 'Dominique', email: 'dominique@users.noreply.invalid' };

let repo: FakeRepo;

const start = () => {
  repo = fakeRepo({ owner: 'acme', name: 'acme-app', baseBranch: 'main', files: { [FR]: HINTS_FR, [EN]: HINTS_EN } });
  vi.stubGlobal('fetch', repo.fetch);
};

const head = () => repo.refs.get('main')!;

/** Proposes then publishes one source text, as the editor does. */
const changeSource = async (key: string, value: string, connected = repository) => {
  const proposal = await propose(connected, 'fr', [{ file: 'woodlock', key, value }], writer, head());

  return publish(connected, 'fr', [{ file: 'woodlock', key, commit: proposal.commit }], writer);
};

const entryOf = async (key: string, connected = repository) =>
  (await getCatalogue(connected, 'en')).entries.find((entry) => entry.key === key);

beforeEach(() => {
  clearI18nCatalogueCache();
  clearI18nProgressCache();
  start();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearI18nCatalogueCache();
  clearI18nProgressCache();
});

describe('a change of the source', () => {
  it('changes one line of the source file', async () => {
    const published = await changeSource('hints.12', 'Douze !');

    expect(published.refused).toEqual([]);
    expect(lineDiff(HINTS_FR, repo.filesAt(published.commit!).get(FR)!)).toEqual({
      removed: ['\t\t"12": "Douze"'],
      added: ['\t\t"12": "Douze !"'],
    });
  });

  it('lists the source among the keys that wait, before it is published', async () => {
    await propose(repository, 'fr', [{ file: 'woodlock', key: 'hints.3', value: 'Trois !' }], writer, head());

    const waiting = await proposedKeys(repository, 'fr');

    expect(waiting).toEqual([expect.objectContaining({ key: 'hints.3', value: 'Trois !', current: 'Trois' })]);
  });

  it('refuses a key the source does not hold: a new key goes through « Nouvelle clé »', async () => {
    await expect(
      propose(
        repository,
        'fr',
        [{ file: 'woodlock', key: 'hints.99', value: 'Quatre-vingt-dix-neuf' }],
        writer,
        head(),
      ),
    ).rejects.toThrow(/Nouvelle clé/);
  });

  it('refuses an empty source text', async () => {
    await expect(
      propose(repository, 'fr', [{ file: 'woodlock', key: 'hints.3', value: '  ' }], writer, head()),
    ).rejects.toThrow(/has no text/);
  });

  it('refuses to publish a source text whose base moved since the proposal', async () => {
    const proposal = await propose(
      repository,
      'fr',
      [{ file: 'woodlock', key: 'hints.3', value: 'Trois !' }],
      writer,
      head(),
    );

    // Somebody changes the same text on the base branch, by hand.
    repo.moveBranch('main', { [FR]: HINTS_FR.replace('"Trois"', '"Trois ?"') });

    const published = await publish(
      repository,
      'fr',
      [{ file: 'woodlock', key: 'hints.3', commit: proposal.commit }],
      writer,
    );

    expect(published.commit).toBeNull();
    expect(published.refused).toEqual([
      expect.objectContaining({ key: 'hints.3', reason: 'source-changed', was: 'Trois', now: 'Trois ?' }),
    ]);
  });
});

describe('a translation to read again', () => {
  it('shows a translation whose source changed, with the old and the new source', async () => {
    await changeSource('hints.3', 'Trois !');

    expect(await entryOf('hints.3')).toMatchObject({
      state: 'review',
      value: 'Three',
      source: 'Trois !',
      was: 'Trois',
    });
    // The other keys of the file did not change.
    expect(await entryOf('hints.12')).toMatchObject({ state: 'translated' });
  });

  it('keeps the first source text after two changes, which is the one the translation answers', async () => {
    await changeSource('hints.3', 'Trois !');
    clearI18nCatalogueCache();
    await changeSource('hints.3', 'Trois !!');

    expect(await entryOf('hints.3')).toMatchObject({ state: 'review', was: 'Trois', source: 'Trois !!' });
  });

  it('asks nothing when the source came back to its old text', async () => {
    await changeSource('hints.3', 'Trois !');
    clearI18nCatalogueCache();
    await changeSource('hints.3', 'Trois');

    expect(await entryOf('hints.3')).toMatchObject({ state: 'translated' });
  });

  it('asks nothing of a missing translation: it is missing, not to read again', async () => {
    // `3_image` is empty in English.
    await changeSource('hints.3_image', '/img/3b.png');

    expect(await entryOf('hints.3_image')).toMatchObject({ state: 'missing' });
  });

  it('asks nothing when the translation changed in the same commit as its source', async () => {
    repo.moveBranch('main', {
      [FR]: HINTS_FR.replace('"Trois"', '"Trois !"'),
      [EN]: HINTS_EN.replace('"Three"', '"Three!"'),
    });

    expect(await entryOf('hints.3')).toMatchObject({ state: 'translated', value: 'Three!' });
  });

  it('counts the key apart in the progress of the language', async () => {
    await changeSource('hints.3', 'Trois !');

    const [en] = await progressOf(repository);

    expect(en).toMatchObject({ language: 'en', review: 1, published: 3, missing: 1, total: 5 });
  });

  it('clears the state when a new translation is published', async () => {
    await changeSource('hints.3', 'Trois !');

    const proposal = await propose(
      repository,
      'en',
      [{ file: 'woodlock', key: 'hints.3', value: 'Three!' }],
      writer,
      head(),
    );

    await publish(repository, 'en', [{ file: 'woodlock', key: 'hints.3', commit: proposal.commit }], reviewer);
    clearI18nCatalogueCache();

    expect(await entryOf('hints.3')).toMatchObject({ state: 'translated', value: 'Three!' });
  });

  it('clears the state when a reviewer keeps the translation, with a commit that changes no file', async () => {
    await changeSource('hints.3', 'Trois !');

    const files = repo.filesAt(head());
    const kept = await acknowledge(repository, 'en', [{ file: 'woodlock', key: 'hints.3' }], reviewer);

    expect(kept.kept).toEqual([{ file: 'woodlock', key: 'hints.3' }]);
    expect(repo.filesAt(kept.commit!)).toEqual(files);
    expect(repo.commits.get(kept.commit!)!.message).toContain(reviewedLine('en', { file: 'woodlock', key: 'hints.3' }));
    expect(await entryOf('hints.3')).toMatchObject({ state: 'translated', value: 'Three' });
  });

  it('writes nothing for a key that is not to read again', async () => {
    const before = head();
    const kept = await acknowledge(repository, 'en', [{ file: 'woodlock', key: 'hints.12' }], reviewer);

    expect(kept).toMatchObject({ commit: null, kept: [], skipped: [{ file: 'woodlock', key: 'hints.12' }] });
    expect(head()).toBe(before);
  });

  it('ignores what changed before the repository was connected', async () => {
    repo.moveBranch('main', { [FR]: HINTS_FR.replace('"Trois"', '"Trois !"') });

    expect(await entryOf('hints.3', { ...repository, createdAt: new Date(Date.now() + 60_000) })).toMatchObject({
      state: 'translated',
    });
  });
});

describe('in the mode pull_request', () => {
  const connected: I18nRepository = { ...repository, publishMode: 'pull_request' };

  it('puts the source change in the pull request, and asks for a review once it is merged', async () => {
    await changeSource('hints.3', 'Trois !', connected);

    expect(await entryOf('hints.3', connected)).toMatchObject({ state: 'translated', source: 'Trois' });
    expect(repo.pulls.size).toBe(1);

    repo.mergePull(1);
    clearI18nCatalogueCache();

    expect(await entryOf('hints.3', connected)).toMatchObject({ state: 'review', was: 'Trois', source: 'Trois !' });
  });
});

describe('the trailer', () => {
  it('is read for its own language only', () => {
    const message = [
      'i18n(en): 1 key reviewed by Dominique',
      '',
      reviewedLine('en', { file: 'woodlock', key: 'hints.3' }),
    ].join('\n');

    expect(reviewedKeysOf(message, 'en')).toEqual(['woodlock\nhints.3']);
    expect(reviewedKeysOf(message, 'de')).toEqual([]);
  });
});
