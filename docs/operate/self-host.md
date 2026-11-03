---
description: 'Run the editor on your own computer: the packages, the commands and the checks.'
---

# Run it locally

This page is for a person who runs the editor on their own computer: to try
it, to develop it, or before a [deployment](./deploy.md). To use an editor that
somebody already runs, see [Getting started](../guide/getting-started.md).

## The packages

| Package        | What it is                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/web` | The page: React Router as a single-page application, Tailwind v4 and HeroUI v3.                        |
| `packages/api` | The API: Hono on Node. It holds the routes `/i18n/*`, the catalogue, the proposals and the GitHub App. |
| `packages/mcp` | The typed client of the API, which the page also uses, the CLI, and an MCP server for agents.          |
| `packages/cli` | The npm package `@git8n/cli`: the CLI and the MCP server of `packages/mcp`, in one file.               |
| `packages/db`  | The Drizzle schema of the tables, and their migrations.                                                |
| `docs`         | This site.                                                                                             |

## Start it

You need:

- Node 26 (see `.node-version`);
- pnpm 12 (`corepack enable` reads the version from `package.json`);
- a PostgreSQL server;
- **a GitHub App**, which signs a person in and reads and writes the
  repositories. For local work, create a second App whose callback URL is
  `http://localhost:5173/api/auth/callback/github`.
  [The GitHub App](./github-app.md) says how.

```sh
pnpm install

# Create the tables.
DATABASE_URL=postgres://user:password@localhost:5432/i18n pnpm -F @git8n/db migrate

# Start the API on port 8001.
DATABASE_URL=postgres://user:password@localhost:5432/i18n \
GITHUB_CLIENT_ID=<client ID of the GitHub App> \
GITHUB_CLIENT_SECRET=<client secret of the GitHub App> \
ADMIN_EMAILS=you@example.com \
I18N_GITHUB_APP_ID=<id of the GitHub App> \
I18N_GITHUB_PRIVATE_KEY="$(cat app.private-key.pem)" \
pnpm -F @git8n/api dev

# Start the page on port 5173. Vite passes /api and /i18n to the API.
pnpm -F @git8n/web dev
```

Open `http://localhost:5173`, the address of `BETTER_AUTH_URL`, and not the
port of the API: the session cookie belongs to the address that the browser
reads.

**To sign in before the App exists**, ask for a link by email with an address
of `ADMIN_EMAILS`. Without `SMTP_URL`, the API sends no mail. Outside
production, it writes the link in its log. Open that link. You then reach
« Brancher un dépôt », which needs the App.

Then follow [Getting started](../guide/getting-started.md) from step 2.

[Deploy](./deploy.md) lists every variable of the API.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm -F @git8n/docs demo  # the demo of the home page, built once
pnpm -F @git8n/docs dev   # this site, on port 5208
```

The tests of the API run on PGlite, a PostgreSQL in memory. They need no server.
