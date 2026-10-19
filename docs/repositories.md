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

| Field            | Required | What it is                                                                     |
| ---------------- | -------- | ------------------------------------------------------------------------------ |
| `installationId` | yes      | The installation of the App, from `GET /i18n/installations`.                   |
| `owner`, `name`  | yes      | The repository, for example `acme` and `acme-app`.                             |
| `localesPath`    | yes      | The directory that holds the directories of the languages.                     |
| `languages`      | yes      | The languages, **the source language first**.                                  |
| `branch`         | no       | The base branch, which the editor reads and publishes to. The default is `main`. |
| `manifestPath`   | no       | The manifest, from the root of the repository. The default is `<localesPath>/manifest.json`. |

```sh
curl -X POST https://<editor>/i18n/repositories \
  -H 'Content-Type: application/json' \
  -d '{"installationId": 42, "owner": "acme", "name": "acme-app",
       "localesPath": "src/locales", "languages": ["fr", "en"]}'
```

These settings belong to the repository, so they are in the database and not
in the environment of the API. To add a language, change the row. You do not
need to deploy again.

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

| State       | What the application does                        | What the editor does                                       |
| ----------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `available` | It loads the file.                               | It lists the keys, and a translator writes them.            |
| `partial`   | It does not load the file yet. Users read the source. | It lists the keys, and a remark says that the file is not loaded. |
| `disabled`  | The file has no version in this language.        | It lists no key, and it refuses a write to the file.        |

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
