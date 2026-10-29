# Changesets

A pull request that changes the npm package `@git8n/cli` adds one file here. The
package bundles `packages/mcp`, so a change to `packages/cli` or `packages/mcp`
counts, a test excepted. The `changeset` job of CI fails without the file.

```sh
pnpm changeset          # asks for the bump and one sentence for the changelog
pnpm changeset --empty  # a change that a user of the package cannot see
```

Write the sentence for a person who installs the package, not for the reviewer.
It goes into `packages/cli/CHANGELOG.md`.

`@git8n/cli` and `@git8n/mcp` have one version (`fixed` in `config.json`).
[CONTRIBUTING.md](../CONTRIBUTING.md#release-the-cli) gives the steps of a release.
