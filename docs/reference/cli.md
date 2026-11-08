---
description: Every command, option, environment variable and exit status of the git8n CLI.
---

# CLI reference

```
git8n <command> [options]
```

[CLI](../agents/cli.md) explains how to install and use it.

## Global options

| Option            | What it does                                                                |
| ----------------- | --------------------------------------------------------------------------- |
| `--api <url>`     | The address of the editor. Default: `GIT8N_API_URL`, then the last `login`. |
| `--json`          | Answers one JSON document on stdout. See [JSON](#json).                     |
| `-h`, `--help`    | Shows the help.                                                             |
| `-v`, `--version` | Shows the version.                                                          |

A command refuses an option that it does not take, with `G8N1001`.

## Environment

| Variable          | What it is                                                    |
| ----------------- | ------------------------------------------------------------- |
| `GIT8N_API_URL`   | The address of the editor.                                    |
| `GIT8N_API_TOKEN` | A token. It takes the place of the token of `login`.          |
| `GIT8N_REPO`      | The repository, as `--repo`.                                  |
| `XDG_CONFIG_HOME` | The folder of `git8n/credentials.json`. Default: `~/.config`. |

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

`via` is `login` or `GIT8N_API_TOKEN`. `account` is null for an access
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
of `login` or of `GIT8N_API_TOKEN`. It writes nothing else on stdout.
It takes no `--json`.

### `check`

Reads the locale files of the folder where it runs, with no API and no login,
and reports what is wrong in them. [In CI](../agents/cli.md#in-ci) shows a
workflow.

| Option                | What it does                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--locales <folder>`  | The folder of the languages. Default: the first of `locales`, `src/locales`, `public/locales`, `src/i18n/locales`, `i18n`.   |
| `--manifest <file>`   | The manifest. Default: `<locales>/manifest.json`, if it exists.                                                              |
| `--source <language>` | The source language. Default: the `source` of the manifest.                                                                  |
| `--lang <a,b>`        | The languages to check. Default: every folder of `<locales>` past the source.                                                |
| `--syntax <name>`     | `i18next` (the default: i18next and ICU MessageFormat) or `vue-i18n`: also the linked messages `@:key` and the `\|` plurals. |
| `--reporter <name>`   | `pretty` (the default), `json` (as `--json`) or `github`: one annotation of GitHub Actions for each problem.                 |
| `--max-warnings <n>`  | Fails past `n` warnings. Default: no limit.                                                                                  |

It applies the rules of the editor ([A repository and its files](../guide/repositories.md)):
the dotted keys of i18next, the files that the manifest disables, and the keys
it marks empty on purpose.

[The rules of `check`](./rules/) gives each rule, with its level, an invalid and a valid
example, and the output of the check on them. Each problem names its rule, and
the report ends with the address of the page of each rule it found.

A placeholder is `{{name}}`, `{name}`, `{0}`, `$t(…)`, a tag such as `<0>` or
`<br/>`, or `%s`. With `--syntax vue-i18n`, a linked message such as
`@:common.ok` is one too ([vue-i18n](../formats/libraries.md#vue-i18n)). The branches of an ICU plural are text: `{count, plural, one {# item}}`
holds `{count}` only.

A plural follows i18next: `items_one` and `items_other` are the forms of
`items`. Each language needs the forms of its own rules (`Intl.PluralRules`):
Polish needs `_few` and `_many`, Japanese only `_other`. A form that only a
number past 9999 takes, such as the `_many` of French, is allowed and not
needed. A form other than
`_other` can leave out `{{count}}`: « One item ».

The exit status is 1 on an error, or past `--max-warnings`, else 0. A wrong
setup is `G8N1005`, with the status 2.

`data`: `{ locales, source, languages, files, keys, errors, warnings, maxWarnings, failed, problems: [{ rule, severity, path, language, key, message, docs }] }`. `docs` is the address of the page of the rule.

## JSON

With `--json`, stdout holds one JSON document:

```json
{ "data": { … } }
```

or, when the command fails:

```json
{
  "error": {
    "code": "G8N3002",
    "message": "Name the repository with --repo <owner/name>.",
    "details": ["The repositories of this account:", "  acme/app"],
    "docs": "https://git8n.sakuga.dev/docs/reference/errors/g8n3002.html"
  }
}
```

Without `--json`, the answer goes to stdout and an error goes to stderr.

## Exit status

| Status | Meaning                                                                        |
| ------ | ------------------------------------------------------------------------------ |
| 0      | Done.                                                                          |
| 1      | The API refused, a key is unknown, the sign-in did not end, or `check` failed. |
| 2      | The command, an option, the configuration or the input is wrong.               |
| 3      | No account is signed in, or the API refused the token.                         |

## Error codes

[The error codes](./errors/) gives each code, with its exit status and what to
do. The CLI prints the address of the page of the code after the error, and
`--json` gives it as `error.docs`.
