import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { accessTokens, newId, users } from '@i18n-editor/db';
import { db } from '@/db';

/** Every access token starts with this prefix. `withAuth` reads it to tell a token from a session. */
export const ACCESS_TOKEN_PREFIX = 'i18e_';

/** How many characters of the token the list shows. */
const SHOWN_START = ACCESS_TOKEN_PREFIX.length + 4;

/** A write of `last_used_at` at most once in this time, so that a busy agent does not write on each request. */
const LAST_USE_STEP_MS = 60 * 1000;

export interface AccessToken {
  id: string;
  name: string;
  start: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');

const shapeOf = (row: typeof accessTokens.$inferSelect): AccessToken => ({
  id: row.id,
  name: row.name,
  start: row.start,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** The tokens of an account, the newest first. */
export async function listAccessTokens(userId: string): Promise<AccessToken[]> {
  const rows = await db()
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.userId, userId))
    .orderBy(desc(accessTokens.createdAt));

  return rows.map(shapeOf);
}

/** Makes a token for an account. The answer holds the token: this is the only time it is readable. */
export async function createAccessToken(
  userId: string,
  { name, expiresInDays }: { name: string; expiresInDays: number | null },
  now = new Date(),
): Promise<AccessToken & { token: string }> {
  const token = `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;

  const [row] = await db()
    .insert(accessTokens)
    .values({
      id: newId(now),
      userId,
      name,
      tokenHash: hashOf(token),
      start: token.slice(0, SHOWN_START),
      expiresAt: expiresInDays === null ? null : new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000),
      createdAt: now,
    })
    .returning();

  return { ...shapeOf(row!), token };
}

/** Deletes a token of an account. False when the account holds no token with this id. */
export async function revokeAccessToken(userId: string, id: string): Promise<boolean> {
  const deleted = await db()
    .delete(accessTokens)
    .where(and(eq(accessTokens.id, id), eq(accessTokens.userId, userId)))
    .returning({ id: accessTokens.id });

  return deleted.length > 0;
}

/** The account of a token that exists and did not expire, or null. */
export async function accountOfAccessToken(token: string, now = new Date()) {
  const [found] = await db()
    .select({
      id: accessTokens.id,
      lastUsedAt: accessTokens.lastUsedAt,
      user: { id: users.id, name: users.name, email: users.email, emailVerified: users.emailVerified },
    })
    .from(accessTokens)
    .innerJoin(users, eq(users.id, accessTokens.userId))
    .where(
      and(
        eq(accessTokens.tokenHash, hashOf(token)),
        or(isNull(accessTokens.expiresAt), gt(accessTokens.expiresAt, now)),
      ),
    )
    .limit(1);

  if (!found) return null;

  if (!found.lastUsedAt || now.getTime() - found.lastUsedAt.getTime() > LAST_USE_STEP_MS) {
    await db().update(accessTokens).set({ lastUsedAt: now }).where(eq(accessTokens.id, found.id));
  }

  return found.user;
}
