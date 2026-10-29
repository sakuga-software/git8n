import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withoutChangeset } from './changeset.ts';

test('a change to the code of the package needs a changeset', () => {
  assert.deepEqual(withoutChangeset(['packages/mcp/src/cli/check.ts', 'docs/index.md']), [
    'packages/mcp/src/cli/check.ts',
  ]);
  assert.deepEqual(withoutChangeset(['packages/cli/package.json']), ['packages/cli/package.json']);
});

test('a changeset lets the change through', () => {
  assert.deepEqual(withoutChangeset(['packages/mcp/src/cli/check.ts', '.changeset/brave-owls-sing.md']), []);
});

test('the README of .changeset is not a changeset', () => {
  assert.deepEqual(withoutChangeset(['packages/cli/src/git8n.ts', '.changeset/README.md']), [
    'packages/cli/src/git8n.ts',
  ]);
});

test('a test, the app and the docs need no changeset', () => {
  assert.deepEqual(
    withoutChangeset([
      'packages/mcp/src/cli/check.spec.ts',
      'packages/cli/src/git8n.spec.ts',
      'packages/api/src/app.ts',
      'packages/web/app/root.tsx',
      'docs/agents/cli.md',
    ]),
    [],
  );
});
