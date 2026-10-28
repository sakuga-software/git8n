import '../setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { i18nRepositories, members, newId } from '@git8n/db';
import app from '../../app';
import { env } from '@/config/env';
import { clearI18nCatalogueCache } from '@/services/i18n-catalogue.service';
import { clearI18nProgressCache } from '@/services/i18n-progress.service';
import { clearAvatarCache } from '@/services/i18n-avatars.service';
import { authHeaders, grant, insertAccount, insertOrganization, signedInAdmin } from '../db/fixtures';
import { useTestDb } from '../db/test-db';
import { fakeRepo } from '../services/fake-github-repo';

// The credential is minted by the GitHub App, which has its own spec.
vi.mock('@/services/github-app.service', async (original) => {
  const real = await original<typeof import('@/services/github-app.service')>();

  return {
    ...real,
    installationToken: async () => 'installation-token',
    installations: async () => [
      { id: 42, account: 'acme', avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4' },
    ],
    // GitHub answers 404 for an installation nobody holds: its token cannot
    // be minted.
    repositoriesOf: async (installationId: number) => {
      if (installationId !== 42) throw new real.GithubError('GitHub answered 404 — Not Found', 404);

      return [{ owner: 'acme', name: 'acme-app' }];
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

    // No source text changed since the connection (DB-607).
    if (path.includes('/commits?')) return ok([]);
    // This repository holds no manifest, so every file is available (DB-225).
    if (path.includes('locales/manifest.json?')) {
      return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    }
    if (/locales\/[^/?]+\?/.test(path)) return ok([{ name: 'common.json', type: 'file', sha: 'sha-common' }]);

    const french = path.includes('/fr/');

    return ok({ content: base64({ hello: french ? 'Bonjour' : 'Hello' }), encoding: 'base64', sha: 's' });
  });

/** A repository the editor translates, written down as the route would. A second call answers the same one. */
async function repository() {
  const [held] = await db()
    .select()
    .from(i18nRepositories)
    .where(and(eq(i18nRepositories.owner, 'acme'), eq(i18nRepositories.name, 'acme-app')));

  if (held) return held;

  const [row] = await db()
    .insert(i18nRepositories)
    .values({
      id: newId(),
      organizationId: await insertOrganization(),
      installationId: 42,
      owner: 'acme',
      name: 'acme-app',
      branch: 'main',
      localesPath: 'src/locales',
      languages: ['fr', 'en'],
    } as never)
    .returning();

  return row;
}

/** An account that translates `languages` in `acme/acme-app`, or in `repo`, with no admin right. */
async function translator(
  languages: string[],
  role: 'translator' | 'reviewer' | 'owner' = 'translator',
  options: { writesSource?: boolean; repo?: { id: string } } = {},
) {
  const userId = await insertAccount();
  const repo = options.repo ?? (await repository());

  await grant(userId, repo.id, { languages, role, writesSource: options.writesSource });

  return { userId, headers: await authHeaders(userId) };
}

beforeEach(() => {
  clearI18nCatalogueCache();
  clearI18nProgressCache();
  clearAvatarCache();
  Object.assign(env, { I18N_APP: APP });
  vi.stubGlobal('fetch', github());
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(env, { I18N_APP: undefined });
  clearI18nCatalogueCache();
});

describe('GET /i18n/repositories', () => {
  /** The header shows the picture of the owner beside the name (DB-617). */
  it('gives each repository the picture of the account that holds its installation', async () => {
    const repo = await repository();
    const other = {
      ...repo,
      id: newId(),
      organizationId: await insertOrganization(),
      installationId: 7,
      name: 'other-app',
    };

    await db()
      .insert(i18nRepositories)
      .values(other as never);

    const admin = await signedInAdmin();
    const listed = (await (await app.request('/i18n/repositories', { headers: admin.headers })).json()) as {
      data: Array<{ name: string; avatarUrl: string | null }>;
    };

    expect(listed.data.map(({ name, avatarUrl }) => ({ name, avatarUrl }))).toEqual(
      expect.arrayContaining([
        { name: 'acme-app', avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4' },
        { name: 'other-app', avatarUrl: null },
      ]),
    );
  });
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
        organizationId: await insertOrganization(),
        installationId: 42,
        owner: 'acme',
        name: 'acme-app',
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
        owner: 'acme',
        name: 'acme-app',
        localesPath: 'src/locales/',
        languages: ['fr', 'en'],
      }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: { localesPath: string; source: string; targets: string[] } };

    // A path that ends in a slash would double in a URL.
    expect(body.data.localesPath).toBe('src/locales');
    expect((body.data as { created?: boolean }).created).toBe(true);
    expect(body.data.source).toBe('fr');
    expect(body.data.targets).toEqual(['en']);
  });

  /** A repository holds its members in an organization of its own, and the admin who connects it owns it (DB-637). */
  it('gives the repository an organization, and makes the admin who connects it its owner', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 42,
        owner: 'acme',
        name: 'acme-app',
        localesPath: 'src',
        languages: ['fr'],
      }),
    });
    const { id } = ((await res.json()) as { data: { id: string } }).data;
    const [row] = await db().select().from(i18nRepositories).where(eq(i18nRepositories.id, id));
    const owners = await db().select().from(members).where(eq(members.organizationId, row.organizationId));

    expect(owners.map(({ userId, role }) => ({ userId, role }))).toEqual([{ userId: admin.userId, role: 'owner' }]);
  });

  it('keeps the path of a manifest that is not beside the languages', async () => {
    const admin = await signedInAdmin();
    const add = (manifestPath?: string) =>
      app.request('/i18n/repositories', {
        method: 'POST',
        headers: { ...admin.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: 42,
          owner: 'acme',
          name: 'acme-app',
          localesPath: 'src/locales',
          languages: ['fr', 'en'],
          manifestPath,
        }),
      });

    expect((await add('../secrets.json')).status).toBe(400);
    expect((await add('config/i18n.yaml')).status).toBe(400);

    const res = await add('config/i18n.json');

    expect(res.status).toBe(200);

    const listed = (await (await app.request('/i18n/repositories', { headers: admin.headers })).json()) as {
      data: Array<{ manifestPath: string }>;
    };

    expect(listed.data.map((row) => row.manifestPath)).toEqual(['config/i18n.json']);
  });

  it('reads the manifest beside the languages when the repository names none', async () => {
    const admin = await signedInAdmin();

    await app.request('/i18n/repositories', {
      method: 'POST',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 42,
        owner: 'acme',
        name: 'acme-app',
        localesPath: 'src/locales',
        languages: ['fr', 'en'],
      }),
    });

    const listed = (await (await app.request('/i18n/repositories', { headers: admin.headers })).json()) as {
      data: Array<{ manifestPath: string }>;
    };

    expect(listed.data.map((row) => row.manifestPath)).toEqual(['src/locales/manifest.json']);
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
          owner: 'acme',
          name: 'acme-app',
          localesPath: 'a/b',
          languages: ['fr', 'en'],
        }),
      });

    const first = (await (await send()).json()) as { data: { id: string; created: boolean } };
    const second = (await (await send()).json()) as { data: { id: string; created: boolean } };

    expect(second.data.id).toBe(first.data.id);
    // The page reads it to say « already connected » rather than « connected ».
    expect([first.data.created, second.data.created]).toEqual([true, false]);
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
        owner: 'acme',
        name: 'acme-app',
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
        owner: 'acme',
        name: 'acme-app',
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
        owner: 'acme',
        name: 'acme-app',
        branch: '../../../../user',
        localesPath: 'src/locales',
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
        owner: 'acme',
        name: 'acme-app',
        localesPath: 'src/locales',
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
        owner: 'acme',
        name: 'acme-app',
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
    expect(await res.text()).toContain('acme/acme-app');
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
      data: [{ id: 42, account: 'acme', repositories: [{ name: 'acme-app' }] }],
    });
  });

  it('refuses a translator who is no admin', async () => {
    const { headers } = await translator(['en']);

    expect((await app.request('/i18n/installations', { headers })).status).toBe(403);
  });
});

/**
 * What a repository holds before an admin connects it (DB-581).
 *
 * The App reaches `acme/acme-app` through installation 42 alone, as the mock
 * at the top of this file says.
 */
describe('GET /i18n/detection', () => {
  const TREE = [
    { path: 'README.md', type: 'blob' },
    { path: 'src', type: 'tree' },
    { path: 'src/locales/manifest.json', type: 'blob' },
    { path: 'src/locales/en/common.json', type: 'blob' },
    { path: 'src/locales/fr/common.json', type: 'blob' },
    { path: 'src/locales/fr/tutorial.json', type: 'blob' },
    { path: 'docs/examples/de/common.json', type: 'blob' },
  ];

  /** GitHub, for one repository whose default branch is `trunk`. */
  const repositoryOnGithub = (options: { manifest?: unknown; rules?: unknown[] | 'refused' } = {}) =>
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname;

      if (path === '/repos/acme/acme-app') return ok({ default_branch: 'trunk' });
      if (path === '/repos/acme/acme-app/rules/branches/trunk') {
        return options.rules === 'refused'
          ? { ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) }
          : ok(options.rules ?? []);
      }
      if (path === '/repos/acme/acme-app/git/trees/trunk') return ok({ tree: TREE, truncated: false });
      if (path.startsWith('/repos/acme/acme-app/git/trees/')) {
        return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
      }
      if (path === '/repos/acme/acme-app/contents/src/locales/manifest.json') {
        return ok({ content: base64(options.manifest ?? { source: 'fr', files: {} }), encoding: 'base64' });
      }

      return { ok: false, status: 404, json: async () => ({ message: `no ${path}` }) };
    });

  const detection = async (query: string, headers?: Record<string, string>) =>
    app.request(`/i18n/detection?${query}`, { headers: headers ?? (await signedInAdmin()).headers });

  it('finds the default branch, the folders of the languages and the source of the manifest', async () => {
    vi.stubGlobal('fetch', repositoryOnGithub());

    const res = await detection('installationId=42&owner=acme&name=acme-app');

    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({
      defaultBranch: 'trunk',
      branch: 'trunk',
      truncated: false,
      candidates: [
        { path: 'src/locales', languages: ['en', 'fr'] },
        { path: 'docs/examples', languages: ['de'] },
      ],
      localesPath: 'src/locales',
      manifestPath: 'src/locales/manifest.json',
      source: 'fr',
      languages: ['fr', 'en'],
      requiresPullRequest: false,
    });
  });

  it('says that a ruleset requires a pull request on the branch, and says nothing when GitHub refuses', async () => {
    vi.stubGlobal('fetch', repositoryOnGithub({ rules: [{ type: 'deletion' }, { type: 'pull_request' }] }));

    const required = await detection('installationId=42&owner=acme&name=acme-app');

    expect(((await required.json()) as { data: { requiresPullRequest: unknown } }).data.requiresPullRequest).toBe(true);

    vi.stubGlobal('fetch', repositoryOnGithub({ rules: 'refused' }));

    const unknown = await detection('installationId=42&owner=acme&name=acme-app');

    expect(((await unknown.json()) as { data: { requiresPullRequest: unknown } }).data.requiresPullRequest).toBeNull();
  });

  it('answers the folder that the admin chose, with no manifest beside it', async () => {
    vi.stubGlobal('fetch', repositoryOnGithub());

    const res = await detection('installationId=42&owner=acme&name=acme-app&localesPath=docs/examples/');

    expect(((await res.json()) as { data: unknown }).data).toMatchObject({
      localesPath: 'docs/examples',
      manifestPath: null,
      source: null,
      languages: ['de'],
    });
  });

  /** A manifest that names no source leaves the order to the admin. */
  it('keeps the languages in their order when the manifest names no source', async () => {
    vi.stubGlobal('fetch', repositoryOnGithub({ manifest: { files: {} } }));

    const res = await detection('installationId=42&owner=acme&name=acme-app');

    expect(((await res.json()) as { data: unknown }).data).toMatchObject({ source: null, languages: ['en', 'fr'] });
  });

  it('answers 400 for a branch the repository does not hold', async () => {
    vi.stubGlobal('fetch', repositoryOnGithub());

    const res = await detection('installationId=42&owner=acme&name=acme-app&branch=nope');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('nope');
  });

  it('answers 400 for an installation that is not installed', async () => {
    vi.stubGlobal('fetch', repositoryOnGithub());

    expect((await detection('installationId=99&owner=acme&name=acme-app')).status).toBe(400);
  });

  it('refuses a repository the installation does not reach', async () => {
    vi.stubGlobal('fetch', repositoryOnGithub());

    const res = await detection('installationId=42&owner=somebody-else&name=private-thing');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('acme/acme-app');
  });

  it('refuses a query that names no repository', async () => {
    expect((await detection('installationId=42')).status).toBe(400);
  });

  it('refuses a locales path that climbs out of the repository', async () => {
    expect((await detection('installationId=42&owner=acme&name=acme-app&localesPath=../x')).status).toBe(400);
  });

  it('refuses a translator who is no admin', async () => {
    const { headers } = await translator(['en'], 'reviewer');

    expect((await detection('installationId=42&owner=acme&name=acme-app', headers)).status).toBe(403);
  });
});

describe('GET /i18n/me', () => {
  it('tells an admin that they translate nothing', async () => {
    const admin = await signedInAdmin();
    const res = await app.request('/i18n/me', { headers: admin.headers });

    expect(await res.json()).toMatchObject({ data: { admin: true, memberships: [] } });
  });

  /** The first step of connecting a repository is to install the App (DB-581). */
  it('gives an admin the address that installs the App, and nobody else', async () => {
    const admin = await signedInAdmin();
    const { headers } = await translator(['en']);
    const of = async (sent: Record<string, string>) =>
      ((await (await app.request('/i18n/me', { headers: sent })).json()) as { data: { installUrl: string | null } })
        .data.installUrl;

    expect(await of(admin.headers)).toBe(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`);
    expect(await of(headers)).toBeNull();
  });

  it('tells a reviewer their languages and their role, in each repository', async () => {
    const repo = await repository();
    const { headers } = await translator(['en', 'de'], 'reviewer');
    const res = await app.request('/i18n/me', { headers });

    expect(await res.json()).toMatchObject({
      data: {
        admin: false,
        memberships: [{ repositoryId: repo.id, languages: ['de', 'en'], role: 'reviewer', writesSource: false }],
      },
    });
  });

  /** The editor reads it to know whether to offer the creation of a key (DB-238). */
  it('tells an account that it writes the source', async () => {
    const { headers } = await translator([], 'translator', { writesSource: true });
    const res = await app.request('/i18n/me', { headers });

    expect(await res.json()).toMatchObject({ data: { memberships: [{ languages: [], writesSource: true }] } });
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
    expect(await res.json()).toMatchObject({ data: { admin: false, memberships: [] } });
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
  const LOCALES = 'src/locales';

  const withRepo = () => {
    const repo = fakeRepo({
      owner: 'acme',
      name: 'acme-app',
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

    expect(commit?.author.email).toBe(`${userId}@users.noreply.invalid`);
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
      expect(commit.author.email).toBe(`${userId}@users.noreply.invalid`);
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

  /**
   * Who may change a text of the source, and keep a translation after it (DB-607).
   *
   * The source is proposed and published by `writes_source` alone. A grant of
   * the source as a language grants nothing, and neither does an admin.
   */
  describe('the source, and the translations to read again', () => {
    const sourceProposal = (repositoryId: string, readAt: string) => ({
      ...proposalBody(repositoryId, readAt, 'fr'),
      values: [{ file: 'common', key: 'hello', value: 'Salut' }],
    });

    it('lets an account that writes the source propose and publish it', async () => {
      const repoRow = await repository();
      const repo = withRepo();
      const { headers } = await translator([], 'translator', { writesSource: true });
      const proposed = await post('/i18n/proposals', headers, sourceProposal(repoRow.id, repo.refs.get('main')!));

      expect(proposed.status).toBe(200);

      const { data } = (await proposed.json()) as { data: { commit: string } };
      const published = await post('/i18n/publications', headers, {
        repository: repoRow.id,
        language: 'fr',
        approved: [{ file: 'common', key: 'hello', commit: data.commit }],
      });

      expect(published.status).toBe(200);
      expect(JSON.parse(repo.filesAt(repo.refs.get('main')!).get(`${LOCALES}/fr/common.json`)!)).toEqual({
        hello: 'Salut',
      });
    });

    it('refuses a reviewer of every language who does not write the source', async () => {
      const repoRow = await repository();
      const repo = withRepo();
      const { headers } = await translator(['en', 'fr'], 'reviewer');

      expect((await post('/i18n/proposals', headers, sourceProposal(repoRow.id, repo.refs.get('main')!))).status).toBe(
        403,
      );
      expect(repo.refs.get('i18n/fr')).toBeUndefined();
    });

    it('refuses an admin who holds no row', async () => {
      const repoRow = await repository();
      const repo = withRepo();
      const admin = await signedInAdmin();

      expect(
        (await post('/i18n/proposals', admin.headers, sourceProposal(repoRow.id, repo.refs.get('main')!))).status,
      ).toBe(403);
    });

    it('lets a reviewer keep a translation whose source changed, and shows it to read again before', async () => {
      const repoRow = await repository();
      const repo = withRepo();

      repo.moveBranch('main', { [`${LOCALES}/fr/common.json`]: { hello: 'Salut' } });

      const { headers } = await translator(['en'], 'reviewer');
      const before = await app.request(`/i18n/catalogue?repository=${repoRow.id}&language=en`, { headers });

      expect(await before.json()).toMatchObject({
        data: { entries: [{ key: 'hello', state: 'review', was: 'Bonjour', source: 'Salut', value: 'Hello' }] },
      });

      const kept = await post('/i18n/reviews', headers, {
        repository: repoRow.id,
        language: 'en',
        keys: [{ file: 'common', key: 'hello' }],
      });

      expect(kept.status).toBe(200);
      expect(await kept.json()).toMatchObject({ data: { kept: [{ file: 'common', key: 'hello' }], skipped: [] } });

      const after = await app.request(`/i18n/catalogue?repository=${repoRow.id}&language=en`, { headers });

      expect(await after.json()).toMatchObject({ data: { entries: [{ key: 'hello', state: 'translated' }] } });
    });

    it('refuses a translator who does not review the language', async () => {
      const repoRow = await repository();

      withRepo();

      const { headers } = await translator(['en']);
      const res = await post('/i18n/reviews', headers, {
        repository: repoRow.id,
        language: 'en',
        keys: [{ file: 'common', key: 'hello' }],
      });

      expect(res.status).toBe(403);
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

/**
 * A repository that publishes through a pull request (DB-606): how an admin
 * chooses it, what the page reads of the pull request, and what a publication
 * answers when GitHub refuses.
 */
describe('the mode pull_request', () => {
  const LOCALES = 'src/locales';

  const withRepo = () => {
    const repo = fakeRepo({
      owner: 'acme',
      name: 'acme-app',
      baseBranch: 'main',
      files: {
        [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
        [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
      },
    });

    vi.stubGlobal('fetch', repo.fetch);

    return repo;
  };

  const send = (method: string, path: string, headers: Record<string, string>, body: unknown) =>
    app.request(path, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** A proposal of `hello`, then its publication by a reviewer. */
  const proposeThenPublish = async (repositoryId: string, readAt: string) => {
    const author = await translator(['en']);
    const proposed = await send('POST', '/i18n/proposals', author.headers, {
      repository: repositoryId,
      language: 'en',
      readAt,
      values: [{ file: 'common', key: 'hello', value: 'Hi' }],
    });
    const { data } = (await proposed.json()) as { data: { commit: string } };
    const publisher = await translator(['en'], 'reviewer');

    return send('POST', '/i18n/publications', publisher.headers, {
      repository: repositoryId,
      language: 'en',
      approved: [{ file: 'common', key: 'hello', commit: data.commit }],
    });
  };

  it('lets an admin connect a repository in the mode pull_request, and lists the mode', async () => {
    const admin = await signedInAdmin();
    const res = await send('POST', '/i18n/repositories', admin.headers, {
      installationId: 42,
      owner: 'acme',
      name: 'acme-app',
      localesPath: 'src/locales',
      languages: ['fr', 'en'],
      publishMode: 'pull_request',
    });

    expect(res.status).toBe(200);

    const listed = (await (await app.request('/i18n/repositories', { headers: admin.headers })).json()) as {
      data: Array<{ publishMode: string }>;
    };

    expect(listed.data[0].publishMode).toBe('pull_request');
  });

  it('connects a repository in the mode commit when the body names none', async () => {
    const admin = await signedInAdmin();

    await send('POST', '/i18n/repositories', admin.headers, {
      installationId: 42,
      owner: 'acme',
      name: 'acme-app',
      localesPath: 'src/locales',
      languages: ['fr', 'en'],
    });

    const [row] = await db().select().from(i18nRepositories);

    expect(row.publishMode).toBe('commit');
  });

  it('lets an admin change the mode of a connected repository', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();
    const res = await send('PATCH', `/i18n/repositories/${repoRow.id}`, admin.headers, { publishMode: 'pull_request' });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { publishMode: string } }).data.publishMode).toBe('pull_request');
  });

  it('refuses the change to a reviewer who is no admin', async () => {
    const repoRow = await repository();
    const { headers } = await translator(['en'], 'reviewer');

    expect(
      (await send('PATCH', `/i18n/repositories/${repoRow.id}`, headers, { publishMode: 'pull_request' })).status,
    ).toBe(403);
  });

  it('refuses a mode it does not know, and a repository that is not there', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();

    expect(
      (await send('PATCH', `/i18n/repositories/${repoRow.id}`, admin.headers, { publishMode: 'push' })).status,
    ).toBe(400);
    expect((await send('PATCH', '/i18n/repositories/nope', admin.headers, { publishMode: 'commit' })).status).toBe(400);
  });

  it('publishes into a pull request, and the page then reads it open', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();

    await send('PATCH', `/i18n/repositories/${repoRow.id}`, admin.headers, { publishMode: 'pull_request' });

    const repo = withRepo();
    const res = await proposeThenPublish(repoRow.id, repo.refs.get('main')!);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { pullRequest: { number: number } } }).data.pullRequest.number).toBe(1);

    const state = await app.request(`/i18n/publication?repository=${repoRow.id}`, { headers: admin.headers });

    expect(((await state.json()) as { data: unknown }).data).toEqual({
      publishMode: 'pull_request',
      pullRequest: { number: 1, url: 'https://github.com/acme/acme-app/pull/1', state: 'open', mergeable: true },
    });
  });

  it('answers no pull request for a repository that publishes by commit', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();
    const state = await app.request(`/i18n/publication?repository=${repoRow.id}`, { headers: admin.headers });

    expect(((await state.json()) as { data: unknown }).data).toEqual({ publishMode: 'commit', pullRequest: null });
  });

  it('answers 503 naming the permission when GitHub refuses the pull request', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();

    await send('PATCH', `/i18n/repositories/${repoRow.id}`, admin.headers, { publishMode: 'pull_request' });

    const repo = withRepo();

    repo.refuse.pulls = true;

    const res = await proposeThenPublish(repoRow.id, repo.refs.get('main')!);

    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toMatch(/Pull requests: write/);
  });

  it('answers 409 when the branch of the publications conflicts with the base branch', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();

    await send('PATCH', `/i18n/repositories/${repoRow.id}`, admin.headers, { publishMode: 'pull_request' });

    const repo = withRepo();

    expect((await proposeThenPublish(repoRow.id, repo.refs.get('main')!)).status).toBe(200);

    repo.moveBranch('main', { [`${LOCALES}/en/common.json`]: { hello: 'Hey' } });
    repo.refuse.mergeConflict = true;

    const res = await proposeThenPublish(repoRow.id, repo.refs.get('main')!);

    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toMatch(/Resolve the conflict/);
  });
});

/**
 * The settings of a connected repository (DB-609): what an admin changes, what
 * is read on GitHub first, and what a format of a message refuses.
 */
describe('PATCH /i18n/repositories/:id', () => {
  const LOCALES = 'src/locales';

  const withRepo = () => {
    const repo = fakeRepo({
      owner: 'acme',
      name: 'acme-app',
      baseBranch: 'main',
      files: {
        [`${LOCALES}/fr/common.json`]: { hello: 'Bonjour' },
        [`${LOCALES}/en/common.json`]: { hello: 'Hello' },
        'config/i18n.json': { source: 'fr' },
      },
    });

    // A branch beside main, at the same commit.
    repo.refs.set('next', repo.refs.get('main')!);
    vi.stubGlobal('fetch', repo.fetch);

    return repo;
  };

  const patch = (id: string, headers: Record<string, string>, body: unknown) =>
    app.request(`/i18n/repositories/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const rowOf = async (id: string) => (await db().select().from(i18nRepositories)).find((row) => row.id === id)!;

  it('changes the formats, and an empty format gives the default back', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();

    const set = await patch(repoRow.id, admin.headers, {
      pullRequestTitleTemplate: 'Translations: {count_keys} ({languages})',
      pullRequestBodyTemplate: 'Merge me.\n\n{keys_list}',
    });

    expect(set.status).toBe(200);
    expect((await rowOf(repoRow.id)).pullRequestTitleTemplate).toBe('Translations: {count_keys} ({languages})');

    expect((await patch(repoRow.id, admin.headers, { pullRequestTitleTemplate: '' })).status).toBe(200);
    expect((await rowOf(repoRow.id)).pullRequestTitleTemplate).toBeNull();
    expect((await rowOf(repoRow.id)).pullRequestBodyTemplate).toBe('Merge me.\n\n{keys_list}');
  });

  it('lists the formats beside the repository', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();

    await patch(repoRow.id, admin.headers, { proposalCommitTemplate: 'i18n({language}): {count_keys}' });

    const listed = (await (await app.request('/i18n/repositories', { headers: admin.headers })).json()) as {
      data: Array<Record<string, unknown>>;
    };

    expect(listed.data[0]).toMatchObject({
      proposalCommitTemplate: 'i18n({language}): {count_keys}',
      publicationCommitTemplate: null,
      pullRequestTitleTemplate: null,
      pullRequestBodyTemplate: null,
    });
  });

  it('refuses an unknown variable, and says it under its field', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();
    const res = await patch(repoRow.id, admin.headers, { pullRequestTitleTemplate: 'by {author}' });

    expect(res.status).toBe(400);

    const answer = (await res.json()) as { errors: Array<{ field: string; message: string }> };

    expect(answer.errors).toEqual([
      { field: 'pullRequestTitleTemplate', message: expect.stringMatching(/\{author\} is not a variable/) },
    ]);
    expect((await rowOf(repoRow.id)).pullRequestTitleTemplate).toBeNull();
  });

  it('refuses a second line in a commit subject, a lone brace, a field it does not know and an empty change', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();

    for (const body of [
      { publicationCommitTemplate: 'one\ntwo' },
      { proposalCommitTemplate: 'i18n({language)' },
      { installationId: 7 },
      {},
      { languages: ['fr', 'en', 'fr'] },
      { localesPath: '../secrets' },
    ]) {
      expect((await patch(repoRow.id, admin.headers, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('refuses a reviewer who is no admin, and a repository that is not there', async () => {
    const repoRow = await repository();
    const { headers } = await translator(['en'], 'reviewer');
    const admin = await signedInAdmin();

    expect((await patch(repoRow.id, headers, { pullRequestTitleTemplate: '{count_keys}' })).status).toBe(403);
    expect((await patch('nope', admin.headers, { pullRequestTitleTemplate: '{count_keys}' })).status).toBe(400);
  });

  it('moves the branch, the folder and the manifest after it reads them on GitHub', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();

    withRepo();

    const res = await patch(repoRow.id, admin.headers, {
      branch: 'next',
      manifestPath: 'config/i18n.json',
      languages: ['fr', 'en', 'de'],
      publishMode: 'pull_request',
    });

    expect(res.status).toBe(200);
    expect(await rowOf(repoRow.id)).toMatchObject({
      branch: 'next',
      manifestPath: 'config/i18n.json',
      languages: ['fr', 'en', 'de'],
      publishMode: 'pull_request',
    });
  });

  it('refuses a branch, a folder or a manifest that GitHub does not hold, and writes nothing', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();

    withRepo();

    const refused = [
      [{ branch: 'gone' }, /has no branch gone/],
      [{ localesPath: 'locales' }, /holds no folder locales/],
      [{ manifestPath: 'config/missing.json' }, /holds no file config\/missing.json/],
    ] as const;

    for (const [body, reason] of refused) {
      const res = await patch(repoRow.id, admin.headers, body);

      expect(res.status, JSON.stringify(body)).toBe(400);
      const answer = (await res.json()) as { message: string; errors: Array<{ field: string }> };

      expect(answer.message).toMatch(reason);
      expect(answer.errors).toEqual([{ field: Object.keys(body)[0], message: answer.message }]);
    }

    expect(await rowOf(repoRow.id)).toMatchObject({ branch: 'main', localesPath: LOCALES, manifestPath: null });
  });

  it('answers 502 with the reason when GitHub fails the check, and writes nothing', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();
    const repo = withRepo();
    const answering = repo.fetch.getMockImplementation()!;

    repo.fetch.mockImplementation(async (url, init) =>
      String(url).includes('/branches/')
        ? { ok: false, status: 500, json: async () => ({ message: 'Server Error' }) }
        : answering(url, init),
    );

    const res = await patch(repoRow.id, admin.headers, { branch: 'next' });

    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).toMatch(/GitHub answered 500/);
    expect((await rowOf(repoRow.id)).branch).toBe('main');
  });

  it('writes the next proposal and publication in the formats of the repository', async () => {
    const repoRow = await repository();
    const admin = await signedInAdmin();
    const repo = withRepo();

    await patch(repoRow.id, admin.headers, {
      proposalCommitTemplate: 'translate({language}): {count_keys} from {author}',
      publicationCommitTemplate: 'translate({language}): {count_keys} {action}',
    });

    const author = await translator(['en']);
    const proposed = await app.request('/i18n/proposals', {
      method: 'POST',
      headers: { ...author.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repository: repoRow.id,
        language: 'en',
        readAt: repo.refs.get('main'),
        values: [{ file: 'common', key: 'hello', value: 'Hi' }],
      }),
    });
    const { data } = (await proposed.json()) as { data: { commit: string } };

    expect(repo.commits.get(data.commit)!.message).toMatch(
      new RegExp(`^translate\\(en\\): 1 key from .+\\n\\nRead-at: ${repo.refs.get('main')}$`),
    );

    const publisher = await translator(['en'], 'reviewer');
    const published = await app.request('/i18n/publications', {
      method: 'POST',
      headers: { ...publisher.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repository: repoRow.id,
        language: 'en',
        approved: [{ file: 'common', key: 'hello', commit: data.commit }],
      }),
    });

    expect(published.status).toBe(200);
    expect(repo.commits.get(repo.refs.get('main')!)!.message).toBe(
      'translate(en): 1 key published\n\n- en common:hello',
    );
  });
});

/** The rights of a member hold in its repository, and in no other (DB-637). */
describe('members of one repository', () => {
  async function otherRepository() {
    const [row] = await db()
      .insert(i18nRepositories)
      .values({
        id: newId(),
        organizationId: await insertOrganization(),
        installationId: 42,
        owner: 'acme',
        name: 'other-app',
        branch: 'main',
        localesPath: 'src/locales',
        languages: ['fr', 'en'],
      } as never)
      .returning();

    return row;
  }

  it('lists to a member only the repositories where it is a member', async () => {
    const repo = await repository();

    await otherRepository();

    const { headers } = await translator(['en']);
    const listed = (await (await app.request('/i18n/repositories', { headers })).json()) as {
      data: Array<{ id: string }>;
    };

    expect(listed.data.map((row) => row.id)).toEqual([repo.id]);
  });

  it('refuses to a member the catalogue and the writes of another repository', async () => {
    await repository();

    const other = await otherRepository();
    const { headers } = await translator(['en'], 'reviewer');
    const read = await app.request(`/i18n/catalogue?repository=${other.id}&language=en`, { headers });
    const proposed = await app.request('/i18n/proposals', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repository: other.id,
        language: 'en',
        readAt: 'a'.repeat(40),
        values: [{ file: 'common', key: 'hello', value: 'Hi' }],
      }),
    });

    expect(read.status).toBe(403);
    expect(proposed.status).toBe(403);
  });

  /** A different answer would tell a member which repositories the editor holds. */
  it('answers a member the same for a repository that is not there and for one of another member', async () => {
    await repository();

    const other = await otherRepository();
    const { headers } = await translator(['en']);
    const answers = await Promise.all(
      [other.id, 'no-such-repository'].map(async (id) => {
        const res = await app.request(`/i18n/catalogue?repository=${id}&language=en`, { headers });

        return { status: res.status, body: await res.text() };
      }),
    );

    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0].status).toBe(403);
    expect(answers[0].body).not.toContain('other-app');
  });

  it('gives an owner the rights of a reviewer in its languages', async () => {
    const repo = await repository();
    const { headers } = await translator(['en'], 'owner');
    const res = await app.request('/i18n/me', { headers });

    expect(await res.json()).toMatchObject({ data: { memberships: [{ repositoryId: repo.id, role: 'owner' }] } });
  });

  /** The plugin lets any signed-in account call its routes. A translator could make itself an owner. */
  it('closes the routes of the organization plugin, even to a member', async () => {
    const repo = await repository();
    const { headers, userId } = await translator(['en']);

    for (const path of ['update-member-role', 'add-member', 'remove-member', 'invite-member', 'leave', 'update']) {
      const res = await app.request(`/api/auth/organization/${path}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: repo.organizationId, memberId: userId, role: 'owner' }),
      });

      expect(res.status).toBe(404);
    }

    expect((await app.request('/api/auth/organization/list', { headers })).status).toBe(404);
  });
});
