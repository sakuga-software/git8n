import type { Catalogue, CatalogueEntry, ProposedValue } from '../api.ts';
import { CliError } from './errors.ts';

/** How the command line names a key: the file, a colon, and the dotted path. */
export const idOf = (entry: Pick<CatalogueEntry, 'file' | 'key'>): string => `${entry.file}:${entry.key}`;

export const parseId = (id: string): { file: string; key: string } => {
  const colon = id.indexOf(':');

  if (colon <= 0 || colon === id.length - 1) {
    throw new CliError('I18NE1001', `${id} is not a key. Name a key as <file>:<key>, for example common:hello.title.`);
  }

  return { file: id.slice(0, colon), key: id.slice(colon + 1) };
};

/** The files that have no version in the language of the catalogue. */
export const disabledFilesOf = (read: Catalogue): string[] =>
  Object.entries(read.files ?? {})
    .filter(([, state]) => state === 'disabled')
    .map(([file]) => file)
    .sort();

const parentOf = (key: string): string => key.slice(0, Math.max(key.lastIndexOf('.'), 0));

/**
 * The keys beside a key: same file, same parent path. They say where a text shows.
 */
export const neighboursOf = (read: Catalogue, entry: CatalogueEntry, most = 5): CatalogueEntry[] =>
  read.entries
    .filter(
      (other) => other.file === entry.file && other.key !== entry.key && parentOf(other.key) === parentOf(entry.key),
    )
    .slice(0, most);

/** One page of a list. The cursor is the position of the first row. */
export const pageOf = <T>(rows: T[], cursor: number, limit: number) => {
  const page = rows.slice(cursor, cursor + limit);

  return {
    total: rows.length,
    cursor,
    nextCursor: cursor + page.length < rows.length ? cursor + page.length : null,
    rows: page,
  };
};

export const matchesText = (entry: CatalogueEntry, text: string): boolean => {
  const wanted = text.toLowerCase();

  return [idOf(entry), entry.source, entry.value ?? ''].some((field) => field.toLowerCase().includes(wanted));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const flatten = (file: string, value: unknown, path: string, into: Map<string, string>): void => {
  if (typeof value === 'string') {
    if (!path) throw new CliError('I18NE1003', `${file} holds a text and no key.`);

    into.set(`${file}:${path}`, value);

    return;
  }

  if (!isRecord(value)) {
    throw new CliError('I18NE1003', `${file}:${path} is not a text. A value is a string, or an object of keys.`);
  }

  for (const [name, inner] of Object.entries(value)) flatten(file, inner, path ? `${path}.${name}` : name, into);
};

/**
 * The texts of the input of `apply`, by key id.
 *
 * The input is a JSON object in one of these forms:
 * - `{ "common:hello.title": "Hello" }`, with the id of each key;
 * - `{ "common": { "hello": { "title": "Hello" } } }`, with a file at the top;
 * - with `--file common`, the keys of that file, nested or dotted.
 */
export const textsOf = (input: string, file?: string): Map<string, string> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new CliError('I18NE1003', `The input is not JSON: ${(error as Error).message}`);
  }

  if (!isRecord(parsed)) throw new CliError('I18NE1003', 'The input must be a JSON object of keys and texts.');

  const texts = new Map<string, string>();

  if (file) {
    flatten(file, parsed, '', texts);
  } else {
    for (const [name, value] of Object.entries(parsed)) {
      if (name.includes(':')) {
        if (typeof value !== 'string') throw new CliError('I18NE1003', `${name} is not a text.`);

        const { file: inFile, key } = parseId(name);

        texts.set(`${inFile}:${key}`, value);
      } else if (isRecord(value)) {
        flatten(name, value, '', texts);
      } else {
        throw new CliError(
          'I18NE1003',
          `${name} names no file. Write <file>:<key>, put the keys under their file, or pass --file.`,
        );
      }
    }
  }

  const blank = [...texts].filter(([, text]) => text.trim() === '').map(([id]) => id);

  if (blank.length > 0) {
    throw new CliError(
      'I18NE1003',
      'An empty text is not a translation. To leave a key empty on purpose, mark it « vide exprès » in the editor.',
      blank.slice(0, 10),
    );
  }

  return texts;
};

export interface ApplyPlan {
  readAt: string;
  changes: Array<{ id: string; file: string; key: string; from: string | null; to: string }>;
  unchanged: string[];
}

/** Most keys in one proposal. The API refuses a larger batch. */
export const MOST_KEYS = 2000;

/** What `apply` proposes: each text that is new, against the catalogue that the command read. */
export const planOf = (read: Catalogue, texts: Map<string, string>, readAt: string): ApplyPlan => {
  const disabled = new Set(disabledFilesOf(read));
  const byId = new Map(read.entries.map((entry) => [idOf(entry), entry]));
  const closed = [...texts.keys()].filter((id) => disabled.has(parseId(id).file));
  const unknown = [...texts.keys()].filter((id) => !byId.has(id) && !disabled.has(parseId(id).file));

  if (closed.length > 0) {
    throw new CliError(
      'I18NE3004',
      `These keys are in a file that has no ${read.language} version, and take no proposal.`,
      closed.slice(0, 10),
    );
  }

  if (unknown.length > 0) {
    throw new CliError(
      'I18NE3004',
      `${unknown.length} key(s) of the input are not keys of the source (${read.source}).`,
      unknown.slice(0, 10),
    );
  }

  const changes: ApplyPlan['changes'] = [];
  const unchanged: string[] = [];

  for (const [id, to] of texts) {
    const entry = byId.get(id)!;

    if (entry.value === to) unchanged.push(id);
    else changes.push({ id, file: entry.file, key: entry.key, from: entry.value, to });
  }

  if (changes.length > MOST_KEYS) {
    throw new CliError(
      'I18NE1003',
      `${changes.length} keys are more than ${MOST_KEYS} in one proposal. Split the input.`,
    );
  }

  return { readAt, changes, unchanged };
};

export const valuesOf = (plan: ApplyPlan): ProposedValue[] =>
  plan.changes.map(({ file, key, to }) => ({ file, key, value: to }));
