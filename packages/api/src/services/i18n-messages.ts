import type { I18nRepository } from '@i18n-editor/db';
import { countKeys, messageOf } from '@i18n-editor/db/messages';

/**
 * The messages the editor writes on GitHub, in the formats of the repository (DB-609).
 *
 * `@i18n-editor/db/messages` holds the formats and the variables. This file
 * gives each variable its value.
 */

type Repository = Pick<
  I18nRepository,
  'owner' | 'name' | 'branch' | 'proposalCommitTemplate' | 'publicationCommitTemplate'
>;

const where = (repository: Pick<I18nRepository, 'owner' | 'name' | 'branch'>) => ({
  repository: `${repository.owner}/${repository.name}`,
  branch: repository.branch,
});

/** The subject of a proposal. The git service adds the `Read-at:` trailer under it. */
export const proposalSubject = (
  repository: Repository,
  language: string,
  count: number,
  author: { name: string },
): string =>
  messageOf('proposalCommit', repository.proposalCommitTemplate, {
    language,
    count: String(count),
    count_keys: countKeys(count),
    author: author.name,
    ...where(repository),
  });

/** The subject of a publication, or of the keys that `POST /keys` creates in the source. */
export const publicationSubject = (
  repository: Repository,
  language: string,
  count: number,
  action: 'published' | 'created',
  author: { name: string },
): string =>
  messageOf('publicationCommit', repository.publicationCommitTemplate, {
    language,
    count: String(count),
    count_keys: countKeys(count),
    action,
    author: author.name,
    ...where(repository),
  });
