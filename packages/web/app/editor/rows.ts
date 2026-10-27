import type { Catalogue, ProposedKey, Rights } from '@i18n-editor/mcp/api';

/**
 * What a key is for a translator, in the order the table shows it (DB-213).
 *
 * - `missing`: the base branch says nothing, and nobody proposed anything;
 * - `review`: the base branch says it, and its source changed since (DB-607);
 * - `proposed`: a batch waits on the branch of the language;
 * - `published`: the base branch says it.
 */
export type RowState = 'missing' | 'review' | 'proposed' | 'published';

export const ROW_STATES: readonly RowState[] = ['missing', 'review', 'proposed', 'published'];

/** The tabs of a language. The source answers no other text, so nothing in it is to read again (DB-607). */
export const statesOf = (isSource: boolean): readonly RowState[] =>
  isSource ? ROW_STATES.filter((state) => state !== 'review') : ROW_STATES;

export interface Row {
  file: string;
  key: string;
  source: string;
  /** What the base branch says in this language. */
  published: string | null;
  /** What waits on the branch of the language, with the batch a publication names. */
  proposal: ProposedKey | null;
  state: RowState;
  /**
   * For `review`: the source text the published translation answers. `source` is the text now.
   * Null for a key left empty on purpose: its mark keeps no text.
   */
  was: string | null;
  /** The base branch leaves the key empty on purpose (DB-611). It is `published`, or `review` when the source changed. */
  empty: boolean;
}

export const idOf = (row: { file: string; key: string }): string => `${row.file}\n${row.key}`;

/** A row is edited when its field says something else than the value the API holds. */
export const isEdited = (row: Row, draft: string | undefined): boolean =>
  draft !== undefined && draft.trim().length > 0 && draft !== (row.proposal?.value ?? row.published ?? '');

/** What a translator reads in the column of the language: a field typed in this session counts. */
export type NeighbourState = RowState | 'edited';

export interface Neighbour {
  row: Row;
  /** The text of the language now, the field typed in this session first. `null` when nothing is there. */
  value: string | null;
  state: NeighbourState;
}

export interface Neighbours {
  /** The first segment of the open key, or `''` for a key without a section. */
  section: string;
  /** Every other key of the section, before the cut. */
  total: number;
  rows: Neighbour[];
}

/** The rows shown under the open key before « Voir les … clés ». */
export const NEIGHBOURS_SHOWN = 8;

/**
 * The keys beside the open one, to keep the same terms from a key to the next (DB-277).
 *
 * - **Which**: the keys of the same file that share the first segment of the
 *   open key. A key without a section shows the other keys without a section.
 *   The open key itself is left out: it is just above.
 * - **In which order**: the keys with a text in the language first, because
 *   they give the terms; the missing ones after. The key order inside each.
 * - **How many**: `limit`, and `total` says how many the section holds.
 */
export const neighboursOf = (
  rows: readonly Row[],
  open: Pick<Row, 'file' | 'key'>,
  drafts: ReadonlyMap<string, string>,
  limit = NEIGHBOURS_SHOWN,
): Neighbours => {
  const dot = open.key.indexOf('.');
  const section = dot === -1 ? '' : open.key.slice(0, dot);
  const inSection = (key: string) => (section === '' ? !key.includes('.') : key.startsWith(`${section}.`));

  const found = rows
    .filter((row) => row.file === open.file && row.key !== open.key && inSection(row.key))
    .map((row): Neighbour => {
      const draft = drafts.get(idOf(row));

      if (isEdited(row, draft)) return { row, value: draft!, state: 'edited' };

      return { row, value: row.proposal?.value ?? row.published, state: row.state };
    })
    .sort((a, b) => Number(a.value === null) - Number(b.value === null) || a.row.key.localeCompare(b.row.key));

  return { section, total: found.length, rows: found.slice(0, limit) };
};

/**
 * One row per key of the source, the keys with work on them first.
 *
 * A proposal for a key that the catalogue does not hold is left out: the
 * source dropped the key, and a row with no source text cannot be judged.
 */
export const rowsOf = (catalogue: Catalogue, proposed: readonly ProposedKey[]): Row[] => {
  const waiting = new Map(proposed.map((row) => [idOf(row), row]));

  return catalogue.entries
    .map((entry): Row => {
      const proposal = waiting.get(idOf(entry)) ?? null;

      return {
        file: entry.file,
        key: entry.key,
        source: entry.source,
        published: entry.value,
        proposal,
        state: proposal
          ? 'proposed'
          : entry.state === 'review'
            ? 'review'
            : entry.state === 'translated'
              ? 'published'
              : 'missing',
        was: !proposal && entry.state === 'review' && !entry.empty ? (entry.was ?? '') : null,
        empty: entry.empty === true,
      };
    })
    .sort(
      (a, b) =>
        ROW_STATES.indexOf(a.state) - ROW_STATES.indexOf(b.state) ||
        a.file.localeCompare(b.file) ||
        a.key.localeCompare(b.key),
    );
};

export const countsOf = (rows: readonly Row[]): Record<RowState, number> => ({
  missing: rows.filter((row) => row.state === 'missing').length,
  review: rows.filter((row) => row.state === 'review').length,
  proposed: rows.filter((row) => row.state === 'proposed').length,
  published: rows.filter((row) => row.state === 'published').length,
});

/** The published keys left empty on purpose (DB-611). `published` counts them too. */
export const emptyCountOf = (rows: readonly Row[]): number =>
  rows.filter((row) => row.state === 'published' && row.empty).length;

/**
 * The share of the keys that is published, in whole percent, or `null` with no key.
 *
 * Rounded down: 99.6 % published is not « 100 % », which would say that nothing is left.
 */
export const shareOf = (counts: Record<RowState, number>): number | null => {
  const total = counts.published + counts.proposed + counts.missing + counts.review;

  return total === 0 ? null : Math.floor((counts.published / total) * 100);
};

/** The files of a catalogue in one state of the manifest (DB-225). */
export const filesIn = (catalogue: Catalogue, state: 'partial' | 'disabled'): string[] =>
  Object.entries(catalogue.files ?? {})
    .filter(([, held]) => held === state)
    .map(([file]) => file)
    .sort();

export interface Access {
  /** The languages the account can open, in the order of the repository: the source first. */
  languages: string[];
  mayPropose: (language: string) => boolean;
  mayPublish: (language: string) => boolean;
  /** Whether the account may keep a translation as it is after its source changed (DB-607). */
  mayReview: (language: string) => boolean;
  /** Whether the account may add a key to the source language (DB-238). */
  mayCreate: boolean;
}

/**
 * What an account can do with the languages of a repository.
 *
 * An admin reads every language and writes none without a grant. A translator
 * opens the languages of the grant only: the API refuses a write on any other,
 * and a language that cannot be written is not offered.
 *
 * An account that writes the source opens every language, as an admin does. A
 * key is created to be translated, and its author must see where it lands.
 */
export const accessOf = (rights: Rights, targets: readonly string[], source?: string): Access => {
  const granted = rights.rights?.languages ?? [];
  const mayCreate = rights.rights?.writesSource === true;
  const isTarget = (language: string) => granted.includes(language) && targets.includes(language);
  const reviews = (language: string) =>
    isTarget(language) && (rights.rights?.role === 'reviewer' || rights.rights?.role === 'owner');
  // The source is written and published by `writes_source` alone (DB-607).
  // Every account that opens the repository reads it: it is what a
  // translation answers.
  const isSource = (language: string) => source !== undefined && language === source;

  return {
    languages: [
      ...(source !== undefined ? [source] : []),
      ...targets.filter((language) => rights.admin || mayCreate || granted.includes(language)),
    ],
    mayPropose: (language) => (isSource(language) ? mayCreate : isTarget(language)),
    mayPublish: (language) => (isSource(language) ? mayCreate : reviews(language)),
    mayReview: (language) => !isSource(language) && reviews(language),
    mayCreate,
  };
};

/** Whether the account manages the repository: an admin, or an owner of the repository (DB-637). */
export const manages = (rights: Rights): boolean => rights.admin || rights.rights?.role === 'owner';

/** What a publication copied for a key: its value, and whether it leaves the key empty on purpose. */
export type PublishedValue = Pick<ProposedKey, 'value' | 'empty'>;

/**
 * The value a publication copied, shown before the catalogue says it.
 *
 * The API holds a catalogue for five minutes. Without this, a key that was
 * just published leaves the proposals and reads `missing` until then.
 *
 * `""` with no mark is a key that is missing again: its mark was removed (DB-611).
 */
export const withPublished = (catalogue: Catalogue, published: ReadonlyMap<string, PublishedValue>): Catalogue => ({
  ...catalogue,
  entries: catalogue.entries.map((entry) => {
    const copied = published.get(idOf(entry));

    if (copied === undefined) return entry;

    const { was: _was, empty: _empty, ...rest } = entry;

    if (copied.empty) return { ...rest, value: '', state: 'translated' as const, empty: true as const };
    if (copied.value === '') return { ...rest, value: null, state: 'missing' as const };

    return { ...rest, value: copied.value, state: 'translated' as const };
  }),
});

/** What this page wrote since `over` was read: the keys it proposed, and the keys it published. */
export interface Writes {
  /** The answer of the API these writes come after. A newer answer holds them already. */
  over: readonly ProposedKey[];
  proposed: readonly ProposedKey[];
  published: ReadonlySet<string>;
}

/**
 * The proposed keys as they are after the writes of this page (DB-241).
 *
 * The table stays on the screen while the API reads again. Without this, a key
 * that was just proposed shows as missing until the answer comes, and a key
 * that was just published shows as one that waits.
 *
 * The writes apply to the answer they come after and to no other. The next
 * answer of the API holds them, and can hold the write of another person too.
 */
export const withWrites = (proposed: readonly ProposedKey[], writes: Writes | null): readonly ProposedKey[] => {
  if (!writes || writes.over !== proposed) return proposed;

  const mine = new Map(writes.proposed.map((row) => [idOf(row), row]));
  const kept = proposed.filter((row) => !mine.has(idOf(row)));

  return [...kept, ...mine.values()].filter((row) => !writes.published.has(idOf(row)));
};

const writesOver = (writes: Writes | null, over: readonly ProposedKey[]): Writes =>
  writes?.over === over ? writes : { over, proposed: [], published: new Set() };

/**
 * The writes after this page proposed `keys` over the answer `over`.
 *
 * The last write of a key wins. A key that was published and is proposed again
 * waits again, so it leaves the published ones.
 */
export const afterProposal = (
  writes: Writes | null,
  over: readonly ProposedKey[],
  keys: readonly ProposedKey[],
): Writes => {
  const before = writesOver(writes, over);
  const again = new Set(keys.map(idOf));

  return {
    over,
    proposed: [...before.proposed.filter((row) => !again.has(idOf(row))), ...keys],
    published: new Set([...before.published].filter((id) => !again.has(id))),
  };
};

/** The writes after this page published the keys `ids` over the answer `over`. */
export const afterPublication = (
  writes: Writes | null,
  over: readonly ProposedKey[],
  ids: readonly string[],
): Writes => {
  const before = writesOver(writes, over);
  const done = new Set(ids);

  return {
    over,
    proposed: before.proposed.filter((row) => !done.has(idOf(row))),
    published: new Set([...before.published, ...ids]),
  };
};

/** Lower case and no accent: « deconnexion » finds « Déconnexion ». */
const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * The rows that a search keeps (DB-239).
 *
 * The query can be a part of the key, of the source text, of the published
 * value or of the proposed one. An empty query keeps every row.
 */
export const matching = (rows: readonly Row[], query: string): readonly Row[] => {
  const wanted = fold(query.trim());

  if (wanted === '') return rows;

  return rows.filter((row) =>
    [row.key, row.source, row.published ?? '', row.proposal?.value ?? ''].some((text) => fold(text).includes(wanted)),
  );
};

/** Where a text holds a query, as `[start, end)` in the text itself, with the folding of `matching`. */
export const matchIn = (text: string, query: string): readonly [number, number] | null => {
  const wanted = fold(query.trim());

  if (wanted === '') return null;

  // The fold of a character can change the length: each folded character keeps the place of its character.
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;

  for (const character of text) {
    for (const part of fold(character)) {
      folded += part;
      starts.push(at);
      ends.push(at + character.length);
    }

    at += character.length;
  }

  const found = folded.indexOf(wanted);

  return found === -1 ? null : [starts[found]!, ends[found + wanted.length - 1]!];
};

export interface Suggestion {
  row: Row;
  /** The text under the key: the first of the source and the translation that holds the query, or the source. */
  text: string;
  keyMatch: readonly [number, number] | null;
  textMatch: readonly [number, number] | null;
}

/** The suggestions of the search (DB-619). */
export const SUGGESTIONS_SHOWN = 8;

/**
 * The keys that the search suggests, from the rows a search keeps.
 *
 * A key that starts with the query comes first, then a key that holds it, then a key whose text holds it.
 */
export const suggestionsOf = (rows: readonly Row[], query: string): Suggestion[] => {
  if (fold(query.trim()) === '') return [];

  const rank = (suggestion: Suggestion) => (suggestion.keyMatch === null ? 2 : suggestion.keyMatch[0] === 0 ? 0 : 1);

  return matching(rows, query)
    .map((row) => {
      const texts = [row.source, row.proposal?.value ?? row.published ?? ''];
      const text = texts.find((candidate) => matchIn(candidate, query) !== null) ?? row.source;

      return { row, text, keyMatch: matchIn(row.key, query), textMatch: matchIn(text, query) };
    })
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, SUGGESTIONS_SHOWN);
};

/** The characters a line of the translation column holds at the narrowest width of the table. */
const LINE = 50;

/**
 * The lines a text needs, so a long text is read without a scroll.
 * A short text takes one line: most keys are a label.
 */
export const linesOf = (text: string): number =>
  Math.min(
    8,
    text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / LINE)), 0),
  );

/**
 * The drafts that stay after a proposal was written.
 *
 * A draft leaves only if it still says what was sent. A text that was typed
 * while the proposal was on its way is not on the branch, and stays.
 */
export const draftsAfterProposal = (
  drafts: ReadonlyMap<string, string>,
  sent: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> => new Map([...drafts].filter(([id, value]) => sent.get(id) !== value));

/** One page of a list, and where it sits in the list. */
export interface Page<T> {
  rows: readonly T[];
  /** The page that is shown, from 1. It is the last one when the page asked for is past the end. */
  page: number;
  /** At least 1: an empty list has one empty page. */
  pages: number;
  /** The place of the first and of the last row of the page in the list, from 1. Both are 0 for an empty list. */
  from: number;
  to: number;
  total: number;
}

/**
 * The page `asked` of a list (DB-265).
 *
 * A page that is past the end gives the last one. A proposal takes rows out of
 * the list, and the last page can then hold nothing: the reader must not stay
 * on a page that is empty when rows are left before it.
 */
export const pageOf = <T>(rows: readonly T[], asked: number, size: number): Page<T> => {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pages, Math.max(1, Math.floor(asked) || 1));
  const start = (page - 1) * size;
  const shown = rows.slice(start, start + size);

  return {
    rows: shown,
    page,
    pages,
    from: shown.length === 0 ? 0 : start + 1,
    to: start + shown.length,
    total: rows.length,
  };
};

const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Why a new key cannot be created, in the words of the form, or nothing (DB-238).
 *
 * The API refuses the same keys. This says it before the request, and in
 * French. `existing` holds the keys of the file the key goes to.
 */
export const newKeyProblem = (key: string, existing: ReadonlySet<string>): string | null => {
  const parts = key.split('.');

  if (key.trim() === '') return 'Donnez un nom à la clé.';
  if (/\s/.test(key)) return "Une clé ne contient pas d'espace.";
  if (parts.some((part) => part === ''))
    return "Une clé ne commence pas, ne finit pas par un point, et n'en a pas deux de suite.";
  if (parts.some((part) => UNSAFE.has(part)))
    return `« ${parts.find((part) => UNSAFE.has(part))} » ne peut pas être un segment de clé.`;
  if (existing.has(key)) return 'Cette clé existe déjà dans ce fichier.';

  const below = [...existing].find((held) => held.startsWith(`${key}.`));

  if (below) return `« ${key} » est déjà une section : elle contient ${below}.`;

  const above = [...existing].find((held) => key.startsWith(`${held}.`));

  if (above) return `« ${above} » est déjà un texte : une clé ne peut pas passer dessous.`;

  return null;
};

/** A run of pages that the pager does not draw one by one. A click on it opens the page in its middle. */
export interface PageGap {
  from: number;
  to: number;
}

/**
 * The page numbers a pager draws (DB-274).
 *
 * Up to seven pages, all of them. Beyond, the first, the last, the open one
 * and its two neighbours, with a gap for each run that is left out. A gap of
 * one page is that page: three dots would take the room of its number.
 */
export const pageNumbersOf = (page: number, pages: number): (number | PageGap)[] => {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);

  const kept = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((number) => number >= 1 && number <= pages)
    .sort((a, b) => a - b);
  const drawn: (number | PageGap)[] = [];

  for (const [index, number] of kept.entries()) {
    const before = kept[index - 1];

    if (before !== undefined && number - before === 2) drawn.push(before + 1);
    else if (before !== undefined && number - before > 2) drawn.push({ from: before + 1, to: number - 1 });

    drawn.push(number);
  }

  return drawn;
};

/**
 * The key that a view of one key shows, and its place in the list from 0 (DB-276).
 *
 * `id` is the key that was opened. A proposal takes it out of the list: the
 * view then shows the key that took its place, `last`, so the translator goes
 * on with the next one and not from the top.
 */
export const openOf = (rows: readonly Row[], id: string | null, last: number): { row: Row; index: number } | null => {
  if (rows.length === 0) return null;

  const found = id === null ? -1 : rows.findIndex((row) => idOf(row) === id);
  const index = found === -1 ? Math.min(Math.max(last, 0), rows.length - 1) : found;

  return { row: rows[index], index };
};
