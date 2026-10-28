import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

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
    /** A column of the better-auth organization plugin. The editor names the repository in each request and leaves it empty. */
    activeOrganizationId: text('active_organization_id'),
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

/**
 * The codes of the better-auth device authorization plugin (DB-669). A
 * command line asks for a code, and a signed-in person approves it in the
 * editor. The command line then gets a session token.
 */
export const authDeviceCodes = pgTable(
  'auth_device_codes',
  {
    id: text('id').primaryKey(),
    deviceCode: text('device_code').notNull(),
    userCode: text('user_code').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    pollingInterval: bigint('polling_interval', { mode: 'number' }),
    clientId: text('client_id'),
    scope: text('scope'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_device_codes_device_code_idx').on(table.deviceCode),
    uniqueIndex('auth_device_codes_user_code_idx').on(table.userCode),
  ],
);

/**
 * The access tokens of an account, for an agent or a CI job (DB-669).
 *
 * A token acts as its account. The table keeps the SHA-256 of the token and
 * never the token: the page shows the token one time only, when it is made.
 */
export const accessTokens = pgTable(
  'access_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    /** The first characters of the token, so that a person can tell their tokens apart. */
    start: text('start').notNull(),
    /** Null when the token does not expire. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('access_tokens_token_hash_idx').on(table.tokenHash),
    index('access_tokens_user_id_idx').on(table.userId),
  ],
);

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
    /**
     * The formats of the messages the editor writes (DB-609). Null means the
     * default format. `packages/api/src/services/i18n-messages.ts` lists the
     * variables of each one.
     */
    proposalCommitTemplate: text('proposal_commit_template'),
    publicationCommitTemplate: text('publication_commit_template'),
    pullRequestTitleTemplate: text('pull_request_title_template'),
    pullRequestBodyTemplate: text('pull_request_body_template'),
    /**
     * The better-auth organization that holds the members of this repository (DB-637).
     *
     * `restrict`: an organization cannot go while its repository stays.
     */
    organizationId: text('organization_id')
      .notNull()
      .unique()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One row per repository: two would each answer for it, with a branch of
  // their own, and nothing would say which one the editor reads.
  (table) => [uniqueIndex('i18n_repositories_owner_name_idx').on(table.owner, table.name)],
);

/**
 * The organizations of the better-auth organization plugin: one for each
 * repository, which `i18n_repositories.organization_id` names (DB-637).
 *
 * The plugin refuses to start without its `metadata` column, which it writes
 * as JSON. The editor never sends a value, so the column stays empty.
 */
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const MEMBER_ROLES = ['owner', 'reviewer', 'translator'] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Who may do what in one repository (DB-637). The better-auth organization
 * plugin writes the row, and `packages/api/src/permissions.ts` names the roles.
 *
 * **The text is not here.** It lives in the JSON files of the repository, which
 * stay the truth of what is published.
 *
 * `role` is text, as the plugin wants it: one of `MEMBER_ROLES`.
 */
export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    /**
     * Whether this member may write the source language (DB-238).
     *
     * It is a right of its own, and no language of `member_languages` gives it.
     * A translator of English does not write the French that English answers.
     */
    writesSource: boolean('writes_source').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // The plugin checks the pair in code only. Two requests at the same time would make two rows.
  (table) => [
    uniqueIndex('members_organization_user_idx').on(table.organizationId, table.userId),
    index('members_user_id_idx').on(table.userId),
  ],
);

/**
 * The invitations of the organization plugin. The plugin refuses to start
 * without this table. The editor does not use it: `app.ts` closes its routes.
 */
export const invitations = pgTable('invitations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role'),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  inviterId: text('inviter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The languages a member may write, one row per language. Never the source language.
 *
 * A member with no row here writes no target language. That is how a translator
 * is set aside without losing the history of what they wrote.
 */
export const memberLanguages = pgTable(
  'member_languages',
  {
    memberId: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
  },
  (table) => [primaryKey({ columns: [table.memberId, table.language] })],
);

/**
 * A member that has no account yet (DB-637, DB-645). An admin or an owner adds
 * a person by address or by GitHub login before their first sign-in.
 *
 * The first session of an account that matches the row makes it a member, and
 * deletes the row. An address matches only when it is verified: by the magic
 * link, or by GitHub. A GitHub login is kept as its numeric ID, which stays
 * the same when the person changes their login.
 */
export const pendingMembers = pgTable(
  'pending_members',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Lower case. */
    email: text('email'),
    githubId: text('github_id'),
    /** The login at the time of the invitation, to show it. `githubId` is what matches. */
    githubLogin: text('github_login'),
    role: text('role').notNull(),
    writesSource: boolean('writes_source').notNull().default(false),
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pending_members_organization_email_idx').on(table.organizationId, table.email),
    uniqueIndex('pending_members_organization_github_idx').on(table.organizationId, table.githubId),
    index('pending_members_email_idx').on(table.email),
    index('pending_members_github_id_idx').on(table.githubId),
    check('pending_members_names_somebody', sql`${table.email} is not null or ${table.githubId} is not null`),
  ],
);

/** The languages a pending member will write, one row per language. */
export const pendingMemberLanguages = pgTable(
  'pending_member_languages',
  {
    pendingMemberId: text('pending_member_id')
      .notNull()
      .references(() => pendingMembers.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
  },
  (table) => [primaryKey({ columns: [table.pendingMemberId, table.language] })],
);
