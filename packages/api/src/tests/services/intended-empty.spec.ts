import '../setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { I18nRepository } from '@i18n-editor/db';
import { clearI18nCatalogueCache, getCatalogue } from '@/services/i18n-catalogue.service';
import { acknowledge, propose, proposedKeys, publish } from '@/services/i18n-git.service';
import { clearI18nProgressCache, progressOf } from '@/services/i18n-progress.service';
import { marksOf, sourceHashOf, writeMark } from '@/services/intended-empty';
import { LocaleFile, UnwritableKeyError } from '@/services/locale-file';
import { fakeRepo, type FakeRepo } from './fake-github-repo';

vi.mock('@/services/github-app.service', async (original) => ({
  ...(await original<typeof import('@/services/github-app.service')>()),
  installationToken: async () => 'installation-token',
}));

/**
 * A key left empty on purpose in one language (DB-611).
 *
 * The case is the one of `woodlock.json`: English moves the picture of the
 * hint 3 to the hint 5, so its `3_image` is `""` on purpose. Read as missing,
 * a translator fills it, and the English player sees the picture twice.
 */

const LOCALES = 'src/locales';
const FR = `${LOCALES}/fr/woodlock.json`;
const EN = `${LOCALES}/en/woodlock.json`;
const MANIFEST = `${LOCALES}/manifest.json`;

const HINTS_FR = '{\n\t"hints": {\n\t\t"3": "Trois",\n\t\t"3_image": "/img/3.png",\n\t\t"5_image": ""\n\t}\n}\n';
const HINTS_EN = '{\n\t"hints": {\n\t\t"3": "Three",\n\t\t"3_image": "",\n\t\t"5_image": "/img/3.png"\n\t}\n}\n';
const MANIFEST_TEXT = '{\n\t"source": "fr",\n\t"files": {\n\t\t"illusion": { "en": "disabled" }\n\t}\n}\n';

const repository: I18nRepository = {
  id: 'repo-empty',
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

const translator = { name: 'Camille', email: 'camille@users.noreply.invalid' };
const reviewer = { name: 'Dominique', email: 'dominique@users.noreply.invalid' };
const KEY = { file: 'woodlock', key: 'hints.3_image' };

let repo: FakeRepo;

const start = (files: Record<string, string> = { [FR]: HINTS_FR, [EN]: HINTS_EN, [MANIFEST]: MANIFEST_TEXT }) => {
  repo = fakeRepo({ owner: 'acme', name: 'acme-app', baseBranch: 'main', files });
  vi.stubGlobal('fetch', repo.fetch);
};

const head = () => repo.refs.get('main')!;
const textAt = (ref: string, path: string) => repo.filesAt(ref).get(path);
const entryOf = async (key: string) =>
  (await getCatalogue(repository, 'en')).entries.find((entry) => entry.key === key);

/** Marks the key, or removes its mark, and publishes it, as the editor does. */
const markAndPublish = async (empty: boolean, value = '') => {
  const proposal = await propose(repository, 'en', [{ ...KEY, value, empty }], translator, head());

  return publish(repository, 'en', [{ ...KEY, commit: proposal.commit }], reviewer);
};

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

describe('the text of a manifest', () => {
  it('adds a mark with the indentation of the file, and its removal gives back the same text', () => {
    const manifest = LocaleFile.parse(MANIFEST_TEXT);

    expect(writeMark(manifest, 'en', KEY, 'a1b2c3d4e5f6')).toBe(true);
    expect(JSON.parse(manifest.toString())).toEqual({
      source: 'fr',
      files: { illusion: { en: 'disabled' } },
      empty: { en: { 'woodlock:hints.3_image': { source: 'a1b2c3d4e5f6' } } },
    });
    expect(manifest.toString()).toContain('\t\t"en": {\n\t\t\t"woodlock:hints.3_image": {\n\t\t\t\t"source"');

    expect(writeMark(manifest, 'en', KEY, null)).toBe(true);
    expect(manifest.toString()).toBe(MANIFEST_TEXT);
  });

  it('removes one mark and keeps the others of the language', () => {
    const manifest = LocaleFile.parse(MANIFEST_TEXT);

    writeMark(manifest, 'en', KEY, 'aaaaaaaaaaaa');
    writeMark(manifest, 'en', { file: 'common', key: 'title' }, 'bbbbbbbbbbbb');
    writeMark(manifest, 'en', KEY, null);

    expect(marksOf(JSON.parse(manifest.toString()), 'en')).toEqual(new Map([['common\ntitle', 'bbbbbbbbbbbb']]));
  });

  it('changes nothing to remove a mark the manifest does not hold', () => {
    const manifest = LocaleFile.parse(MANIFEST_TEXT);

    expect(writeMark(manifest, 'en', KEY, null)).toBe(false);
    expect(manifest.toString()).toBe(MANIFEST_TEXT);
  });

  it('reads a name with a dot in the key, and ignores a name with no file', () => {
    expect(
      marksOf({ empty: { en: { 'woodlock:hints.3_image': { source: 'x' }, nofile: { source: 'y' } } } }, 'en'),
    ).toEqual(new Map([['woodlock\nhints.3_image', 'x']]));
  });
});

describe('marking a key as empty on purpose', () => {
  it('proposes the mark on the branch of the language, with the hash of the source read', async () => {
    const proposal = await propose(repository, 'en', [{ ...KEY, value: '', empty: true }], translator, head());

    expect(proposal.files).toEqual([EN, MANIFEST]);
    expect(marksOf(JSON.parse(textAt(proposal.commit, MANIFEST)!), 'en')).toEqual(
      new Map([['woodlock\nhints.3_image', sourceHashOf('/img/3.png')]]),
    );
    // The base branch waits for a reviewer.
    expect(textAt(head(), MANIFEST)).toBe(MANIFEST_TEXT);
  });

  it('lists the mark as a proposal, even when the base branch already says ""', async () => {
    await propose(repository, 'en', [{ ...KEY, value: '', empty: true }], translator, head());

    const [row] = await proposedKeys(repository, 'en');

    expect(row).toMatchObject({ ...KEY, value: '', current: '', empty: true });
  });

  it('publishes the mark onto the manifest of the base branch, and changes no other byte', async () => {
    const before = textAt(head(), EN);
    const publication = await markAndPublish(true);

    expect(publication.published).toEqual([expect.objectContaining(KEY)]);
    expect(textAt(head(), EN)).toBe(before);
    expect(textAt(head(), MANIFEST)).toBe(
      '{\n\t"source": "fr",\n\t"files": {\n\t\t"illusion": { "en": "disabled" }\n\t},\n\t"empty": {\n\t\t"en": {\n\t\t\t"woodlock:hints.3_image": {\n\t\t\t\t"source": "' +
        sourceHashOf('/img/3.png') +
        '"\n\t\t\t}\n\t\t}\n\t}\n}\n',
    );
    expect(await proposedKeys(repository, 'en')).toEqual([]);
  });

  it('writes "" over a value the branch held, in the same batch as the mark', async () => {
    // The proposal of the 26th filled the key, thinking it was missing.
    await propose(repository, 'en', [{ ...KEY, value: '/img/3.png' }], translator, head());
    const proposal = await propose(repository, 'en', [{ ...KEY, value: '', empty: true }], translator, head());

    expect(JSON.parse(textAt(proposal.commit, EN)!).hints['3_image']).toBe('');
    expect(await proposedKeys(repository, 'en')).toEqual([expect.objectContaining({ value: '', empty: true })]);
  });

  it('makes a manifest when the repository holds none', async () => {
    start({ [FR]: HINTS_FR, [EN]: HINTS_EN });

    await markAndPublish(true);

    expect(JSON.parse(textAt(head(), MANIFEST)!)).toEqual({
      empty: { en: { 'woodlock:hints.3_image': { source: sourceHashOf('/img/3.png') } } },
    });
  });

  it('refuses to mark a key of the source', async () => {
    await expect(
      propose(repository, 'fr', [{ ...KEY, value: '', empty: true }], translator, head()),
    ).rejects.toBeInstanceOf(UnwritableKeyError);
  });

  it('refuses a mark that the branch removed after the approved batch', async () => {
    const marked = await propose(repository, 'en', [{ ...KEY, value: '', empty: true }], translator, head());

    await propose(repository, 'en', [{ ...KEY, value: '' }], translator, head());

    const publication = await publish(repository, 'en', [{ ...KEY, commit: marked.commit }], reviewer);

    expect(publication.refused).toEqual([expect.objectContaining({ reason: 'changed-since-approval' })]);
    expect(textAt(head(), MANIFEST)).toBe(MANIFEST_TEXT);
  });
});

describe('removing the mark', () => {
  it('is a proposal of the key with no mark, and gives the manifest back as it was', async () => {
    await markAndPublish(true);
    await markAndPublish(false);

    expect(textAt(head(), MANIFEST)).toBe(MANIFEST_TEXT);
    expect(await entryOf('hints.3_image')).toMatchObject({ state: 'missing', value: null });
  });

  it('goes with a text proposed for the key', async () => {
    await markAndPublish(true);
    await markAndPublish(false, 'Picture');

    expect(textAt(head(), MANIFEST)).toBe(MANIFEST_TEXT);
    expect(await entryOf('hints.3_image')).toMatchObject({ state: 'translated', value: 'Picture' });
  });
});

describe('the catalogue and the progress', () => {
  it('counts a marked key as translated, with no text, and apart in the progress', async () => {
    await markAndPublish(true);
    clearI18nCatalogueCache();

    expect(await entryOf('hints.3_image')).toEqual({
      ...KEY,
      source: '/img/3.png',
      value: '',
      state: 'translated',
      empty: true,
    });

    const [english] = await progressOf(repository);

    expect(english).toMatchObject({ published: 3, missing: 0, empty: 1, total: 3 });
  });

  it('asks to read the key again when the source changed since the mark', async () => {
    await markAndPublish(true);
    repo.moveBranch('main', { [FR]: HINTS_FR.replace('/img/3.png', '/img/3-new.png') });
    clearI18nCatalogueCache();

    expect(await entryOf('hints.3_image')).toMatchObject({ state: 'review', value: '', empty: true });
    expect((await entryOf('hints.3_image'))?.was).toBeUndefined();
  });

  it('ignores a mark on a key whose value is not "" any more', async () => {
    repo.moveBranch('main', {
      [MANIFEST]: JSON.stringify({ empty: { en: { 'woodlock:hints.3': { source: 'x' } } } }),
    });
    clearI18nCatalogueCache();

    expect(await entryOf('hints.3')).toEqual({
      file: 'woodlock',
      key: 'hints.3',
      source: 'Trois',
      value: 'Three',
      state: 'translated',
    });
  });

  it('ignores a mark on a key the target does not hold', async () => {
    repo.moveBranch('main', {
      [EN]: '{\n\t"hints": {\n\t\t"3": "Three"\n\t}\n}\n',
      [MANIFEST]: JSON.stringify({ empty: { en: { 'woodlock:hints.3_image': { source: 'x' } } } }),
    });
    clearI18nCatalogueCache();

    expect(await entryOf('hints.3_image')).toMatchObject({ state: 'missing', value: null });
    expect((await entryOf('hints.3_image'))?.empty).toBeUndefined();
  });
});

describe('keeping a marked key after its source changed', () => {
  it('writes the hash of the new source, and the key is translated again', async () => {
    await markAndPublish(true);
    repo.moveBranch('main', { [FR]: HINTS_FR.replace('/img/3.png', '/img/3-new.png') });

    const kept = await acknowledge(repository, 'en', [KEY], reviewer);

    expect(kept.kept).toEqual([KEY]);
    expect(marksOf(JSON.parse(textAt(head(), MANIFEST)!), 'en').get('woodlock\nhints.3_image')).toBe(
      sourceHashOf('/img/3-new.png'),
    );
    clearI18nCatalogueCache();
    expect(await entryOf('hints.3_image')).toMatchObject({ state: 'translated', empty: true });
  });

  it('leaves out a marked key whose source did not change', async () => {
    await markAndPublish(true);

    const kept = await acknowledge(repository, 'en', [KEY], reviewer);

    expect(kept).toMatchObject({ commit: null, kept: [], skipped: [KEY] });
  });
});
