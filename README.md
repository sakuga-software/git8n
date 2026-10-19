# i18n-editor

An editor for the translations of a product. Its source of truth is the JSON
locale files in a GitHub repository. Translators propose texts, reviewers
publish them, and each publication is a commit on the repository, made by a
GitHub App.

The editor keeps no text of its own. Its database holds three things:

- the repositories it translates;
- the accounts, which sign in with GitHub;
- the rights of each account.

## Packages

| Package        | What it is                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/web` | The page: React Router as a single-page application, Tailwind v4 and HeroUI v3.                        |
| `packages/api` | The API: Hono on Node. It holds the routes `/i18n/*`, the catalogue, the proposals and the GitHub App. |
| `packages/mcp` | The typed client of the API, which the page also uses, and an MCP server for agents.                   |
| `packages/db`  | The Drizzle schema of the tables, and their migrations.                                                |

## Run it locally

You need Node 24 (see `.node-version`), pnpm 11, a PostgreSQL server, and two
things on GitHub:

- **An OAuth App**, for the sign-in. Its callback URL is
  `http://localhost:5173/api/auth/callback/github`.
- **A GitHub App**, which reads and writes the repositories.

```sh
pnpm install

# Create the tables.
DATABASE_URL=postgres://user:password@localhost:5432/i18n pnpm -F @i18n-editor/db migrate

# Start the API on port 8001.
DATABASE_URL=postgres://user:password@localhost:5432/i18n \
GITHUB_CLIENT_ID=<client ID of the OAuth App> \
GITHUB_CLIENT_SECRET=<client secret of the OAuth App> \
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

In production, the API serves the built page itself: set `WEB_ROOT` to
`packages/web/build/client`. The page and the API then have one origin, and
the browser needs no CORS.

| Variable                  | Package | What it is                                                                                             |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`            | api, db | The PostgreSQL server.                                                                                 |
| `DATABASE_TLS`            | api     | `true` to connect with TLS when the URL does not say so.                                               |
| `PORT`                    | api     | The port of the API. The default is 8001.                                                              |
| `BETTER_AUTH_URL`         | api     | The address of the editor, as the browser reads it. The default is `http://localhost:5173`.            |
| `BETTER_AUTH_SECRET`      | api     | At least 32 characters. It signs the sessions and encrypts the GitHub tokens. Required in production.  |
| `GITHUB_CLIENT_ID`        | api     | The client ID of the OAuth App of the sign-in.                                                         |
| `GITHUB_CLIENT_SECRET`    | api     | The client secret of that OAuth App.                                                                   |
| `ADMIN_EMAILS`            | api     | The addresses of the admins, separated by commas. See [Accounts and rights](#accounts-and-rights).     |
| `WEB_ROOT`                | api     | The folder of the built page. When it is set, the API serves the page.                                 |
| `COMMIT_EMAIL_DOMAIN`     | api     | The domain of the address a commit gives its author. See [docs/repositories.md](docs/repositories.md). |
| `I18N_GITHUB_APP_ID`      | api     | The ID of the GitHub App that reads and writes the repositories.                                       |
| `I18N_GITHUB_PRIVATE_KEY` | api     | The private key of that App, in PEM format.                                                            |

## Accounts and rights

A person signs in with GitHub. The first sign-in creates the account, and the
account opens nothing:

- **An admin** sets the repositories up. An account is an admin if its address
  is in `ADMIN_EMAILS` and GitHub says that the address is verified. The
  address is the public address of the GitHub profile, or the primary address
  if the profile shows none. The editor reads it again at each sign-in, so a
  change on GitHub counts at the next sign-in.
- **A translator** proposes in the languages of its row of `i18n_translators`.
- **A reviewer** also publishes these languages.
- **The source language** needs `writes_source` on the row.

To administer gives no right to write a language. An admin grants the rights in
the database for now:

```sql
insert into i18n_translators (user_id, languages, role)
select id, '{en}', 'reviewer' from users where lower(email) = 'translator@example.com';
```

## Documentation

- [A repository and its locale files](docs/repositories.md): the layout, the
  fields of a repository, the format of the manifest and the author of a commit.
- [The GitHub App](docs/github-app.md): its permissions, and how to create it.

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
