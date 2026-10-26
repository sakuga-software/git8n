import { sql } from 'drizzle-orm';
import { bigint, boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * An account of the editor. better-auth writes it at the first sign-in with GitHub.
 *
 * `email` and `emailVerified` are the ones GitHub gives at the last sign-in.
 * `ADMIN_EMAILS` reads them on each request, so no column says who is an admin.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(sql`lower(${table.email})`)],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('auth_sessions_user_id_idx').on(table.userId),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
  ],
);

/** The GitHub account behind a user. better-auth encrypts its tokens before it writes them. */
export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('auth_accounts_user_id_idx').on(table.userId),
    uniqueIndex('auth_accounts_provider_idx').on(table.providerId, table.accountId),
  ],
);

/** The state of a sign-in with GitHub between the redirect and the callback. */
export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('auth_verifications_identifier_idx').on(table.identifier),
    index('auth_verifications_expires_at_idx').on(table.expiresAt),
  ],
);

export const I18N_ROLES = ['translator', 'reviewer'] as const;

export type I18nRole = (typeof I18N_ROLES)[number];

/** What an account may do with the translations: propose, or publish (DB-210). */
export const i18nRole = pgEnum('i18n_role', I18N_ROLES);

export const PUBLISH_MODES = ['commit', 'pull_request'] as const;

export type PublishMode = (typeof PUBLISH_MODES)[number];

/**
 * How a publication reaches the base branch (DB-606).
 *
 * - `commit`: one commit straight onto the base branch;
 * - `pull_request`: commits on `i18n/publish`, and one open pull request to the
 *   base branch. A repository whose base branch requires a pull request needs it.
 */
export const publishMode = pgEnum('publish_mode', PUBLISH_MODES);

/**
 * A repository the editor translates, and how to read it (DB-210).
 *
 * **The configuration of a repository is not the configuration of a
 * deployment.** The branch, the path of the locales and the languages are
 * properties of the repository itself: they belong beside it, not in an
 * environment variable that a deployment has to carry. Adding a language then
 * costs a row, not a release.
 *
 * `installationId` is what the GitHub App answers for this repository. It is
 * what mints the token, and it is what makes a second repository free: install
 * the App on it, add a row.
 *
 * Only the two secrets of the App itself stay in the environment, because a
 * private key belongs in neither a table nor a repository.
 */
export const i18nRepositories = pgTable(
  'i18n_repositories',
  {
    id: text('id').primaryKey(),
    /** The installation of the GitHub App that reads and writes this repository. */
    installationId: bigint('installation_id', { mode: 'number' }).notNull(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    branch: text('branch').notNull().default('main'),
    /** Where the locale directories live: `<path>/<language>/<file>.json`. */
    localesPath: text('locales_path').notNull(),
    /**
     * Where the manifest of the locales lives, from the root of the repository.
     * Null means `<localesPath>/manifest.json`.
     */
    manifestPath: text('manifest_path'),
    /** The languages, **the source first** — the one the others translate. */
    languages: text('languages').array().notNull(),
    publishMode: publishMode('publish_mode').notNull().default('commit'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One row per repository: two would each answer for it, with a branch of
  // their own, and nothing would say which one the editor reads.
  (table) => [uniqueIndex('i18n_repositories_owner_name_idx').on(table.owner, table.name)],
);

/**
 * Who may write which language of the translations (DB-210).
 *
 * **The text is not here.** It lives in the JSON files of the repository, which
 * stay the truth of what is published. This table answers one question: what a
 * signed-in account is allowed to do to them.
 *
 * An account with no row is not a translator. `languages` empty is a row that
 * grants nothing, which is how a translator is suspended without losing the
 * history of what they approved.
 */
export const i18nTranslators = pgTable('i18n_translators', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** The languages this account may write. Never the source language. */
  languages: text('languages').array().notNull().default(sql.raw(`'{}'::text[]`)),
  role: i18nRole('role').notNull().default('translator'),
  /**
   * Whether this account may write the source language (DB-238).
   *
   * It is a right of its own, and no language of `languages` gives it. A
   * translator of English does not write the French that English answers.
   */
  writesSource: boolean('writes_source').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
