---
description: Move the translations of a GitHub repository from Crowdin to git8n, step by step.
---

# Migrate from Crowdin

This page moves the translations of a GitHub repository from Crowdin to git8n.
It follows the migration of a real product, and keeps the steps that it needed.

Crowdin keeps the texts in a Crowdin project and syncs them with the
repository. git8n keeps them in the repository only. So the migration moves no
text: it makes sure that the repository holds every translation, then removes
the sync.

## 1. Get every translation into the repository

Crowdin sends the translations as pull requests from a service branch (`l10n_…`
by default). **An open pull request of Crowdin can hold translations that exist
nowhere else.** Before you remove anything:

- list the open pull requests of the Crowdin branch;
- read each diff. Merge the ones that bring translations, or copy their texts
  into the editor later. Close only the ones that bring nothing new.

A diff that replaces a text of `main` with `""` or with an older wording brings
nothing: close it.

## 2. Check the layout of the files

git8n reads one folder per language, with the same file names in each:
`<localesPath>/<language>/<file>.json`. A file holds nested objects of strings.
[A repository and its files](./repositories.md#the-files) gives the rules.

If a language is only partly translated, or a file has no version in a
language, write a [manifest](./repositories.md#the-manifest) rather than leave
empty files. Then run the check on a clone:

```sh
npx @git8n/cli check
```

[`check`](../reference/cli.md#check) reads the files with no server, and tells
what the editor would refuse.

## 3. Connect the repository

Install the GitHub App on the repository, then connect it in the editor and
give the rights to your translators: [Getting started](./getting-started.md).
A translator with no GitHub account signs in with a link by email.

## 4. Remove the sync

Remove the files that drive Crowdin:

- the workflow that calls the Crowdin CLI or action, for example
  `.github/workflows/crowdin.yml`, or the Crowdin GitHub integration on the
  Crowdin side;
- `crowdin.yml`, wherever it is in the repository.

Look at `.gitignore` too. A line that ignores these files hides them from a
search that respects `.gitignore`, such as `grep -r` in some setups, but leaves
them in the repository. Search with `git ls-files | grep -i crowdin`.

## 5. Revoke the credentials

A workflow of Crowdin reads a project ID and a personal token, often as
`CROWDIN_PROJECT_ID` and `CROWDIN_PERSONAL_TOKEN`. Delete both from the
settings of the repository.

**Check where the token is.** A token saved as a repository **variable**, and
not as a secret, is plain text that every person with read access to the
settings can see. Deleting the variable does not make it safe: revoke the token
on Crowdin.

## 6. Decide what to do with the Crowdin project

The project lives outside the repository, with its translators, its
translation memory and its glossary. git8n has no translation memory or
glossary, so they do not move. Closing the project is a decision for its
owner, not a step of the clean-up: keep it, or keep an export of what you
need, until you are sure.

## 7. Check every pull request

Add `git8n check` to CI, so that a file that does not parse, or a translation
that loses a placeholder, fails the pull request:
[In CI](../agents/cli.md#in-ci).
