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

If you change `packages/db/src/schema.ts`, generate the migration with
`pnpm -F @git8n/db db:generate`. Never edit a migration that is already
on `main`.

## Pull requests

- Make a branch from `main` and open the pull request against `main`.
- Keep one change per pull request.
- Write the title and the description in English. Say what changes for a
  translator, a reviewer or an operator, and how you checked it.
- If the change has a visual effect, add a screenshot or a recording.

## Comments in the code

Write a comment only when the code cannot say it: a risk, a reason or a
contract. Use short sentences in the active voice.

## Licence

By contributing, you agree that your contribution is under the
[AGPL-3.0](LICENSE) licence of this repository.
