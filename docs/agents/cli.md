# CLI

::: info Coming
This page describes work in progress. The CLI does not exist yet.
:::

`i18n-editor` is a command line client of the API. It reads and proposes
translations from a terminal, a script or a CI job. It also starts the MCP
server.

## The commands that come first

| Command                                        | What it does                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `i18n-editor login` / `logout`                 | Signs in from the terminal with a code that you approve in the browser.                                         |
| `i18n-editor status`                           | The progress of each language of a repository.                                                                  |
| `i18n-editor keys`                             | The keys of a language. `--missing <language>`, `--values`.                                                     |
| `i18n-editor get <key>`                        | One key: the source, the target and its state.                                                                  |
| `i18n-editor search <text>`                    | The keys whose text contains a value.                                                                           |
| `i18n-editor apply <file>`                     | Proposes a batch from a JSON file, or from stdin with `-`. One batch is one commit. `--dry-run` shows the plan. |
| `i18n-editor proposals`                        | The batches that wait on a language.                                                                            |
| `i18n-editor prompt translate --to <language>` | Prints a prompt that asks an LLM to translate the missing keys.                                                 |
| `i18n-editor mcp`                              | Starts the [MCP server](./mcp.md) over stdio.                                                                   |

Each command takes `--repo` and `--json`. A long listing pages with `--cursor`.
Each error has a stable code and a documented exit code.

Later, `i18n-editor check` reads the locale files of a clone with no server,
and reports the missing keys and the placeholders that differ, for a CI job.
