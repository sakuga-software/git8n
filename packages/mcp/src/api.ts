/**
 * The translations, read and written through the API (DB-211).
 *
 * **Every call goes through `/i18n`, never through a service.** The rights of
 * DB-210 live in the middleware of those routes: which languages an account may
 * propose in, and that publishing needs the reviewer role. A server that
 * imported the services would carry those rules in its own discipline instead,
 * and there would be a write path that does not pass them.
 *
 * The credential is a bearer token of an account: an access token of the page
 * « Jetons » (DB-669). The server never holds a password.
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
  /** Where the API answers, for example `https://i18n.example.com`. */
  url: string;
  /**
   * A bearer token of the account this server acts as.
   *
   * The editor of DB-213 runs in a browser and holds no token: it leaves this
   * out, and every call carries the session cookie of the API.
   */
  token?: string;
  /** Replaces the global `fetch`. A test sends the requests to the API in its own process. */
  fetch?: typeof fetch;
}

export const configOf = (env: Record<string, string | undefined>): ApiConfig => {
  const url = env.I18N_EDITOR_API_URL?.replace(/\/+$/, '');
  const token = env.I18N_EDITOR_API_TOKEN;

  if (!url || !token) {
    throw new NotConfiguredError(
      'Set I18N_EDITOR_API_URL and I18N_EDITOR_API_TOKEN. Make the token in the editor: account menu, then « Jetons d’accès ».',
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
  /** `review`: a translation whose source changed after it was written (DB-607). */
  state: 'translated' | 'missing' | 'review';
  /**
   * For `review` only: the source text the translation answers. `source` is the text now.
   * A key left empty on purpose has none.
   */
  was?: string;
  /** The key is left empty on purpose in this language (DB-611): `value` is `''`, and it counts as translated. */
  empty?: true;
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
   * `partial` file is translated and not shown to the users of the application yet. An API from
   * before DB-225 sends no such field.
   */
  files?: Record<string, 'available' | 'partial' | 'disabled'>;
}

export interface Repository {
  id: string;
  owner: string;
  name: string;
  /** The picture of the owner on GitHub (DB-617). Null if GitHub gave none, absent from an older API. */
  avatarUrl?: string | null;
  branch: string;
  localesPath: string;
  /** From the root of the repository. Absent from an API older than DB-571. */
  manifestPath?: string;
  /** How a publication reaches the base branch. Absent from an API older than DB-606, which publishes by commit. */
  publishMode?: PublishMode;
  /**
   * The formats of the messages (DB-609). Null means the default format, and
   * an API older than DB-609 sends none.
   */
  proposalCommitTemplate?: string | null;
  publicationCommitTemplate?: string | null;
  pullRequestTitleTemplate?: string | null;
  pullRequestBodyTemplate?: string | null;
  source: string;
  targets: string[];
}

/** What an admin changes on a connected repository. An absent field keeps its value (DB-609). */
export interface RepositoryChange {
  branch?: string;
  localesPath?: string;
  /** Null gives back `<localesPath>/manifest.json`. */
  manifestPath?: string | null;
  /** The source language first. */
  languages?: string[];
  publishMode?: PublishMode;
  /** Null gives back the default format. */
  proposalCommitTemplate?: string | null;
  publicationCommitTemplate?: string | null;
  pullRequestTitleTemplate?: string | null;
  pullRequestBodyTemplate?: string | null;
}

/** `commit`: straight onto the base branch. `pull_request`: through one open pull request (DB-606). */
export type PublishMode = 'commit' | 'pull_request';

/** The pull request that carries the publications of a repository. */
export interface PublishPull {
  number: number;
  url: string;
  state: 'open' | 'merged' | 'closed';
  /** Null while GitHub computes it, and for a pull request that is not open. */
  mergeable: boolean | null;
}

export interface PublicationState {
  publishMode: PublishMode;
  /** The last pull request of the publications, open or not. Null in the mode `commit`. */
  pullRequest: PublishPull | null;
}

/** What an account may do in one repository (DB-637). */
export interface Membership {
  repositoryId: string;
  languages: string[];
  /** An owner also manages the members. A reviewer publishes. A translator proposes. */
  role: 'owner' | 'reviewer' | 'translator';
  /** Whether the account may add a key to the source language (DB-238). */
  writesSource: boolean;
}

/** What `/i18n/me` answers: the account, and what it may do in each repository where it is a member. */
export interface Me {
  admin: boolean;
  /** Where an admin installs the GitHub App. Null for any other account, and absent from an API older than DB-581. */
  installUrl?: string | null;
  memberships: Membership[];
}

/** What an account may do in one repository: the view of `Me` that the screens of a repository read. */
export interface Rights {
  admin: boolean;
  rights: {
    languages: string[];
    role: Membership['role'];
    /** Whether the account may add a key to the source language. Absent from an API older than DB-238. */
    writesSource?: boolean;
  } | null;
}

/** The rights of `me` in one repository. */
export const rightsIn = (me: Me, repositoryId: string): Rights => {
  const membership = me.memberships.find((held) => held.repositoryId === repositoryId);

  return {
    admin: me.admin,
    rights: membership
      ? { languages: membership.languages, role: membership.role, writesSource: membership.writesSource }
      : null,
  };
};

export interface ProposedValue {
  file: string;
  key: string;
  value: string;
  /** Leaves the key empty on purpose (DB-611), with `value: ''`. No field removes the mark. */
  empty?: boolean;
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

const ask = async <T>(config: ApiConfig, path: string, body?: unknown, method?: 'PATCH' | 'DELETE'): Promise<T> => {
  const response = await (config.fetch ?? fetch)(`${config.url}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
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

export const rightsOf = (config: ApiConfig) => ask<Me>(config, '/i18n/me');

/** One installation of the GitHub App, and the repositories it reaches. For an admin. */
export interface Installation {
  id: number;
  /** The organisation or the person the App is installed on. */
  account: string;
  repositories: Array<{ owner: string; name: string }>;
}

export const installations = (config: ApiConfig) => ask<Installation[]>(config, '/i18n/installations');

/** A repository that an installation reaches, with the account the App is installed on. */
export interface ReachableRepository {
  installationId: number;
  account: string;
  owner: string;
  name: string;
  private: boolean;
  /** The last push to the repository. The list comes sorted by it, the newest first. */
  pushedAt: string | null;
}

export interface ReachablePage {
  rows: ReachableRepository[];
  page: number;
  perPage: number;
  /** How many repositories match the search, over every page. */
  total: number;
  hasMore: boolean;
}

/**
 * One page of the repositories that the installations reach. `q` searches
 * every page. `fresh` asks the API to read GitHub again rather than the listing it holds.
 */
export const reachableRepositories = (
  config: ApiConfig,
  query: { page?: number; perPage?: number; q?: string; fresh?: boolean } = {},
) => {
  const params = new URLSearchParams();

  if (query.page) params.set('page', String(query.page));
  if (query.perPage) params.set('perPage', String(query.perPage));
  if (query.q) params.set('q', query.q);
  if (query.fresh) params.set('fresh', '1');

  const search = params.toString();

  return ask<ReachablePage>(config, `/i18n/installations/repositories${search ? `?${search}` : ''}`);
};

/** A folder that holds one folder for each language. */
export interface LocalesCandidate {
  path: string;
  languages: string[];
}

/** How a repository holds its locales, read before an admin connects it (DB-581). */
export interface Detection {
  defaultBranch: string;
  branch: string;
  /** GitHub cut the listing of a large repository: a folder deep in it can be absent. */
  truncated: boolean;
  candidates: LocalesCandidate[];
  localesPath: string | null;
  manifestPath: string | null;
  /** The source that the manifest names, or null. */
  source: string | null;
  /** The source first when it is known. */
  languages: string[];
  /** Whether a ruleset requires a pull request on the branch. Null when GitHub did not say, absent before DB-606. */
  requiresPullRequest?: boolean | null;
}

export const detection = (
  config: ApiConfig,
  query: { installationId: number; owner: string; name: string; branch?: string; localesPath?: string },
) => {
  const params = new URLSearchParams({
    installationId: String(query.installationId),
    owner: query.owner,
    name: query.name,
  });

  if (query.branch) params.set('branch', query.branch);
  if (query.localesPath) params.set('localesPath', query.localesPath);

  return ask<Detection>(config, `/i18n/detection?${params}`);
};

export interface NewRepository {
  installationId: number;
  owner: string;
  name: string;
  branch?: string;
  localesPath: string;
  manifestPath?: string;
  /** The source first. */
  languages: string[];
  publishMode?: PublishMode;
}

/** Connects a repository. `created` is false when it was connected already: the API answers that row. */
export const addRepository = (config: ApiConfig, repository: NewRepository) =>
  ask<Repository & { created?: boolean }>(config, '/i18n/repositories', repository);

export const catalogue = (config: ApiConfig, repository: string, language: string) =>
  ask<Catalogue>(
    config,
    `/i18n/catalogue?repository=${encodeURIComponent(repository)}&language=${encodeURIComponent(language)}`,
  );

/** How far a cold read of a catalogue is: `done` of its `total` locale files (DB-654). */
export interface CatalogueProgress {
  done: number;
  total: number;
}

/** One line of `/i18n/catalogue/stream`. */
type CatalogueLine =
  | { progress: CatalogueProgress }
  | { catalogue: Catalogue }
  | { error: { status: number; message: string } };

/**
 * The catalogue of `catalogue`, with `onProgress` called while a cold read takes its files (DB-654).
 *
 * The API answers NDJSON. A read that fails after the answer started says so in a line, with its status.
 */
export const catalogueStream = async (
  config: ApiConfig,
  repository: string,
  language: string,
  onProgress: (progress: CatalogueProgress) => void,
): Promise<Catalogue> => {
  const path = `/i18n/catalogue/stream?repository=${encodeURIComponent(repository)}&language=${encodeURIComponent(language)}`;
  const response = await (config.fetch ?? fetch)(`${config.url}${path}`, {
    signal: AbortSignal.timeout(60 * 1000),
    ...(config.token === undefined ? { credentials: 'include' as const } : {}),
    headers: {
      ...(config.token === undefined ? {} : { Authorization: `Bearer ${config.token}` }),
      Accept: 'application/x-ndjson',
    },
  });

  if (!response.ok || !response.body) {
    const said = await response.text().catch(() => '');

    throw new ApiError(said || `${path} answered ${response.status}`, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rest = '';

  for (;;) {
    const { done, value } = await reader.read();

    rest += decoder.decode(value, { stream: !done });

    const lines = rest.split('\n');

    // The last piece can be half a line: it waits for the next chunk.
    rest = done ? '' : lines.pop()!;

    for (const text of lines) {
      if (!text.trim()) continue;

      const line = JSON.parse(text) as CatalogueLine;

      if ('progress' in line) onProgress(line.progress);
      else if ('catalogue' in line) return line.catalogue;
      else throw new ApiError(line.error.message, line.error.status);
    }

    if (done) throw new ApiError(`${path} ended before the catalogue`, 502);
  }
};

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
  /** The batch leaves the key empty on purpose (DB-611). */
  empty?: true;
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
  /** The pull request that carries it. Null in the mode `commit`, and absent from an API older than DB-606. */
  pullRequest?: PublishPull | null;
}

/** Changes how a connected repository publishes. For an admin. */
/**
 * Changes a connected repository, for an admin (DB-606, DB-609).
 *
 * A refusal answers 400. Its body holds `errors`, one entry for each field,
 * as the other validation errors of the API do. `issuesOf` reads them.
 */
export const updateRepository = (config: ApiConfig, repository: string, change: RepositoryChange) =>
  ask<Repository>(config, `/i18n/repositories/${encodeURIComponent(repository)}`, change, 'PATCH');

/** The refusals of a change, by field, when the API named them. */
export const issuesOf = (error: unknown): Array<{ field: string; message: string }> => {
  if (!(error instanceof ApiError) || error.status !== 400) return [];

  try {
    const parsed = JSON.parse(error.message) as { errors?: Array<{ field?: unknown; message?: unknown }> };

    return (parsed.errors ?? []).map((issue) => ({
      field: String(issue.field ?? ''),
      message: String(issue.message ?? ''),
    }));
  } catch {
    return [];
  }
};

/** The pull request that carries the publications of a repository. */
export const publicationState = (config: ApiConfig, repository: string) =>
  ask<PublicationState>(config, `/i18n/publication?repository=${encodeURIComponent(repository)}`);

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
  /** The pull request that carries them, in the mode `pull_request`. */
  pullRequest?: PublishPull | null;
}

/**
 * Adds keys to the source language: on the base branch, or in the pull request
 * of the publications in the mode `pull_request`. The MCP server exposes
 * no tool for it: a person writes the texts of the product, an agent translates
 * them.
 */
export const createKeys = (config: ApiConfig, batch: { repository: string; values: ProposedValue[] }) =>
  ask<CreatedKeys>(config, '/i18n/keys', batch);

/** What keeping translations after a change of their source ended as (DB-607). */
export interface Reviewed {
  commit: string | null;
  kept: Array<{ file: string; key: string }>;
  skipped: Array<{ file: string; key: string }>;
  pullRequest: PublishPull | null;
}

/**
 * Keeps translations as they are, after their source changed. The MCP server
 * exposes no tool for it: as a publication, a person does it.
 */
export const keepTranslations = (
  config: ApiConfig,
  batch: { repository: string; language: string; keys: Array<{ file: string; key: string }> },
) => ask<Reviewed>(config, '/i18n/reviews', batch);

export interface LanguageProgress {
  language: string;
  published: number;
  proposed: number;
  missing: number;
  /** Translations whose source changed after they were written (DB-607). */
  review: number;
  /** The published keys left empty on purpose, counted in `published` too (DB-611). Absent from an older API. */
  empty?: number;
  total: number;
}

/**
 * How far each language of a repository is, for the languages the account can
 * open. The API holds an answer for a minute, and drops it at each write.
 */
export const progress = (config: ApiConfig, repository: string) =>
  ask<LanguageProgress[]>(config, `/i18n/progress?repository=${encodeURIComponent(repository)}`);

/** The orders of the page of every repository. */
export type OverviewSort = 'name' | 'created' | 'progress';

/** One connected repository, as the page of every repository shows it (DB-610). */
export interface RepositoryOverview {
  id: string;
  owner: string;
  name: string;
  branch: string;
  publishMode: PublishMode;
  source: string;
  targets: string[];
  /** When the repository was connected, ISO 8601. */
  createdAt: string;
  /** The target languages the account can open. Null when GitHub did not answer. */
  progress: LanguageProgress[] | null;
  /** Why `progress` is null. */
  progressError?: string;
  /** The open pull request of the publications, for a repository that publishes by pull request. */
  pullRequest: { number: number; url: string } | null;
}

export interface OverviewPage {
  rows: RepositoryOverview[];
  page: number;
  perPage: number;
  /** How many repositories match the search, over every page. */
  total: number;
  hasMore: boolean;
}

/** One page of the connected repositories, searched on `owner/name` and sorted. */
export const overview = (
  config: ApiConfig,
  query: { page?: number; perPage?: number; q?: string; sort?: OverviewSort; order?: 'asc' | 'desc' } = {},
) => {
  const params = new URLSearchParams();

  if (query.page) params.set('page', String(query.page));
  if (query.perPage) params.set('perPage', String(query.perPage));
  if (query.q) params.set('q', query.q);
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);

  const search = params.toString();

  return ask<OverviewPage>(config, `/i18n/overview${search ? `?${search}` : ''}`);
};

/** What a member, or an invitation, may do in a repository (DB-637). */
export interface MemberRights {
  role: Membership['role'];
  /** The target languages, never the source: `writesSource` gives it. */
  languages: string[];
  writesSource: boolean;
}

export interface Member extends MemberRights {
  id: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
}

/** A person added before their first sign-in, by address or by GitHub login. */
export interface Invitation extends MemberRights {
  id: string;
  email: string | null;
  githubLogin: string | null;
  createdAt: string;
}

export interface MemberList {
  members: Member[];
  invitations: Invitation[];
}

/** What adding a person did: a member now, or an invitation that waits for the first sign-in. */
export type AddedMember =
  | { outcome: 'member'; memberId: string }
  | {
      outcome: 'invited';
      invitationId: string;
      by: 'email' | 'github';
      /** For an invitation by address: false when the magic link did not leave. The list sends it again. */
      linkSent?: boolean;
    };

const membersPath = (repository: string) => `/i18n/repositories/${encodeURIComponent(repository)}`;

export const readMembers = (config: ApiConfig, repository: string) =>
  ask<MemberList>(config, `${membersPath(repository)}/members`);

export const addMember = (
  config: ApiConfig,
  repository: string,
  person: ({ email: string } | { githubLogin: string }) & MemberRights,
) => ask<AddedMember>(config, `${membersPath(repository)}/members`, person);

export const changeMember = (config: ApiConfig, repository: string, memberId: string, change: Partial<MemberRights>) =>
  ask<null>(config, `${membersPath(repository)}/members/${encodeURIComponent(memberId)}`, change, 'PATCH');

export const removeMember = (config: ApiConfig, repository: string, memberId: string) =>
  ask<null>(config, `${membersPath(repository)}/members/${encodeURIComponent(memberId)}`, undefined, 'DELETE');

export const changeInvitation = (
  config: ApiConfig,
  repository: string,
  invitationId: string,
  change: Partial<MemberRights>,
) => ask<null>(config, `${membersPath(repository)}/invitations/${encodeURIComponent(invitationId)}`, change, 'PATCH');

export const removeInvitation = (config: ApiConfig, repository: string, invitationId: string) =>
  ask<null>(config, `${membersPath(repository)}/invitations/${encodeURIComponent(invitationId)}`, undefined, 'DELETE');

/** Sends the magic link of an invitation by address again (DB-645). */
export const sendInvitationLink = (config: ApiConfig, repository: string, invitationId: string) =>
  ask<null>(config, `${membersPath(repository)}/invitations/${encodeURIComponent(invitationId)}/link`, {});

/** An access token of the signed-in account (DB-669). The list never holds the token itself. */
export interface AccessToken {
  id: string;
  name: string;
  /** The first characters of the token, to tell the tokens apart. */
  start: string;
  /** Null when the token does not expire. */
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Only the session of the browser manages the tokens: the API refuses a bearer token here. */
export const accessTokens = (config: ApiConfig) => ask<AccessToken[]>(config, '/i18n/tokens');

/** The answer holds `token`. It is the only time that the token is readable. */
export const createAccessToken = (config: ApiConfig, token: { name: string; expiresInDays: number | null }) =>
  ask<AccessToken & { token: string }>(config, '/i18n/tokens', token);

export const revokeAccessToken = (config: ApiConfig, id: string) =>
  ask<null>(config, `/i18n/tokens/${encodeURIComponent(id)}`, undefined, 'DELETE');
