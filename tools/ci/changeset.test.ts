import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Change, withoutChangeset } from './changeset.ts';

const changes = (...lines: string[]): Change[] =>
  lines.map((line) => {
    const [status = '', file = ''] = line.split(' ');

    return { status, file };
  });

test('a change to the code of the package needs a changeset', () => {
  assert.deepEqual(withoutChangeset(changes('M packages/mcp/src/cli/check.ts', 'M docs/index.md')), [
    'packages/mcp/src/cli/check.ts',
  ]);
  assert.deepEqual(withoutChangeset(changes('M packages/cli/package.json')), ['packages/cli/package.json']);
});

test('a changeset that the pull request adds or changes lets the change through', () => {
  assert.deepEqual(withoutChangeset(changes('M packages/mcp/src/cli/check.ts', 'A .changeset/brave-owls-sing.md')), []);
  assert.deepEqual(withoutChangeset(changes('M packages/mcp/src/cli/check.ts', 'M .changeset/brave-owls-sing.md')), []);
});

test('a changeset that the pull request deletes is not one', () => {
  assert.deepEqual(withoutChangeset(changes('M packages/cli/src/git8n.ts', 'D .changeset/brave-owls-sing.md')), [
    'packages/cli/src/git8n.ts',
  ]);
});

test('the pull request of a version deletes the changesets and writes the changelog', () => {
  assert.deepEqual(
    withoutChangeset(
      changes(
        'D .changeset/brave-owls-sing.md',
        'M packages/cli/package.json',
        'A packages/cli/CHANGELOG.md',
        'M packages/mcp/package.json',
      ),
    ),
    [],
  );
});

test('the README of .changeset is not a changeset', () => {
  assert.deepEqual(withoutChangeset(changes('M packages/cli/src/git8n.ts', 'M .changeset/README.md')), [
    'packages/cli/src/git8n.ts',
  ]);
});

test('a test, the app and the docs need no changeset', () => {
  assert.deepEqual(
    withoutChangeset(
      changes(
        'M packages/mcp/src/cli/check.spec.ts',
        'M packages/cli/src/git8n.spec.ts',
        'M packages/api/src/app.ts',
        'M packages/web/app/root.tsx',
        'M docs/agents/cli.md',
      ),
    ),
    [],
  );
});
