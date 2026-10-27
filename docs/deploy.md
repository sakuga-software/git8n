# Deploy the editor

A deployment has two images. Build both from the root of the repository: pnpm
needs the workspace files.

| Image      | Dockerfile                | What it runs                                                                                          |
| ---------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `app`      | `packages/api/Dockerfile` | The API on `PORT`. It also serves the built page, so the page and the API have one origin.            |
| `migrator` | `packages/db/Dockerfile`  | `dist/migrate.mjs` on `DATABASE_URL`. It applies the migrations that are not applied yet, then stops. |

```sh
docker build -f packages/api/Dockerfile -t i18n-editor .
docker build -f packages/db/Dockerfile -t i18n-editor-migrator .
```

- The `app` image runs as the user `node`, listens on port 8001, and has a
  `HEALTHCHECK` on `/health`.
- The `migrator` image holds one bundle and the SQL files, on a distroless
  Node image, as a user that is not root. It has no shell, no pnpm and no
  drizzle-kit.

The migrator keeps the journal of drizzle-kit: the table
`drizzle.__drizzle_migrations`, with the `when` of `meta/_journal.json` and the
same hash of each file. A database that `drizzle-kit migrate` updated gets only
the migrations that came after.

## Dokploy

Two applications from the same repository and branch, with the build type
**Dockerfile** and no build stage:

| Application | Dockerfile path           | Docker context path | Watch paths                        |
| ----------- | ------------------------- | ------------------- | ---------------------------------- |
| `app`       | `packages/api/Dockerfile` | `.`                 | none: every push deploys it        |
| `migrator`  | `packages/db/Dockerfile`  | `.`                 | `packages/db/**`, `pnpm-lock.yaml` |

The `migrator` has no domain, and its restart policy is « none »: it stops
after it applies the migrations.

## Order of a deployment

1. Run the `migrator` to its end. It stops with the code 0 when the database
   is up to date, and it is safe to run again.
2. Then start or restart the `app`.

**Run the migrator first.** A new version of the `app` can read a column that
only its migration adds.

## Behind a proxy

Put the `app` behind a reverse proxy that terminates TLS and sets
`X-Forwarded-For` to the address of the client, as Traefik does. The sign-in
limits the number of requests for each client address, and it reads the
address from that header. Without the header, all the clients share one limit.

## Variables of the `app`

| Variable                  | Required | What it is                                                                                                                                              | Example                                            |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `DATABASE_URL`            | yes      | The PostgreSQL server.                                                                                                                                  | `postgresql://i18n:secret@i18n-postgres:5432/i18n` |
| `DATABASE_TLS`            | no       | `true` to connect with TLS when the URL does not say so. The default is `false`.                                                                        | `true`                                             |
| `BETTER_AUTH_URL`         | yes      | The address of the editor, as the browser reads it. GitHub sends the browser back to it after the sign-in.                                              | `https://i18n.sakuga.dev`                          |
| `BETTER_AUTH_SECRET`      | yes      | At least 32 characters. It signs the sessions and encrypts the GitHub tokens. The app refuses to start without it.                                      | the output of `openssl rand -hex 32`               |
| `GITHUB_CLIENT_ID`        | yes      | The client ID of the GitHub App, for the sign-in.                                                                                                       | `Iv23li…`                                          |
| `GITHUB_CLIENT_SECRET`    | yes      | The client secret of the GitHub App.                                                                                                                    | a secret from the App settings                     |
| `I18N_GITHUB_APP_ID`      | yes      | The ID of the GitHub App, for the repositories.                                                                                                         | `1234567`                                          |
| `I18N_GITHUB_PRIVATE_KEY` | yes      | The private key of the GitHub App, in PEM format. Write the newlines as they are, or as `\n`.                                                           | `-----BEGIN RSA PRIVATE KEY-----\n…`               |
| `ADMIN_EMAILS`            | yes      | The addresses of the admins, separated by commas. GitHub must say that each address is verified.                                                        | `alice@example.com,bob@example.com`                |
| `COMMIT_EMAIL_DOMAIN`     | no       | The domain of the address a commit gives its author. The default is `users.noreply.invalid`.                                                            | `users.noreply.example.com`                        |
| `SMTP_URL`                | no       | The SMTP server that sends the magic links to invited people (DB-645). Without it, no mail leaves, and an invited person without GitHub cannot sign in. | `smtps://user:password@smtp.example.com:465`       |
| `MAIL_FROM`               | no       | The sender of the mails. The default is `Traductions <no-reply@<host of BETTER_AUTH_URL>>`.                                                             | `Traductions <no-reply@example.com>`               |
| `GITHUB_APP_SLUG`         | no       | The name of the GitHub App in its address, `github.com/apps/<slug>`. The page links to its installation page.                                           | `i18n-editor`                                      |
| `PORT`                    | no       | The port of the API. The image sets 8001.                                                                                                               | `8001`                                             |
| `WEB_ROOT`                | no       | The folder of the built page. The image sets `/app/web`.                                                                                                | `/app/web`                                         |

[`github-app.md`](github-app.md) says how to create the App and get its four
values. The callback URL of the App must be `BETTER_AUTH_URL` followed by
`/api/auth/callback/github`.

## Variables of the `migrator`

| Variable       | Required | What it is                                                                | Example                                            |
| -------------- | -------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| `DATABASE_URL` | yes      | The same server as the `app`. For TLS, add `?sslmode=require` to the URL. | `postgresql://i18n:secret@i18n-postgres:5432/i18n` |

## Check a deployment

- `GET /health` answers `200` and `{"status":"ok"}`.
- `GET /` answers the page.
- `GET /i18n/me` answers `401` without a session.
- « Se connecter avec GitHub » opens GitHub, then comes back to the editor.
