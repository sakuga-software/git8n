import type { Repository } from '@i18n-editor/mcp/api';

/**
 * The pages of GitHub that show what the editor reads (DB-242).
 *
 * The host is assumed. A row of `i18n_repositories` names an owner and a name,
 * and the API talks to `api.github.com` alone. This is the one place where the
 * editor says so.
 */
const HOST = 'https://github.com';

/** Each segment is encoded. A branch keeps its slashes: `i18n/en` is one branch, in two segments. */
const path = (...segments: string[]): string =>
  segments
    .flatMap((segment) => segment.split('/'))
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');

type Named = Pick<Repository, 'owner' | 'name'>;

export const repositoryUrl = (repository: Named): string => `${HOST}/${path(repository.owner, repository.name)}`;

export const branchUrl = (repository: Named & Pick<Repository, 'branch'>): string =>
  `${repositoryUrl(repository)}/tree/${path(repository.branch)}`;

export const commitUrl = (repository: Named, commit: string): string =>
  `${repositoryUrl(repository)}/commit/${path(commit)}`;

/**
 * One locale file as the editor read it.
 *
 * It names the commit and not the branch. The branch moves, and the page would
 * then show a text the table does not.
 */
export const fileUrl = (
  repository: Named & Pick<Repository, 'localesPath'>,
  commit: string,
  language: string,
  file: string,
): string => `${repositoryUrl(repository)}/blob/${path(commit, repository.localesPath, language, `${file}.json`)}`;
