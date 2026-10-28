# CLI reference

```
i18n-editor <command> [options]
```

[CLI](../agents/cli.md) explains how to install and use it.

## Global options

| Option            | What it does                                                                      |
| ----------------- | --------------------------------------------------------------------------------- |
| `--api <url>`     | The address of the editor. Default: `I18N_EDITOR_API_URL`, then the last `login`. |
| `--json`          | Answers one JSON document on stdout. See [JSON](#json).                           |
| `-h`, `--help`    | Shows the help.                                                                   |
| `-v`, `--version` | Shows the version.                                                                |

A command refuses an option that it does not take, with `I18NE1001`.

## Environment

| Variable                | What it is                                                          |
| ----------------------- | ------------------------------------------------------------------- |
| `I18N_EDITOR_API_URL`   | The address of the editor.                                          |
| `I18N_EDITOR_API_TOKEN` | A token. It takes the place of the token of `login`.                |
| `I18N_EDITOR_REPO`      | The repository, as `--repo`.                                        |
| `XDG_CONFIG_HOME`       | The folder of `i18n-editor/credentials.json`. Default: `~/.config`. |

## Commands

### `login`

Signs in with a device code. Options: `--no-open` does not open the browser.

The code and the address go to stderr. The token goes to the file of the
credentials, never to stdout.

`data`: `{ api, account: { name, email } | null, credentials }`

### `logout`

Ends the session on the API and deletes the token of this computer. An access
token stays valid: revoke it on the page **Jetons d'accès**.

`data`: `{ api, signedOut, revoked }`. `revoked` is false when the API did not
end the session, or for an access token.

### `whoami`

`data`: `{ api, account, via, admin, memberships: [{ repository, repositoryId, role, languages, writesSource }] }`

`via` is `login` or `I18N_EDITOR_API_TOKEN`. `account` is null for an access
token.

### `status`

Options: `--repo`. With a repository (named, or from the git remote), the
progress of each language of it. Else, the progress of each repository of the
account.

`data`: `{ repository: { id, name, branch, source, targets }, languages: [LanguageProgress] }`,
or `{ repositories: [{ id, name, source, targets, languages, error? }] }`.

`LanguageProgress` is `{ language, published, proposed, missing, review, empty?, total }`.

### `keys`

Options: `--repo`, `--lang`, `--state missing|review|translated|all` (default
`all`), `--missing` (the same as `--state missing`), `--file <name>`,
`--values`, `--limit <n>` (default 100, from 1 to 2000), `--cursor <n>`.

`data`: `{ repository, language, source, commit, filesWithNoVersion, total, cursor, nextCursor, entries: [Entry] }`

`Entry` is `{ id, file, key, state, empty? }`. With `--values`, it also holds
`source`, `value` and, for a key to review, `was`. `commit` is the revision
that every value was read at. `nextCursor` is null on the last page.

### `get <file:key>`

Options: `--repo`, `--lang`.

`data`: `{ repository, language, source, commit, entry: Entry, neighbours: [Entry] }`

The neighbours are at most 5 keys of the same file with the same parent path.

### `search <text>`

Options: `--repo`, `--lang`, `--file`, `--limit`, `--cursor`. The CLI reads
the catalogue and keeps the keys whose id, source or translation holds the
text, with no regard to case.

`data`: `{ repository, language, commit, total, cursor, nextCursor, entries: [Entry] }`

### `apply <file|->`

Options: `--repo`, `--lang`, `--file <name>`, `--dry-run`, `--read-at <sha>`.

The input is a JSON object, in one of these forms:

```json
{ "common:hello.title": "Hello" }
{ "common": { "hello": { "title": "Hello" } } }
```

With `--file common`, the object holds the keys of that file only, nested or
dotted. At most 2000 keys change in one proposal.

`data`: `{ repository, language, readAt, changes: [{ id, file, key, from, to }], unchanged: [id], stillToReview: [id], proposed }`

`stillToReview` holds the keys to review whose text the input keeps. A
proposal of the same text changes no file, so the key stays to review: a
reviewer keeps it in the editor.

`proposed` is `{ commit, branch, readAt, keys, files }`, or null after a dry
run or when nothing changed.

### `proposals`

Options: `--repo`, `--lang`.

`data`: `{ repository, language, batches: [{ commit, message, author, at, readAt }] }`

### `prompt translate`

Options: `--to <language>` (or `--lang`), `--repo`, `--state missing|review`
(default `missing`), `--file`, `--limit` (default 50, from 1 to 500),
`--cursor`.

Without `--json`, the CLI writes the prompt, in Markdown.

`data`: `{ repository, language, source, commit, total, cursor, nextCursor, keys: [{ id, source, was?, value?, neighbours }], prompt }`

### `mcp`

Starts the [MCP server](../agents/mcp.md) on stdin and stdout, with the token
of `login` or of `I18N_EDITOR_API_TOKEN`. It writes nothing else on stdout.
It takes no `--json`.

## JSON

With `--json`, stdout holds one JSON document:

```json
{ "data": { … } }
```

or, when the command fails:

```json
{
  "error": {
    "code": "I18NE3002",
    "message": "Name the repository with --repo <owner/name>.",
    "details": ["The repositories of this account:", "  acme/app"]
  }
}
```

Without `--json`, the answer goes to stdout and an error goes to stderr.

## Exit status

| Status | Meaning                                                          |
| ------ | ---------------------------------------------------------------- |
| 0      | Done.                                                            |
| 1      | The API refused, a key is unknown, or the sign-in did not end.   |
| 2      | The command, an option, the configuration or the input is wrong. |
| 3      | No account is signed in, or the API refused the token.           |

## Error codes

| Code        | Status | Meaning                                                                       |
| ----------- | ------ | ----------------------------------------------------------------------------- |
| `I18NE1001` | 2      | The command or an option is wrong.                                            |
| `I18NE1002` | 2      | No address of the API: pass `--api` or set `I18N_EDITOR_API_URL`.             |
| `I18NE1003` | 2      | The input of `apply` is not valid.                                            |
| `I18NE1004` | 2      | The file of the credentials is not valid. Delete it and sign in again.        |
| `I18NE2001` | 3      | No account is signed in, or the API refused the token.                        |
| `I18NE2002` | 1      | The device code expired before somebody approved it.                          |
| `I18NE2003` | 1      | The person refused the device code.                                           |
| `I18NE3001` | 2      | No repository matches.                                                        |
| `I18NE3002` | 2      | The repository is not clear: pass `--repo`.                                   |
| `I18NE3003` | 2      | The language is not clear, or the account cannot open it: pass `--lang`.      |
| `I18NE3004` | 1      | A key is not a key of the source, or its file has no version in the language. |
| `I18NE4001` | 1      | The API refused the request.                                                  |
| `I18NE4002` | 1      | The API failed, or did not answer.                                            |
