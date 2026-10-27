import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  authAccounts,
  i18nRepositories,
  memberLanguages,
  members,
  type MemberRole,
  pendingMemberLanguages,
  pendingMembers,
  users,
} from '@i18n-editor/db';
import { auth } from '@/auth';
import { env } from '@/config/env';
import { db } from '@/db';
import { logger } from '@/utils/logger';

/** The GitHub IDs of the accounts that `userId` signs in with. */
const githubIdsOf = async (userId: string): Promise<string[]> =>
  (
    await db()
      .select({ id: authAccounts.accountId })
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, 'github')))
  ).map((row) => row.id);

/**
 * Makes an account a member with a role, its languages and the right to write the source.
 *
 * The plugin writes the member row, and the editor writes the languages after
 * it. If the languages fail, the member row goes too: a member with no
 * language would refuse a second try as « already a member ».
 */
export async function addMemberWithLanguages(
  organizationId: string,
  userId: string,
  rights: { role: MemberRole; languages: string[]; writesSource: boolean },
): Promise<string> {
  const member = await auth().api.addMember({
    body: { userId, organizationId, role: rights.role, writesSource: rights.writesSource },
  });

  if (!member) throw new Error('better-auth did not answer the member it added.');

  if (rights.languages.length > 0) {
    try {
      await db()
        .insert(memberLanguages)
        .values([...new Set(rights.languages)].sort().map((language) => ({ memberId: member.id, language })));
    } catch (error) {
      await db().delete(members).where(eq(members.id, member.id));
      throw error;
    }
  }

  return member.id;
}

/**
 * Makes an account a member of each repository where a pending row names it,
 * then deletes these rows (DB-637, DB-645).
 *
 * An address matches only when it is verified. Without that rule, a person
 * who adds an invited address to their GitHub account, and does not verify
 * it, gets the rights of the invitation.
 */
export async function admitPending(userId: string): Promise<void> {
  const [user] = await db().select().from(users).where(eq(users.id, userId));

  if (!user) return;

  const githubIds = await githubIdsOf(userId);
  const byAddress = user.emailVerified ? eq(pendingMembers.email, user.email.trim().toLowerCase()) : undefined;
  const byGithub = githubIds.length > 0 ? inArray(pendingMembers.githubId, githubIds) : undefined;

  if (!byAddress && !byGithub) return;

  const pending = await db().select().from(pendingMembers).where(or(byAddress, byGithub));

  for (const row of pending) {
    const [held] = await db()
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.organizationId, row.organizationId), eq(members.userId, userId)));

    // A member keeps the rights it has. The invitation does not change them.
    if (!held) {
      const languages = await db()
        .select({ language: pendingMemberLanguages.language })
        .from(pendingMemberLanguages)
        .where(eq(pendingMemberLanguages.pendingMemberId, row.id));

      try {
        await addMemberWithLanguages(row.organizationId, userId, {
          role: row.role as MemberRole,
          languages: languages.map(({ language }) => language),
          writesSource: row.writesSource,
        });
      } catch (error) {
        // The sign-in goes on. The invitation stays, and the next sign-in tries again.
        logger.error('An invitation was not turned into a member', { invitation: row.id, error });
        continue;
      }
    }

    await db().delete(pendingMembers).where(eq(pendingMembers.id, row.id));
  }
}

/** The repositories that wait for an address, by their full name. */
export const repositoriesInvitingAddress = async (email: string): Promise<string[]> =>
  (
    await db()
      .select({ owner: i18nRepositories.owner, name: i18nRepositories.name })
      .from(pendingMembers)
      .innerJoin(i18nRepositories, eq(i18nRepositories.organizationId, pendingMembers.organizationId))
      .where(eq(pendingMembers.email, email.trim().toLowerCase()))
  ).map((row) => `${row.owner}/${row.name}`);

/**
 * Whether the editor sends a magic link to an address (DB-645).
 *
 * It sends one to an admin, to an invited address, and to the verified address
 * of a member. Any other address gets no mail, and the same answer.
 */
export async function mayReceiveMagicLink(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();

  if (env.ADMIN_EMAILS.has(address)) return true;
  if ((await repositoriesInvitingAddress(address)).length > 0) return true;

  const [member] = await db()
    .select({ id: members.id })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(sql`lower(${users.email}) = ${address}`, eq(users.emailVerified, true)))
    .limit(1);

  return member !== undefined;
}
