import { execFileSync } from 'node:child_process';

/**
 * Whether a pull request that changes the npm package carries a changeset (DB-688).
 *
 * `@git8n/cli` bundles the code of `@git8n/mcp`, so a change to either reaches npm. `changeset
 * version` writes the version and the changelog from the files in `.changeset/`. A change with no
 * changeset reaches no changelog, and a user reads that nothing changed.
 *
 * Only a pull request is read: its checkout is the merge commit, and the first parent of that
 * commit is the head of its base. So `HEAD^1..HEAD` is what the pull request changes.
 *
 *   node tools/ci/changeset.ts <event>
 *
 * exits 1, with the reason, when the package changed and no changeset came with the change.
 */

/** The directories whose code goes into the npm package. */
export const PUBLISHED: readonly string[] = ['packages/cli/', 'packages/mcp/'];

/** A file that a user of the package can get: in a published directory, and not a test. */
export const isPublished = (file: string): boolean =>
  PUBLISHED.some((directory) => file.startsWith(directory)) && !/\.(spec|test)\.ts$/.test(file);

/** One line of `git diff --name-status`: `A`, `M` or `D`, and the path. */
export interface Change {
  status: string;
  file: string;
}

/** A changeset is one Markdown file in `.changeset/`. The README of the directory is not one. */
export const isChangeset = (file: string): boolean =>
  /^\.changeset\/[^/]+\.md$/.test(file) && file !== '.changeset/README.md';

/**
 * Whether the changes carry a changeset.
 *
 * A changeset that the pull request deletes counts only in the pull request of a version:
 * `changeset version` deletes the changesets and writes `packages/cli/CHANGELOG.md`.
 * Else a pull request could delete an old changeset and add none.
 */
const carriesChangeset = (changes: readonly Change[]): boolean =>
  changes.some(({ status, file }) => isChangeset(file) && status !== 'D') ||
  (changes.some(({ status, file }) => isChangeset(file) && status === 'D') &&
    changes.some(({ file }) => file === 'packages/cli/CHANGELOG.md'));

/** The published files that changed, if no changeset came with them. Empty means that the check passes. */
export const withoutChangeset = (changes: readonly Change[]): string[] =>
  carriesChangeset(changes) ? [] : changes.map(({ file }) => file).filter(isPublished);

const changedOnTopOfBase = (): Change[] =>
  execFileSync('git', ['diff', '--name-status', '--no-renames', 'HEAD^1', 'HEAD'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [status = '', file = ''] = line.split('\t');

      return { status, file };
    });

const main = ([event = '']: string[]): void => {
  if (event !== 'pull_request') return;

  const missing = withoutChangeset(changedOnTopOfBase());

  if (missing.length === 0) return;

  console.error(
    [
      'This pull request changes the npm package @git8n/cli, and adds no changeset:',
      ...missing.map((file) => `  ${file}`),
      'Run `pnpm changeset` and commit the file that it writes. If a user of the package cannot see',
      'the change, run `pnpm changeset --empty`.',
    ].join('\n'),
  );
  process.exitCode = 1;
};

if (import.meta.main) main(process.argv.slice(2));
