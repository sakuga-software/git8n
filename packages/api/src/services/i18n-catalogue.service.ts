import type { I18nRepository } from '@i18n-editor/db';
import {
  ask,
  GithubAppNotConfiguredError,
  GithubError,
  insideRepository,
  installationToken,
} from '@/services/github-app.service';
import { languagesOf, UnknownLanguageError } from '@/services/i18n-repositories.service';
import { fileName, localeManifestSchema, type FileState } from '@/schemas/i18n';
import { describeError } from '@/utils/describe-error';
import { logger } from '@/utils/logger';

/**
 * The translations as GitHub holds them (DB-210).
 *
 * The files are read from the repository, not from a checkout. The API has no
 * clone, and a clone goes stale between a read and the write after it. The SHA
 * GitHub answers for each file lets a publication refuse to overwrite a change
 * it did not see (DB-212).
 *
 * This module only reads. It knows nothing about proposals.
 */

/** How long a read is held, as the other outside reads of the API are. */
const CACHE_MS = 5 * 60 * 1000;

/** What a key is, once the two languages are put side by side. */
export interface CatalogueEntry {
  /** The file it lives in, without its extension: `common`, `admin`… */
  file: string;
  /** Its dotted path, as i18next reads it. */
  key: string;
  /** What the source language says. */
  source: string;
  /** What the target language says, or nothing when it says nothing. */
  value: string | null;
  /**
   * `translated` or `missing`.
   *
   * An empty value counts as missing. i18next falls back on it instead of
   * drawing a blank line, and `apps/app` treats it as missing since DB-209.
   */
  state: 'translated' | 'missing';
}

export interface Catalogue {
  /** The repository this answer is about. */
  repository: string;
  /** The language this answer is about. */
  language: string;
  /** The language it is translated from. */
  source: string;
  /** The commit of the branch the files were read at. */
  commit: string;
  /**
   * One entry per key of the source, whether the target holds it or not.
   *
   * The keys come in the order of the source file, so a key sits beside the
   * ones it belongs with. The files come in alphabetical order.
   */
  entries: CatalogueEntry[];
  /**
   * What this language is for each file of the source, as the manifest says.
   *
   * A `disabled` file has no entry above. Its name here tells « no version in
   * this language » apart from « nothing is missing ».
   */
  files: Record<string, FileState>;
  /** The SHA of each file read, per language — what a publication writes against. */
  shas: Record<string, Record<string, string>>;
}

/**
 * Says what is not set up, instead of answering an empty catalogue.
 *
 * It covers a GitHub App with no secrets, and a setup with no repository. An
 * operator acts on both, so the route passes the message through.
 */
export { GithubAppNotConfiguredError as I18nNotConfiguredError };

interface ContentsEntry {
  name: string;
  type: string;
  sha: string;
  content?: string;
  encoding?: string;
}

/** A token that may read this repository, and nothing else. */
const readToken = (repository: I18nRepository) =>
  installationToken(repository.installationId, {
    repository: repository.name,
    permissions: { contents: 'read' },
  });

/** The files of one language directory, by name without the extension. */
export const filesOf = async (
  repository: I18nRepository,
  token: string,
  language: string,
  ref: string,
  options: { absentIsEmpty?: boolean } = {},
): Promise<Map<string, string>> => {
  const { owner, name, localesPath } = repository;
  const listing = await ask<ContentsEntry[]>(
    `/repos/${insideRepository(owner, name)}/contents/${insideRepository(localesPath, language)}?ref=${ref}`,
    token,
  ).catch((error: unknown) => {
    // A language being added holds no directory yet. Its first read must
    // answer every key missing, not stop on a 404. The source is read without
    // this flag: an absent source is a path that is wrong.
    if (options.absentIsEmpty && error instanceof GithubError && error.status === 404) return [];

    throw error;
  });

  // An answer that is not a list is a path that names a file. That is a
  // configuration mistake, not an empty language.
  if (!Array.isArray(listing)) {
    throw new Error(`${localesPath}/${language} is not a directory of ${owner}/${name}`);
  }

  const files = listing
    .filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'))
    .map((entry) => [entry.name.replace(/\.json$/, ''), entry.sha] as [string, string]);
  // `common.v2.json` gives the name `common.v2`, which the write schemas
  // refuse. Listed, its keys are shown to a translator who cannot write them.
  const unwritable = files.filter(([file]) => !fileName.safeParse(file).success).map(([file]) => file);

  if (unwritable.length > 0) {
    logger.warn(
      `${owner}/${name}: ${localesPath}/${language} holds files that no proposal can name, so the catalogue leaves them out: ${unwritable.join(', ')}`,
    );
  }

  return new Map(files.filter(([file]) => !unwritable.includes(file)));
};

/**
 * One locale file, parsed, at one revision.
 *
 * The write path of DB-212 reads through this rather than through a reader of
 * its own: the guard below is the one that keeps a file too large for the API
 * from being written back as an empty translation.
 */
export const contentOf = async (
  repository: I18nRepository,
  token: string,
  language: string,
  file: string,
  ref: string,
): Promise<Record<string, unknown>> => {
  const { owner, name, localesPath } = repository;
  const answer = await ask<ContentsEntry>(
    `/repos/${insideRepository(owner, name)}/contents/${insideRepository(localesPath, language, `${file}.json`)}?ref=${ref}`,
    token,
  );

  // Past one megabyte the contents API answers a URL and no content. Such a
  // file would otherwise read as an empty translation.
  if (!answer.content || answer.encoding !== 'base64') {
    throw new Error(`${localesPath}/${language}/${file}.json came back without content — too large for the API?`);
  }

  return JSON.parse(Buffer.from(answer.content, 'base64').toString('utf8')) as Record<string, unknown>;
};

/** Says what a language is for a file. */
export type StateOf = (file: string, language: string) => FileState;

/**
 * The manifest of the locales at one revision, as a question (DB-225).
 *
 * A repository with no manifest answers `available` for everything. A manifest
 * that does not parse stops the read: read as empty, it puts back every file
 * that it disabled.
 */
export const manifestOf = async (repository: I18nRepository, token: string, ref: string): Promise<StateOf> => {
  const { owner, name, localesPath } = repository;
  const answer = await ask<ContentsEntry>(
    `/repos/${insideRepository(owner, name)}/contents/${insideRepository(localesPath, 'manifest.json')}?ref=${ref}`,
    token,
  ).catch((error: unknown) => {
    if (error instanceof GithubError && error.status === 404) return null;

    throw error;
  });

  if (answer === null) return () => 'available';

  if (!answer.content || answer.encoding !== 'base64') {
    throw new Error(`${localesPath}/manifest.json came back without content`);
  }

  const parsed = localeManifestSchema.safeParse(JSON.parse(Buffer.from(answer.content, 'base64').toString('utf8')));

  if (!parsed.success) {
    throw new Error(`${localesPath}/manifest.json is not a manifest: ${JSON.stringify(parsed.error.issues)}`);
  }

  const { source } = languagesOf(repository);

  // The row of the repository and the manifest each name the source. Here
  // alone can they be compared. If they differ, every state is read against
  // the wrong language.
  if (parsed.data.source !== undefined && parsed.data.source !== source) {
    throw new Error(
      `${localesPath}/manifest.json names ${parsed.data.source} as its source, and the repository names ${source}`,
    );
  }

  // The source is what the others are translated from, so no manifest can
  // switch it off.
  return (file, language) => (language === source ? 'available' : (parsed.data.files[file]?.[language] ?? 'available'));
};

/** The dotted paths of an object, as i18next reads its keys. */
export const pathsOf = (node: unknown, prefix = ''): Array<[string, unknown]> => {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return [[prefix, node]];

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    pathsOf(value, prefix ? `${prefix}.${key}` : key),
  );
};

const headCommit = async (repository: I18nRepository, token: string): Promise<string> => {
  const answer = await ask<{ sha: string }>(
    `/repos/${insideRepository(repository.owner, repository.name)}/commits/${encodeURIComponent(repository.branch)}`,
    token,
  );

  return answer.sha;
};

const read = async (repository: I18nRepository, language: string): Promise<Catalogue> => {
  const { source, targets } = languagesOf(repository);

  if (language !== source && !targets.includes(language)) {
    throw new UnknownLanguageError(
      `${language} is not one of the languages of ${repository.owner}/${repository.name}. Known: ${[source, ...targets].join(', ')}`,
    );
  }

  const token = await readToken(repository);

  // Everything is read at one commit. The branch can advance between two
  // calls. A source at one revision beside a target at another pairs values
  // that never existed together. It also answers file SHAs that do not belong
  // to the content returned (DB-212). The contents API takes a commit as
  // `ref`.
  const commit = await headCommit(repository, token);
  const [sourceFiles, targetFiles, stateOf] = await Promise.all([
    filesOf(repository, token, source, commit),
    language === source
      ? Promise.resolve(new Map<string, string>())
      : filesOf(repository, token, language, commit, { absentIsEmpty: true }),
    manifestOf(repository, token, commit),
  ]);

  const entries: CatalogueEntry[] = [];
  const files: Record<string, FileState> = {};
  const shas: Record<string, Record<string, string>> = {
    [source]: Object.fromEntries(sourceFiles),
    ...(language === source ? {} : { [language]: Object.fromEntries(targetFiles) }),
  };

  for (const file of [...sourceFiles.keys()].sort()) {
    files[file] = stateOf(file, language);

    // A file with no version in this language is not a file of missing keys.
    if (files[file] === 'disabled') continue;

    const [sourceContent, targetContent] = await Promise.all([
      contentOf(repository, token, source, file, commit),
      // A file the target does not hold yet is every key missing, not a
      // failure.
      language === source || targetFiles.has(file)
        ? contentOf(repository, token, language, file, commit)
        : Promise.resolve({}),
    ]);

    const target = new Map(pathsOf(targetContent));

    for (const [key, value] of pathsOf(sourceContent)) {
      const answer = target.get(key);
      const translated = typeof answer === 'string' && answer.length > 0;

      entries.push({
        file,
        key,
        source: typeof value === 'string' ? value : String(value ?? ''),
        value: translated ? (answer as string) : null,
        state: translated ? 'translated' : 'missing',
      });
    }
  }

  return { repository: repository.id, language, source, commit, entries, files, shas };
};

const held = new Map<string, { at: number; value: Catalogue }>();

/**
 * The reads that have not answered yet, by the key they will be held under.
 *
 * One catalogue costs a request per file per language. Two readers on a cold
 * cache fan that out twice for one answer. The second caller waits on the
 * first read.
 */
const reading = new Map<string, Promise<Catalogue>>();

/** Empties the cache. The tests call it; nothing else needs it. */
export const clearI18nCatalogueCache = (): void => {
  held.clear();
  reading.clear();
};

/**
 * Drops what is held of one repository, for every language.
 *
 * A key that was just added to the source is missing in each target. Held for
 * five minutes more, the catalogue would not show the key to who created it.
 */
export const forgetCatalogues = (repositoryId: string): void => {
  for (const key of [...held.keys(), ...reading.keys()]) {
    if (key.startsWith(`${repositoryId}:`)) {
      held.delete(key);
      reading.delete(key);
    }
  }
};

export const getCatalogue = async (
  repository: I18nRepository,
  language: string,
  options: { now?: Date } = {},
): Promise<Catalogue> => {
  const now = options.now ?? new Date();
  const key = `${repository.id}:${language}`;
  const hit = held.get(key);

  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.value;

  const shared = reading.get(key);

  if (shared) return shared;

  const started = read(repository, language)
    .then((value) => {
      held.set(key, { at: now.getTime(), value });

      return value;
    })
    .catch((error: unknown) => {
      // An operator or a caller acts on these two. Wrapped, they reach the
      // route as a server failure.
      if (error instanceof GithubAppNotConfiguredError || error instanceof UnknownLanguageError) throw error;

      throw new Error(`The translations of ${language} were not read: ${describeError(error)}`, { cause: error });
    })
    .finally(() => {
      // A failure is never held: the next caller reads again. The identity
      // check keeps a read that was cleared, then started again, from being
      // removed while it is in flight.
      if (reading.get(key) === started) reading.delete(key);
    });

  reading.set(key, started);

  return started;
};
