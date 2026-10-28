# MCP tools

Each tool answers one text block that holds JSON. When the API refuses, the
tool answers `isError: true` and the text `<status> — <message>`.

`repository` is always the `id` of a repository, from `i18n_repositories`.
`language` is a tag such as `fr` or `pt-BR`. `file` is a file name such as
`common`, never a path.

## `i18n_repositories`

The repositories that the account can read. An admin reads all of them. Any
other account reads the repositories where it is a member.

**Input:** none.

**Answer:** a list of repositories.

| Field           | What it is                                     |
| --------------- | ---------------------------------------------- |
| `id`            | The identifier that the other tools take.      |
| `owner`, `name` | The repository on GitHub.                      |
| `branch`        | The base branch.                               |
| `localesPath`   | The folder of the locale files.                |
| `manifestPath`  | The manifest, from the root of the repository. |
| `publishMode`   | `commit` or `pull_request`.                    |
| `source`        | The source language.                           |
| `targets`       | The other languages.                           |

## `i18n_me`

What the account of the token may do. A token gives the rights of its account, and
no more ([Access tokens](../agents/tokens.md)).

**Input:** none.

**Answer:**

```json
{
  "admin": false,
  "memberships": [{ "repositoryId": "…", "role": "translator", "languages": ["en", "de"], "writesSource": false }]
}
```

`role` is `translator`, `reviewer` or `owner`. A translator proposes. A
reviewer or an owner also publishes, in the editor.

## `i18n_keys`

The keys of one language, 200 for each answer.

**Input:**

| Field        | Required | What it is                                                |
| ------------ | -------- | --------------------------------------------------------- |
| `repository` | yes      | The repository.                                           |
| `language`   | yes      | The language to read.                                     |
| `state`      | no       | `missing` (the default), `review`, `translated` or `all`. |
| `file`       | no       | Only the keys of this file.                               |
| `offset`     | no       | Where the page starts. The default is 0.                  |

**Answer:**

| Field                | What it is                                                                           |
| -------------------- | ------------------------------------------------------------------------------------ |
| `commit`             | The revision of the base branch that the values come from. Send it back as `readAt`. |
| `source`             | The source language.                                                                 |
| `language`           | The language read.                                                                   |
| `total`              | How many keys match the filter.                                                      |
| `offset`, `returned` | Where the page starts, and how many keys it holds.                                   |
| `more`               | `true` if another page follows. Call again with `offset + returned`.                 |
| `filesWithNoVersion` | The files that this language does not have. They take no proposal.                   |
| `entries`            | The keys. See below.                                                                 |

Each entry:

| Field    | What it is                                                                    |
| -------- | ----------------------------------------------------------------------------- |
| `file`   | The file of the key.                                                          |
| `key`    | The dotted path of the key.                                                   |
| `source` | The source text now.                                                          |
| `value`  | The text of the language on the base branch, or `null`.                       |
| `state`  | `missing`, `translated` or `review`.                                          |
| `was`    | For `review` only: the source text that the translation answers.              |
| `empty`  | `true` if the key is left empty on purpose in this language. `value` is `""`. |

The server holds one reading of a catalogue for 5 minutes. Every page of a
listing answers the `commit` of the first page.

## `i18n_key`

One key, with its context.

**Input:** `repository`, `language`, `file`, `key` (the dotted path). All are
required.

**Answer:** `{ "found": true, "commit": "…", "source": "fr", "entry": { … } }`,
with the same `entry` as `i18n_keys`.

If the key does not exist, or if the file has no version in the language, the
answer is `{ "found": false, "reason": "…" }`.

## `i18n_propose`

Writes a batch as one commit on the branch `i18n/<language>`. It publishes
nothing.

**Input:**

| Field        | Required | What it is                                                                 |
| ------------ | -------- | -------------------------------------------------------------------------- |
| `repository` | yes      | The repository.                                                            |
| `language`   | yes      | The language of the texts.                                                 |
| `readAt`     | yes      | The `commit` of the listing that the texts answer. A SHA of 40 characters. |
| `values`     | yes      | From 1 to 2000 texts. See below.                                           |

Each value:

| Field   | Required | What it is                                                                                                                                   |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`  | yes      | The file of the key.                                                                                                                         |
| `key`   | yes      | The dotted path of the key.                                                                                                                  |
| `value` | yes      | The text.                                                                                                                                    |
| `empty` | no       | `true` leaves the key empty on purpose, with `value: ""`. Use it only when the language wants no text. A key sent without it loses its mark. |

**Answer:**

```json
{ "commit": "…", "branch": "i18n/en", "readAt": "…", "keys": 42, "files": ["common", "checkout"] }
```

## `i18n_proposals`

The batches that the branch of a language holds and the base branch does not.

**Input:** `repository`, `language`.

**Answer:** a list of batches.

| Field     | What it is                           |
| --------- | ------------------------------------ |
| `commit`  | The commit of the batch.             |
| `message` | Its commit message.                  |
| `author`  | The account that proposed it.        |
| `at`      | When.                                |
| `readAt`  | The revision that the batch answers. |
