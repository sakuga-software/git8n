import '../setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { I18nRepository } from '@i18n-editor/db';
import { clearI18nCatalogueCache, getCatalogue } from '@/services/i18n-catalogue.service';
import { UnknownLanguageError } from '@/services/i18n-repositories.service';
import { proposalSchema } from '@/schemas/i18n';

/** What the reading asked its token for, so the ask itself can be checked. */
const asked: Array<[number, unknown]> = [];

// The GitHub App mints the credential and has its own spec. The token is
// answered here, so a failure is in the reading. What the reading asks for is
// recorded: a token that carries more than it needs shows in no answer.
vi.mock('@/services/github-app.service', async (original) => ({
  ...(await original<typeof import('@/services/github-app.service')>()),
  installationToken: async (installationId: number, scope: unknown) => {
    asked.push([installationId, scope]);

    return 'installation-token';
  },
}));

/**
 * The catalogue is read from GitHub over HTTP (DB-210).
 *
 * The repository answers the content. This pins everything around it:
 *
 * - a key read from two languages at once;
 * - the states;
 * - the ways a read can fail without looking like an empty translation.
 */

const repository: I18nRepository = {
  id: 'repo-1',
  installationId: 42,
  owner: 'acme',
  name: 'acme-app',
  branch: 'main',
  localesPath: 'src/locales',
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

const base64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

const ok = (body: unknown) => ({ ok: true, headers: new Headers(), json: async () => body });
const missing = () => ({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) });

/**
 * A repository that answers `files` per language, and a commit.
 *
 * `manifest` is the content of `manifest.json`, as the file holds it. With
 * none, the repository answers 404 for it, as one from before DB-225 does.
 */
const github = (files: Record<string, Record<string, unknown>>, manifest?: unknown) =>
  vi.fn(async (url: string, _init?: RequestInit) => {
    const path = String(url);

    if (path.includes('/commits/')) return ok({ sha: 'c0ffee1234' });

    // No source text changed since the connection, so nothing is to read again (DB-607).
    if (path.includes('/commits?')) return ok([]);

    if (path.includes('locales/manifest.json?')) {
      return manifest === undefined ? missing() : ok({ content: base64(manifest), encoding: 'base64', sha: 'm' });
    }

    const directory = path.match(/locales\/([^/?]+)\?/);

    if (directory) {
      const held = files[directory[1]];

      if (!held) return missing();

      return ok(
        Object.keys(held).map((name) => ({
          name: `${name}.json`,
          type: 'file',
          sha: `sha-${directory[1]}-${name}`,
        })),
      );
    }

    const file = path.match(/locales\/([^/]+)\/([^/?]+)\.json\?/);

    if (file) {
      const content = files[file[1]]?.[file[2]];

      if (content === undefined) return missing();

      return ok({ content: base64(content), encoding: 'base64', sha: 's' });
    }

    throw new Error(`the test answers no ${path}`);
  });

beforeEach(() => {
  clearI18nCatalogueCache();
  asked.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearI18nCatalogueCache();
});

describe('the catalogue', () => {
  it('puts the two languages of a key side by side', async () => {
    vi.stubGlobal(
      'fetch',
      github({
        fr: { common: { hello: 'Bonjour', bye: 'Au revoir' } },
        en: { common: { hello: 'Hello', bye: '' } },
      }),
    );

    const catalogue = await getCatalogue(repository, 'en');

    expect(catalogue.commit).toBe('c0ffee1234');
    expect(catalogue.repository).toBe('repo-1');
    // The order is the one of the source file, not the alphabet: the keys of a
    // file sit next to the ones they belong with.
    expect(catalogue.entries).toEqual([
      { file: 'common', key: 'hello', source: 'Bonjour', value: 'Hello', state: 'translated' },
      { file: 'common', key: 'bye', source: 'Au revoir', value: null, state: 'missing' },
    ]);
  });

  /**
   * DB-209 settled it on the front. i18next falls back on an empty value
   * instead of drawing a blank line. A file that claims a key and leaves it
   * empty has not translated it.
   */
  it('counts an empty translation as missing, not as translated', async () => {
    vi.stubGlobal('fetch', github({ fr: { a: { k: 'Salut' } }, en: { a: { k: '' } } }));

    const [entry] = (await getCatalogue(repository, 'en')).entries;

    expect(entry).toMatchObject({ state: 'missing', value: null });
  });

  it('reads a file the target language does not hold as every key missing', async () => {
    vi.stubGlobal('fetch', github({ fr: { a: { k: 'Salut' }, b: { j: 'Ciao' } }, en: { a: { k: 'Hi' } } }));

    const entries = (await getCatalogue(repository, 'en')).entries;

    expect(entries.find((entry) => entry.file === 'b')).toMatchObject({ state: 'missing' });
  });

  /**
   * The guide has no English version (DB-225). Read through `absentIsEmpty`,
   * each of its keys answers `missing`, and asks a translator to write a file
   * that must not exist.
   */
  it('leaves out a file the manifest disables, and says it has no version', async () => {
    vi.stubGlobal(
      'fetch',
      github(
        { fr: { common: { hello: 'Bonjour' }, guide: { title: 'Le carnet' } }, en: { common: { hello: 'Hello' } } },
        { source: 'fr', files: { common: { en: 'available' }, guide: { en: 'disabled' } } },
      ),
    );

    const catalogue = await getCatalogue(repository, 'en');

    expect(catalogue.entries.map((entry) => entry.file)).toEqual(['common']);
    expect(catalogue.files).toEqual({ common: 'available', guide: 'disabled' });
  });

  it('keeps a partial file among the keys to translate', async () => {
    vi.stubGlobal(
      'fetch',
      github(
        { fr: { guide: { title: 'Le carnet', end: 'Fin' } }, en: { guide: { title: 'The notebook' } } },
        { files: { guide: { en: 'partial' } } },
      ),
    );

    const catalogue = await getCatalogue(repository, 'en');

    expect(catalogue.files).toEqual({ guide: 'partial' });
    expect(catalogue.entries.map((entry) => [entry.key, entry.state])).toEqual([
      ['title', 'translated'],
      ['end', 'missing'],
    ]);
  });

  /** The source is what the others are translated from. A manifest that disables it would empty the editor. */
  it('reads every file of the source, whatever the manifest says of it', async () => {
    vi.stubGlobal(
      'fetch',
      github({ fr: { guide: { title: 'Le carnet' } } }, { files: { guide: { fr: 'disabled', en: 'disabled' } } }),
    );

    const catalogue = await getCatalogue(repository, 'fr');

    expect(catalogue.files).toEqual({ guide: 'available' });
    expect(catalogue.entries).toHaveLength(1);
  });

  it('reads the manifest at the path that the repository names', async () => {
    const files = {
      fr: { common: { hello: 'Bonjour' }, guide: { title: 'Le carnet' } },
      en: { common: { hello: 'Hello' } },
    };
    const elsewhere = github(files);
    const fetch = vi.fn(async (url: string, init?: RequestInit) =>
      String(url).includes('/contents/config/i18n.json?')
        ? ok({ content: base64({ files: { guide: { en: 'disabled' } } }), encoding: 'base64', sha: 'm' })
        : elsewhere(url, init),
    );

    vi.stubGlobal('fetch', fetch);

    const catalogue = await getCatalogue({ ...repository, manifestPath: 'config/i18n.json' }, 'en');

    expect(catalogue.files).toEqual({ common: 'available', guide: 'disabled' });
    expect(fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('manifest.json'))).toEqual([]);
  });

  it('reads a repository with no manifest as every file available', async () => {
    vi.stubGlobal('fetch', github({ fr: { a: { k: 'Salut' } }, en: { a: { k: 'Hi' } } }));

    expect((await getCatalogue(repository, 'en')).files).toEqual({ a: 'available' });
  });

  /**
   * Read as empty, a manifest that does not parse puts back every file that it
   * disabled, and nothing says so.
   */
  it('refuses a manifest that names a state nobody knows', async () => {
    vi.stubGlobal(
      'fetch',
      github({ fr: { a: { k: 'Salut' } }, en: { a: { k: 'Hi' } } }, { files: { a: { en: 'off' } } }),
    );

    await expect(getCatalogue(repository, 'en')).rejects.toThrow(/manifest\.json is not a manifest/);
  });

  it('refuses a manifest whose source is not the one of the repository', async () => {
    vi.stubGlobal(
      'fetch',
      github({ fr: { a: { k: 'Salut' } }, en: { a: { k: 'Hi' } } }, { source: 'en', files: { a: { fr: 'disabled' } } }),
    );

    await expect(getCatalogue(repository, 'en')).rejects.toThrow(/names en as its source, and the repository names fr/);
  });

  /**
   * `common.v2.json` reads as the file `common.v2`, and the write schemas take
   * no dot (DB-221). Listed, its keys reach a translator, or an agent, that is
   * refused when it names them.
   */
  it('lists no file that a proposal cannot name', async () => {
    vi.stubGlobal(
      'fetch',
      github({
        fr: { common: { hello: 'Bonjour' }, 'common.v2': { hello: 'Salut' } },
        en: { common: { hello: 'Hello' }, 'common.v2': { hello: 'Hi' } },
      }),
    );

    const catalogue = await getCatalogue(repository, 'en');
    const refused = catalogue.entries.filter(
      (entry) =>
        !proposalSchema.safeParse({
          repository: 'repo-1',
          language: 'en',
          readAt: 'a'.repeat(40),
          values: [{ file: entry.file, key: entry.key, value: 'x' }],
        }).success,
    );

    expect(catalogue.entries.map((entry) => entry.file)).toEqual(['common']);
    expect(refused).toEqual([]);
    expect(Object.keys(catalogue.files)).toEqual(['common']);
    expect(catalogue.shas).toEqual({ fr: { common: 'sha-fr-common' }, en: { common: 'sha-en-common' } });
  });

  it('carries the sha of every file, which a publication writes against', async () => {
    vi.stubGlobal('fetch', github({ fr: { a: { k: 'Salut' } }, en: { a: { k: 'Hi' } } }));

    const { shas } = await getCatalogue(repository, 'en');

    expect(shas).toEqual({ fr: { a: 'sha-fr-a' }, en: { a: 'sha-en-a' } });
  });

  /**
   * With neither field, GitHub mints a token for everything the installation
   * holds: every repository, and every permission the App was approved for.
   * Reading needs one repository and `contents: read`.
   */
  it('asks its token for this repository and for reading alone', async () => {
    vi.stubGlobal('fetch', github({ fr: { a: { k: 'Salut' } }, en: { a: { k: 'Hi' } } }));

    await getCatalogue(repository, 'en');

    expect(asked).toEqual([[42, { repository: 'acme-app', permissions: { contents: 'read' } }]]);
  });

  /**
   * The branch can advance between two calls. A source at one revision beside
   * a target at another pairs values that never existed together. It also
   * answers file SHAs that do not belong to the content returned.
   */
  it('reads every file at the commit it answers, not at the branch', async () => {
    const calls = github({ fr: { a: { k: 'Salut' } }, en: { a: { k: 'Hi' } } });

    vi.stubGlobal('fetch', calls);

    const { commit } = await getCatalogue(repository, 'en');
    const contents = calls.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/contents/'));

    expect(contents.length).toBeGreaterThan(0);
    expect(contents.every((url) => url.endsWith(`?ref=${commit}`))).toBe(true);
  });

  it('asks again only after the answer is stale', async () => {
    const calls = github({ fr: { a: { k: 'Salut' } }, en: { a: { k: 'Hi' } } });

    vi.stubGlobal('fetch', calls);

    const at = new Date('2026-09-24T09:00:00Z');

    await getCatalogue(repository, 'en', { now: at });
    const first = calls.mock.calls.length;

    await getCatalogue(repository, 'en', { now: new Date(at.getTime() + 60_000) });

    expect(calls.mock.calls.length).toBe(first);

    await getCatalogue(repository, 'en', { now: new Date(at.getTime() + 6 * 60_000) });

    expect(calls.mock.calls.length).toBeGreaterThan(first);
  });

  /**
   * A catalogue costs a request per file per language. Two readers on a cold
   * cache fan that out twice for the same answer. The second fan-out is waste,
   * and it is how a rate limit is met.
   */
  it('shares a read that has not answered yet rather than starting a second', async () => {
    const files = { fr: { a: { k: 'Salut' }, b: { j: 'Ciao' } }, en: { a: { k: 'Hi' } } };
    const alone = github(files);

    vi.stubGlobal('fetch', alone);
    await getCatalogue(repository, 'en');

    const together = github(files);

    clearI18nCatalogueCache();
    vi.stubGlobal('fetch', together);

    const [first, second] = await Promise.all([getCatalogue(repository, 'en'), getCatalogue(repository, 'en')]);

    expect(second).toBe(first);
    // Two callers on a cold cache cost what one caller costs.
    expect(together.mock.calls.length).toBe(alone.mock.calls.length);
  });

  /** Two repositories are two catalogues, not one answered twice. */
  it('holds one answer per repository', async () => {
    const calls = github({ fr: { a: { k: 'Salut' } }, en: { a: { k: 'Hi' } } });

    vi.stubGlobal('fetch', calls);

    const at = new Date('2026-09-24T09:00:00Z');

    await getCatalogue(repository, 'en', { now: at });
    const first = calls.mock.calls.length;

    await getCatalogue({ ...repository, id: 'repo-2' }, 'en', { now: at });

    expect(calls.mock.calls.length).toBeGreaterThan(first);
  });
});

/**
 * The row is written by an administrator, and the same builder serves the
 * writes of DB-212. A write pointed somewhere else is not the same mistake as
 * a read.
 */
describe('the path stays inside the repository', () => {
  it('refuses a locales path that climbs out of it', async () => {
    const calls = github({ fr: { a: { k: 'Salut' } }, en: { a: { k: 'Hi' } } });

    vi.stubGlobal('fetch', calls);

    await expect(getCatalogue({ ...repository, localesPath: '../../../../user/repos' }, 'en')).rejects.toThrow(
      /cannot hold \.\./,
    );
    // Nothing left for GitHub: the refusal comes before the request.
    expect(calls.mock.calls.filter(([url]) => String(url).includes('/contents/'))).toHaveLength(0);
  });

  /** A name with a slash or a question mark would otherwise change the request. */
  it('encodes what it puts in the path', async () => {
    const calls = vi.fn(async (url: string) => {
      if (String(url).includes('/commits/')) return ok({ sha: 'c0ffee' });

      return ok([]);
    });

    vi.stubGlobal('fetch', calls);

    await getCatalogue({ ...repository, owner: 'a b', name: 'c?d' }, 'fr').catch(() => undefined);

    const asked = calls.mock.calls.map(([url]) => String(url));

    expect(asked.every((url) => url.startsWith('https://api.github.com/repos/a%20b/c%3Fd/'))).toBe(true);
  });
});

describe('a language nobody has started', () => {
  /**
   * Adding a language costs a row, and the row comes before the first file.
   * Until somebody writes one, GitHub holds no directory and answers 404. That
   * must read as every key missing. A read that stops here is a language
   * nobody can start from the editor.
   */
  it('reads a target directory GitHub does not hold as every key missing', async () => {
    vi.stubGlobal('fetch', github({ fr: { a: { k: 'Salut' }, b: { j: 'Ciao' } } }));

    const { entries } = await getCatalogue({ ...repository, languages: ['fr', 'de'] }, 'de');

    expect(entries).toEqual([
      { file: 'a', key: 'k', source: 'Salut', value: null, state: 'missing' },
      { file: 'b', key: 'j', source: 'Ciao', value: null, state: 'missing' },
    ]);
  });

  /** The source is not a language being started: its absence is a path that is wrong. */
  it('refuses a source directory GitHub does not hold', async () => {
    vi.stubGlobal('fetch', github({ en: { a: { k: 'Hi' } } }));

    await expect(getCatalogue(repository, 'en')).rejects.toThrow(/404/);
  });
});

describe('when the catalogue cannot be read', () => {
  /** The caller named it, so it is a 400 at the route and not a server error. */
  it('refuses a language the repository does not name, by a type the route reads', async () => {
    vi.stubGlobal('fetch', github({ fr: {}, en: {} }));

    await expect(getCatalogue(repository, 'de')).rejects.toBeInstanceOf(UnknownLanguageError);
  });

  /**
   * Past one megabyte the contents API answers a URL and no content. Read as it
   * comes, that file would be an empty translation of every one of its keys.
   */
  it('refuses a file that came back without its content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/commits/')) return ok({ sha: 'c0ffee' });
        // The history of the branch says nothing to read again: the failure is the one of the file.
        if (String(url).includes('/commits?')) return ok([]);
        if (/locales\/[^/?]+\?/.test(String(url))) return ok([{ name: 'a.json', type: 'file', sha: 'x' }]);

        return ok({ sha: 'x', download_url: 'https://…' });
      }),
    );

    await expect(getCatalogue(repository, 'en')).rejects.toThrow(/without content/);
  });

  it('does not hold a failure in the cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );

    await expect(getCatalogue(repository, 'en')).rejects.toThrow();

    vi.stubGlobal('fetch', github({ fr: { a: { k: 'Salut' } }, en: { a: { k: 'Hi' } } }));

    await expect(getCatalogue(repository, 'en')).resolves.toMatchObject({ language: 'en' });
  });
});
