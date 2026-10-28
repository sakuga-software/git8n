import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  i18nRepositories,
  memberLanguages,
  members,
  type MemberRole,
  newId,
  organizations,
  pendingMemberLanguages,
  pendingMembers,
  users,
} from '@i18n-editor/db';
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

/** The headers of a request of the browser: the session cookie, signed as better-auth signs it. */
export async function cookieHeaders(userId: string): Promise<Record<string, string>> {
  const context = await auth().$context;
  const session = await context.internalAdapter.createSession(userId);
  const signature = createHmac('sha256', context.secret).update(session.token).digest('base64');

  return { cookie: `better-auth.session_token=${encodeURIComponent(`${session.token}.${signature}`)}` };
}

/** A new admin account, and the headers of its requests. */
export async function signedInAdmin(): Promise<{ userId: string; headers: Record<string, string> }> {
  // An address belongs to one account, so a second admin of the same test is the first one.
  const [held] = await db().select({ id: users.id }).from(users).where(eq(users.email, ADMIN_EMAIL));
  const userId = held?.id ?? (await insertAccount({ name: 'Admin', email: ADMIN_EMAIL }));

  return { userId, headers: await authHeaders(userId) };
}

/** An organization with no member, as the connection of a repository writes it. */
export async function insertOrganization(): Promise<string> {
  const id = newId();

  await db().insert(organizations).values({ id, name: id, slug: id });

  return id;
}

/** Makes `userId` a member of a repository, with a role and languages. */
export async function grant(
  userId: string,
  repositoryId: string,
  options: { role?: MemberRole; languages?: string[]; writesSource?: boolean } = {},
): Promise<void> {
  const [repository] = await db()
    .select({ organizationId: i18nRepositories.organizationId })
    .from(i18nRepositories)
    .where(eq(i18nRepositories.id, repositoryId));
  const memberId = newId();

  await db()
    .insert(members)
    .values({
      id: memberId,
      organizationId: repository.organizationId,
      userId,
      role: options.role ?? 'translator',
      writesSource: options.writesSource ?? false,
    });

  if (options.languages?.length) {
    await db()
      .insert(memberLanguages)
      .values(options.languages.map((language) => ({ memberId, language })));
  }
}

/** A member that waits for its first sign-in, named by address or by GitHub ID. */
export async function invite(
  repositoryId: string,
  options: { email?: string; githubId?: string; role?: MemberRole; languages?: string[]; writesSource?: boolean },
): Promise<string> {
  const [repository] = await db()
    .select({ organizationId: i18nRepositories.organizationId })
    .from(i18nRepositories)
    .where(eq(i18nRepositories.id, repositoryId));
  const id = newId();

  await db()
    .insert(pendingMembers)
    .values({
      id,
      organizationId: repository.organizationId,
      email: options.email?.toLowerCase() ?? null,
      githubId: options.githubId ?? null,
      role: options.role ?? 'translator',
      writesSource: options.writesSource ?? false,
    });

  if (options.languages?.length) {
    await db()
      .insert(pendingMemberLanguages)
      .values(options.languages.map((language) => ({ pendingMemberId: id, language })));
  }

  return id;
}
