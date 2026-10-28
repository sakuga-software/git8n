import type { I18nRepository } from '@git8n/db';
import { getCatalogue } from '@/services/i18n-catalogue.service';
import { proposedKeys } from '@/services/i18n-git.service';
import { languagesOf } from '@/services/i18n-repositories.service';
import { createCache } from '@/utils/cache';

/** How far one language is: every key of the source is in one of the four counts. */
export interface LanguageProgress {
  language: string;
  published: number;
  proposed: number;
  missing: number;
  /** Translations whose source changed after they were written (DB-607). */
  review: number;
  /**
   * The published keys left empty on purpose (DB-611). They are in `published`
   * too: this count says how much of it holds no text.
   */
  empty: number;
  total: number;
}

/**
 * How long an answer is held.
 *
 * The side panel of the editor shows these numbers for every language, and
 * asks for them at each visit. The keys that wait are read from GitHub at each
 * call and nothing holds them, so a minute here is what keeps a page that
 * reloads from asking GitHub again per language.
 */
const HELD_MS = 60 * 1000;

const progress = createCache<LanguageProgress[]>(HELD_MS);

/**
 * Drops what is held of one repository.
 *
 * A proposal, a publication and a new key each change a count. The route that
 * writes calls this, so whoever wrote does not read the numbers of before.
 */
export const forgetProgress = (repositoryId: string): void => progress.forget(repositoryId);

/** Empties the cache. The tests call it; nothing else needs it. */
export const clearI18nProgressCache = (): void => progress.clear();

const idOf = (row: { file: string; key: string }): string => `${row.file}\n${row.key}`;

/**
 * The counts of one language, by the rule of the table of the editor.
 *
 * **A key that waits is proposed, whatever the base branch says of it.** A key
 * with a published value and a proposal to change it counts as proposed, not
 * as published: that is the tab the editor shows it under. A file the manifest
 * disables for the language is not in the catalogue, so it is in no count.
 */
const read = async (repository: I18nRepository, language: string): Promise<LanguageProgress> => {
  const [catalogue, waiting] = await Promise.all([
    getCatalogue(repository, language),
    proposedKeys(repository, language),
  ]);
  const proposedIds = new Set(waiting.map(idOf));
  const counts = { published: 0, proposed: 0, missing: 0, review: 0, empty: 0 };

  for (const entry of catalogue.entries) {
    if (proposedIds.has(idOf(entry))) counts.proposed += 1;
    else if (entry.state === 'review') counts.review += 1;
    else if (entry.state === 'translated') {
      counts.published += 1;
      if (entry.empty) counts.empty += 1;
    } else counts.missing += 1;
  }

  return { language, ...counts, total: catalogue.entries.length };
};

const readAll = (repository: I18nRepository, now: number): Promise<LanguageProgress[]> =>
  progress.get(
    repository.id,
    () => {
      const { source, targets } = languagesOf(repository);

      return Promise.all([source, ...targets].map((language) => read(repository, language)));
    },
    now,
  );

/**
 * How far each language of a repository is, the source first (DB-268).
 *
 * The source counts as a target does (DB-675): a text that waits on its branch
 * is proposed, and an empty text is missing. The select of the editor shows it
 * beside the others.
 *
 * The languages are read together. The catalogues are the ones the editor
 * reads next, and they are held for five minutes, so this costs GitHub no read
 * that opening a language would not have cost.
 *
 * An answer older than `HELD_MS` is answered at once, and a new read starts
 * behind it (DB-679): a cold read of GitHub takes several seconds. A write
 * forgets the answer, so the person who wrote waits for the new numbers.
 */
export const progressOf = (repository: I18nRepository, options: { now?: Date } = {}): Promise<LanguageProgress[]> => {
  const now = (options.now ?? new Date()).getTime();
  const held = progress.peek(repository.id, now);
  const reading = readAll(repository, now);

  if (!held || held.fresh) return reading;

  // The page has its answer. A failed read in the background leaves the old one held.
  reading.catch(() => undefined);

  return Promise.resolve(held.value);
};

/**
 * The progress held for a repository, fresh or not, with no wait. With nothing
 * held, it answers `undefined` and starts the read, so the next ask finds it.
 */
export const heldProgressOf = (
  repository: I18nRepository,
  options: { now?: Date } = {},
): LanguageProgress[] | undefined => {
  const now = (options.now ?? new Date()).getTime();
  const held = progress.peek(repository.id, now);

  if (!held) {
    readAll(repository, now).catch(() => undefined);

    return undefined;
  }

  progressOf(repository, options).catch(() => undefined);

  return held.value;
};
