import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  authAccounts,
  i18nRepositories,
  memberLanguages,
  type I18nRepository,
  members,
  type MemberRole,
  newId,
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

/** What a member, or an invitation, may do in a repository. */
export interface MemberRights {
  role: MemberRole;
  languages: string[];
  writesSource: boolean;
}

export interface MemberEntry extends MemberRights {
  id: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
}

export interface InvitationEntry extends MemberRights {
  id: string;
  email: string | null;
  githubLogin: string | null;
  createdAt: string;
}

export interface MemberList {
  members: MemberEntry[];
  invitations: InvitationEntry[];
}

/** A change that the members of a repository refuse, with the status the route answers. */
export class MemberError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(status: MemberError['status'], message: string) {
    super(message);

    this.name = 'MemberError';
    this.status = status;
  }
}

const sorted = (languages: string[]): string[] => [...new Set(languages)].sort();

/** Refuses a language that is not a target of the repository. The source is a right of its own: `writesSource`. */
const checkLanguages = (repository: I18nRepository, languages: string[]): void => {
  const targets = repository.languages.slice(1);
  const unknown = languages.filter((language) => !targets.includes(language));

  if (unknown.length > 0) {
    throw new MemberError(
      400,
      `${unknown.join(', ')} is not a target language of this repository. Targets: ${targets.join(', ') || 'none'}.`,
    );
  }
};

/** The members of a repository and the invitations that wait, the owners first. */
export async function listMembers(repository: I18nRepository): Promise<MemberList> {
  const rows = await db()
    .select({
      id: members.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      role: members.role,
      writesSource: members.writesSource,
      language: memberLanguages.language,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .leftJoin(memberLanguages, eq(memberLanguages.memberId, members.id))
    .where(eq(members.organizationId, repository.organizationId));
  const pending = await db()
    .select({
      id: pendingMembers.id,
      email: pendingMembers.email,
      githubLogin: pendingMembers.githubLogin,
      role: pendingMembers.role,
      writesSource: pendingMembers.writesSource,
      createdAt: pendingMembers.createdAt,
      language: pendingMemberLanguages.language,
    })
    .from(pendingMembers)
    .leftJoin(pendingMemberLanguages, eq(pendingMemberLanguages.pendingMemberId, pendingMembers.id))
    .where(eq(pendingMembers.organizationId, repository.organizationId));

  const byMember = new Map<string, MemberEntry>();

  for (const { language, ...row } of rows) {
    const held = byMember.get(row.id) ?? { ...row, role: row.role as MemberRole, languages: [] };

    if (language) held.languages.push(language);
    byMember.set(row.id, held);
  }

  const byInvitation = new Map<string, InvitationEntry>();

  for (const { language, createdAt, ...row } of pending) {
    const held = byInvitation.get(row.id) ?? {
      ...row,
      role: row.role as MemberRole,
      createdAt: createdAt.toISOString(),
      languages: [],
    };

    if (language) held.languages.push(language);
    byInvitation.set(row.id, held);
  }

  const rank = (role: MemberRole) => ['owner', 'reviewer', 'translator'].indexOf(role);

  return {
    members: [...byMember.values()]
      .map((entry) => ({ ...entry, languages: sorted(entry.languages) }))
      .sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name)),
    invitations: [...byInvitation.values()]
      .map((entry) => ({ ...entry, languages: sorted(entry.languages) }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

/** What adding a person did: a member now, or an invitation that waits for the first sign-in. */
export type Added =
  | { outcome: 'member'; memberId: string }
  | { outcome: 'invited'; invitationId: string; by: 'email' | 'github' };

/** The account of a GitHub ID, when the person signed in once with GitHub. */
const userOfGithubId = async (githubId: string): Promise<string | undefined> =>
  (
    await db()
      .select({ userId: authAccounts.userId })
      .from(authAccounts)
      .where(and(eq(authAccounts.providerId, 'github'), eq(authAccounts.accountId, githubId)))
  )[0]?.userId;

/** The account of a verified address. An address that nobody verified names nobody. */
const userOfAddress = async (email: string): Promise<string | undefined> =>
  (
    await db()
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, eq(users.emailVerified, true)))
  )[0]?.id;

/** Makes an account a member with these rights. */
const admit = async (repository: I18nRepository, userId: string, rights: MemberRights): Promise<string> => {
  const [held] = await db()
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.organizationId, repository.organizationId), eq(members.userId, userId)));

  if (held) throw new MemberError(409, 'This person is already a member of this repository.');

  const member = await auth().api.addMember({
    body: { userId, organizationId: repository.organizationId, role: rights.role, writesSource: rights.writesSource },
  });

  if (!member) throw new Error('better-auth did not answer the member it added.');

  if (rights.languages.length > 0) {
    await db()
      .insert(memberLanguages)
      .values(sorted(rights.languages).map((language) => ({ memberId: member.id, language })));
  }

  return member.id;
};

/**
 * Adds a person to a repository, by address or by GitHub login (DB-637).
 *
 * A person who has an account becomes a member at once. Another person gets
 * an invitation, which the first sign-in turns into a member. `resolveLogin`
 * gives the numeric ID of a GitHub login: the ID stays when the login changes.
 */
export async function addPerson(
  repository: I18nRepository,
  person: ({ email: string; githubLogin?: undefined } | { githubLogin: string; email?: undefined }) & MemberRights,
  invitedBy: string,
  resolveLogin: (login: string) => Promise<{ id: string; login: string } | null>,
): Promise<Added> {
  checkLanguages(repository, person.languages);

  const rights: MemberRights = { role: person.role, languages: person.languages, writesSource: person.writesSource };
  let github: { id: string; login: string } | null = null;

  if (person.githubLogin !== undefined) {
    github = await resolveLogin(person.githubLogin);

    if (!github) throw new MemberError(400, `No GitHub account has the login ${person.githubLogin}.`);
  }

  const userId = github ? await userOfGithubId(github.id) : await userOfAddress(person.email as string);

  if (userId) return { outcome: 'member', memberId: await admit(repository, userId, rights) };

  const [taken] = await db()
    .select({ id: pendingMembers.id })
    .from(pendingMembers)
    .where(
      and(
        eq(pendingMembers.organizationId, repository.organizationId),
        github ? eq(pendingMembers.githubId, github.id) : eq(pendingMembers.email, person.email as string),
      ),
    );

  if (taken) throw new MemberError(409, 'An invitation already waits for this person.');

  const invitationId = newId();

  await db()
    .insert(pendingMembers)
    .values({
      id: invitationId,
      organizationId: repository.organizationId,
      email: github ? null : (person.email as string),
      githubId: github?.id ?? null,
      githubLogin: github?.login ?? null,
      role: rights.role,
      writesSource: rights.writesSource,
      invitedBy,
    });

  if (rights.languages.length > 0) {
    await db()
      .insert(pendingMemberLanguages)
      .values(sorted(rights.languages).map((language) => ({ pendingMemberId: invitationId, language })));
  }

  return { outcome: 'invited', invitationId, by: github ? 'github' : 'email' };
}

/** How many owners a repository has. */
const ownersOf = async (organizationId: string): Promise<number> =>
  (
    await db()
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.organizationId, organizationId), eq(members.role, 'owner')))
  ).length;

/** The member of a repository, or a 404. A member of another repository is not there. */
const memberOf = async (repository: I18nRepository, memberId: string) => {
  const [member] = await db()
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.organizationId, repository.organizationId)));

  if (!member) throw new MemberError(404, 'No member of this repository has this ID.');

  return member;
};

/** Refuses to take the last owner of a repository away. Nobody could then manage it but an admin. */
const keepAnOwner = async (member: { role: string; organizationId: string }): Promise<void> => {
  if (member.role === 'owner' && (await ownersOf(member.organizationId)) === 1) {
    throw new MemberError(409, 'This is the last owner of the repository. Make another member owner first.');
  }
};

/** Changes the rights of a member. An absent field keeps its value. */
export async function changeMember(
  repository: I18nRepository,
  memberId: string,
  change: Partial<MemberRights>,
): Promise<void> {
  const member = await memberOf(repository, memberId);

  if (change.languages) checkLanguages(repository, change.languages);
  if (change.role !== undefined && change.role !== 'owner') await keepAnOwner(member);

  await db().transaction(async (tx) => {
    if (change.role !== undefined || change.writesSource !== undefined) {
      await tx
        .update(members)
        .set({
          ...(change.role !== undefined ? { role: change.role } : {}),
          ...(change.writesSource !== undefined ? { writesSource: change.writesSource } : {}),
        })
        .where(eq(members.id, memberId));
    }

    if (change.languages) {
      await tx.delete(memberLanguages).where(eq(memberLanguages.memberId, memberId));

      if (change.languages.length > 0) {
        await tx.insert(memberLanguages).values(sorted(change.languages).map((language) => ({ memberId, language })));
      }
    }
  });
}

/** Takes a member out of a repository. Its account stays, with its other repositories. */
export async function removeMember(repository: I18nRepository, memberId: string): Promise<void> {
  const member = await memberOf(repository, memberId);

  await keepAnOwner(member);
  await db().delete(members).where(eq(members.id, memberId));
}

/** The invitation of a repository, or a 404. */
const invitationOf = async (repository: I18nRepository, invitationId: string) => {
  const [invitation] = await db()
    .select()
    .from(pendingMembers)
    .where(and(eq(pendingMembers.id, invitationId), eq(pendingMembers.organizationId, repository.organizationId)));

  if (!invitation) throw new MemberError(404, 'No invitation of this repository has this ID.');

  return invitation;
};

/** Changes the rights that an invitation will give. An absent field keeps its value. */
export async function changeInvitation(
  repository: I18nRepository,
  invitationId: string,
  change: Partial<MemberRights>,
): Promise<void> {
  await invitationOf(repository, invitationId);

  if (change.languages) checkLanguages(repository, change.languages);

  await db().transaction(async (tx) => {
    if (change.role !== undefined || change.writesSource !== undefined) {
      await tx
        .update(pendingMembers)
        .set({
          ...(change.role !== undefined ? { role: change.role } : {}),
          ...(change.writesSource !== undefined ? { writesSource: change.writesSource } : {}),
        })
        .where(eq(pendingMembers.id, invitationId));
    }

    if (change.languages) {
      await tx.delete(pendingMemberLanguages).where(eq(pendingMemberLanguages.pendingMemberId, invitationId));

      if (change.languages.length > 0) {
        await tx
          .insert(pendingMemberLanguages)
          .values(sorted(change.languages).map((language) => ({ pendingMemberId: invitationId, language })));
      }
    }
  });
}

/** Cancels an invitation. A magic link already sent then opens a session with no right. */
export async function removeInvitation(repository: I18nRepository, invitationId: string): Promise<void> {
  await invitationOf(repository, invitationId);
  await db().delete(pendingMembers).where(eq(pendingMembers.id, invitationId));
}
