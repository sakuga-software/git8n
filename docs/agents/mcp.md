# MCP server

`packages/mcp` holds an MCP server. With it, an agent reads the translations
and proposes texts, with no screen and no access to GitHub.

The server translates nothing. It answers the catalogue, and the agent writes
the words. It does not publish either: a person reviews and publishes.

## How it works

The server speaks MCP over stdio. Each tool calls the HTTP API of the editor,
under `/i18n`, with the token of one account. The API checks the rights of that
account on each call: its repositories, its languages and its role. The server
never reaches GitHub or the database, so it has no write path that skips these
checks.

```
agent
  │ stdio
  ▼
MCP server
  │ HTTPS, Authorization: Bearer <token>
  ▼
API /i18n      checks the rights of the account
  │ GitHub App
  ▼
repository
```

## Configure it

The server needs two variables:

| Variable          | What it is                                                          |
| ----------------- | ------------------------------------------------------------------- |
| `GIT8N_API_URL`   | The address of the editor, for example `https://git8n.example.com`. |
| `GIT8N_API_TOKEN` | An access token of the account that the agent acts as.              |

The server sends the token as `Authorization: Bearer <token>`.

Create the token in the editor: account menu, then **Jetons d'accès**.
[Access tokens](./tokens.md) tells how, and what a token can and cannot do.
Give the agent its own token, so that you can revoke it alone.

## Connect it to an agent

With the [CLI](./cli.md), `git8n mcp` starts the server with the token
of `git8n login`, or of `GIT8N_API_TOKEN`:

```json
{
  "mcpServers": {
    "git8n": {
      "command": "node",
      "args": ["--experimental-strip-types", "/path/to/git8n/packages/mcp/src/cli/main.ts", "mcp"]
    }
  }
}
```

Without the CLI, run the server from a clone of the repository, after `pnpm install`:

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

The server writes only the protocol on stdout. It writes its errors on stderr.
If a variable is missing, it stops with a message that names it.

## The tools

| Tool                | What it answers                                                                    |
| ------------------- | ---------------------------------------------------------------------------------- |
| `i18n_repositories` | The repositories, with their source language and their targets.                    |
| `i18n_me`           | What the account of the token may do: its repositories, roles and languages.       |
| `i18n_keys`         | The keys of a language, by state and by file, with the `commit` they were read at. |
| `i18n_key`          | One key: the source text, the target text and its state.                           |
| `i18n_propose`      | Writes a whole batch as **one** commit on `i18n/<language>`.                       |
| `i18n_proposals`    | The batches that wait on a language.                                               |

[MCP tools](../reference/mcp-tools.md) gives the input and the answer of each
tool.

## A typical session

1. `i18n_me`: find the repositories and the languages that the account may
   write.
2. `i18n_keys` with `state: "missing"`: get the first page of keys to
   translate, and its `commit`.
3. `i18n_key` for a key that needs context: the file and the dotted path tell
   what the text is for.
4. `i18n_propose` with every text and the `commit` of step 2 as `readAt`.
5. `i18n_proposals`: check that the batch waits on the language. A reviewer
   then publishes it in the editor.

## Two rules

**Carry the `commit` back.** `i18n_keys` and `i18n_key` answer the revision
that they read. `i18n_propose` takes it as `readAt`. A publication uses it to
refuse a key whose source changed after the proposal. The tool refuses a value
that is not a full SHA of 40 characters. Do not invent one.

**One call is one commit.** Send the texts of one language in one
`i18n_propose`, up to 2000 keys, and not one call for each key.

Every page of one listing answers the revision of the first page, so a long
catalogue does not mix two revisions in one batch. Do not mix the values of two
listings in one call: a batch carries one `readAt`.

## Errors

A tool does not throw when the API refuses. It answers `isError` with the
status and the message of the API, for example
`403 — This account may not propose in de.` The agent reads the reason and can act on it.

## What the server does not do

- **Publish.** A reviewer approves a translation. That is a judgement, and the
  API refuses a publication from an account that is not a reviewer.
- **Add a key to the source.** A person writes the texts of the product. An
  agent translates them.
- **Keep a translation after its source changed.** A reviewer does it in the
  editor.
