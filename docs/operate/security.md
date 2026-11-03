# Security

This page lists what can go wrong around the tokens, the agents and the
GitHub App, and what stops it. Each threat has three parts: the attack, the
risks, and the mitigation.

## Where the rights are checked

The API checks the rights of an account on each request: its repositories,
its languages and its role. These rights are rows of the database, read again
on every write.

The MCP server and the CLI are clients of this API, like the page. **They are
not a security boundary.** They hold no right of their own, and they never
reach GitHub or the database. A client that you change, or replace, can do no
more than the account of its token.

The API reaches GitHub through the GitHub App, never with the token of a
person. A sign-in with GitHub leaves the token of that sign-in in the database,
encrypted with `BETTER_AUTH_SECRET`, but no route of the API uses it to read or
write a repository.

## A token that somebody steals

**Attack.** Somebody copies an access token `g8n_…` from a CI log, a shell
history or an agent configuration. Or they copy the file of `git8n login`.

**Risks.** The token acts as its account, with all its rights, until it
expires or somebody revokes it:

- a translator's token proposes texts in the languages of that translator;
- a reviewer's token also publishes to the base branch;
- an owner's token also adds and removes members.

A token cannot create, list or revoke a token, and cannot approve a device
code. Only the session of the browser can. So a stolen token cannot make
another token that outlives it.

**Mitigation.**

- **Give each agent its own account**, with the smallest role that does the
  job. An agent that only proposes needs a translator, in its languages only.
  A token of your own account carries your role.
- **Give a token a life.** A token lives 30 days, 90 days, one year, or has no
  end. The longest life with an end is 365 days. Choose the shortest that
  works.
- **Revoke it** on the page « Jetons d'accès » as soon as it leaks, or when the
  agent stops. The API deletes the row: the next request with that token gets
  `401`.
- **Watch the last use.** The page shows the day each token was last used. A
  token that you do not use and that shows a recent use is a stolen token.
- The API keeps only the SHA-256 of a token, and its first characters to name
  it. A copy of the database gives no usable token.
- `git8n login` keeps its session in `~/.config/git8n/credentials.json`
  (`$XDG_CONFIG_HOME/git8n` if set). The CLI writes the folder with mode
  `0700` and the file with mode `0600`: only your account of the computer
  reads them. The session ends after 14 days without use. `git8n logout` ends
  it on the API and deletes it from the file.
- In CI, put the token in a secret of the CI, never in the workflow file.

[Access tokens](../agents/tokens.md) tells how to create and revoke one.

## An agent that proposes a harmful text

**Attack.** An agent writes a translation that is wrong on purpose or by
mistake: a text that misleads the reader, a lost placeholder, or markup that
the product renders as HTML. The agent can follow instructions hidden in a
text that it reads, for example a source text or a comment of the repository.

**Risks.** A proposal is any string. The API checks the shape of a batch (the
file, the key, the language, the revision that the agent read), not the
meaning of a text. If the text reaches the base branch, the product shows it
to its users.

**Mitigation.**

- **An agent proposes, a person publishes.** A proposal is one commit on the
  branch `i18n/<language>`, not on the base branch. The MCP server has no tool
  that publishes. A reviewer reads each text in the editor, and publishes or
  refuses it.
- **Give the agent a translator's account.** A reviewer's token could publish
  through the API, with no person in between.
- **Run `git8n check` in CI** on the base branch, or on the pull request of a
  publication. It fails on a translation that loses or adds a placeholder.
  [CLI](../agents/cli.md#in-ci) gives a workflow.
- **Publish by pull request** on a repository with protected branches. Then
  the review rules of the repository apply to each publication too.
  [A repository and its files](../guide/repositories.md#how-a-publication-reaches-the-base-branch)
  tells the two modes apart.
- In the product, escape a translation like any other text. A translation that
  holds markup must go through a component that allows only the tags you
  expect, for example `<Trans>` of react-i18next.

## A member that you remove

**Attack.** A person leaves the team, but keeps a session in a browser, a
session of `git8n login`, or an access token.

**Risks.** The session and the tokens stay valid for the account. Without a
member row, they open nothing in that repository.

**Mitigation.**

- **Remove the member** in « Réglages », then « Membres ». The API reads the
  rights again on each request, so the removal applies to the next request,
  in every session and with every token of that account. The account keeps
  its other repositories.
- To stop the account everywhere, remove it from each repository. Its tokens
  then reach nothing. The person can still revoke them, but you cannot revoke
  the tokens of another account.
- The history stays: the commits of the person stay in the repository, with
  their author.

## The private key of the GitHub App leaks

**Attack.** Somebody reads `I18N_GITHUB_PRIVATE_KEY` from the environment of
the server, a backup, or a file that somebody committed.

**Risks.** With the key and the ID of the App, an attacker acts as the App on
every installation: they read the repositories that it reaches, and write to
them with the permissions of the App (« Contents », and « Pull requests » if
you gave it). This goes around the editor and its rights.

**Mitigation.**

- **Install the App on « Only select repositories »**, and only on the
  repositories that you translate.
- **Protect the base branch** and publish by pull request. A write to a
  protected branch then needs a review on GitHub too.
- Keep the key in the secret store of the host, never in a repository or an
  image.
- **If the key leaks:** in the settings of the App on GitHub, generate a new
  private key, put it in `I18N_GITHUB_PRIVATE_KEY`, redeploy, then delete the
  old key. GitHub refuses the old key as soon as you delete it.

[The GitHub App](./github-app.md) lists its permissions, and why it needs each.

## A webhook event that GitHub did not send

**Attack.** Somebody sends requests to `/api/github/webhook`, which is public.

**Risks.** An event that the API accepts empties what it holds of a
repository, so that the next read goes to GitHub again. An event writes
nothing. If the API accepted unsigned events, a flood of them would make each
read slow, and use the rate limit of the App on GitHub.

**Mitigation.**

- The API checks the signature `X-Hub-Signature-256` of each event against
  `GITHUB_WEBHOOK_SECRET`, in constant time. An event with a wrong signature
  gets `401` and empties nothing.
- **Without `GITHUB_WEBHOOK_SECRET`, the route does not exist**: it answers
  `404`. The editor then shows a change made on GitHub after the five minutes
  of its cache.
- Use a long random secret. The API refuses one shorter than 16 characters.
