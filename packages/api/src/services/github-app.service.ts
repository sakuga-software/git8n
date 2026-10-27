import jwt from 'jsonwebtoken';
import { env } from '@/config/env';

/**
 * The GitHub App that reads and writes the translations (DB-210).
 *
 * The App is installed on a repository. A personal token is not used, so a
 * translator is added with no access to GitHub.
 *
 * A token of an installation lasts one hour. It is asked for one repository
 * and for the rights it needs. Uninstalling the App revokes it.
 *
 * Nothing here names a repository. The App says which installations exist and
 * what each one reaches. Which one the editor translates is a row of
 * `i18n_repositories`.
 */

const API = 'https://api.github.com';

/** GitHub refuses a JWT that lasts more than ten minutes. Nine leaves room for a slow clock. */
const JWT_SECONDS = 9 * 60;

/**
 * How long before its end a token is thrown away.
 *
 * An installation token lasts one hour. A request that starts one second
 * before the end finishes after it. The margin keeps a read from failing on a
 * token that was valid when it was picked.
 */
const RENEW_BEFORE_MS = 5 * 60 * 1000;

/** What GitHub refused, with the status it refused it with. */
export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);

    this.name = 'GithubError';
  }
}

/** Says what is missing, rather than letting a call fail on an empty header. */
export class GithubAppNotConfiguredError extends Error {
  constructor(reason: string) {
    super(reason);

    this.name = 'GithubAppNotConfiguredError';
  }
}

const config = () => {
  if (!env.I18N_APP) {
    throw new GithubAppNotConfiguredError(
      'The translations need a GitHub App: set I18N_GITHUB_APP_ID and I18N_GITHUB_PRIVATE_KEY.',
    );
  }

  return env.I18N_APP;
};

/** The App itself, for the calls that are made before an installation is known. */
const appJwt = (now: Date): string => {
  const { appId, privateKey } = config();
  const issued = Math.floor(now.getTime() / 1000);

  try {
    return jwt.sign({ iat: issued - 60, exp: issued + JWT_SECONDS, iss: appId }, privateKey, { algorithm: 'RS256' });
  } catch (error) {
    // The message of the library does not say which variable holds the key.
    throw new GithubAppNotConfiguredError(
      `I18N_GITHUB_PRIVATE_KEY is not a private key GitHub can use: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * How many pages one listing reads.
 *
 * A `Link` that always names a next page makes a loop with no end. The loop
 * fills the heap and stops the process. A hundred pages of a hundred rows is
 * far more than this reads.
 */
const MAX_PAGES = 100;

/**
 * The path of a file or a directory of a repository, as a URL carries it.
 *
 * Each segment is encoded, and `..` is refused. `fetch` resolves `..` before
 * it sends, so a path that holds one leaves the repository:
 * `contents/../../../../user/repos` asks GitHub for `/user/repos`. An
 * administrator writes the row that holds such a path, and the writes of
 * DB-212 build their paths here too.
 */
export const insideRepository = (...parts: string[]): string =>
  parts
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (segment === '.' || segment === '..') {
        // A row written before this rule existed reaches here. The reader can
        // do nothing about it, so it is not a bad request: an operator fixes
        // the row, which is what this error means everywhere else.
        throw new GithubAppNotConfiguredError(
          `A path of the locales cannot hold ${segment}: ${parts.join('/')}. Fix the row of the repository.`,
        );
      }

      return encodeURIComponent(segment);
    })
    .join('/');

/** What GitHub answered, and the page after it when its `Link` names one. */
export interface Answered<T> {
  body: T;
  next: string | null;
}

/** The `rel="next"` of a `Link` header, as a path of the API. */
const nextOf = (header: string | null): string | null => {
  const match = header?.match(/<([^>]+)>;\s*rel="next"/);

  if (!match) return null;

  // A `next` on another host gets our prefix and becomes a path. Every caller
  // here talks to one API, so stop on a page that is elsewhere.
  if (!match[1].startsWith(`${API}/`)) throw new Error(`GitHub named a next page outside ${API}: ${match[1]}`);

  return match[1].slice(API.length);
};

export const asked = async <T>(
  path: string,
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET',
  body?: unknown,
): Promise<Answered<T>> => {
  const response = await fetch(`${API}${path}`, {
    method,
    signal: AbortSignal.timeout(15 * 1000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const answer = (await response.json().catch(() => ({}))) as { message?: string };

    throw new GithubError(
      `GitHub answered ${response.status} for ${path} — ${answer.message ?? 'no reason given'}`,
      response.status,
    );
  }

  // A merge with nothing to merge answers 204, with no body to read.
  if (response.status === 204) return { body: null as T, next: null };

  return { body: (await response.json()) as T, next: nextOf(response.headers.get('link')) };
};

/** One answer, for a call that reads no more than a page. */
export const ask = async <T>(
  path: string,
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET',
  body?: unknown,
): Promise<T> => (await asked<T>(path, token, method, body)).body;

/**
 * Every page of a listing.
 *
 * One page is a ceiling. An account with more than a hundred repositories
 * answers the first hundred. It says nothing about the rest, so a repository
 * that is there looks absent.
 */
const every = async <T>(path: string, token: string): Promise<T[]> => {
  const rows: T[] = [];
  let at: string | null = path;

  for (let read = 0; at; read += 1) {
    if (read >= MAX_PAGES)
      throw new Error(`${path} named more than ${MAX_PAGES} pages — this is a loop, not a listing.`);

    const page: Answered<T[]> = await asked<T[]>(at, token);

    rows.push(...page.body);
    at = page.next;
  }

  return rows;
};

/** The rights a token is asked for. Omitted, GitHub grants everything the App holds. */
export interface TokenScope {
  /** The repository, by name. Omitted, the token reaches every repository of the installation. */
  repository?: string;
  permissions?: Record<string, 'read' | 'write'>;
}

const held = new Map<string, { token: string; until: number }>();

/** Throws every held token away. The tests call it; nothing else needs it. */
export const clearInstallationToken = (): void => held.clear();

/**
 * A token of one installation, asked for as little as the caller needs.
 *
 * With neither field, GitHub mints a token for everything the installation
 * holds. An App installed on an organisation would give this service a key to
 * all of it.
 *
 * The scope is part of the key the token is held under: a token for reading
 * must not go to a caller that asked to write.
 */
export const installationToken = async (
  installationId: number,
  scope: TokenScope = {},
  options: { now?: Date } = {},
): Promise<string> => {
  const now = options.now ?? new Date();
  const key = `${installationId}:${JSON.stringify(scope)}`;
  const hit = held.get(key);

  if (hit && hit.until - now.getTime() > RENEW_BEFORE_MS) return hit.token;

  const minted = await ask<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    appJwt(now),
    'POST',
    {
      // `repositories` takes the **name**, not `owner/name`: the owner is the
      // one of the installation.
      ...(scope.repository ? { repositories: [scope.repository] } : {}),
      ...(scope.permissions ? { permissions: scope.permissions } : {}),
    },
  );

  held.set(key, { token: minted.token, until: new Date(minted.expires_at).getTime() });

  return minted.token;
};

/** One installation of the App: which one, and under which account. */
export interface Installation {
  id: number;
  /** The organisation or the person the App is installed on. */
  account: string;
  /** The picture of that account on GitHub. Null if GitHub sends none. */
  avatarUrl: string | null;
}

/**
 * The installations of the App.
 *
 * A repository is discovered, not configured. Install the App, ask here, and
 * the answer says what it reaches.
 */
export const installations = async (options: { now?: Date } = {}): Promise<Installation[]> => {
  const rows = await every<{ id: number; account?: { login?: string; avatar_url?: string } }>(
    '/app/installations?per_page=100',
    appJwt(options.now ?? new Date()),
  );

  return rows.map((row) => ({
    id: row.id,
    account: row.account?.login ?? '',
    avatarUrl: row.account?.avatar_url ?? null,
  }));
};

/** A repository one installation can reach. */
export interface InstallationRepository {
  owner: string;
  name: string;
  private: boolean;
  /** The last push to the repository, as GitHub dates it, or its last change if it has no push. */
  pushedAt: string | null;
}

export const repositoriesOf = async (installationId: number): Promise<InstallationRepository[]> => {
  // `metadata: read` is the least that lists repositories, and this call needs
  // nothing else.
  const token = await installationToken(installationId, { permissions: { metadata: 'read' } });
  // This listing wraps its rows in an object. `every` reads an array, so the
  // pages are walked here.
  const rows: InstallationRepository[] = [];
  let at: string | null = '/installation/repositories?per_page=100';

  for (let read = 0; at; read += 1) {
    if (read >= MAX_PAGES) throw new Error(`/installation/repositories named more than ${MAX_PAGES} pages.`);

    const page: Answered<{
      repositories: Array<{
        name: string;
        owner: { login: string };
        private?: boolean;
        pushed_at?: string | null;
        updated_at?: string | null;
      }>;
    }> = await asked(at, token);

    rows.push(
      ...page.body.repositories.map((row) => ({
        owner: row.owner.login,
        name: row.name,
        private: row.private === true,
        pushedAt: row.pushed_at ?? row.updated_at ?? null,
      })),
    );
    at = page.next;
  }

  return rows;
};
