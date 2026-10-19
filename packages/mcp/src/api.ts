/**
 * The translations, read and written through the API (DB-211).
 *
 * **Every call goes through `/i18n`, never through a service.** The rights of
 * DB-210 live in the middleware of those routes: which languages an account may
 * propose in, and that publishing needs the reviewer role. A server that
 * imported the services would carry those rules in its own discipline instead,
 * and there would be a write path that does not pass them.
 *
 * The credential is a bearer token of an account, which `POST /auth/login`
 * answers. The server never holds a password.
 */

/** What the API answers when it refuses, so the agent reads why. */
export class ApiError extends Error {
  readonly status: number;

  // Written out rather than as a parameter property: Node runs this file with
  // `--experimental-strip-types`, which removes types and rewrites nothing, and
  // a parameter property is syntax it refuses.
  constructor(message: string, status: number) {
    super(message);

    this.name = 'ApiError';
    this.status = status;
  }
}

/** Says what is missing, rather than failing on an empty header. */
export class NotConfiguredError extends Error {
  constructor(reason: string) {
    super(reason);

    this.name = 'NotConfiguredError';
  }
}

export interface ApiConfig {
  /** Where the API answers, for example `https://api.detectivebox.com`. */
  url: string;
  /**
   * A bearer token of the account this server acts as.
   *
   * The editor of DB-213 runs in a browser and holds no token: it leaves this
   * out, and every call carries the session cookie of the API.
   */
  token?: string;
}

export const configOf = (env: Record<string, string | undefined>): ApiConfig => {
  const url = env.DETECTIVEBOX_API_URL?.replace(/\/+$/, '');
  const token = env.DETECTIVEBOX_API_TOKEN;

  if (!url || !token) {
    throw new NotConfiguredError(
      'Set DETECTIVEBOX_API_URL and DETECTIVEBOX_API_TOKEN. The token is the accessToken that POST /auth/login answers.',
    );
  }

  return { url, token };
};

/** One key of the source, beside what the target language says about it. */
export interface CatalogueEntry {
  file: string;
  key: string;
  source: string;
  value: string | null;
  state: 'translated' | 'missing';
}

export interface Catalogue {
  repository: string;
  language: string;
  source: string;
  /**
   * The revision every value was read at.
   *
   * A proposal carries it back, and that is what lets a publication refuse a
   * key whose source moved since (DB-212). Nothing here invents one.
   */
  commit: string;
  entries: CatalogueEntry[];
  /**
   * What the language is for each file of the source (DB-225).
   *
   * A `disabled` file has no version in this language and no entry above. A
   * `partial` file is translated and not shown to the players yet. An API from
   * before DB-225 sends no such field.
   */
  files?: Record<string, 'available' | 'partial' | 'disabled'>;
}

export interface Repository {
  id: string;
  owner: string;
  name: string;
  branch: string;
  localesPath: string;
  source: string;
  targets: string[];
}

export interface Rights {
  admin: boolean;
  rights: {
    languages: string[];
    role: 'translator' | 'reviewer';
    /** Whether the account may add a key to the source language. Absent from an API older than DB-238. */
    writesSource?: boolean;
  } | null;
}

export interface ProposedValue {
  file: string;
  key: string;
  value: string;
}

export interface Proposal {
  commit: string;
  branch: string;
  readAt: string;
  keys: number;
  files: string[];
}

export interface WaitingBatch {
  commit: string;
  message: string;
  author: string;
  at: string;
  readAt: string;
}

const ask = async <T>(config: ApiConfig, path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${config.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    signal: AbortSignal.timeout(60 * 1000),
    ...(config.token === undefined ? { credentials: 'include' as const } : {}),
    headers: {
      ...(config.token === undefined ? {} : { Authorization: `Bearer ${config.token}` }),
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    // The message of the API says which language, which repository, or what a
    // body was missing. Losing it would leave the agent with a status alone.
    const said = await response.text().catch(() => '');

    throw new ApiError(said || `${path} answered ${response.status}`, response.status);
  }

  return ((await response.json()) as { data: T }).data;
};

export const repositories = (config: ApiConfig) => ask<Repository[]>(config, '/i18n/repositories');

export const rightsOf = (config: ApiConfig) => ask<Rights>(config, '/i18n/me');

export const catalogue = (config: ApiConfig, repository: string, language: string) =>
  ask<Catalogue>(
    config,
    `/i18n/catalogue?repository=${encodeURIComponent(repository)}&language=${encodeURIComponent(language)}`,
  );

export const waiting = (config: ApiConfig, repository: string, language: string) =>
  ask<WaitingBatch[]>(
    config,
    `/i18n/proposals?repository=${encodeURIComponent(repository)}&language=${encodeURIComponent(language)}`,
  );

/** One key that waits on the branch of a language, with the batch a publication names. */
export interface ProposedKey {
  file: string;
  key: string;
  value: string;
  /** What the base branch says in this language now. */
  current: string | null;
  source: string | null;
  commit: string;
  author: string;
  at: string;
  readAt: string;
}

export interface ApprovedKey {
  file: string;
  key: string;
  commit: string;
}

export interface RefusedKey extends ApprovedKey {
  reason: 'source-changed' | 'not-on-the-branch' | 'no-revision' | 'changed-since-approval' | 'disabled';
  was?: string;
  now?: string;
}

export interface Publication {
  commit: string | null;
  published: ApprovedKey[];
  refused: RefusedKey[];
}

export const proposedKeys = (config: ApiConfig, repository: string, language: string) =>
  ask<ProposedKey[]>(
    config,
    `/i18n/proposals/keys?repository=${encodeURIComponent(repository)}&language=${encodeURIComponent(language)}`,
  );

/**
 * Copies approved keys onto the base branch. The MCP server exposes no tool
 * for it: an agent proposes, and a person publishes.
 */
export const publish = (config: ApiConfig, batch: { repository: string; language: string; approved: ApprovedKey[] }) =>
  ask<Publication>(config, '/i18n/publications', batch);

export const propose = (
  config: ApiConfig,
  batch: { repository: string; language: string; readAt: string; values: ProposedValue[] },
) => ask<Proposal>(config, '/i18n/proposals', batch);

export interface CreatedKeys {
  commit: string;
  keys: number;
  files: string[];
}

/**
 * Adds keys to the source language, on the base branch. The MCP server exposes
 * no tool for it: a person writes the texts of the product, an agent translates
 * them.
 */
export const createKeys = (config: ApiConfig, batch: { repository: string; values: ProposedValue[] }) =>
  ask<CreatedKeys>(config, '/i18n/keys', batch);

export interface LanguageProgress {
  language: string;
  published: number;
  proposed: number;
  missing: number;
  total: number;
}

/**
 * How far each language of a repository is, for the languages the account can
 * open. The API holds an answer for a minute, and drops it at each write.
 */
export const progress = (config: ApiConfig, repository: string) =>
  ask<LanguageProgress[]>(config, `/i18n/progress?repository=${encodeURIComponent(repository)}`);
