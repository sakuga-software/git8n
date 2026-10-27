import { createHash } from 'node:crypto';
import { LocaleFile } from '@/services/locale-file';

/**
 * The keys a language leaves empty on purpose (DB-611).
 *
 * The manifest holds them, so they travel with the files and the CI of the
 * repository reads them too:
 *
 * ```json
 * "empty": { "en": { "woodlock:hints.3_image": { "source": "a1b2c3d4e5f6" } } }
 * ```
 *
 * `source` is the hash of the source text when the key was marked. A source
 * that changed since gives another hash, and the mark is then to read again.
 * A mark counts only on a key whose value is `""`. On any other value, it is
 * an orphan, and the editor ignores it.
 */

const SECTION = 'empty';

/** The hash a mark records: the first 12 hexadecimal digits of the SHA-256 of the source text. */
export const sourceHashOf = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);

/** The name of a key in the manifest: `<file>:<key>`. */
export const markNameOf = (row: { file: string; key: string }): string => `${row.file}:${row.key}`;

const idOf = (file: string, key: string): string => `${file}\n${key}`;

/**
 * The marks of one language, by `<file>\n<key>`, with the hash each recorded.
 *
 * A name with no `:`, or a mark with no `source`, is not a mark.
 */
export const marksOf = (manifest: unknown, language: string): Map<string, string> => {
  const marks = new Map<string, string>();
  const section = (manifest as { [SECTION]?: Record<string, Record<string, { source?: unknown }>> } | null)?.[SECTION];
  const ofLanguage = section?.[language];

  if (!ofLanguage || typeof ofLanguage !== 'object') return marks;

  for (const [name, mark] of Object.entries(ofLanguage)) {
    const colon = name.indexOf(':');

    if (colon <= 0 || typeof mark?.source !== 'string') continue;

    marks.set(idOf(name.slice(0, colon), name.slice(colon + 1)), mark.source);
  }

  return marks;
};

/**
 * Writes a mark into the text of a manifest, or removes it with `hash: null`.
 *
 * It answers whether the text changed. The other bytes of the manifest stay
 * as they were.
 */
export const writeMark = (
  manifest: LocaleFile,
  language: string,
  row: { file: string; key: string },
  hash: string | null,
): boolean => {
  const before = manifest.toString();
  const path = [SECTION, language, markNameOf(row)];

  if (hash === null) manifest.removeAt(path);
  else manifest.setAt([...path, 'source'], hash);

  return manifest.toString() !== before;
};

/** A manifest text to write marks into, or a new one when the repository has none. */
export const manifestFileOf = (text: string | null): LocaleFile =>
  text === null ? LocaleFile.empty() : LocaleFile.parse(text);
