# i18n-editor

An editor for the translations of a product. Its source of truth is the JSON
locale files in a GitHub repository. Translators propose texts, reviewers
publish them, and each publication is a commit on the repository, made by a
GitHub App.

The editor keeps no text of its own. Its database holds two things:

- the repositories it translates;
- the rights of each account.

> **Status:** the code comes out of the Detective Box monorepo. The editor has
> no sign-in yet, so the API refuses every request with 401. Some defaults
> still name Detective Box.

## Packages

| Package         | What it is                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------- |
| `packages/web`  | The page: React Router as a single-page application, Tailwind v4 and HeroUI v3.                |
| `packages/api`  | The API: Hono on Node. It holds the routes `/i18n/*`, the catalogue, the proposals and the GitHub App. |
| `packages/mcp`  | The typed client of the API, which the page also uses, and an MCP server for agents.           |
| `packages/db`   | The Drizzle schema of the two tables, and their migrations.                                    |

## Run it locally

You need Node 24 (see `.node-version`), pnpm 11 and a PostgreSQL server.

```sh
pnpm install

# Create the tables.
DATABASE_URL=postgres://user:password@localhost:5432/i18n pnpm -F @i18n-editor/db migrate

# Start the API on port 8001.
DATABASE_URL=postgres://user:password@localhost:5432/i18n \
KNOWN_HOSTS=http://localhost:5173 \
I18N_GITHUB_APP_ID=<id of the App> \
I18N_GITHUB_PRIVATE_KEY="$(cat app.private-key.pem)" \
pnpm -F @i18n-editor/api dev

# Start the page on port 5173.
VITE_API=http://localhost:8001 pnpm -F @i18n-editor/web dev
```

| Variable                  | Package | What it is                                                         |
| ------------------------- | ------- | ------------------------------------------------------------------ |
| `DATABASE_URL`            | api, db | The PostgreSQL server.                                             |
| `DATABASE_TLS`            | api     | `true` to connect with TLS when the URL does not say so.           |
| `PORT`                    | api     | The port of the API. The default is 8001.                          |
| `KNOWN_HOSTS`             | api     | The origins that the page is served from, separated by commas.     |
| `I18N_GITHUB_APP_ID`      | api     | The ID of the GitHub App that reads and writes the repositories.   |
| `I18N_GITHUB_PRIVATE_KEY` | api     | The private key of that App, in PEM format.                        |
| `VITE_API`                | web     | The address of the API. Vite writes it into the build.             |

## Checks

```sh
pnpm typecheck
pnpm test
```

The tests of the API run on PGlite, a PostgreSQL in memory. They need no server.

## Licence

[GNU Affero General Public License v3.0](LICENSE). If you run a changed
version of this editor as a service, you must publish your changes to the
users of that service.
