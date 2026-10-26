import type { I18nRepository } from '@i18n-editor/db';
import { ask, GithubError, insideRepository } from '@/services/github-app.service';
import { fileTextOf, pathsOf } from '@/services/i18n-catalogue.service';
import { languagesOf } from '@/services/i18n-repositories.service';

/**
 * The translations to read again, because their source changed (DB-607).
 *
 * **The state is computed from git, and no table holds it.** The base branch
 * says when a source text changed, when a translation changed, and when a
 * reviewer kept a translation as it is. The last of these three events for a
 * key decides:
 *
 * - a source change, after the last translation of the key: « à revoir »;
 * - a change of the translation, or a `Reviewed:` trailer: up to date.
 *
 * **Only the history since the repository was connected counts.** Before that
 * date, nothing here wrote the files, and a source that drifted years ago
 * would flood every language with keys nobody can date.
 *
 * The read is bounded: `HISTORY_LIMIT` commits of the base branch, newest
 * first. An event older than that is ignored, as an event before the
 * connection is.
 */

/** The commits of the base branch that one read walks at most. */
export const HISTORY_LIMIT = 300;

/** The trailer that keeps a translation as it is, after its source changed. */
export const REVIEWED = 'Reviewed';

/** One line of the trailer, as `reviewedLine` writes it and `reviewedKeysOf` reads it. */
export const reviewedLine = (language: string, row: { file: string; key: string }): string =>
  `${REVIEWED}: ${language} ${row.file}:${row.key}`;

/** The keys a message keeps as they are, in one language. */
export const reviewedKeysOf = (message: string, language: string): string[] =>
  [...message.matchAll(new RegExp(`^${REVIEWED}: (\\S+) ([^:\\s]+):(\\S+)$`, 'gm'))]
    .filter((match) => match[1] === language)
    .map((match) => `${match[2]}\n${match[3]}`);

/** A key to read again: the source it was translated from, and the source now. */
export interface Review {
  /** The source text before the first change that the translation has not followed. */
  was: string;
}

interface ListedCommit {
  sha: string;
  commit: { message: string };
  parents: Array<{ sha: string }>;
}

const repo = (repository: I18nRepository) => `/repos/${insideRepository(repository.owner, repository.name)}`;

/** The commits of `ref` since the connection, newest first, at most `HISTORY_LIMIT`. */
const commitsOf = async (
  repository: I18nRepository,
  token: string,
  ref: string,
  path?: string,
): Promise<ListedCommit[]> => {
  const rows: ListedCommit[] = [];
  const since = repository.createdAt.toISOString();

  for (let page = 1; rows.length < HISTORY_LIMIT; page += 1) {
    const query = new URLSearchParams({ sha: ref, since, per_page: '100', page: String(page) });

    if (path) query.set('path', path);

    const answer = await ask<ListedCommit[]>(`${repo(repository)}/commits?${query}`, token);

    rows.push(...answer);

    if (answer.length < 100) break;
  }

  return rows.slice(0, HISTORY_LIMIT);
};

/** The locale files a commit changed in one language, by file name without the extension. */
const filesChangedIn = async (
  repository: I18nRepository,
  token: string,
  sha: string,
  language: string,
): Promise<string[]> => {
  const answer = await ask<{ files?: Array<{ filename: string }> }>(
    `${repo(repository)}/commits/${insideRepository(sha)}`,
    token,
  );
  const prefix = `${repository.localesPath}/${language}/`;

  return (answer.files ?? [])
    .map((file) => file.filename)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json') && !name.slice(prefix.length).includes('/'))
    .map((name) => name.slice(prefix.length, -'.json'.length));
};

/** The string values of a file at a revision, or none when the file is not there. */
const valuesAt = async (
  repository: I18nRepository,
  token: string,
  language: string,
  file: string,
  ref: string | undefined,
): Promise<Map<string, string>> => {
  if (!ref) return new Map();

  try {
    const content = JSON.parse(await fileTextOf(repository, token, language, file, ref)) as unknown;

    return new Map(pathsOf(content).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return new Map();

    throw error;
  }
};

/** A key that changed in one commit, with the value it had before. */
interface Change {
  id: string;
  before: string | undefined;
}

/** The keys one commit changed in one language. */
const changesOf = async (
  repository: I18nRepository,
  token: string,
  commit: ListedCommit,
  language: string,
): Promise<Change[]> => {
  const parent = commit.parents[0]?.sha;
  const changes: Change[] = [];

  for (const file of await filesChangedIn(repository, token, commit.sha, language)) {
    const [after, before] = await Promise.all([
      valuesAt(repository, token, language, file, commit.sha),
      valuesAt(repository, token, language, file, parent),
    ]);

    for (const [key, value] of after) {
      if (before.get(key) !== value) changes.push({ id: `${file}\n${key}`, before: before.get(key) });
    }
  }

  return changes;
};

/**
 * The keys of one target language to read again, at the head `ref` of the base branch.
 *
 * The keys are `<file>\n<key>`, as the editor names a row.
 */
export const reviewsOf = async (
  repository: I18nRepository,
  token: string,
  ref: string,
  language: string,
): Promise<Map<string, Review>> => {
  const { source } = languagesOf(repository);
  const reviews = new Map<string, Review>();

  if (language === source) return reviews;

  const sourceCommits = await commitsOf(repository, token, ref, `${repository.localesPath}/${source}`);

  // The common case: no source text changed since the connection, so there is
  // nothing to read again, and the rest of the history is not read.
  if (sourceCommits.length === 0) return reviews;

  const [history, targetCommits] = await Promise.all([
    commitsOf(repository, token, ref),
    commitsOf(repository, token, ref, `${repository.localesPath}/${language}`),
  ]);
  // The place of a commit in the history is its clock: 0 is the newest. A
  // date would tie a source change and its translation made in one commit.
  const placeOf = new Map(history.map((commit, index) => [commit.sha, index]));
  const targetShas = new Set(targetCommits.map((commit) => commit.sha));
  const sourceShas = new Set(sourceCommits.map((commit) => commit.sha));

  // Oldest first, so the last event of a key is the one that stays.
  for (const commit of [...history].reverse()) {
    if (!placeOf.has(commit.sha)) continue;

    if (sourceShas.has(commit.sha)) {
      for (const change of await changesOf(repository, token, commit, source)) {
        // The first change since the translation is the text it answers. A
        // later change keeps that text, not the one in between.
        if (!reviews.has(change.id)) reviews.set(change.id, { was: change.before ?? '' });
      }
    }

    // A translation changed in the same commit as its source follows it.
    if (targetShas.has(commit.sha)) {
      for (const change of await changesOf(repository, token, commit, language)) reviews.delete(change.id);
    }

    for (const id of reviewedKeysOf(commit.commit.message, language)) reviews.delete(id);
  }

  return reviews;
};
