import type { I18nRepository } from '@i18n-editor/db';
import { getCatalogue } from '@/services/i18n-catalogue.service';
import { proposedKeys } from '@/services/i18n-git.service';
import { languagesOf } from '@/services/i18n-repositories.service';

/** How far one language is: every key of the source is in one of the four counts. */
export interface LanguageProgress {
  language: string;
  published: number;
  proposed: number;
  missing: number;
  /** Translations whose source changed after they were written (DB-607). */
  review: number;
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

const held = new Map<string, { at: number; value: LanguageProgress[] }>();
const reading = new Map<string, Promise<LanguageProgress[]>>();

/**
 * Drops what is held of one repository.
 *
 * A proposal, a publication and a new key each change a count. The route that
 * writes calls this, so whoever wrote does not read the numbers of before.
 */
export const forgetProgress = (repositoryId: string): void => {
  held.delete(repositoryId);
  reading.delete(repositoryId);
};

/** Empties the cache. The tests call it; nothing else needs it. */
export const clearI18nProgressCache = (): void => {
  held.clear();
  reading.clear();
};

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
  const counts = { published: 0, proposed: 0, missing: 0, review: 0 };

  for (const entry of catalogue.entries) {
    if (proposedIds.has(idOf(entry))) counts.proposed += 1;
    else if (entry.state === 'review') counts.review += 1;
    else if (entry.state === 'translated') counts.published += 1;
    else counts.missing += 1;
  }

  return { language, ...counts, total: catalogue.entries.length };
};

/**
 * How far each target language of a repository is (DB-268).
 *
 * The languages are read together. The catalogues are the ones the editor
 * reads next, and they are held for five minutes, so this costs GitHub no read
 * that opening a language would not have cost.
 */
export const progressOf = async (
  repository: I18nRepository,
  options: { now?: Date } = {},
): Promise<LanguageProgress[]> => {
  const now = (options.now ?? new Date()).getTime();
  const hit = held.get(repository.id);

  if (hit && now - hit.at < HELD_MS) return hit.value;

  const shared = reading.get(repository.id);

  if (shared) return shared;

  const started = Promise.all(languagesOf(repository).targets.map((language) => read(repository, language)))
    .then((value) => {
      // A write that came during the read dropped this entry: its answer is of before the write.
      if (reading.get(repository.id) === started) held.set(repository.id, { at: now, value });

      return value;
    })
    .finally(() => {
      if (reading.get(repository.id) === started) reading.delete(repository.id);
    });

  reading.set(repository.id, started);

  return started;
};
