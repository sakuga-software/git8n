import { and, eq } from 'drizzle-orm';
import { i18nRepositories, newId, type I18nRepository, type PublishMode } from '@i18n-editor/db';
import { db } from '@/db';
import { withoutTrailingSlashes } from '@/utils/trailing-slashes';
import {
  ask,
  GithubAppNotConfiguredError,
  GithubError,
  insideRepository,
  installationToken,
  repositoriesOf,
} from '@/services/github-app.service';
import { forgetCatalogues } from '@/services/i18n-catalogue.service';
import { forgetProgress } from '@/services/i18n-progress.service';

/**
 * The repositories the editor translates (DB-210).
 *
 * The branch, the path of the locales and the languages belong to the
 * repository, so they live beside it. Adding a language costs a row. A second
 * repository costs an installation and a row, not a second deployment.
 */

/** The languages of a repository, the source told apart from the rest. */
export interface Languages {
  /** The one the others are translated from: the first of the row. */
  source: string;
  targets: string[];
}

export const languagesOf = (repository: I18nRepository): Languages => ({
  source: repository.languages[0],
  targets: repository.languages.slice(1),
});

export const listRepositories = async (): Promise<I18nRepository[]> =>
  db().select().from(i18nRepositories).orderBy(i18nRepositories.owner, i18nRepositories.name);

/**
 * Named a repository that is not one of these, and says which ones are.
 *
 * It covers an identifier that names nothing, and a repository the
 * installation does not reach. The caller is wrong, not the service, so the
 * route answers 400.
 */
export class UnknownRepositoryError extends Error {
  constructor(reason: string) {
    super(reason);

    this.name = 'UnknownRepositoryError';
  }
}

/** Named a language the repository does not hold, and says which ones it does. */
export class UnknownLanguageError extends Error {
  constructor(reason: string) {
    super(reason);

    this.name = 'UnknownLanguageError';
  }
}

/**
 * The repository behind an identifier, or the reason there is none.
 *
 * No repository at all is a setup nobody finished, not a catalogue with no
 * key. Somebody must install the App and say what to translate, so it is a
 * 503. An identifier that names nothing is the caller's mistake, and answers
 * the ones that exist.
 */
export const repositoryOrReason = async (id: string | undefined): Promise<I18nRepository> => {
  const rows = await listRepositories();

  if (rows.length === 0) {
    throw new GithubAppNotConfiguredError(
      'No repository is set up yet. Install the GitHub App on one, then add it with POST /i18n/repositories.',
    );
  }

  const known = rows.map((row) => `${row.id} (${row.owner}/${row.name})`).join(', ');

  if (!id) {
    throw new UnknownRepositoryError(`Name the repository to read, with ?repository=. Known: ${known}`);
  }

  const found = rows.find((row) => row.id === id);

  if (!found) throw new UnknownRepositoryError(`No repository ${id}. Known: ${known}`);

  return found;
};

export interface NewRepository {
  installationId: number;
  owner: string;
  name: string;
  branch?: string;
  localesPath: string;
  manifestPath?: string;
  /** The source language first. */
  languages: string[];
  publishMode?: PublishMode;
}

/**
 * Refuses a repository that the installation does not reach.
 *
 * The installation gives the right to read, and the caller chooses it.
 * Without this check, an admin writes down any repository beside one of our
 * installations. Every read of it then fails at GitHub with a bare 404.
 */
export const ensureReachable = async (installationId: number, owner: string, name: string): Promise<void> => {
  const reachable = await repositoriesOf(installationId).catch((error: unknown) => {
    // An installation nobody holds is the caller's mistake: GitHub refuses to
    // mint its token. Here alone. The same refusal on GET /i18n/installations
    // is our App failing, and stays a server error.
    if (error instanceof GithubError && [401, 403, 404].includes(error.status)) {
      throw new UnknownRepositoryError(
        `No installation ${installationId} this App can use. Read GET /i18n/installations for the ones that exist.`,
      );
    }

    throw error;
  });

  if (!reachable.some((row) => row.owner === owner && row.name === name)) {
    throw new UnknownRepositoryError(
      `Installation ${installationId} does not reach ${owner}/${name}. It reaches: ${
        reachable.map((row) => `${row.owner}/${row.name}`).join(', ') || 'nothing'
      }`,
    );
  }
};

/** A repository written down, and whether this call wrote it. */
export interface Added {
  repository: I18nRepository;
  /** False when the row was already there. The page then says so, and opens it. */
  created: boolean;
}

/**
 * Writes a repository down, or answers the one that is already there.
 *
 * Adding the same repository twice is an operator pressing a button again, not
 * an error. It must not make a second row: two rows would each answer for it
 * with a branch of their own.
 */
export const addRepository = async (input: NewRepository): Promise<Added> => {
  if (input.languages.length === 0) {
    throw new Error('A repository needs at least its source language.');
  }

  const [existing] = await db()
    .select()
    .from(i18nRepositories)
    .where(and(eq(i18nRepositories.owner, input.owner), eq(i18nRepositories.name, input.name)))
    .limit(1);

  if (existing) return { repository: existing, created: false };

  await ensureReachable(input.installationId, input.owner, input.name);

  const [created] = await db()
    .insert(i18nRepositories)
    .values({
      id: newId(),
      installationId: input.installationId,
      owner: input.owner,
      name: input.name,
      branch: input.branch || 'main',
      // A path that ends in a slash would double in a URL.
      localesPath: withoutTrailingSlashes(input.localesPath),
      manifestPath: input.manifestPath ?? null,
      languages: input.languages,
      publishMode: input.publishMode ?? 'commit',
    })
    .returning();

  return { repository: created, created: true };
};

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

/** A branch, a folder or a manifest that GitHub does not hold, and the field that names it. */
export class NotOnGithubError extends UnknownRepositoryError {
  readonly field: 'branch' | 'localesPath' | 'manifestPath';

  constructor(field: NotOnGithubError['field'], reason: string) {
    super(reason);

    this.name = 'NotOnGithubError';
    this.field = field;
  }
}

const repositoryPath = (row: Pick<I18nRepository, 'owner' | 'name'>) =>
  `/repos/${insideRepository(row.owner)}/${insideRepository(row.name)}`;

/**
 * Refuses a branch, a folder or a manifest that the repository does not hold.
 *
 * A row that names a path GitHub does not have would read as a catalogue with
 * no key, and every write would fail at GitHub with a bare 404. The check reads
 * the branch the row will hold, so a new branch and an old path are read together.
 */
const ensureOnGithub = async (row: I18nRepository, next: I18nRepository): Promise<void> => {
  const branchMoved = next.branch !== row.branch;
  const branchOrPathMoved = branchMoved || next.localesPath !== row.localesPath;
  const manifestToRead = next.manifestPath && (branchOrPathMoved || next.manifestPath !== row.manifestPath);

  // A change of the mode or of a format reads nothing on GitHub.
  if (!branchOrPathMoved && !manifestToRead) return;

  const token = await installationToken(row.installationId, { repository: row.name });
  const repository = repositoryPath(row);
  const ref = `?ref=${encodeURIComponent(next.branch)}`;
  const exists = async (path: string): Promise<unknown> =>
    ask<unknown>(path, token).catch((error: unknown) => {
      if (error instanceof GithubError && error.status === 404) return null;

      throw error;
    });

  if (branchMoved && !(await exists(`${repository}/branches/${insideRepository(next.branch)}`))) {
    throw new NotOnGithubError('branch', `${row.owner}/${row.name} has no branch ${next.branch}.`);
  }

  if (branchOrPathMoved) {
    const folder = await exists(`${repository}/contents/${insideRepository(next.localesPath)}${ref}`);

    if (!Array.isArray(folder)) {
      throw new NotOnGithubError('localesPath', `${next.branch} holds no folder ${next.localesPath}.`);
    }
  }

  if (manifestToRead) {
    const manifest = await exists(`${repository}/contents/${insideRepository(next.manifestPath!)}${ref}`);

    if (!manifest || Array.isArray(manifest)) {
      throw new NotOnGithubError('manifestPath', `${next.branch} holds no file ${next.manifestPath}.`);
    }
  }
};

/**
 * Changes a connected repository (DB-606, DB-609).
 *
 * A change of the branch or of a path is read on GitHub before it is written.
 * The catalogue and the progress held for the repository are then dropped,
 * because they were read from the old place.
 */
export const updateRepository = async (id: string, change: RepositoryChange): Promise<I18nRepository> => {
  const [row] = await db().select().from(i18nRepositories).where(eq(i18nRepositories.id, id)).limit(1);

  if (!row) throw new UnknownRepositoryError(`No repository ${id}.`);

  const set: Partial<I18nRepository> = {
    ...change,
    ...(change.localesPath === undefined ? {} : { localesPath: withoutTrailingSlashes(change.localesPath) }),
  };
  const next = { ...row, ...set };

  await ensureOnGithub(row, next);

  const [changed] = await db().update(i18nRepositories).set(set).where(eq(i18nRepositories.id, id)).returning();

  forgetCatalogues(id);
  forgetProgress(id);

  return changed;
};
