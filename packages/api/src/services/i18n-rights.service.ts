import { eq } from 'drizzle-orm';
import { i18nTranslators } from '@i18n-editor/db';
import { db } from '@/db';

/**
 * What an account may do to the translations (DB-210).
 *
 * `withAuth` answers one question: is this an admin. The right to write a
 * language is a different one, granted per language by a row of
 * `i18n_translators`.
 *
 * An account with no row is not a translator. An admin with no row reads the
 * catalogue and writes nothing, so an administrator does not become the
 * translator of every language. `mayPropose` and `mayPublish` read that grant
 * on every write (DB-212), and neither covers an admin.
 */
export interface TranslatorRights {
  /**
   * The languages this account may propose in.
   *
   * Empty grants nothing, and is how a translator is set aside without losing
   * the history of what they wrote.
   */
  languages: string[];
  /** A reviewer publishes what a translator proposes. */
  role: 'translator' | 'reviewer';
  /**
   * Whether this account may write the source language (DB-238).
   *
   * No language of `languages` gives it, and neither does the reviewer role:
   * a translator of English does not write the French that English answers.
   */
  writesSource: boolean;
}

/** What the account may do, or nothing when it holds no row. */
export const rightsOf = async (userId: string): Promise<TranslatorRights | null> => {
  const [row] = await db().select().from(i18nTranslators).where(eq(i18nTranslators.userId, userId)).limit(1);

  if (!row) return null;

  return { languages: row.languages, role: row.role, writesSource: row.writesSource };
};

/**
 * The address a batch is authored with, which is not the one of the account.
 *
 * A commit is public and permanent, so a personal address written into
 * `git log` cannot be taken back. This names the account without saying how to
 * reach the person, as GitHub's own `users.noreply` addresses do.
 */
export const authorAddressOf = (userId: string): string => `${userId}@users.noreply.detectivebox.com`;

/** Whether this account may propose in a language: a row that names it. */
export const mayPropose = (rights: TranslatorRights | null, language: string): boolean =>
  rights !== null && rights.languages.includes(language);

/** Whether this account may publish a language: a row that names it, as a reviewer. */
export const mayPublish = (rights: TranslatorRights | null, language: string): boolean =>
  rights !== null && rights.role === 'reviewer' && rights.languages.includes(language);

/**
 * Whether this account may add a key to the source language: a row that says so.
 *
 * An admin with no such row is refused, as for a proposal. To administer is not
 * to write the texts of the product.
 */
export const mayWriteSource = (rights: TranslatorRights | null): boolean => rights !== null && rights.writesSource;
