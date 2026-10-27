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

/** The GitHub IDs of the accounts that `userId` signs in with. */
const githubIdsOf = async (userId: string): Promise<string[]> =>
  (
    await db()
      .select({ id: authAccounts.accountId })
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, 'github')))
  ).map((row) => row.id);

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
      const member = await auth().api.addMember({
        body: {
          userId,
          organizationId: row.organizationId,
          role: row.role as MemberRole,
          writesSource: row.writesSource,
        },
      });
      const languages = await db()
        .select({ language: pendingMemberLanguages.language })
        .from(pendingMemberLanguages)
        .where(eq(pendingMemberLanguages.pendingMemberId, row.id));

      if (member && languages.length > 0) {
        await db()
          .insert(memberLanguages)
          .values(languages.map(({ language }) => ({ memberId: member.id, language })))
          .onConflictDoNothing();
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
