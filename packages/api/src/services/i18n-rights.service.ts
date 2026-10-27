import { and, eq } from 'drizzle-orm';
import { i18nRepositories, memberLanguages, members, type MemberRole } from '@i18n-editor/db';
import { env } from '@/config/env';
import { db } from '@/db';
import { roleMay } from '@/permissions';

/**
 * What an account may do to the translations of one repository (DB-210, DB-637).
 *
 * `withAuth` answers one question: is this an admin. The right to write a
 * language is a different one. A member row of the organization of the
 * repository grants it, with one row of `member_languages` for each language.
 *
 * An account with no member row is not a translator of that repository. An
 * admin with no row reads the catalogue and writes nothing, so an
 * administrator does not become the translator of every language.
 * `mayPropose` and `mayPublish` read that grant on every write (DB-212), and
 * neither covers an admin.
 */
export interface TranslatorRights {
  /**
   * The languages this account may propose in.
   *
   * Empty grants nothing, and is how a translator is set aside without losing
   * the history of what they wrote.
   */
  languages: string[];
  /** A reviewer publishes what a translator proposes. An owner also manages the members. */
  role: MemberRole;
  /**
   * Whether this account may write the source language (DB-238).
   *
   * No language of `languages` gives it, and neither does a role: a translator
   * of English does not write the French that English answers.
   */
  writesSource: boolean;
}

/** The rights of an account in one repository, with the repository they belong to. */
export interface Membership extends TranslatorRights {
  repositoryId: string;
}

/** Every repository where the account is a member, and what it may do in each. */
export const membershipsOf = async (userId: string, repositoryId?: string): Promise<Membership[]> => {
  const rows = await db()
    .select({
      memberId: members.id,
      repositoryId: i18nRepositories.id,
      role: members.role,
      writesSource: members.writesSource,
      language: memberLanguages.language,
    })
    .from(members)
    .innerJoin(i18nRepositories, eq(i18nRepositories.organizationId, members.organizationId))
    .leftJoin(memberLanguages, eq(memberLanguages.memberId, members.id))
    .where(
      repositoryId
        ? and(eq(members.userId, userId), eq(i18nRepositories.id, repositoryId))
        : eq(members.userId, userId),
    );

  const byMember = new Map<string, Membership>();

  for (const row of rows) {
    const held = byMember.get(row.memberId) ?? {
      repositoryId: row.repositoryId,
      role: row.role as MemberRole,
      writesSource: row.writesSource,
      languages: [],
    };

    if (row.language) held.languages.push(row.language);
    byMember.set(row.memberId, held);
  }

  return [...byMember.values()].map((membership) => ({ ...membership, languages: membership.languages.sort() }));
};

/** What the account may do in a repository, or nothing when it is not a member. */
export const rightsOf = async (userId: string, repositoryId: string): Promise<TranslatorRights | null> => {
  const [membership] = await membershipsOf(userId, repositoryId);

  if (!membership) return null;

  const { languages, role, writesSource } = membership;

  return { languages, role, writesSource };
};

/**
 * The address a batch is authored with, which is not the one of the account.
 *
 * A commit is public and permanent, so a personal address written into
 * `git log` cannot be taken back. This names the account without saying how to
 * reach the person, as GitHub's own `users.noreply` addresses do.
 *
 * WARNING: do not use `users.noreply.github.com` with an ID of this editor.
 * GitHub then gives the commit to the GitHub account that has that name.
 */
export const authorAddressOf = (userId: string, domain = env.COMMIT_EMAIL_DOMAIN): string => `${userId}@${domain}`;

/** Whether this account may propose in a language: a member row that names it. */
export const mayPropose = (rights: TranslatorRights | null, language: string): boolean =>
  rights !== null && roleMay(rights.role, { translation: ['propose'] }) && rights.languages.includes(language);

/** Whether this account may publish a language: a member row that names it, with a role that publishes. */
export const mayPublish = (rights: TranslatorRights | null, language: string): boolean =>
  rights !== null && roleMay(rights.role, { translation: ['publish'] }) && rights.languages.includes(language);

/**
 * Whether this account may add a key to the source language: a member row that says so.
 *
 * An admin with no such row is refused, as for a proposal. To administer is not
 * to write the texts of the product.
 */
export const mayWriteSource = (rights: TranslatorRights | null): boolean => rights !== null && rights.writesSource;

/** Whether this account may add, change and remove the members of a repository: an admin, or an owner. */
export const mayManageMembers = (admin: boolean, rights: TranslatorRights | null): boolean =>
  admin || (rights !== null && roleMay(rights.role, { member: ['create', 'update', 'delete'] }));
