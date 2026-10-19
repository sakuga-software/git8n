import { and, eq } from 'drizzle-orm';
import { i18nRepositories, newId, type I18nRepository } from '@i18n-editor/db';
import { db } from '@/db';
import { GithubAppNotConfiguredError, GithubError, repositoriesOf } from '@/services/github-app.service';

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
}

/**
 * Writes a repository down, or answers the one that is already there.
 *
 * Adding the same repository twice is an operator pressing a button again, not
 * an error. It must not make a second row: two rows would each answer for it
 * with a branch of their own.
 */
export const addRepository = async (input: NewRepository): Promise<I18nRepository> => {
  if (input.languages.length === 0) {
    throw new Error('A repository needs at least its source language.');
  }

  const [existing] = await db()
    .select()
    .from(i18nRepositories)
    .where(and(eq(i18nRepositories.owner, input.owner), eq(i18nRepositories.name, input.name)))
    .limit(1);

  if (existing) return existing;

  // The installation gives the right to read, and the caller chooses it.
  // Without this check, an admin writes down any repository beside one of our
  // installations. Every read of it then fails at GitHub with a bare 404.
  const reachable = await repositoriesOf(input.installationId).catch((error: unknown) => {
    // An installation nobody holds is the caller's mistake: GitHub refuses to
    // mint its token. Here alone. The same refusal on GET /i18n/installations
    // is our App failing, and stays a server error.
    if (error instanceof GithubError && [401, 403, 404].includes(error.status)) {
      throw new UnknownRepositoryError(
        `No installation ${input.installationId} this App can use. Read GET /i18n/installations for the ones that exist.`,
      );
    }

    throw error;
  });

  if (!reachable.some((row) => row.owner === input.owner && row.name === input.name)) {
    throw new UnknownRepositoryError(
      `Installation ${input.installationId} does not reach ${input.owner}/${input.name}. It reaches: ${
        reachable.map((row) => `${row.owner}/${row.name}`).join(', ') || 'nothing'
      }`,
    );
  }

  const [created] = await db()
    .insert(i18nRepositories)
    .values({
      id: newId(),
      installationId: input.installationId,
      owner: input.owner,
      name: input.name,
      branch: input.branch || 'main',
      // A path that ends in a slash would double in a URL.
      localesPath: input.localesPath.replace(/\/+$/, ''),
      manifestPath: input.manifestPath ?? null,
      languages: input.languages,
    })
    .returning();

  return created;
};
