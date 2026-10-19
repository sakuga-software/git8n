import '../setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18nRepositories, i18nTranslators, newId } from '@i18n-editor/db';
import app from '../../app';
import { env } from '@/config/env';
import { clearI18nCatalogueCache } from '@/services/i18n-catalogue.service';
import { clearI18nProgressCache } from '@/services/i18n-progress.service';
import { authHeaders, insertAccount, signedInAdmin } from '../db/fixtures';
import { useTestDb } from '../db/test-db';
import { fakeRepo } from '../services/fake-github-repo';

// The credential is minted by the GitHub App, which has its own spec.
vi.mock('@/services/github-app.service', async (original) => {
  const real = await original<typeof import('@/services/github-app.service')>();

  return {
    ...real,
    installationToken: async () => 'installation-token',
    installations: async () => [{ id: 42, account: 'sakuga-software' }],
    // GitHub answers 404 for an installation nobody holds: its token cannot
    // be minted.
    repositoriesOf: async (installationId: number) => {
      if (installationId !== 42) throw new real.GithubError('GitHub answered 404 — Not Found', 404);

      return [{ owner: 'sakuga-software', name: 'detectivebox-front' }];
    },
  };
});

const { db } = useTestDb();

/**
 * Who reads the translations, who sets a repository up, and what they are told
 * when nobody has (DB-210).
 *
 * An admin or a translator may read, and neither is the other. Setting a
 * repository up is for an admin alone.
 */

const APP = { appId: '123456', privateKey: 'PEM' };

const base64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

const ok = (body: unknown) => ({ ok: true, headers: new Headers(), json: async () => body });

const github = () =>
  vi.fn(async (url: string, _init?: RequestInit) => {
    const path = String(url);

    if (path.includes('/commits/')) return ok({ sha: 'c0ffee1234' });
    // This repository holds no manifest, so every file is available (DB-225).
    if (path.includes('locales/manifest.json?')) {
      return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    }
    if (/locales\/[^/?]+\?/.test(path)) return ok([{ name: 'common.json', type: 'file', sha: 'sha-common' }]);

    const french = path.includes('/fr/');

    return ok({ content: base64({ hello: french ? 'Bonjour' : 'Hello' }), encoding: 'base64', sha: 's' });
  });

/** A repository the editor translates, written down as the route would. */
async function repository() {
  const [row] = await db()
    .insert(i18nRepositories)
    .values({
      id: newId(),
      installationId: 42,
      owner: 'sakuga-software',
      name: 'detectivebox-front',
      branch: 'main',
      localesPath: 'apps/app/src/assets/locales',
      languages: ['fr', 'en'],
    } as never)
    .returning();

  return row;
}

/** An account that translates `languages`, with no admin right. */
async function translator(
  languages: string[],
  role: 'translator' | 'reviewer' = 'translator',
  options: { writesSource?: boolean } = {},
) {
  const userId = await insertAccount();

  await db()
    .insert(i18nTranslators)
    .values({ userId, languages, role, writesSource: options.writesSource ?? false } as never);

  return { userId, headers: await authHeaders(userId) };
}

beforeEach(() => {
  clearI18nCatalogueCache();
  clearI18nProgressCache();
  Object.assign(env, { I18N_APP: APP });
  vi.stubGlobal('fetch', github());
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(env, { I18N_APP: undefined });
  clearI18nCatalogueCache();
});

describe('GET /i18n/catalogue', () => {
  it('answers an admin who translates nothing', async () => {
    const repo = await repository();
    const admin = await signedInAdmin();
    const res = await app.request(`/i18n/catalogue?repository=${repo.id}&language=en`, { headers: admin.headers });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: { entries: unknown[]; source: string } };

    expect(body.data.source).toBe('fr');
    expect(body.data.entries).toHaveLength(1);
  });

  it('answers a translator who is no admin', async () => {
    const repo = await repository();
    const { headers } = await translator(['en']);

    expect((await app.request(`/i18n/catalogue?repository=${repo.id}&language=en`, { headers })).status).toBe(200);
  });

  /** A row with no language still reads: it is the writing that it cannot do. */
  it('answers a translator whose languages are empty', async () => {
    const repo = await repository();
    const { headers } = await translator([]);

    expect((await app.request(`/i18n/catalogue?repository=${repo.id}&language=en`, { headers })).status).toBe(200);
  });

  it('refuses an account that neither administers nor translates', async () => {
    const repo = await repository();
    const userId = await insertAccount();

    expect(
      (await app.request(`/i18n/catalogue?repository=${repo.id}&language=en`, { headers: await authHeaders(userId) }))
        .status,
    ).toBe(403);
  });

  it('asks for the language rather than guessing one', async () => {
    const repo = await repository();
    const admin = await signedInAdmin();

    expect((await app.request(`/i18n/catalogue?repository=${repo.id}`, { headers: admin.headers })).status).toBe(400);
  });

  /**
   * A setup nobody finished is not a catalogue with no key. The page names it,
   * as the ranking of DB-206 does.
   */
  it('answers 503 while no repository is set up', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/catalogue?language=en', { headers: admin.headers });

    expect(res.status).toBe(503);
    expect(await res.text()).toContain('Install the GitHub App');
  });

  /**
   * The caller typed a language the repository does not hold. A 500 would read
   * as a failure of the server, and would say nothing about which exist.
   */
  it('answers 400 for a language the repository does not hold', async () => {
    const repo = await repository();
    const admin = await signedInAdmin();
    const res = await app.request(`/i18n/catalogue?repository=${repo.id}&language=de`, { headers: admin.headers });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('fr, en');
  });

  /**
   * The rule at the route came after this row could exist. The reader can do
   * nothing about it, so it is not a bad request: an operator fixes the row.
   */
  it('answers 503 for a repository whose locales path climbs out of it', async () => {
    const [row] = await db()
      .insert(i18nRepositories)
      .values({
        id: newId(),
        installationId: 42,
        owner: 'sakuga-software',
        name: 'detectivebox-front',
        branch: 'main',
        localesPath: '../../../../user/repos',
        languages: ['fr', 'en'],
      } as never)
      .returning();
    const admin = await signedInAdmin();
    const res = await app.request(`/i18n/catalogue?repository=${row.id}&language=en`, { headers: admin.headers });

    expect(res.status).toBe(503);
    expect(await res.text()).toContain('Fix the row');
  });

  it('names the repositories it knows when the one asked for is not among them', async () => {
    const repo = await repository();
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/catalogue?repository=nope&language=en', { headers: admin.headers });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain(`${repo.owner}/${repo.name}`);
  });
});

describe('POST /i18n/repositories', () => {
  it('writes one down, and answers what it holds', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 42,
        owner: 'sakuga-software',
        name: 'detectivebox-front',
        localesPath: 'apps/app/src/assets/locales/',
        languages: ['fr', 'en'],
      }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: { localesPath: string; source: string; targets: string[] } };

    // A path that ends in a slash would double in a URL.
    expect(body.data.localesPath).toBe('apps/app/src/assets/locales');
    expect(body.data.source).toBe('fr');
    expect(body.data.targets).toEqual(['en']);
  });

  /** An operator pressing a button again is not an error, and must not make a second row. */
  it('answers the row that is already there rather than a second one', async () => {
    const admin = await signedInAdmin();
    const send = () =>
      app.request('/i18n/repositories', {
        method: 'POST',
        headers: { ...admin.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: 42,
          owner: 'sakuga-software',
          name: 'detectivebox-front',
          localesPath: 'a/b',
          languages: ['fr', 'en'],
        }),
      });

    const first = (await (await send()).json()) as { data: { id: string } };
    const second = (await (await send()).json()) as { data: { id: string } };

    expect(second.data.id).toBe(first.data.id);
    expect(await db().select().from(i18nRepositories)).toHaveLength(1);
  });

  it('refuses a body that names no language', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: 42, owner: 'a', name: 'b', localesPath: 'c' }),
    });

    expect(res.status).toBe(400);
  });

  /**
   * A guard on a field says nothing about its type. `"fr"` has a length of
   * two, so a check on `languages?.length` lets a string reach a `text[]`
   * column. That is a 500 for a bad request.
   */
  it('refuses a language that is a string rather than a list', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 42,
        owner: 'sakuga-software',
        name: 'detectivebox-front',
        localesPath: 'c',
        languages: 'fr',
      }),
    });

    expect(res.status).toBe(400);
    expect(await db().select().from(i18nRepositories)).toHaveLength(0);
  });

  it('refuses a body that is not JSON at all', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
  });

  /**
   * `fetch` resolves `..` before it sends. A path that holds one asks GitHub
   * for something outside the repository, with our installation token.
   */
  it('refuses a locales path that climbs out of the repository', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 42,
        owner: 'sakuga-software',
        name: 'detectivebox-front',
        localesPath: '../../../../user/repos',
        languages: ['fr'],
      }),
    });

    expect(res.status).toBe(400);
    expect(await db().select().from(i18nRepositories)).toHaveLength(0);
  });

  /** git refuses such a ref too, and DB-212 will build refs from this field. */
  it('refuses a branch that climbs out of the repository', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 42,
        owner: 'sakuga-software',
        name: 'detectivebox-front',
        branch: '../../../../user',
        localesPath: 'apps/app/src/assets/locales',
        languages: ['fr'],
      }),
    });

    expect(res.status).toBe(400);
    expect(await db().select().from(i18nRepositories)).toHaveLength(0);
  });

  it('refuses a language that is a path rather than a tag', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 42,
        owner: 'sakuga-software',
        name: 'detectivebox-front',
        localesPath: 'apps/app/src/assets/locales',
        languages: ['fr', '../../../../installation/repositories'],
      }),
    });

    expect(res.status).toBe(400);
    expect(await db().select().from(i18nRepositories)).toHaveLength(0);
  });

  /**
   * An installation nobody holds is the caller's mistake, not the server's. It
   * is the third shape of the same defect on this route, after the untyped
   * body and the unknown language.
   */
  it('answers 400 for an installation that is not installed', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 99,
        owner: 'sakuga-software',
        name: 'detectivebox-front',
        localesPath: 'c',
        languages: ['fr'],
      }),
    });

    expect(res.status).toBe(400);
    expect(await db().select().from(i18nRepositories)).toHaveLength(0);
  });

  /**
   * The installation is what gives the right to read, and the caller chooses
   * it. Written down unchecked, every read of that row fails at GitHub with a
   * 404 that says nothing about why.
   */
  it('refuses a repository the installation does not reach', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 42,
        owner: 'somebody-else',
        name: 'private-thing',
        localesPath: 'c',
        languages: ['fr'],
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('sakuga-software/detectivebox-front');
    expect(await db().select().from(i18nRepositories)).toHaveLength(0);
  });

  /** Setting the tool up is the step that needs access; translating is not. */
  it('refuses a translator who is no admin', async () => {
    const { headers } = await translator(['en'], 'reviewer');
    const res = await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: 42, owner: 'a', name: 'b', localesPath: 'c', languages: ['fr'] }),
    });

    expect(res.status).toBe(403);
  });
});

describe('GET /i18n/installations', () => {
  /** How a repository is found rather than typed: the App says what it reaches. */
  it('names what the App can reach', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/installations', { headers: admin.headers });

    expect(await res.json()).toMatchObject({
      data: [{ id: 42, account: 'sakuga-software', repositories: [{ name: 'detectivebox-front' }] }],
    });
  });

  it('refuses a translator who is no admin', async () => {
    const { headers } = await translator(['en']);

    expect((await app.request('/i18n/installations', { headers })).status).toBe(403);
  });
});

describe('GET /i18n/me', () => {
  it('tells an admin that they translate nothing', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/me', { headers: admin.headers });

    expect(await res.json()).toMatchObject({ data: { admin: true, rights: null } });
  });

  it('tells a reviewer their languages and their role', async () => {
    const { headers } = await translator(['en', 'de'], 'reviewer');
    const res = await app.request('/i18n/me', { headers });

    expect(await res.json()).toMatchObject({
      data: { admin: false, rights: { languages: ['en', 'de'], role: 'reviewer', writesSource: false } },
    });
  });

  /** The editor reads it to know whether to offer the creation of a key (DB-238). */
  it('tells an account that it writes the source', async () => {
    const { headers } = await translator([], 'translator', { writesSource: true });
    const res = await app.request('/i18n/me', { headers });

    expect(await res.json()).toMatchObject({ data: { rights: { languages: [], writesSource: true } } });
  });

  /**
   * Signing in gives no right over a language (DB-218).
   *
   * Anybody can hold an account here — with a password, and since DB-218 with
   * GitHub. This is the endpoint the editor asks to know which languages to
   * offer, so an answer that carried a role would offer them to everyone. The
   * read and the write are already refused; this is what the screen reads.
   */
  it('tells an account that holds no row that it translates nothing', async () => {
    const userId = await insertAccount();
    const res = await app.request('/i18n/me', { headers: await authHeaders(userId) });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { admin: false, rights: null } });
  });
});

/**
 * Who may write a language, and who may only propose in it (DB-212).
 *
 * DB-210 left this guard to the route that writes. **An admin is not covered
 * by it**: reading the catalogue is an admin page, writing a language is a row
 * of `i18n_translators`.
 */
describe('the write path', () => {
  const LOCALES = 'apps/app/src/assets/locales';

  const withRepo = () => {
    const repo = fakeRepo({
      owner: 'sakuga-software',
      name: 'detectivebox-front',
      baseBranch: 'main',
      files: {
        [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
        [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
      },
    });

    vi.stubGlobal('fetch', repo.fetch);

    return repo;
  };

  /** A proposal names the commit the translator read the catalogue at. */
  const proposalBody = (repositoryId: string, readAt: string, language = 'en') => ({
    repository: repositoryId,
    language,
    readAt,
    values: [{ file: 'common', key: 'hello', value: 'Hi' }],
  });

  const post = (path: string, headers: Record<string, string>, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('lets a translator of the language propose', async () => {
    const repoRow = await repository();
    const repo = withRepo();
    const { headers } = await translator(['en']);
    const res = await post('/i18n/proposals', headers, proposalBody(repoRow.id, repo.refs.get('main')!));

    expect(res.status).toBe(200);
    expect(repo.refs.get('i18n/en')).toBeDefined();
  });

  it('refuses a translator of another language', async () => {
    const repoRow = await repository();

    const repo = withRepo();
    const { headers } = await translator(['de']);

    expect((await post('/i18n/proposals', headers, proposalBody(repoRow.id, repo.refs.get('main')!))).status).toBe(403);
  });

  /** An administrator does not silently become the translator of every language. */
  it('refuses an admin who holds no row', async () => {
    const repoRow = await repository();

    const repo = withRepo();
    const admin = await signedInAdmin();

    expect(
      (await post('/i18n/proposals', admin.headers, proposalBody(repoRow.id, repo.refs.get('main')!))).status,
    ).toBe(403);
  });

  it('refuses a body whose language is a path rather than a tag', async () => {
    const repoRow = await repository();

    const repo = withRepo();
    const { headers } = await translator(['en']);
    const res = await post('/i18n/proposals', headers, {
      ...proposalBody(repoRow.id, repo.refs.get('main')!),
      language: '../../../../user',
    });

    expect(res.status).toBe(400);
  });

  /** A translator proposes and does not publish their own work. */
  it('refuses a translator who is no reviewer on a publication', async () => {
    const repoRow = await repository();

    withRepo();

    const { headers } = await translator(['en'], 'translator');
    const res = await post('/i18n/publications', headers, {
      repository: repoRow.id,
      language: 'en',
      // A valid body, so what this pins is the guard and not the schema.
      approved: [{ file: 'common', key: 'hello', commit: 'c'.repeat(40) }],
    });

    expect(res.status).toBe(403);
  });

  it('lets a reviewer of the language publish what a translator proposed', async () => {
    const repoRow = await repository();
    const repo = withRepo();
    const author = await translator(['en']);
    const proposed = await post('/i18n/proposals', author.headers, proposalBody(repoRow.id, repo.refs.get('main')!));
    const { data } = (await proposed.json()) as { data: { commit: string } };
    const publisher = await translator(['en'], 'reviewer');
    const res = await post('/i18n/publications', publisher.headers, {
      repository: repoRow.id,
      language: 'en',
      approved: [{ file: 'common', key: 'hello', commit: data.commit }],
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(repo.filesAt(repo.refs.get('main')!).get(`${LOCALES}/en/common.json`)!)).toEqual({
      hello: 'Hi',
    });
  });

  /** The commit is public and permanent: it must not carry a personal address. */
  it('authors the commit with an address that reaches nobody', async () => {
    const repoRow = await repository();
    const repo = withRepo();
    const { headers, userId } = await translator(['en']);

    await post('/i18n/proposals', headers, proposalBody(repoRow.id, repo.refs.get('main')!));

    const commit = repo.commits.get(repo.refs.get('i18n/en')!);

    expect(commit?.author.email).toBe(`${userId}@users.noreply.detectivebox.com`);
    expect(commit?.author.email).not.toContain('@example');
  });

  it('answers what is waiting on the branch of a language', async () => {
    const repoRow = await repository();

    const repo = withRepo();
    const { headers } = await translator(['en']);

    await post('/i18n/proposals', headers, proposalBody(repoRow.id, repo.refs.get('main')!));

    const res = await app.request(`/i18n/proposals?repository=${repoRow.id}&language=en`, { headers });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: Array<{ author: string; readAt: string }> };

    expect(body.data).toHaveLength(1);
    expect(body.data[0].readAt).toMatch(/^[0-9a-f]{40}$/);
  });

  it('answers the keys that wait, each with the batch a publication names', async () => {
    const repoRow = await repository();
    const repo = withRepo();
    const { headers } = await translator(['en']);

    await post('/i18n/proposals', headers, proposalBody(repoRow.id, repo.refs.get('main')!));

    const res = await app.request(`/i18n/proposals/keys?repository=${repoRow.id}&language=en`, { headers });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: Array<{ file: string; key: string; commit: string }> };

    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((row) => row.commit === repo.refs.get('i18n/en'))).toBe(true);
  });

  it('refuses the keys that wait to an account that neither administers nor translates', async () => {
    const repoRow = await repository();

    withRepo();

    const userId = await insertAccount();
    const res = await app.request(`/i18n/proposals/keys?repository=${repoRow.id}&language=en`, {
      headers: await authHeaders(userId),
    });

    expect(res.status).toBe(403);
  });

  /**
   * `__proto__.x` does not write into the file: it walks to `Object.prototype`
   * and writes there, so every object made afterwards in this process carries
   * the value. A translator sends these keys.
   */
  it('refuses a key that names a property every object holds', async () => {
    const repoRow = await repository();
    const repo = withRepo();
    const { headers } = await translator(['en']);
    const res = await post('/i18n/proposals', headers, {
      ...proposalBody(repoRow.id, repo.refs.get('main')!),
      values: [{ file: 'common', key: '__proto__.polluted', value: 'yes' }],
    });

    expect(res.status).toBe(400);
    // Refused by the schema, before the service is asked at all. The service
    // refuses it too, and its own spec pins that half.
    expect(await res.text()).toContain('nor name __proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(repo.refs.get('i18n/en')).toBeUndefined();
  });

  /** The same rule on both routes, so neither answers a different error. */
  it('refuses an unsafe key on a publication too', async () => {
    const repoRow = await repository();

    withRepo();

    const { headers } = await translator(['en'], 'reviewer');
    const res = await post('/i18n/publications', headers, {
      repository: repoRow.id,
      language: 'en',
      approved: [{ file: 'common', key: '__proto__.polluted', commit: 'a'.repeat(40) }],
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('nor name __proto__');
  });

  /** The commit must be one of this repository, not a sha a caller made up. */
  it('refuses a revision the base branch never held', async () => {
    const repoRow = await repository();

    withRepo();

    const { headers } = await translator(['en']);
    const res = await post('/i18n/proposals', headers, {
      ...proposalBody(repoRow.id, 'f'.repeat(40)),
      values: [{ file: 'common', key: 'hello', value: 'Hi' }],
    });

    expect(res.status).toBe(400);
  });

  /**
   * Who may add a key to the source (DB-238).
   *
   * It is a right of its own. A reviewer of every target does not hold it, and
   * neither does an admin: the French text is what each translation answers.
   */
  describe('POST /i18n/keys', () => {
    const body = (repositoryId: string, values = [{ file: 'common', key: 'bye', value: 'Au revoir' }]) => ({
      repository: repositoryId,
      values,
    });

    it('lets an account that writes the source add a key to the base branch', async () => {
      const repoRow = await repository();
      const repo = withRepo();
      const { headers, userId } = await translator([], 'translator', { writesSource: true });
      const res = await post('/i18n/keys', headers, body(repoRow.id));

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ data: { keys: 1, commit: repo.refs.get('main') } });

      const commit = repo.commits.get(repo.refs.get('main')!)!;

      expect(JSON.parse(commit.files.get(`${LOCALES}/fr/common.json`)!)).toEqual({
        hello: 'Bonjour',
        bye: 'Au revoir',
      });
      expect(commit.author.email).toBe(`${userId}@users.noreply.detectivebox.com`);
    });

    it('refuses a reviewer who does not write the source', async () => {
      const repoRow = await repository();
      const repo = withRepo();
      const before = repo.refs.get('main');
      const { headers } = await translator(['en', 'fr'], 'reviewer');

      expect((await post('/i18n/keys', headers, body(repoRow.id))).status).toBe(403);
      expect(repo.refs.get('main')).toBe(before);
    });

    it('refuses an admin who holds no row', async () => {
      const repoRow = await repository();

      withRepo();

      const admin = await signedInAdmin();

      expect((await post('/i18n/keys', admin.headers, body(repoRow.id))).status).toBe(403);
    });

    it('answers 400 for a key the source holds, with the reason', async () => {
      const repoRow = await repository();

      withRepo();

      const { headers } = await translator([], 'translator', { writesSource: true });
      const res = await post(
        '/i18n/keys',
        headers,
        body(repoRow.id, [{ file: 'common', key: 'hello', value: 'Salut' }]),
      );

      expect(res.status).toBe(400);
      expect(await res.text()).toContain('hello is already in common');
    });

    it('refuses a text that is empty, a file that is a path and an unsafe key', async () => {
      const repoRow = await repository();

      withRepo();

      const { headers } = await translator([], 'translator', { writesSource: true });

      for (const value of [
        { file: 'common', key: 'bye', value: '' },
        { file: '../common', key: 'bye', value: 'x' },
        { file: 'common', key: '__proto__.polluted', value: 'x' },
      ]) {
        expect((await post('/i18n/keys', headers, body(repoRow.id, [value]))).status).toBe(400);
      }
    });

    it('refuses a visitor who is not signed in', async () => {
      const repoRow = await repository();

      withRepo();

      expect((await post('/i18n/keys', {}, body(repoRow.id))).status).toBe(401);
    });
  });

  /** The numbers of the side panel of the editor (DB-268). */
  describe('GET /i18n/progress', () => {
    const read = (repositoryId: string, headers: Record<string, string>) =>
      app.request(`/i18n/progress?repository=${repositoryId}`, { headers });

    it('answers a translator the languages of its row', async () => {
      const repoRow = await repository();

      withRepo();

      const { headers } = await translator(['en']);
      const res = await read(repoRow.id, headers);

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        data: [{ language: 'en', published: 1, proposed: 0, missing: 0, total: 1 }],
      });
    });

    /** A language the account cannot open is not offered, so its numbers are not sent. */
    it('answers no language to a translator of another one', async () => {
      const repoRow = await repository();

      withRepo();

      const { headers } = await translator(['de']);

      expect(await (await read(repoRow.id, headers)).json()).toMatchObject({ data: [] });
    });

    it('answers every language to an admin and to an account that writes the source', async () => {
      const repoRow = await repository();

      withRepo();

      const admin = await signedInAdmin();
      const writer = await translator([], 'translator', { writesSource: true });

      for (const headers of [admin.headers, writer.headers]) {
        expect(await (await read(repoRow.id, headers)).json()).toMatchObject({ data: [{ language: 'en' }] });
      }
    });

    it('counts a proposal at once for whoever wrote it', async () => {
      const repoRow = await repository();
      const repo = withRepo();
      const { headers } = await translator(['en']);

      await read(repoRow.id, headers);
      await post('/i18n/proposals', headers, proposalBody(repoRow.id, repo.refs.get('main')!));

      expect(await (await read(repoRow.id, headers)).json()).toMatchObject({
        data: [{ language: 'en', published: 0, proposed: 1 }],
      });
    });

    /**
     * The catalogue is held for five minutes, and a publication changes what
     * it reads. With the old catalogue the key leaves the proposed ones and
     * lands in the missing ones, for the person who just published it.
     */
    it('counts a publication at once for whoever published', async () => {
      const repoRow = await repository();
      const repo = withRepo();

      repo.moveBranch('main', {
        [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour', bye: 'Au revoir' },
        [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
      });

      const { headers } = await translator(['en'], 'reviewer');
      const proposal = await post('/i18n/proposals', headers, {
        repository: repoRow.id,
        language: 'en',
        readAt: repo.refs.get('main')!,
        values: [{ file: 'common', key: 'bye', value: 'Bye' }],
      });
      const { data } = (await proposal.json()) as { data: { commit: string } };

      expect(await (await read(repoRow.id, headers)).json()).toMatchObject({
        data: [{ language: 'en', published: 1, proposed: 1, missing: 0 }],
      });

      await post('/i18n/publications', headers, {
        repository: repoRow.id,
        language: 'en',
        approved: [{ file: 'common', key: 'bye', commit: data.commit }],
      });

      expect(await (await read(repoRow.id, headers)).json()).toMatchObject({
        data: [{ language: 'en', published: 2, proposed: 0, missing: 0, total: 2 }],
      });
    });

    /** `createKeys` drops the catalogues itself (DB-238). This holds it from the route. */
    it('counts a new key at once for whoever created it', async () => {
      const repoRow = await repository();

      withRepo();

      const { headers } = await translator([], 'translator', { writesSource: true });

      expect(await (await read(repoRow.id, headers)).json()).toMatchObject({
        data: [{ language: 'en', missing: 0, total: 1 }],
      });

      await post('/i18n/keys', headers, {
        repository: repoRow.id,
        values: [{ file: 'common', key: 'bye', value: 'Au revoir' }],
      });

      expect(await (await read(repoRow.id, headers)).json()).toMatchObject({
        data: [{ language: 'en', published: 1, missing: 1, total: 2 }],
      });
    });

    it('refuses an account that neither administers nor translates', async () => {
      const repoRow = await repository();

      withRepo();

      const userId = await insertAccount();

      expect((await read(repoRow.id, await authHeaders(userId))).status).toBe(403);
    });
  });
});
