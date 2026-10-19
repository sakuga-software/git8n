import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import type { GithubOptions } from 'better-auth/social-providers';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { authAccounts, authSessions, authVerifications, type Database, newId, users } from '@i18n-editor/db';
import { env } from './config/env';
import { db } from './db';

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
      // GitHub is the only way in, so an address never belongs to two accounts.
      accountLinking: { enabled: false },
    },
    verification: { modelName: 'auth_verifications' },
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
    // The MCP server sends the session token as a bearer token. The browser sends the cookie.
    plugins: [bearer()],
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
