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

/** A changeset is one Markdown file in `.changeset/`. The README of the directory is not one. */
export const isChangeset = (file: string): boolean =>
  /^\.changeset\/[^/]+\.md$/.test(file) && file !== '.changeset/README.md';

/** The published files that changed, if no changeset came with them. Empty means that the check passes. */
export const withoutChangeset = (changed: readonly string[]): string[] =>
  changed.some(isChangeset) ? [] : changed.filter(isPublished);

const changedOnTopOfBase = (): string[] =>
  execFileSync('git', ['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '');

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
