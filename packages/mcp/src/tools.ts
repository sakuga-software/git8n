import { z } from 'zod';
import {
  catalogue,
  propose,
  repositories,
  rightsOf,
  waiting,
  type ApiConfig,
  type Catalogue,
  type CatalogueEntry,
} from './api.ts';

/**
 * What an agent can do to the translations (DB-211).
 *
 * The same operations the editor will have: list the keys of a language by
 * state, read one with its context, and write a batch as one proposal.
 *
 * **Publishing is not here.** A reviewer approving a translation is a
 * judgement, and the screen that asks for it is DB-213. The API refuses a
 * publication from an account that is no reviewer either way, so this is the
 * narrower of two guards rather than the only one.
 */

/** A key is a name of a file and a dotted path, never a path of its own. */
const fileName = z.string().regex(/^[A-Za-z0-9_-]+$/, 'A file is a name such as common, not a path');
const language = z.string().regex(/^[A-Za-z0-9_-]+$/, 'A language is a tag such as fr or pt-BR');

/**
 * How many entries one answer carries.
 *
 * A catalogue of two thousand keys does not fit an agent's context, and an
 * answer it cannot read is an answer it will ask for again. The window says
 * what it left out.
 */
const PAGE = 200;

/**
 * What a tool that names one language of one repository takes.
 *
 * Shared so the six tools state a language the same way. Stated by hand, one
 * of them took `../../../../user`, and the guard was the API rather than the
 * input.
 */
export const languageSchema = {
  repository: z.string().min(1).describe('The repository to read, from i18n_repositories.'),
  language: language.describe('The language to read, which the repository must translate into.'),
};

export const listSchema = {
  ...languageSchema,
  state: z
    .enum(['missing', 'translated', 'all'])
    .default('missing')
    .describe('Which keys to answer. `missing` is what there is work on.'),
  file: fileName.optional().describe('Only the keys of this file, for example `common`.'),
  offset: z.number().int().min(0).default(0).describe('Where to start, for a catalogue past one answer.'),
};

export const readSchema = {
  ...languageSchema,
  file: fileName,
  key: z.string().min(1).describe('The dotted path of the key, as i18next reads it.'),
};

export const proposeSchema = {
  ...languageSchema,
  readAt: z
    .string()
    .regex(/^[0-9a-f]{40}$/, 'The `commit` of the listing this batch answers')
    .describe(
      'The `commit` the keys were read at, taken from i18n_keys or i18n_key. Every page of one listing answers the same one. It is what lets a publication refuse a key whose source moved since — never invent one, and never mix the values of two listings in one call.',
    ),
  values: z
    .array(z.object({ file: fileName, key: z.string().min(1), value: z.string() }))
    .min(1)
    .max(2000)
    .describe(
      'The whole batch. One call is one commit, so three hundred keys are three hundred keys, not three hundred commits.',
    ),
};

const answer = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

/**
 * How long one reading of a catalogue serves every page of it.
 *
 * The same window the API holds its own answer for, so this never serves a
 * revision older than the one the API would.
 */
const HELD_MS = 5 * 60 * 1000;

/**
 * The readings one server holds.
 *
 * **It belongs to a server, not to the module.** Held in a module, two servers
 * built in one process would share it: the second would be answered a
 * catalogue the first read under **its** token and for **its** host, without
 * asking for it — and would see what a 403 should have refused it.
 */
export interface Catalogues {
  read: (config: ApiConfig, repository: string, language: string, now: number) => Promise<Catalogue>;
  clear: () => void;
}

/**
 * One reading of a catalogue, shared by every page of it.
 *
 * **Each page fetching again is how two revisions end up in one proposal.**
 * Page one is read at A, page two at B, and a batch carries a single `readAt`:
 * the keys of page one then go out stamped with B, and the publication of
 * DB-212 compares a source that moved against itself. Every page of a listing
 * answers the revision the first one did.
 */
export const createCatalogues = (): Catalogues => {
  const held = new Map<string, { at: number; value: Catalogue }>();
  const reading = new Map<string, Promise<Catalogue>>();

  return {
    read: async (config, repository, language, now) => {
      const key = `${repository}:${language}`;
      const hit = held.get(key);

      if (hit && now - hit.at < HELD_MS) return hit.value;

      // A client can send the second page before the first answers. Without
      // this, both miss the cache and both read, and the two answers can carry
      // two revisions — which is the defect the comment above describes.
      const shared = reading.get(key);

      if (shared) return shared;

      const started = catalogue(config, repository, language)
        .then((value) => {
          held.set(key, { at: now, value });

          return value;
        })
        .finally(() => {
          // A later read must not drop the one that replaced it.
          if (reading.get(key) === started) reading.delete(key);
        });

      reading.set(key, started);

      return started;
    },
    clear: () => {
      held.clear();
      reading.clear();
    },
  };
};

/** The files that have no version in the language of a catalogue. */
const disabledIn = (read: { files?: Record<string, string> }): string[] =>
  Object.entries(read.files ?? {})
    .filter(([, state]) => state === 'disabled')
    .map(([file]) => file)
    .sort();

const matching = (entries: CatalogueEntry[], state: string, file?: string) =>
  entries.filter((entry) => (state === 'all' || entry.state === state) && (file === undefined || entry.file === file));

export const listKeys = async (
  config: ApiConfig,
  input: { repository: string; language: string; state: string; file?: string; offset: number },
  held: Catalogues,
  now = Date.now(),
) => {
  const read = await held.read(config, input.repository, input.language, now);
  const found = matching(read.entries, input.state, input.file);
  const page = found.slice(input.offset, input.offset + PAGE);

  return answer({
    // The revision the values were read at. A proposal carries it back.
    commit: read.commit,
    source: read.source,
    language: read.language,
    total: found.length,
    offset: input.offset,
    returned: page.length,
    // Said plainly rather than left to be worked out from three numbers.
    more: input.offset + page.length < found.length,
    // An agent that sees no key of a file must not read « fully translated ».
    // A proposal on one of these files is refused.
    filesWithNoVersion: disabledIn(read),
    entries: page,
  });
};

export const readKey = async (
  config: ApiConfig,
  input: { repository: string; language: string; file: string; key: string },
  held: Catalogues,
  now = Date.now(),
) => {
  const read = await held.read(config, input.repository, input.language, now);
  const found = read.entries.find((entry) => entry.file === input.file && entry.key === input.key);

  if (disabledIn(read).includes(input.file)) {
    return answer({
      found: false,
      reason: `${input.file} has no ${input.language} version, and takes no proposal.`,
    });
  }

  if (!found) {
    // A key that is not there is not an empty translation, and saying so is
    // what keeps an agent from proposing a value for a key nobody asked for.
    return answer({
      found: false,
      reason: `${input.file}.${input.key} is not a key of the source of ${input.language}.`,
    });
  }

  return answer({ found: true, commit: read.commit, source: read.source, entry: found });
};

export const proposeBatch = async (
  config: ApiConfig,
  input: {
    repository: string;
    language: string;
    readAt: string;
    values: Array<{ file: string; key: string; value: string }>;
  },
) => answer(await propose(config, input));

export const listRepositories = async (config: ApiConfig) => answer(await repositories(config));

export const whoAmI = async (config: ApiConfig) => answer(await rightsOf(config));

export const listProposals = async (config: ApiConfig, input: { repository: string; language: string }) =>
  answer(await waiting(config, input.repository, input.language));
