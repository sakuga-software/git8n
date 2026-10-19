import { z } from 'zod';

/**
 * A dotted key of a locale file, as i18next reads it.
 *
 * `__proto__` and its neighbours name a property every object holds, so
 * writing one walks out of the file and into every object of the process. The
 * service refuses them too; this is what makes both routes answer the same
 * way rather than one of them reaching the service to find out.
 */
export const translationKey = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value.split('.').every((part) => part.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(part)),
    'A key cannot hold an empty segment, nor name __proto__, constructor or prototype',
  );

/** Refuses a value that climbs out of what it names. git refuses such a ref too. */
const noClimbing = (value: string) => value.split('/').every((segment) => segment !== '.' && segment !== '..');

/**
 * A repository the editor translates (DB-210).
 *
 * A guard on a field says nothing about its type. `languages: "fr"` passes a
 * check on its length and reaches a `text[]` column as a string. That fails as
 * a server error, not as the bad request it is.
 */
export const newRepositorySchema = z.object({
  installationId: z.coerce.number().int().positive(),
  owner: z.string().min(1),
  name: z.string().min(1),
  branch: z.string().min(1).refine(noClimbing, 'A branch cannot hold . or ..').optional(),
  /**
   * A path that holds `..` leaves the repository. `fetch` resolves it before
   * it sends, so `../../../../user/repos` asks GitHub for `/user/repos` with
   * our installation token.
   */
  localesPath: z.string().min(1).refine(noClimbing, 'A path of the locales cannot hold . or ..'),
  /** From the root of the repository. Absent means `<localesPath>/manifest.json`. */
  manifestPath: z
    .string()
    .regex(/\.json$/, 'A manifest is a .json file')
    .refine(noClimbing, 'A path of the manifest cannot hold . or ..')
    .optional(),
  /** The source language first, and the rest translated from it. A tag, not a path. */
  languages: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/, 'A language is a tag such as fr or pt-BR')).min(1),
});

export type NewRepositoryBody = z.infer<typeof newRepositorySchema>;

/**
 * A file of the locales is a name such as `common`, never a path.
 *
 * The catalogue reads the names of GitHub through this rule too (DB-221), so
 * it lists no file that a proposal or a publication refuses.
 */
export const fileName = z.string().regex(/^[A-Za-z0-9_-]+$/, 'A file is a name such as common, not a path');

/**
 * What a language is for one file of the locales (DB-225).
 *
 * - `available`: the application loads the file, and a translator works on it;
 * - `partial`: a translator works on it, and the application does not load it,
 *   so its users read the source;
 * - `disabled`: the file has no version in this language. The catalogue leaves
 *   it out, and a write on it is refused.
 */
export const fileStateSchema = z.enum(['available', 'partial', 'disabled']);

export type FileState = z.infer<typeof fileStateSchema>;

/**
 * The manifest of the locales (DB-225). By default it is `manifest.json`,
 * beside the directories of the languages. `docs/manifest.md` gives its format.
 *
 * A file or a language that it does not name is `available`. A repository
 * with no manifest then reads as it did before.
 */
export const localeManifestSchema = z.object({
  source: z.string().min(1).optional(),
  files: z.record(fileName, z.record(z.string().min(1), fileStateSchema)).default({}),
});

export type LocaleManifest = z.infer<typeof localeManifestSchema>;

/**
 * A batch of translations proposed in one language (DB-212).
 *
 * One batch is one commit, so the keys arrive together. A file is a name such
 * as `common`, not a path: the path is built from the row of the repository.
 */
export const proposalSchema = z.object({
  repository: z.string().min(1),
  language: z.string().regex(/^[A-Za-z0-9_-]+$/, 'A language is a tag such as fr or pt-BR'),
  /**
   * The commit of the catalogue the translator read.
   *
   * The head of the branch at the moment of the write is not it: the source can
   * move in between, and the catalogue is held for five minutes besides. The
   * drift check would then compare the new source with itself.
   */
  readAt: z.string().regex(/^[0-9a-f]{40}$/, 'A commit is a full lowercase sha'),
  values: z
    .array(
      z.object({
        file: fileName,
        key: translationKey,
        value: z.string(),
      }),
    )
    .min(1)
    .max(2000),
});

/**
 * The keys a reviewer approves, and the batch each comes from.
 *
 * The commit says which revision the key was written against. A key whose
 * source moved since is then refused rather than published.
 */
export const publicationSchema = z.object({
  repository: z.string().min(1),
  language: z.string().regex(/^[A-Za-z0-9_-]+$/, 'A language is a tag such as fr or pt-BR'),
  approved: z
    .array(
      z.object({
        file: fileName,
        key: translationKey,
        commit: z.string().regex(/^[0-9a-f]{40}$/, 'A commit is a full lowercase sha'),
      }),
    )
    .min(1)
    .max(2000),
});

/**
 * The keys an account adds to the source language (DB-238).
 *
 * No language is named: the source of a repository is the first language of
 * its row, and a caller does not choose it. A value is at least one character:
 * an empty source text is a key with nothing to translate.
 */
export const newKeysSchema = z.object({
  repository: z.string().min(1),
  values: z
    .array(
      z.object({
        file: fileName,
        key: translationKey,
        value: z.string().min(1),
      }),
    )
    .min(1)
    .max(200),
});
