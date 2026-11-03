# Troubleshooting

Each title is a symptom. Find yours, then follow the link to the page that
explains the cause.

## The editor still shows the old commit after a merge on GitHub

The API holds what it reads of a repository for up to five minutes. A push to
the repository, a merge on GitHub included, makes the API drop it, but only
when the **webhook** of the GitHub App reaches the API. An open page reads
again every 30 seconds, and then shows the new commit.

If the commit is still old after a minute:

- Open **Advanced** in the settings of the App. Each delivery shows there, with
  the answer of the API: `200` for a push. A failed delivery shows its error.
- Check that the API has `GITHUB_WEBHOOK_SECRET`, with the same value as the
  App. Without it, the API takes no event, and a change shows after the five
  minutes of the cache.

[The GitHub App](../operate/github-app.md#what-it-may-do) describes the webhook.

## The mail of an invitation, or of a sign-in link, does not arrive

- **No `SMTP_URL`.** Without it, the API sends no mail. Outside production, it
  writes the mail in its log, with the link. In production, it writes only that
  no mail left.
- **A Scaleway server.** Scaleway blocks the outbound ports 465 and 587: the
  connection waits, and no mail leaves. Scaleway TEM also listens on 2465 and
  2587: `smtps://<project id>:<secret key>@smtp.tem.scaleway.com:2465`.
- **An address that may not receive a link.** The editor sends a link to an
  address of `ADMIN_EMAILS`, to an invited address, and to the verified address
  of a member. Any other address gets no mail, and the page shows the same
  answer, so that it does not tell which addresses are known.
- **An old link.** A link works one time, and expires after 5 minutes. Ask for
  a new one.

Look in the spam folder too. [Deploy](../operate/deploy.md#variables-of-the-app)
lists the variables of the API.

## My access token, `i18e_…`, does not work any more

The tokens of the editor start with `g8n_` since the editor became git8n. The
API reads a token with another prefix as no token, and refuses the request. The
CLI then stops with `G8N2001`.

Create a new token on the page « Jetons d'accès », and revoke the old one.
If you signed in with the old CLI, `i18n-editor login`, run `git8n login`: the
CLI now keeps its session in `~/.config/git8n/credentials.json`, and does not
read the old file.
[Access tokens](../agents/tokens.md) tells how.

## « Brancher un dépôt » does not list my repository

The page lists only the repositories that an installation of the GitHub App
reaches. An installation on « Only select repositories » reaches only the
repositories that somebody picked.

On GitHub, an owner of the account that holds the repository opens the
installation of the App (for an organisation: **Settings → GitHub Apps →
git8n → Configure**), adds the repository, and saves. Then open « Brancher un
dépôt » again. [The GitHub App](../operate/github-app.md#connect-a-repository)
gives each step.

## A publication through a pull request fails

The App needs the permission « Pull requests » to open the pull request of a
publication, and each installation must accept it. Until then, the editor
answers 503, and the header of the repository says « Permission « Pull
requests » manquante ». A repository that publishes by commit keeps working.

[Add the permission « Pull requests »](../operate/github-app.md#add-pull-requests)
gives the two steps.

## Locally, I sign in, and the editor does not keep my session

Open the page on `http://localhost:5173`, the address of `BETTER_AUTH_URL`,
and not on the port of the API, 8001. The session cookie belongs to the
address that the browser reads. [Run it locally](../operate/self-host.md#start-it)
gives the commands.

## `git8n check` cannot find the locales

The CLI stops with `G8N1005` and exit status 2. With no `--locales`, it tries
`locales`, `src/locales`, `public/locales`, `src/i18n/locales` and `i18n`, in
that order. It also needs a source language: `--source <language>`, or
`"source"` in the manifest.

Run it from the root of the clone, or pass `--locales <folder>` and
`--source <language>`. [The CLI reference](../reference/cli.md#check) gives
every option, and [the error codes](../reference/errors/) every code.
