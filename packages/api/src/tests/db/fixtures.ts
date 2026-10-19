import { newId } from '@i18n-editor/db';
import { type AuthUser, useAuthenticator } from '@/auth';

const HEADER = 'x-test-user';

const accounts = new Map<string, AuthUser>();

// The specs sign in through a header that only this authenticator reads.
useAuthenticator((c) => accounts.get(c.req.header(HEADER) ?? '') ?? null);

/** A new account that is not an admin. */
export function insertAccount(options: { name?: string } = {}): string {
  const id = newId();

  accounts.set(id, { id, name: options.name ?? `Account ${id}`, admin: false });

  return id;
}

/** The headers of a request signed in as `userId`. */
export function authHeaders(userId: string): Record<string, string> {
  return { [HEADER]: userId };
}

/** A new admin account, and the headers of its requests. */
export function signedInAdmin(): { userId: string; headers: Record<string, string> } {
  const userId = newId();

  accounts.set(userId, { id: userId, name: 'Admin', admin: true });

  return { userId, headers: authHeaders(userId) };
}
