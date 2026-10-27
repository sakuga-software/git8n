import type { I18nRepository } from '@i18n-editor/db';
import {
  ask,
  GithubAppNotConfiguredError,
  GithubError,
  insideRepository,
  installationToken,
} from '@/services/github-app.service';
import { languagesOf, UnknownLanguageError } from '@/services/i18n-repositories.service';
import { reviewsOf } from '@/services/i18n-review.service';
import { marksOf, sourceHashOf } from '@/services/intended-empty';
import { fileName, localeManifestSchema, type FileState } from '@/schemas/i18n';
import { createCache } from '@/utils/cache';
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

/**
 * How many locale files a read asks GitHub for at once.
 *
 * One by one, the 43 files of a repository took 12 s (DB-654). All at once,
 * a large repository would reach the secondary rate limit of GitHub.
 */
const READS_AT_ONCE = 8;

/** How many parsed locale files the API keeps, the least recently read first out. */
const BLOB_LIMIT = 2000;

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
   * `translated`, `missing` or `review`.
   *
   * An empty value counts as missing. i18next falls back on it instead of
   * drawing a blank line. A key the manifest marks as empty on purpose is the
   * exception (DB-611). `review` is a translation whose source changed after
   * it was written (DB-607).
   */
  state: 'translated' | 'missing' | 'review';
  /**
   * For `review` only: the source text the translation answers. `source` is the text now.
   *
   * A key left empty on purpose has none: the manifest records a hash, not the text.
   */
  was?: string;
  /**
   * The key is left empty on purpose in this language (DB-611). `value` is then `''`.
   *
   * It is `translated`, or `review` when the source changed since the mark.
   */
  empty?: true;
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
/**
 * The text of one locale file at one revision, as the repository holds it.
 *
 * A write edits this text (DB-608). A parse and a serialize would reorder the
 * keys that look like integers.
 */
export const fileTextOf = async (
  repository: I18nRepository,
  token: string,
  language: string,
  file: string,
  ref: string,
): Promise<string> => {
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

  return Buffer.from(answer.content, 'base64').toString('utf8');
};

/**
 * The parsed locale files, by the SHA of their blob (DB-654).
 *
 * A blob SHA names one content and never changes, so an entry is never out
 * of date. After a push, a read asks only for the files whose SHA changed.
 */
const blobs = new Map<string, Record<string, unknown>>();

/** One locale file, parsed, by the SHA that its directory listing gives. */
const blobOf = async (
  repository: I18nRepository,
  token: string,
  sha: string,
  path: string,
): Promise<Record<string, unknown>> => {
  const held = blobs.get(sha);

  if (held) {
    blobs.delete(sha);
    blobs.set(sha, held);

    return held;
  }

  const answer = await ask<{ content?: string; encoding?: string }>(
    `/repos/${insideRepository(repository.owner, repository.name)}/git/blobs/${encodeURIComponent(sha)}`,
    token,
  );

  if (answer.content === undefined || answer.encoding !== 'base64') {
    throw new Error(`${path} came back without content`);
  }

  const parsed = JSON.parse(Buffer.from(answer.content, 'base64').toString('utf8')) as Record<string, unknown>;

  blobs.set(sha, parsed);
  if (blobs.size > BLOB_LIMIT) blobs.delete(blobs.keys().next().value!);

  return parsed;
};

/** Calls `task` on each item, at most `limit` at once, and keeps the order of the items. */
const inParallel = async <T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;

      next += 1;
      results[index] = await task(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
};

export const contentOf = async (
  repository: I18nRepository,
  token: string,
  language: string,
  file: string,
  ref: string,
): Promise<Record<string, unknown>> =>
  JSON.parse(await fileTextOf(repository, token, language, file, ref)) as Record<string, unknown>;

/** Says what a language is for a file. */
export type StateOf = (file: string, language: string) => FileState;

/** Where the manifest of a repository lives, from the root of the repository. */
export const manifestPathOf = (repository: Pick<I18nRepository, 'localesPath' | 'manifestPath'>): string =>
  repository.manifestPath ?? `${repository.localesPath}/manifest.json`;

/** The text of the manifest at one revision, or nothing when the repository holds none. */
export const manifestTextOf = async (
  repository: I18nRepository,
  token: string,
  ref: string,
): Promise<string | null> => {
  const { owner, name } = repository;
  const path = manifestPathOf(repository);
  const answer = await ask<ContentsEntry>(
    `/repos/${insideRepository(owner, name)}/contents/${insideRepository(path)}?ref=${ref}`,
    token,
  ).catch((error: unknown) => {
    if (error instanceof GithubError && error.status === 404) return null;

    throw error;
  });

  if (answer === null) return null;

  if (!answer.content || answer.encoding !== 'base64') {
    throw new Error(`${path} came back without content`);
  }

  return Buffer.from(answer.content, 'base64').toString('utf8');
};

/** What the manifest says at one revision: the state of each file, and the keys left empty on purpose. */
export interface Manifest {
  stateOf: StateOf;
  /** The marks of a language, by `<file>\n<key>`, with the hash of the source each recorded (DB-611). */
  marksOf: (language: string) => Map<string, string>;
}

/**
 * The manifest of the locales at one revision (DB-225).
 *
 * A repository with no manifest answers `available` for everything. A manifest
 * that does not parse stops the read: read as empty, it puts back every file
 * that it disabled.
 */
export const readManifest = async (repository: I18nRepository, token: string, ref: string): Promise<Manifest> => {
  const text = await manifestTextOf(repository, token, ref);

  if (text === null) return { stateOf: () => 'available', marksOf: () => new Map() };

  const path = manifestPathOf(repository);
  const raw: unknown = JSON.parse(text);
  const parsed = localeManifestSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(`${path} is not a manifest: ${JSON.stringify(parsed.error.issues)}`);
  }

  const { source } = languagesOf(repository);

  // The row of the repository and the manifest each name the source. Here
  // alone can they be compared. If they differ, every state is read against
  // the wrong language.
  if (parsed.data.source !== undefined && parsed.data.source !== source) {
    throw new Error(`${path} names ${parsed.data.source} as its source, and the repository names ${source}`);
  }

  return {
    // The source is what the others are translated from, so no manifest can
    // switch it off.
    stateOf: (file, language) =>
      language === source ? 'available' : (parsed.data.files[file]?.[language] ?? 'available'),
    // A source text says something, so no key of the source is empty on purpose.
    marksOf: (language) => (language === source ? new Map() : marksOf(raw, language)),
  };
};

/** The state of each file at one revision, as a question. */
export const manifestOf = async (repository: I18nRepository, token: string, ref: string): Promise<StateOf> =>
  (await readManifest(repository, token, ref)).stateOf;

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
  const [sourceFiles, targetFiles, manifest, reviews] = await Promise.all([
    filesOf(repository, token, source, commit),
    language === source
      ? Promise.resolve(new Map<string, string>())
      : filesOf(repository, token, language, commit, { absentIsEmpty: true }),
    readManifest(repository, token, commit),
    reviewsOf(repository, token, commit, language),
  ]);
  const { stateOf } = manifest;
  const marks = manifest.marksOf(language);

  const entries: CatalogueEntry[] = [];
  const files: Record<string, FileState> = {};
  const shas: Record<string, Record<string, string>> = {
    [source]: Object.fromEntries(sourceFiles),
    ...(language === source ? {} : { [language]: Object.fromEntries(targetFiles) }),
  };

  const toRead: string[] = [];

  for (const file of [...sourceFiles.keys()].sort()) {
    files[file] = stateOf(file, language);

    // A file with no version in this language is not a file of missing keys.
    if (files[file] !== 'disabled') toRead.push(file);
  }

  const pathOf = (lang: string, file: string) => `${repository.localesPath}/${lang}/${file}.json`;
  const contents = await inParallel(toRead, READS_AT_ONCE, (file) => {
    const sourceContent = blobOf(repository, token, sourceFiles.get(file)!, pathOf(source, file));
    const targetSha = targetFiles.get(file);

    return Promise.all([
      sourceContent,
      // A file the target does not hold yet is every key missing, not a
      // failure.
      language === source
        ? sourceContent
        : targetSha === undefined
          ? Promise.resolve({} as Record<string, unknown>)
          : blobOf(repository, token, targetSha, pathOf(language, file)),
    ]);
  });

  for (const [index, file] of toRead.entries()) {
    const [sourceContent, targetContent] = contents[index];
    const target = new Map(pathsOf(targetContent));

    for (const [key, value] of pathsOf(sourceContent)) {
      const answer = target.get(key);
      const translated = typeof answer === 'string' && answer.length > 0;
      const text = typeof value === 'string' ? value : String(value ?? '');
      const mark = answer === '' ? marks.get(`${file}\n${key}`) : undefined;

      if (mark !== undefined) {
        // A source that changed since the mark asks again whether the key stays empty.
        entries.push({
          file,
          key,
          source: text,
          value: '',
          state: mark === sourceHashOf(text) ? 'translated' : 'review',
          empty: true,
        });
        continue;
      }
      // A source that changed and came back to its old text asks nothing.
      const review = translated ? reviews.get(`${file}\n${key}`) : undefined;
      const stale = review !== undefined && review.was !== text;

      entries.push({
        file,
        key,
        source: text,
        value: translated ? (answer as string) : null,
        state: stale ? 'review' : translated ? 'translated' : 'missing',
        ...(stale ? { was: review.was } : {}),
      });
    }
  }

  return { repository: repository.id, language, source, commit, entries, files, shas };
};

/**
 * The catalogues, by `<repository>:<language>`.
 *
 * A cold catalogue costs a request per file per language that `blobs` does
 * not hold. Two readers on a cold cache share one read.
 */
const catalogues = createCache<Catalogue>(CACHE_MS);

/** Empties the cache. The tests call it; nothing else needs it. */
export const clearI18nCatalogueCache = (): void => {
  catalogues.clear();
  blobs.clear();
};

/**
 * Drops what is held of one repository, for every language.
 *
 * A key that was just added to the source is missing in each target. Held for
 * five minutes more, the catalogue would not show the key to who created it.
 */
export const forgetCatalogues = (repositoryId: string): void => catalogues.forget(repositoryId);

export const getCatalogue = (
  repository: I18nRepository,
  language: string,
  options: { now?: Date } = {},
): Promise<Catalogue> =>
  catalogues.get(
    `${repository.id}:${language}`,
    () =>
      read(repository, language).catch((error: unknown) => {
        // An operator or a caller acts on these two. Wrapped, they reach the
        // route as a server failure.
        if (error instanceof GithubAppNotConfiguredError || error instanceof UnknownLanguageError) throw error;

        throw new Error(`The translations of ${language} were not read: ${describeError(error)}`, { cause: error });
      }),
    (options.now ?? new Date()).getTime(),
  );
