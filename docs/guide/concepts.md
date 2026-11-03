---
description: The parts of git8n, and what each action writes in git, from a proposal to a publication.
---

# Concepts

This page names the parts of the editor and follows a text from the source to
the base branch.

## Repository

A **repository** is a GitHub repository that the editor translates. An admin
connects it, and its row holds:

- the **base branch**, which the editor reads and publishes to;
- the **folder of the locales**, with one folder for each language;
- the **languages**, the source language first;
- the **manifest**, which says which file each language uses;
- the **mode of publication**: `commit` or `pull_request`.

The editor reads the GitHub App installation of the repository. It never asks
a person for a GitHub token.

## Source and target languages

The **source language** is the first language of the repository. Its files
define the keys. Every other language is a **target**.

A **key** is a file name and a dotted path to a string, as i18next reads it:
`{"cart": {"empty": "…"}}` in `common.json` gives the key `cart.empty` of the
file `common`.

## Catalogue

The **catalogue** of a language is every key of the source, beside what that
language says about it. The API reads it from the base branch and answers the
`commit` it read. Each key has a state:

| State        | What it means                                                                                |
| ------------ | -------------------------------------------------------------------------------------------- |
| `missing`    | The language has no text for the key, or an empty text that nobody marked.                   |
| `translated` | The base branch holds a text for the key.                                                    |
| `review`     | The source changed after the translation. `was` holds the old source.                        |
| proposed     | A text waits on the branch `i18n/<language>`. The page shows it beside the text of the base. |

A key can be **left empty on purpose** in one language. The manifest holds the
mark, with a hash of the source text. Such a key counts as translated until its
source changes. [A repository and its files](./repositories.md#a-key-left-empty-on-purpose)
gives the format.

A file that the manifest marks `disabled` for a language has no key in its
catalogue, and the API refuses a write to it.

## Proposal

A **proposal** is one batch of texts for one language. The editor writes it as
**one commit** on the branch `i18n/<language>`. Three hundred keys are one
commit.

A proposal carries `readAt`: the `commit` of the catalogue that the texts
answer. The commit message holds it as a `Read-at:` trailer. A publication uses
it to find what the source said when the translator wrote the text.

The editor writes nothing on the base branch at this step. A translator can
propose, and cannot publish.

## Publication

A **reviewer** reads the proposals of a language and approves some of them.
The publication copies the approved keys from `i18n/<language>` to the base
branch:

- in the mode `commit`, as one commit on the base branch;
- in the mode `pull_request`, as one commit on `i18n/publish`, which one pull
  request carries to the base branch.

The publication refuses a key, and says why, in these cases:

| Reason                   | What happened                                                                    |
| ------------------------ | -------------------------------------------------------------------------------- |
| `source-changed`         | The source text changed since the proposal. The translation answers an old text. |
| `changed-since-approval` | The branch holds another text now than the batch that the reviewer approved.     |
| `not-on-the-branch`      | The key, or the commit named for it, is not on `i18n/<language>`.                |
| `no-revision`            | The commit has no `Read-at:` trailer.                                            |
| `disabled`               | The manifest says that the file has no version in this language.                 |

Each commit has the name of the person as author, and an address that does not
reach them. [A repository and its files](./repositories.md#the-author-of-a-commit)
gives the details.

## A translation to read again

When a source text changes on the base branch, its translations go to the state
`review`. A reviewer can propose a new text, or keep the translation as it is.
To keep it writes a commit with one `Reviewed:` trailer for each key, and no
change to a file. The editor computes these states from the history of the base
branch. No table holds them.

## What each action writes in git

Every action that changes a text is a commit on GitHub, made by the GitHub App.
No action writes a text in the database: it holds the repositories, the
accounts and the rights only. After each write, the API drops what it holds of
the repository, so the next read shows the new commit.

| Action                                                   | Branch                                                               | Commit                                                                                        | Author of the commit                             | Pull request                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Propose texts: the page, `git8n apply` or `i18n_propose` | `i18n/<language>`. The first proposal makes it from the base branch. | One commit for the batch, with a `Read-at:` trailer                                           | The account that proposes                        | None                                                                                 |
| Propose a key again, before its publication              | `i18n/<language>`                                                    | One more commit. The last batch that changed a key is the one a reviewer reads and publishes. | The account that proposes                        | None                                                                                 |
| Leave a key empty on purpose                             | `i18n/<language>`                                                    | The commit of the proposal also writes the mark in the manifest of the branch                 | The account that proposes                        | None                                                                                 |
| Publish, in the mode `commit`                            | The base branch                                                      | One commit with the approved keys                                                             | The reviewer                                     | None                                                                                 |
| Publish, in the mode `pull_request`                      | `i18n/publish`                                                       | One commit with the approved keys                                                             | The reviewer                                     | The App opens one pull request `i18n/publish` → base branch, or updates the open one |
| Keep a translation after its source changed              | Where a publication goes                                             | One commit with one `Reviewed:` trailer for each key, and no change to a file                 | The reviewer                                     | As for a publication                                                                 |
| Change a source text                                     | `i18n/<source>`, then where a publication goes                       | A proposal, then a publication, as for a target language                                      | The account that writes the source, at each step | As for a publication                                                                 |
| Add a key with « Nouvelle clé »                          | Where a publication goes, with no proposal                           | One commit that adds the key to the source                                                    | The account that writes the source               | As for a publication                                                                 |

The author is the name of the account and an address that does not reach the
person: [the author of a commit](./repositories.md#the-author-of-a-commit).

**No action rejects or deletes a proposal.** A batch stays on
`i18n/<language>`. A reviewer publishes the keys they approve, and the others
stay proposed. A new proposal of a key replaces the text that waits. In the
mode `pull_request`, a pull request closed without a merge drops what it
carried: its keys are proposals again.

## What the editor holds, and for how long

GitHub is the source of truth, so the API reads GitHub and holds the answers
for a short time:

| What                                          | Held for  |
| --------------------------------------------- | --------- |
| The locale files and the catalogue            | 5 minutes |
| The progress of a repository on the home page | 1 minute  |
| The proposals that wait on a language         | 1 minute  |

The GitHub App sends a `push` event to the API. A push, a merge on GitHub
included, drops what the API holds for that repository. An open page reads again
every 30 seconds, so it shows the new commit without a reload. Without the
webhook, a change made on GitHub shows after 5 minutes.
