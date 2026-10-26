import type { I18nRepository } from '@i18n-editor/db';
import { ask, GithubError, insideRepository, installationToken } from '@/services/github-app.service';

/**
 * The pull request that carries the publications of a protected repository (DB-606).
 *
 * In the mode `pull_request`, a publication is a commit on one branch,
 * `i18n/publish`, and one pull request takes that branch to the base branch.
 * A second publication adds a commit to the same branch, so the pull request
 * grows rather than a second one opening. After a merge or a close, the next
 * publication starts the branch again from the base branch.
 */

/** The branch the publications of a protected repository go to. */
export const PUBLISH_BRANCH = 'i18n/publish';

/**
 * The installation does not grant what the mode needs.
 *
 * An App that gains a permission keeps its old one on every installation until
 * an owner of that installation accepts the new one. Until then GitHub refuses
 * the token, or the call. The route answers 503: an operator acts, not the
 * person who publishes.
 */
export class MissingPermissionError extends Error {
  constructor(repository: I18nRepository, permission: string) {
    super(
      `The GitHub App on ${repository.owner}/${repository.name} does not grant « ${permission} ». ` +
        `An owner of installation ${repository.installationId} must accept the new permission in the settings of the installation on GitHub.`,
    );

    this.name = 'MissingPermissionError';
  }
}

/** The branch of the publications cannot take the base branch in: both changed the same lines. */
export class PublishConflictError extends Error {
  constructor(repository: I18nRepository, cause: unknown) {
    super(
      `${PUBLISH_BRANCH} and ${repository.branch} of ${repository.owner}/${repository.name} changed the same lines. ` +
        'Resolve the conflict of the pull request on GitHub, or close it, then publish again.',
      { cause },
    );

    this.name = 'PublishConflictError';
  }
}

/**
 * Whether GitHub refused for a permission that the installation lacks.
 *
 * A token asked with a permission the installation lacks answers 422. A call
 * the token cannot make answers 403 « Resource not accessible by integration ».
 */
export const isMissingPermission = (error: unknown): boolean =>
  error instanceof GithubError &&
  ((error.status === 422 && /permission/i.test(error.message)) ||
    (error.status === 403 && /not accessible by integration/i.test(error.message)));

/**
 * A token for the writes of a publication.
 *
 * The mode `pull_request` also asks for `pull_requests: write`, and no other
 * mode does: a repository that publishes by commit keeps working on an
 * installation that never accepted the new permission.
 */
export const publishToken = async (repository: I18nRepository): Promise<string> => {
  const permissions: Record<string, 'read' | 'write'> =
    repository.publishMode === 'pull_request' ? { contents: 'write', pull_requests: 'write' } : { contents: 'write' };

  try {
    return await installationToken(repository.installationId, { repository: repository.name, permissions });
  } catch (error) {
    if (isMissingPermission(error)) throw new MissingPermissionError(repository, 'Pull requests: write');

    throw error;
  }
};

/** A pull request of the publications, as the editor shows it. */
export interface PublishPull {
  number: number;
  url: string;
  state: 'open' | 'merged' | 'closed';
  /** Null while GitHub computes it, and for a pull request that is not open. */
  mergeable: boolean | null;
}

interface GithubPull {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  mergeable?: boolean | null;
}

const repoPath = (repository: I18nRepository) => `/repos/${insideRepository(repository.owner, repository.name)}`;

const pullsOf = (repository: I18nRepository, token: string, state: 'open' | 'all') =>
  ask<GithubPull[]>(
    `${repoPath(repository)}/pulls?head=${encodeURIComponent(`${repository.owner}:${PUBLISH_BRANCH}`)}` +
      `&base=${encodeURIComponent(repository.branch)}&state=${state}&sort=created&direction=desc&per_page=1`,
    token,
  ).catch((error: unknown) => {
    if (isMissingPermission(error)) throw new MissingPermissionError(repository, 'Pull requests: write');

    throw error;
  });

const summaryOf = (pull: GithubPull): PublishPull => ({
  number: pull.number,
  url: pull.html_url,
  state: pull.merged_at ? 'merged' : pull.state,
  mergeable: pull.state === 'open' ? (pull.mergeable ?? null) : null,
});

/** The open pull request of the publications, or nothing. */
export const openPullOf = async (repository: I18nRepository, token: string): Promise<GithubPull | null> =>
  (await pullsOf(repository, token, 'open'))[0] ?? null;

/**
 * The last pull request of the publications, open or not.
 *
 * A merged one stays the answer until the next publication opens another, so
 * the page can say « fusionnée » after the merge.
 */
export const lastPullOf = async (repository: I18nRepository, token: string): Promise<PublishPull | null> => {
  const [last] = await pullsOf(repository, token, 'all');

  if (!last) return null;
  if (last.state !== 'open') return summaryOf(last);

  // The listing leaves `mergeable` out. Only the pull request itself says it.
  return summaryOf(await ask<GithubPull>(`${repoPath(repository)}/pulls/${last.number}`, token));
};

/** One line of a publication commit that names a key: `- en common:hints.title`. */
const KEY_LINE = /^- ([A-Za-z0-9_-]+) ([A-Za-z0-9_-]+):(\S+)$/;

/** How many keys a commit message names before it says how many more. */
const KEYS_IN_A_MESSAGE = 100;

/** The message of a publication commit: the summary, then one line per key. */
export const publicationMessage = (
  summary: string,
  language: string,
  keys: Array<{ file: string; key: string }>,
): string => {
  const lines = keys.slice(0, KEYS_IN_A_MESSAGE).map((row) => `- ${language} ${row.file}:${row.key}`);
  const more = keys.length - lines.length;

  return [summary, '', ...lines, ...(more > 0 ? [`… and ${more} more`] : [])].join('\n');
};

/**
 * The title and the body of the pull request, from the commits it carries.
 *
 * They are written again after each publication, from git alone: the commits
 * between the base branch and the branch of the publications say what the pull
 * request holds. A merge of the base branch into it names no key, and is left out.
 */
export const describePull = (messages: string[]): { title: string; body: string } => {
  const byLanguage = new Map<string, Set<string>>();
  let unnamed = 0;

  for (const message of messages) {
    if (!message.startsWith('i18n(')) continue;

    for (const line of message.split('\n').slice(1)) {
      const match = line.match(KEY_LINE);

      if (match) {
        const keys = byLanguage.get(match[1]) ?? new Set<string>();

        keys.add(`${match[2]}:${match[3]}`);
        byLanguage.set(match[1], keys);
      }

      const more = line.match(/^… and (\d+) more$/);

      if (more) unnamed += Number(more[1]);
    }
  }

  const languages = [...byLanguage.keys()].sort();
  const count = languages.reduce((total, language) => total + byLanguage.get(language)!.size, 0) + unnamed;
  const title = `i18n: ${count} ${count === 1 ? 'key' : 'keys'} published${languages.length > 0 ? ` (${languages.join(', ')})` : ''}`;
  const body = [
    'Translations published from the translation editor. Each commit names the person who published it.',
    '',
    ...languages.flatMap((language) => [
      `### ${language}`,
      '',
      ...[...byLanguage.get(language)!].sort().map((key) => `- \`${key}\``),
      '',
    ]),
    ...(unnamed > 0 ? [`And ${unnamed} more keys, named in the commits.`, ''] : []),
  ].join('\n');

  return { title, body };
};

/**
 * Opens the pull request of the publications, or writes the title and the body
 * of the one already open.
 */
export const ensurePull = async (repository: I18nRepository, token: string): Promise<PublishPull> => {
  const compared = await ask<{ commits: Array<{ commit: { message: string } }> }>(
    `${repoPath(repository)}/compare/${insideRepository(repository.branch)}...${insideRepository(PUBLISH_BRANCH)}`,
    token,
  );
  const { title, body } = describePull(compared.commits.map((row) => row.commit.message));
  const open = await openPullOf(repository, token);

  try {
    const pull = open
      ? await ask<GithubPull>(`${repoPath(repository)}/pulls/${open.number}`, token, 'PATCH', { title, body })
      : await ask<GithubPull>(`${repoPath(repository)}/pulls`, token, 'POST', {
          title,
          body,
          head: PUBLISH_BRANCH,
          base: repository.branch,
        });

    return summaryOf(pull);
  } catch (error) {
    if (isMissingPermission(error)) throw new MissingPermissionError(repository, 'Pull requests: write');

    throw error;
  }
};

/**
 * Takes the base branch into the branch of the publications.
 *
 * The base branch moves between two publications. The pull request still
 * merges while nothing conflicts, but a key published since reads against an
 * old source. A merge keeps the branch built on the base branch. A conflict is
 * reported, never forced: forcing would drop a publication a reviewer made.
 *
 * It answers the new head of the branch, or the old one when nothing was to merge.
 */
export const mergeBaseInto = async (repository: I18nRepository, token: string, head: string): Promise<string> => {
  try {
    const merged = await ask<{ sha?: string } | null>(`${repoPath(repository)}/merges`, token, 'POST', {
      base: PUBLISH_BRANCH,
      head: repository.branch,
      commit_message: `Merge ${repository.branch} into ${PUBLISH_BRANCH}`,
    });

    return merged?.sha ?? head;
  } catch (error) {
    if (error instanceof GithubError && error.status === 409) throw new PublishConflictError(repository, error);

    throw error;
  }
};
