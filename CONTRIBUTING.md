# Contributing

## Set up

```sh
pnpm install
```

Use the Node version of `.node-version` and pnpm 11.

## Before you open a pull request

```sh
pnpm typecheck
pnpm test
```

Both must pass. A change of behaviour comes with a test that fails without it.

If you change `packages/cli` or `packages/mcp`, add a changeset with
`pnpm changeset`. [.changeset/README.md](.changeset/README.md) tells how.

If you change `packages/db/src/schema.ts`, generate the migration with
`pnpm -F @git8n/db db:generate`. Never edit a migration that is already
on `main`.

## Pull requests

- Make a branch from `main` and open the pull request against `main`.
- Keep one change per pull request.
- Write the title and the description in English. Say what changes for a
  translator, a reviewer or an operator, and how you checked it.
- If the change has a visual effect, add a screenshot or a recording.

## Release the CLI

`@git8n/cli` goes to npm from a release on GitHub. The editor itself deploys
from `main`, and needs no release.

1. Open a pull request `chore: version x.y.z`. It runs `pnpm changeset version`,
   which writes the version of `packages/cli` and `packages/mcp`, and
   `packages/cli/CHANGELOG.md`. Merge it.
2. On GitHub, « Draft a new release ». Create the tag `vx.y.z` on the merge
   commit, then « Generate release notes » and « Publish release ».
3. The release starts `release-npm.yml`: the checks of CI on the tag, the
   tarball, then the publication. The publication waits until a person approves
   the environment `npm`.

A tag pushed alone starts nothing. A run from « Run workflow » packs and checks,
and publishes nothing, also on a tag. To try a failed release again, use
« Re-run jobs » on its run: a version that npm already has is skipped.

No npm token exists. npm trusts the OIDC token of `release-npm.yml`, in the
environment `npm`, as the trusted publisher of `@git8n/cli`. To set it again,
a person who can publish in the npm org `git8n` runs, with npm 11.5.1 or later:

```sh
npm trust github @git8n/cli --file release-npm.yml \
  --repository sakuga-software/git8n --environment npm --allow-publish
```

## Comments in the code

Write a comment only when the code cannot say it: a risk, a reason or a
contract. Use short sentences in the active voice.

## Licence

By contributing, you agree that your contribution is under the
[AGPL-3.0](LICENSE) licence of this repository.
