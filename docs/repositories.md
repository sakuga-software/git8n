# A repository and its locale files

The editor translates the JSON locale files of a GitHub repository. These files
stay the source of truth. The editor keeps no text of its own.

## The files

The files of one language are in one directory, under a path that you choose:

```
<localesPath>/
├── manifest.json        optional, see below
├── fr/                  the source language
│   ├── common.json
│   └── checkout.json
└── en/
    ├── common.json
    └── checkout.json
```

- The name of a directory is a language tag, for example `fr` or `pt-BR`.
- The name of a file has only letters, digits, `-` and `_`. The editor leaves
  out a file such as `common.v2.json`, and the API writes a warning to its log.
- A file holds nested objects of strings. A key is the dotted path to a
  string, as i18next reads it: `{"cart": {"empty": "…"}}` gives `cart.empty`.
- A file of the source must exist in the source directory. A file of another
  language can be absent: all its keys are then missing.

## Add a repository

An admin adds a repository with `POST /i18n/repositories`. Install the GitHub
App on the repository first: [github-app.md](github-app.md) tells how.

| Field            | Required | What it is                                                                                      |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `installationId` | yes      | The installation of the App, from `GET /i18n/installations`.                                    |
| `owner`, `name`  | yes      | The repository, for example `acme` and `acme-app`.                                              |
| `localesPath`    | yes      | The directory that holds the directories of the languages.                                      |
| `languages`      | yes      | The languages, **the source language first**.                                                   |
| `branch`         | no       | The base branch, which the editor reads and publishes to. The default is `main`.                |
| `manifestPath`   | no       | The manifest, from the root of the repository. The default is `<localesPath>/manifest.json`.    |
| `publishMode`    | no       | `commit` or `pull_request`: how a publication reaches the base branch. The default is `commit`. |

```sh
curl -X POST https://<editor>/i18n/repositories \
  -H 'Content-Type: application/json' \
  -d '{"installationId": 42, "owner": "acme", "name": "acme-app",
       "localesPath": "src/locales", "languages": ["fr", "en"]}'
```

These settings belong to the repository, so they are in the database and not
in the environment of the API. To add a language, change the row. You do not
need to deploy again.

## The page of every repository

`/` lists the connected repositories. `/repositories/<id>` opens the table of
one of them, and « i18n Traductions » in the header leads back to the list.

The list reads `GET /i18n/overview`:

| Parameter | Values                        | Default |
| --------- | ----------------------------- | ------- |
| `page`    | from 1                        | 1       |
| `perPage` | 1 to 100                      | 20      |
| `q`       | a part of `owner/name`        | none    |
| `sort`    | `name`, `created`, `progress` | `name`  |
| `order`   | `asc`, `desc`                 | `asc`   |

Each row holds the share of keys published in each language that the account
can open, and the open pull request of a repository that publishes by pull
request. Both come from GitHub, so the API reads them only for the rows of the
page. An order by progress reads every repository that the search keeps, four
at a time. The API holds a progress and a pull request for one minute.

A repository that GitHub does not answer stays in the list, with
`progress: null` and the reason in `progressError`.

`GET /i18n/repositories` keeps its answer: every row, with no progress. The MCP
server and the picker of the table read it.

## How a publication reaches the base branch

A repository publishes in one of two modes. An admin chooses it in the form
« Brancher un dépôt », and changes it later on the page of the settings of the
repository, which sends `PATCH /i18n/repositories/<id>` with `{"publishMode": "…"}`.

| Mode           | A publication is                                          | For                                              |
| -------------- | --------------------------------------------------------- | ------------------------------------------------ |
| `commit`       | one commit on the base branch                             | a base branch that accepts a push                |
| `pull_request` | one commit on `i18n/publish`, carried by one pull request | a base branch whose rules require a pull request |

In the mode `pull_request`:

- The first publication makes `i18n/publish` from the base branch, and opens the
  pull request `i18n/publish` → base branch.
- A later publication adds a commit to the same branch, and writes the title
  and the body of the pull request again. They list every key and language
  that the pull request carries. Each commit names the reviewer who published.
- When the base branch moved, the publication merges it into `i18n/publish`
  first. If the two changed the same lines, the publication stops with a 409
  and forces nothing. Resolve the conflict on GitHub, or close the pull request.
- After a merge or a close, the next publication starts `i18n/publish` again
  from the base branch, and opens a new pull request. A closed pull request
  drops what it carried: its keys are proposals again.
- A key in the open pull request leaves the list of proposals. It shows as
  published in the catalogue after the merge, because the catalogue reads the
  base branch.
- A key created from the editor goes into the pull request too.
- `GET /i18n/publication?repository=<id>` answers the last pull request, open or
  not, and whether GitHub can merge it. The header of the editor shows it.

The App needs the permission « Pull requests: write » for this mode:
[github-app.md](github-app.md) tells how to add it to an App that exists.

## The settings of a repository

An admin opens « Réglages » in the header of the editor, at
`/repositories/<id>/settings`. The page changes the branch, the folder of the
locales, the manifest, the languages, the mode of publication and the formats
of the messages. It sends `PATCH /i18n/repositories/<id>` with the fields that
changed. An absent field keeps its value.

- A new branch, folder or manifest is read on GitHub before it is written. If
  GitHub does not hold it, the API answers 400 and changes nothing.
- A refusal names its field in `errors`, as the other validation errors of the
  API do: `{ "message": "…", "errors": [{ "field": "branch", "message": "…" }] }`.
- If GitHub fails to answer the check for another reason, the API answers 502
  with the reason, and changes nothing.
- `null`, or an empty string, gives a format its default back. A `null`
  manifest gives back `<localesPath>/manifest.json`.

### The formats of the messages

A format is a text with variables between braces. `{{` writes `{`, and `}}`
writes `}`. A variable that the format of its kind does not list is refused.

| Format                        | Field of the API            | Variables                                                                     | Default                                               |
| ----------------------------- | --------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| The commit of a proposal      | `proposalCommitTemplate`    | `language`, `count`, `count_keys`, `author`, `repository`, `branch`           | `i18n({language}): {count_keys} proposed by {author}` |
| The commit of a publication   | `publicationCommitTemplate` | `language`, `count`, `count_keys`, `action`, `author`, `repository`, `branch` | `i18n({language}): {count_keys} {action} by {author}` |
| The title of the pull request | `pullRequestTitleTemplate`  | `count`, `count_keys`, `languages`, `repository`, `branch`                    | `i18n: {count_keys} published ({languages})`          |
| The body of the pull request  | `pullRequestBodyTemplate`   | `count`, `count_keys`, `languages`, `keys_list`, `repository`, `branch`       | a sentence, a blank line, then `{keys_list}`          |

| Variable     | What it writes                                                                |
| ------------ | ----------------------------------------------------------------------------- |
| `language`   | the language of the commit: `en`                                              |
| `languages`  | the languages of the pull request, in alphabetical order: `de, en`            |
| `count`      | how many keys: `3`                                                            |
| `count_keys` | the same, with the word: `1 key`, `3 keys`                                    |
| `action`     | `published`, or `created` for a key that « Nouvelle clé » added to the source |
| `author`     | the name of the account that proposed or published                            |
| `repository` | `owner/name`                                                                  |
| `branch`     | the base branch                                                               |
| `keys_list`  | the keys of the pull request, one Markdown section for each language          |

Rules:

- A commit format and the title are one line. The body takes several.
- A commit subject longer than 100 characters, or a title longer than 256, is
  cut and ends with `…`.
- The editor adds the lines it reads back under the format, whatever the
  format says: the `Read-at:` trailer of a proposal, and one line for each key
  of a publication (`- en common:hello`). The title and the body of the pull
  request are built from these lines, so a format can change the subject freely.
- A format that a hand wrote in the database and that the API would refuse is
  not used: the message takes the default format.

## The manifest

The manifest says, for each file and each language, if the application uses
the translation. It is optional. Without a manifest, each file is `available`
in each language.

```json
{
  "source": "fr",
  "files": {
    "common": { "en": "available", "de": "available" },
    "checkout": { "en": "partial" },
    "legal": { "en": "disabled" }
  }
}
```

| State       | What the application does                             | What the editor does                                              |
| ----------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `available` | It loads the file.                                    | It lists the keys, and a translator writes them.                  |
| `partial`   | It does not load the file yet. Users read the source. | It lists the keys, and a remark says that the file is not loaded. |
| `disabled`  | The file has no version in this language.             | It lists no key, and it refuses a write to the file.              |

- A file or a language that the manifest does not name is `available`.
- The source language is always `available`. The manifest cannot change it.
- If `source` is there, it must be the first language of the repository row.
  If the two are different, the editor stops the read with an error.
- If the manifest is not valid JSON or does not match this format, the editor
  stops the read. It does not read the manifest as empty, because that would
  enable each file that the manifest disables.

The editor reads the manifest on the base branch. A proposal branch cannot
change the state of a file.

Keep the manifest out of the directories of the languages. In one of them, the
editor reads it as a locale file named `manifest`.

## The author of a commit

A proposal and a publication are commits. Their author is the name of the
account and an address that does not reach the person:
`<account ID>@<COMMIT_EMAIL_DOMAIN>`.

| Variable              | Default                 |
| --------------------- | ----------------------- |
| `COMMIT_EMAIL_DOMAIN` | `users.noreply.invalid` |

The default domain is reserved by RFC 2606: no mailbox and no GitHub account
has it.

**Do not set it to `users.noreply.github.com`.** An account ID of the editor is
not a GitHub login. GitHub then gives the commit to the GitHub account with that
name, if one exists.
