# Translate a new language with Claude Code

This page takes a language from nothing to a proposal, with Claude Code and the
[MCP server](./mcp.md). The agent proposes. A person reads the batch and
publishes it: [Review and publish a batch](./review-a-batch.md).

## 1. Give the language to the repository

An admin opens « Réglages » in the editor and adds the language to « Langues,
la source en premier ». The source stays first.

## 2. Give the language to the account of the agent

The agent acts as one account, with its rights. In « Réglages », then
« Membres », give that account the role « Traducteur » and the new language.
A translator proposes, and cannot publish. [Accounts and rights](../guide/accounts.md)
gives the roles.

Give the agent an account, or a token, of its own: you can then revoke it
alone. [Access tokens](./tokens.md) tells how.

## 3. Connect Claude Code

With a token of the account of the agent:

```sh
claude mcp add git8n --scope user \
  --env GIT8N_API_URL=https://git8n.example.com \
  --env GIT8N_API_TOKEN=g8n_… \
  -- npx -y @git8n/cli mcp
claude mcp list
```

`claude mcp list` must show `git8n` as connected. After a `git8n login` on the
same computer, leave out the two `--env`: the server then uses your session,
and acts as your account.

## 4. Ask for the translation

Name the repository and the language, and the rules of the product:

> Translate the missing keys of `<owner>/<name>` into German with the git8n MCP
> server. Keep the placeholders such as `{{name}}` and the tags such as `<0>`.
> Use the formal « Sie ». Propose every key in one batch.

The agent then calls the tools in this order:

1. `i18n_me`: the repositories and the languages that the account can write.
2. `i18n_repositories`: the `id` of the repository.
3. `i18n_keys` with `state: "missing"`: 200 keys for each page, and the
   `commit` that they were read at. The agent reads each page while `more` is
   `true`.
4. `i18n_key`, for a key that needs its context.
5. `i18n_propose`, with every text and the `commit` of step 3 as `readAt`. One
   call is one commit on the branch `i18n/<language>`, up to 2000 keys.
6. `i18n_proposals`: the batch waits on the language.

[MCP tools](../reference/mcp-tools.md) gives the input and the answer of each
tool.

## 5. Check the batch before the review

`git8n check` reads the locale files of a clone, with no server. It finds a
translation that loses a placeholder of its source. Run it on the branch of the
proposal:

```sh
git fetch origin i18n/de && git switch i18n/de
npx @git8n/cli check --lang de
```

A batch with an error is a batch to propose again, before a reviewer reads it.
