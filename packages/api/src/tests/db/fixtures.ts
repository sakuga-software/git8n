import { eq } from 'drizzle-orm';
import { newId, users } from '@i18n-editor/db';
import { auth } from '@/auth';
import { db } from '@/db';

/** An address of `ADMIN_EMAILS` in `setup-env.ts`. */
export const ADMIN_EMAIL = 'admin@example.test';

/** A new account, as a first sign-in with GitHub writes it. It is not an admin. */
export async function insertAccount(
  options: { name?: string; email?: string; emailVerified?: boolean } = {},
): Promise<string> {
  const id = newId();

  await db()
    .insert(users)
    .values({
      id,
      name: options.name ?? `Account ${id}`,
      email: options.email ?? `${id}@example.test`,
      emailVerified: options.emailVerified ?? true,
    });

  return id;
}

/**
 * The headers of a request signed in as `userId`.
 *
 * better-auth writes a real session, and the request carries its token as the
 * MCP server does. The test of the sign-in reads the cookie path.
 */
export async function authHeaders(userId: string): Promise<Record<string, string>> {
  const context = await auth().$context;
  const session = await context.internalAdapter.createSession(userId);

  return { authorization: `Bearer ${session.token}` };
}

/** A new admin account, and the headers of its requests. */
export async function signedInAdmin(): Promise<{ userId: string; headers: Record<string, string> }> {
  // An address belongs to one account, so a second admin of the same test is the first one.
  const [held] = await db().select({ id: users.id }).from(users).where(eq(users.email, ADMIN_EMAIL));
  const userId = held?.id ?? (await insertAccount({ name: 'Admin', email: ADMIN_EMAIL }));

  return { userId, headers: await authHeaders(userId) };
}
