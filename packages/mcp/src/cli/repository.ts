import type { Me, Repository } from '../api.ts';
import { CliError } from './errors.ts';

export const nameOf = (repository: Pick<Repository, 'owner' | 'name'>): string =>
  `${repository.owner}/${repository.name}`;

/** The `owner/name` of each GitHub remote, from the addresses of `git remote -v`. */
export const githubSlugsOf = (remotes: string[]): string[] => {
  const slugs = remotes.flatMap((remote) => {
    const found = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remote.trim());

    return found ? [`${found[1]}/${found[2]}`.toLowerCase()] : [];
  });

  return [...new Set(slugs)];
};

const listOf = (repositories: Repository[]): string[] =>
  repositories.length === 0
    ? ['This account opens no repository.']
    : ['The repositories of this account:', ...repositories.map((repository) => `  ${nameOf(repository)}`)];

/**
 * The repository that a command works on.
 *
 * In this order: the one that `--repo` names, by `owner/name` or by id; the one
 * that a GitHub remote of the folder names; the only repository of the account.
 */
export const pickRepository = (repositories: Repository[], wanted: string | undefined, slugs: string[]): Repository => {
  if (wanted) {
    const found = repositories.find(
      (repository) => repository.id === wanted || nameOf(repository).toLowerCase() === wanted.toLowerCase(),
    );

    if (!found) throw new CliError('I18NE3001', `No repository of this account is ${wanted}.`, listOf(repositories));

    return found;
  }

  const fromGit = repositories.filter((repository) => slugs.includes(nameOf(repository).toLowerCase()));

  if (fromGit.length === 1) return fromGit[0]!;

  if (fromGit.length === 0 && repositories.length === 1) return repositories[0]!;

  if (repositories.length === 0) throw new CliError('I18NE3001', 'This account opens no repository.');

  throw new CliError('I18NE3002', 'Name the repository with --repo <owner/name>.', listOf(repositories));
};

/** The target languages that the account can open in a repository. An admin opens each one. */
export const languagesOpenTo = (me: Me, repository: Repository): string[] => {
  if (me.admin) return repository.targets;

  const membership = me.memberships.find((held) => held.repositoryId === repository.id);

  return repository.targets.filter((language) => membership?.languages.includes(language));
};

/** The language that a command works on: the one named, or the only one the account can open. */
export const pickLanguage = (me: Me, repository: Repository, wanted: string | undefined): string => {
  const open = languagesOpenTo(me, repository);

  if (wanted) {
    if (!repository.targets.includes(wanted)) {
      throw new CliError('I18NE3003', `${nameOf(repository)} does not translate into ${wanted}.`, [
        `Its target languages: ${repository.targets.join(', ') || 'none'}.`,
      ]);
    }

    return wanted;
  }

  if (open.length === 1) return open[0]!;

  throw new CliError('I18NE3003', 'Name the language with --lang <language>.', [
    `The languages this account can open in ${nameOf(repository)}: ${open.join(', ') || 'none'}.`,
  ]);
};
