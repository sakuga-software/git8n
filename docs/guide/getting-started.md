# Getting started

i18n-editor is an editor for the translations of a product. Its source of truth
is the JSON locale files in a GitHub repository. Translators propose texts,
reviewers publish them, and each publication is a commit on the repository,
made by a GitHub App.

The editor keeps no text of its own. Its database holds three things:

- the repositories it translates;
- the accounts;
- the rights of each account in each repository.

## The packages

| Package        | What it is                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/web` | The page: React Router as a single-page application, Tailwind v4 and HeroUI v3.                        |
| `packages/api` | The API: Hono on Node. It holds the routes `/i18n/*`, the catalogue, the proposals and the GitHub App. |
| `packages/mcp` | The typed client of the API, which the page also uses, the CLI, and an MCP server for agents.          |
| `packages/db`  | The Drizzle schema of the tables, and their migrations.                                                |
| `docs`         | This site.                                                                                             |

## Run it locally

You need:

- Node 26 (see `.node-version`);
- pnpm 12 (`corepack enable` reads the version from `package.json`);
- a PostgreSQL server;
- **a GitHub App**, which signs a person in and reads and writes the
  repositories. For local work, create a second App whose callback URL is
  `http://localhost:5173/api/auth/callback/github`.
  [The GitHub App](../operate/github-app.md) says how.

```sh
pnpm install

# Create the tables.
DATABASE_URL=postgres://user:password@localhost:5432/i18n pnpm -F @i18n-editor/db migrate

# Start the API on port 8001.
DATABASE_URL=postgres://user:password@localhost:5432/i18n \
GITHUB_CLIENT_ID=<client ID of the GitHub App> \
GITHUB_CLIENT_SECRET=<client secret of the GitHub App> \
ADMIN_EMAILS=you@example.com \
I18N_GITHUB_APP_ID=<id of the GitHub App> \
I18N_GITHUB_PRIVATE_KEY="$(cat app.private-key.pem)" \
pnpm -F @i18n-editor/api dev

# Start the page on port 5173. Vite passes /api and /i18n to the API.
pnpm -F @i18n-editor/web dev
```

Open `http://localhost:5173`, the address of `BETTER_AUTH_URL`, and not the
port of the API: the session cookie belongs to the address that the browser
reads.

**To sign in before the App exists**, ask for a link by email with an address
of `ADMIN_EMAILS`. Without `SMTP_URL`, the API sends no mail. Outside
production, it writes the link in its log. Open that link. You then reach
« Brancher un dépôt », which needs the App.

[Deploy](../operate/deploy.md) lists every variable of the API.

## Connect a repository

1. Sign in with an address of `ADMIN_EMAILS`.
2. Click « Brancher un dépôt ». GitHub opens the installation page of the App.
   Install it on the repository.
3. GitHub sends you back to the editor. Pick the repository. The editor finds
   the folder of the locale files, the languages and the manifest. Check the
   form, then click « Brancher ce dépôt ».
4. The table of the repository opens. You are its owner.

[A repository and its files](./repositories.md) gives the layout of the files
and every field of a repository.

## Give the rights

An account opens nothing until somebody gives it rights. Open « Réglages »,
then « Membres », and add a person by address or by GitHub login.
[Accounts and rights](./accounts.md) gives the roles.

## Translate

1. Open a repository and pick a language.
2. Write the missing texts. The editor sends them as a proposal: one commit on
   the branch `i18n/<language>`.
3. A reviewer reads the proposals and publishes them. The publication writes
   them on the base branch, by commit or by pull request.

[Concepts](./concepts.md) explains each step.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm -F @i18n-editor/docs dev   # this site, on port 5208
```

The tests of the API run on PGlite, a PostgreSQL in memory. They need no server.
