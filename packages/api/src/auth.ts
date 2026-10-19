import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

/** The account of a request that `withAuth` let through. */
export interface AuthUser {
  id: string;
  name: string;
  /** An admin sets the repositories up. It gives no right to write a language. */
  admin: boolean;
}

/** Finds the account of a request, or answers null for a visitor. */
export type Authenticator = (c: Context) => Promise<AuthUser | null> | AuthUser | null;

// The editor has no sign-in yet: DB-570 adds one. Until then, every request is a visitor.
let authenticate: Authenticator = () => null;

/** Puts `authenticator` in place of the one of the server. The tests call it. */
export function useAuthenticator(authenticator: Authenticator): void {
  authenticate = authenticator;
}

/** Refuses a visitor with a 401, and puts the account on the context. */
export function withAuth(): MiddlewareHandler {
  return async (c, next) => {
    const user = await authenticate(c);

    if (!user) throw new HTTPException(401, { message: 'Unauthorized' });

    c.set('user', user);
    await next();
  };
}
