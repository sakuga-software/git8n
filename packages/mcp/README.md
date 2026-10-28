# `@git8n/mcp`

The typed client of the API, and the two commands built on it:

- `git8n`, the CLI (DB-671): `src/cli/main.ts`. See the
  [CLI](../../docs/agents/cli.md) and its [reference](../../docs/reference/cli.md).
- An MCP server that lets an agent read the translations and propose them,
  without a screen and without any access to GitHub (DB-211): `src/main.ts`,
  or `git8n mcp`.

## What it needs

Two variables, and no password:

```
GIT8N_API_URL=https://git8n.example.com
GIT8N_API_TOKEN=…
```

The token is an **access token** of an account. Make it in the editor: open
the account menu at the top right, then **Jetons d'accès**, and choose a name
and a life (30 days, 90 days, one year, or no end). The page shows the token
one time only: copy it then. The editor keeps its SHA-256 and never the token.

The token acts as its account: its repositories, its languages and its role
are what the API enforces. Revoke it on the same page when the agent stops.
The server never holds a password.

A token can read and propose, as its account does. It cannot make or revoke
a token: only the session of the browser does that.

## Wiring it to an agent

```json
{
  "mcpServers": {
    "git8n": {
      "command": "node",
      "args": ["--experimental-strip-types", "packages/mcp/src/main.ts"],
      "env": {
        "GIT8N_API_URL": "https://git8n.example.com",
        "GIT8N_API_TOKEN": "…"
      }
    }
  }
}
```

## What it offers

| tool                | what it answers                                                                      |
| ------------------- | ------------------------------------------------------------------------------------ |
| `i18n_repositories` | the repositories, their source language and their targets                            |
| `i18n_me`           | what this token may do: which languages, and whether it reviews                      |
| `i18n_keys`         | the keys of a language by state and by file, **with the `commit` they were read at** |
| `i18n_key`          | one key: what the source says, what the target says, its state                       |
| `i18n_propose`      | a whole batch as **one** commit on `i18n/<language>`                                 |
| `i18n_proposals`    | the batches waiting on a language                                                    |

## Two rules worth knowing before writing one

**Carry the `commit` back.** `i18n_keys` and `i18n_key` answer the revision the
values were read at, and `i18n_propose` takes it as `readAt`. That is what lets
a publication refuse a key whose **source** changed since it was proposed
(DB-212). Inventing one switches that check off, so the tool refuses anything
that is not a full sha.

**One call is one commit.** An agent that translates three hundred keys sends
them in one `i18n_propose`, not in three hundred.

Every page of one listing answers the revision the first page was read at, so
paging a long catalogue cannot mix two of them into one batch. Do not mix the
values of two separate listings in one call either: a batch carries a single
`readAt`.

## What it does not do

It does not translate: it answers the catalogue, and the agent writes the words.

It does not publish either. A reviewer approving a translation is a judgement,
and the screen that asks for it is DB-213 — the API refuses a publication from
an account that is no reviewer in any case.

**Nothing here reaches a service directly.** Every call goes through `/i18n`,
where the rights of DB-210 live. A server that imported the services would carry
those rules in its own discipline instead, and there would be a write path that
does not pass them.
