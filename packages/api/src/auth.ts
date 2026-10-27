import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { magicLink } from 'better-auth/plugins/magic-link';
import { organization } from 'better-auth/plugins/organization';
import type { GithubOptions } from 'better-auth/social-providers';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  authAccounts,
  authSessions,
  authVerifications,
  type Database,
  invitations,
  members,
  newId,
  organizations,
  users,
} from '@i18n-editor/db';
import { env } from './config/env';
import { db } from './db';
import { ac, roles } from './permissions';
import { admitPending, mayReceiveMagicLink, repositoriesInvitingAddress } from './services/i18n-members.service';
import { sendMail } from './services/mail.service';
import { logger } from './utils/logger';

/** The account of a request that `withAuth` let through. */
export interface AuthUser {
  id: string;
  name: string;
  /** An admin sets the repositories up. It gives no right to write a language. */
  admin: boolean;
}

export const SESSION_DAYS = 14;

export interface AuthOptions {
  db: Database;
  secret: string;
  /** The address where the browser reaches `/api/auth`, that is, the address of the editor. */
  baseURL: string;
  github?: Pick<GithubOptions, 'clientId' | 'clientSecret' | 'getUserInfo'>;
}

export function createAuth(options: AuthOptions) {
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      schema: {
        users,
        auth_sessions: authSessions,
        auth_accounts: authAccounts,
        auth_verifications: authVerifications,
        organizations,
        members,
        invitations,
      },
    }),
    advanced: { database: { generateId: () => newId() } },
    user: { modelName: 'users' },
    session: {
      modelName: 'auth_sessions',
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    account: {
      modelName: 'auth_accounts',
      encryptOAuthTokens: true,
      // A person invited by address signs in with a magic link, then maybe
      // with GitHub (DB-645). The two join into one account only if GitHub says
      // that the address is verified. Do not add GitHub to `trustedProviders`:
      // a trusted provider joins an address that it did not verify.
      accountLinking: { enabled: true },
    },
    verification: { modelName: 'auth_verifications' },
    databaseHooks: {
      user: {
        create: {
          // A magic link creates an account with no name when the form sends none.
          before: async (user) => ({
            data: { ...user, name: user.name?.trim() || user.email.split('@')[0] },
          }),
        },
      },
      session: {
        create: {
          // Each sign-in makes the account a member where an invitation waits for it (DB-645).
          after: async (session) => {
            await admitPending(session.userId);
          },
        },
      },
    },
    emailAndPassword: { enabled: false },
    ...(options.github && {
      socialProviders: {
        github: {
          ...options.github,
          // `ADMIN_EMAILS` reads the address and its `verified` flag. Without
          // this, they stay as they were at the first sign-in.
          overrideUserInfoOnSignIn: true,
        },
      },
    }),
    plugins: [
      // The MCP server sends the session token as a bearer token. The browser sends the cookie.
      bearer(),
      // One organization for each repository holds its members (DB-637). The
      // routes of the editor do every change: `app.ts` closes the routes of the plugin.
      magicLink({
        // The answer is the same for every address, and comes before the mail
        // leaves: a slow answer would say that the address is known.
        sendMagicLink: async ({ email, url }) => {
          void sendMagicLinkTo(email, url).catch((error: unknown) =>
            logger.error('The magic link was not sent', { error }),
          );
        },
      }),
      organization({
        ac,
        roles,
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        schema: {
          organization: { modelName: 'organizations' },
          invitation: { modelName: 'invitations' },
          member: {
            modelName: 'members',
            additionalFields: { writesSource: { type: 'boolean', required: false, defaultValue: false, input: true } },
          },
        },
      }),
    ],
  });
}

/** Sends a magic link, to an address that may receive one (DB-645). Any other address gets nothing. */
export async function sendMagicLinkTo(email: string, url: string): Promise<void> {
  if (!(await mayReceiveMagicLink(email))) return;

  const inviting = await repositoriesInvitingAddress(email);
  const intro =
    inviting.length > 0
      ? `Vous êtes invité à traduire ${inviting.join(', ')} dans l'éditeur des traductions.`
      : "Voici votre lien de connexion à l'éditeur des traductions.";

  await sendMail({
    to: email,
    subject: inviting.length > 0 ? 'Invitation à traduire' : 'Votre lien de connexion',
    text: `Bonjour,\n\n${intro}\n\nOuvrez ce lien pour vous connecter. Il sert une seule fois et expire dans 5 minutes :\n${url}\n\nSi vous n'avez rien demandé, ignorez ce message.`,
  });
}

export type Auth = ReturnType<typeof createAuth>;

const instances = new WeakMap<Database, Auth>();

/** The authentication of the open database, built once for each database. */
export function auth(): Auth {
  const database = db();
  const held = instances.get(database);

  if (held) return held;

  const created = createAuth({
    db: database,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    github: env.GITHUB,
  });

  instances.set(database, created);

  return created;
}

/** Puts `instance` in place of the authentication of the open database. The tests call it. */
export function useAuth(instance: Auth): void {
  instances.set(db(), instance);
}

/**
 * Whether an account administers the editor.
 *
 * The address must be in `ADMIN_EMAILS`, and GitHub must say that it is
 * verified. Without the second condition, a person who adds an admin address
 * to their GitHub account, and does not verify it, becomes an admin.
 */
export const isAdmin = (user: { email: string; emailVerified: boolean }, admins: ReadonlySet<string>): boolean =>
  user.emailVerified && admins.has(user.email.trim().toLowerCase());

/** Refuses a visitor with a 401, and puts the account on the context. */
export function withAuth(): MiddlewareHandler {
  return async (c, next) => {
    const session = await auth().api.getSession({ headers: c.req.raw.headers });

    if (!session) throw new HTTPException(401, { message: 'Unauthorized' });

    const { user } = session;

    c.set('user', { id: user.id, name: user.name, admin: isAdmin(user, env.ADMIN_EMAILS) } satisfies AuthUser);
    await next();
  };
}
