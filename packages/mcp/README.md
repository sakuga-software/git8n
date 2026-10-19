# `@i18n-editor/mcp`

An MCP server that lets an agent read the translations and propose them, without
a screen and without any access to GitHub (DB-211).

## What it needs

Two variables, and no password:

```
I18N_EDITOR_API_URL=https://i18n.example.com
I18N_EDITOR_API_TOKEN=…
```

The token is the `accessToken` that `POST /auth/login` answers, against the
account's own credentials. It lasts fourteen days. The server never holds a
password, and it acts as that account: its languages and its role are what the
API enforces.

```sh
curl -s -X POST "$I18N_EDITOR_API_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"…","password":"…"}' | jq -r .accessToken
```

## Wiring it to an agent

```json
{
  "mcpServers": {
    "i18n-editor": {
      "command": "node",
      "args": ["--experimental-strip-types", "packages/mcp/src/main.ts"],
      "env": {
        "I18N_EDITOR_API_URL": "https://i18n.example.com",
        "I18N_EDITOR_API_TOKEN": "…"
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
