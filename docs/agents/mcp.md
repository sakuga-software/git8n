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

`npx -y @git8n/cli mcp` starts the server, with Node 22 or later. It takes the
session of `git8n login` on the same computer, or the variables
`GIT8N_API_URL` and `GIT8N_API_TOKEN`. [CLI](./cli.md#sign-in) tells how to
sign in.

### Let your agent do it

Copy this prompt into your agent. It tells the agent how to sign in, add the
server to its client and check the connection, and which commands do not
exist.

<CopyPrompt />

### Add it by hand

Each tab adds the server for the person, in all their projects. A file in a
project, such as `.cursor/mcp.json` or `.vscode/mcp.json`, adds it to that
project only. With a `git8n login` on the same computer, leave out the
variables.

::: code-group

```sh [Claude Code]
claude mcp add --scope user git8n -- npx -y @git8n/cli mcp

# With an access token and no login. The name comes before --env:
# --env takes every KEY=value that follows it.
claude mcp add --scope user git8n \
  --env GIT8N_API_URL=https://git8n.example.com \
  --env GIT8N_API_TOKEN=g8n_… \
  -- npx -y @git8n/cli mcp
```

```json [Cursor]
{
  "mcpServers": {
    "git8n": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@git8n/cli", "mcp"],
      "env": {
        "GIT8N_API_URL": "https://git8n.example.com",
        "GIT8N_API_TOKEN": "${env:GIT8N_API_TOKEN}"
      }
    }
  }
}
```

```sh [VS Code]
code --add-mcp '{"name":"git8n","type":"stdio","command":"npx","args":["-y","@git8n/cli","mcp"]}'

# Or in .vscode/mcp.json, for one workspace:
# {
#   "servers": {
#     "git8n": { "type": "stdio", "command": "npx", "args": ["-y", "@git8n/cli", "mcp"] }
#   }
# }
```

```toml [Codex]
[mcp_servers.git8n]
command = "npx"
args = ["-y", "@git8n/cli", "mcp"]
env = { GIT8N_API_URL = "https://git8n.example.com" }
env_vars = ["GIT8N_API_TOKEN"]
```

```json [Claude Desktop]
{
  "mcpServers": {
    "git8n": {
      "command": "npx",
      "args": ["-y", "@git8n/cli", "mcp"],
      "env": {
        "GIT8N_API_URL": "https://git8n.example.com",
        "GIT8N_API_TOKEN": "g8n_…"
      }
    }
  }
}
```

```txt [Others]
transport  stdio
command    npx
args       -y @git8n/cli mcp
env        GIT8N_API_URL    the address of the editor
           GIT8N_API_TOKEN  an access token, if there is no git8n login
```

:::

The files:

- **Cursor**: `~/.cursor/mcp.json`, or `.cursor/mcp.json` for one project.
- **VS Code**: `code --add-mcp` writes the configuration of the user profile.
  `.vscode/mcp.json` is for one workspace.
- **Codex**: `~/.codex/config.toml`, or `codex mcp add git8n -- npx -y @git8n/cli mcp`.
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`
  on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Quit and
  start the app again after a change.

Do not commit a token in a project file. In Cursor, `${env:GIT8N_API_TOKEN}`
reads it from your shell. In Codex, `env_vars` forwards it from your shell.

### Check the connection

| Client         | Check                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| Claude Code    | `claude mcp list` shows `git8n` as connected. In a session, `/mcp` lists its tools.        |
| Cursor         | The server shows in **Customize**. Its errors are in the panel Output, under « MCP Logs ». |
| VS Code        | Ask the agent to call a tool of `git8n`, then expand the tool call in the conversation.    |
| Codex          | `codex mcp list` shows `git8n`. In the terminal UI, `/mcp` lists the active servers.       |
| Claude Desktop | Quit and start the app again. The server shows under « Connectors ».                       |

Then ask the agent to call `i18n_me`. It answers the account of the token or
of the login, and what it may do. An error answers a code, for example
`G8N2001` when nobody is signed in: [Error codes](../reference/errors/) gives
each one.

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

[Translate a new language with Claude Code](./translate-with-claude-code.md)
and [Review and publish a batch](./review-a-batch.md) go through it step by step.

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
