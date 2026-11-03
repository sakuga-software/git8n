# Compare git8n

This page compares git8n with four tools that also translate the locale files
of an application: Fink, Tolgee, Crowdin and Weblate. Each of them does more
than git8n in some areas. The table says where.

**Checked on 2026-11-03.** The facts about the other tools come from their own
documentation, linked under the table. A tool changes: read its page before you
decide.

## The short answer

- **git8n** edits the JSON locale files of a GitHub repository. Translators
  propose, reviewers publish, and each publication is a commit or a pull
  request. A translator can sign in with a link by email, with no GitHub
  account. Agents work through an MCP server and a CLI. You host it.
- **Fink** is also an editor for the files of a GitHub repository, in the
  browser, with nothing to host. Everyone who saves needs a GitHub account, and
  rights are the rights of GitHub.
- **Tolgee** keeps the texts in a Tolgee project. A CLI or the API moves them
  to and from the repository. It edits texts inside the running application.
- **Crowdin** is a full localization platform for professional translators,
  with translation memory and machine translation. It keeps the texts in a
  Crowdin project, and sends them back as pull requests.
- **Weblate** is an open source platform that treats the repository as the
  place of the texts, with a working copy and a database of its own, and many
  formats and hosts.

## The table

|                            | git8n                                                                   | [Fink](#sources)                                                   | [Tolgee](#sources)                                                   | [Crowdin](#sources)                                       | [Weblate](#sources)                                           |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| Where the texts live       | The repository only. The database holds accounts and rights, not texts  | The repository only                                                | A Tolgee project, pushed to or pulled from the repository by its CLI | A Crowdin project, synced with the repository             | The repository, with a working copy and a database of Weblate |
| Git hosts                  | GitHub                                                                  | GitHub                                                             | Not checked                                                          | GitHub, GitLab, Bitbucket and more                        | Any git host, and Mercurial and Subversion                    |
| Who needs a GitHub account | The admin who installs the GitHub App. Translators can sign in by email | Everyone who saves a change                                        | Nobody: a Tolgee account                                             | Nobody: a Crowdin account                                 | Nobody: a Weblate account                                     |
| Review                     | A proposal is a commit on `i18n/<language>`. A reviewer publishes it    | A commit on a branch, or a pull request from a fork                | Not checked                                                          | Pull requests from a service branch (`l10n_…` by default) | Commits pushed to the repository, or pull requests            |
| Rights                     | A role and a list of languages for each member, in each repository      | The rights of GitHub: no accounts, invitations or roles of its own | Not checked                                                          | Not checked                                               | Not checked                                                   |
| MCP server                 | Yes, over stdio (`npx -y @git8n/cli mcp`)                               | Not checked                                                        | Yes, remote, with sign-in or an API key                              | Yes                                                       | Not in its documentation                                      |
| CLI                        | Yes (`@git8n/cli`), with `check`, a linter that needs no server         | Not checked                                                        | Yes                                                                  | Yes                                                       | Yes (`wlc`)                                                   |
| Self-hosting               | Yes, and required: there is no hosted service                           | No: hosted at fink.inlang.com                                      | Yes, or Tolgee Cloud                                                 | No: a cloud service                                       | Yes, or Hosted Weblate                                        |
| Formats                    | JSON files of nested objects, read with the dotted keys of i18next      | i18next JSON, next-intl, the inlang message format                 | Many, i18next JSON included                                          | Dozens, i18next JSON included                             | Many, i18next JSON included                                   |
| Translation memory, MT     | No                                                                      | No                                                                 | Yes                                                                  | Yes                                                       | Yes                                                           |
| Licence                    | AGPL-3.0-only                                                           | MIT                                                                | Apache-2.0, with enterprise features under another licence           | Proprietary                                               | GPL-3.0                                                       |

« Not checked » means that this page did not find the fact in the documentation
of the tool. It does not mean « no ».

## Sources

- **Fink:** [Fink llms.txt](https://fink.inlang.com/llms.txt) (formats, GitHub only, no translation memory or machine translation), [Translators and non-developers](https://fink.inlang.com/docs/translators.md) (accounts and rights), [inlang-fink on GitHub](https://github.com/opral/inlang-fink) (licence).
- **Tolgee:** [MCP server setup](https://docs.tolgee.io/platform/integrations/mcp_server/setup), [Push and pull strings](https://docs.tolgee.io/tolgee-cli/push-pull-strings), [Supported formats](https://docs.tolgee.io/platform/supported_formats), [Self-hosting](https://docs.tolgee.io/platform/self_hosting/getting_started), [LICENSE](https://github.com/tolgee/tolgee-platform/blob/main/LICENSE). Translation memory and machine translation: [Fink vs Tolgee](https://fink.inlang.com/compare/tolgee.md), a page of a competitor.
- **Crowdin:** [GitHub integration](https://support.crowdin.com/github-integration/) (service branch `l10n_`), [Crowdin MCP Server](https://support.crowdin.com/developer/crowdin-mcp-server/), [crowdin-cli](https://github.com/crowdin/crowdin-cli), [Crowdin docs for LLMs](https://support.crowdin.com/llms-small.txt) (no self-hosted edition is described). Hosts, formats, translation memory and machine translation: [Fink vs Crowdin](https://fink.inlang.com/compare/crowdin.md), a page of a competitor.
- **Weblate:** [Version control integration](https://docs.weblate.org/en/latest/vcs.md), [Code hosting](https://docs.weblate.org/en/latest/admin/code-hosting.md), [Formats](https://docs.weblate.org/en/latest/formats.md), [Translation memory and installation](https://docs.weblate.org/llms.txt) (the index has no MCP page), [Weblate Client](https://docs.weblate.org/en/latest/wlc.md), [WeblateOrg/weblate on GitHub](https://github.com/WeblateOrg/weblate) (licence).

## What git8n does not do

- **No translation memory and no glossary.** Each key is translated on its own.
- **No machine translation on the server.** `git8n prompt translate` writes a
  prompt for a model that you run, and an agent proposes through the MCP
  server. Both go through a review, as a person's proposal does.
- **JSON only.** No YAML, `.po`, XLIFF, ARB or mobile string files.
  [A repository and its files](./repositories.md#the-files) gives the layout.
- **GitHub only.** The editor reads and writes through a GitHub App. GitLab,
  Bitbucket and other hosts are not supported.
- **No hosted service.** You deploy the editor yourself:
  [Deploy](../operate/deploy.md).
- **No in-context editing and no screenshots.** A translator sees the key, the
  source text and the keys near it, not the screen of the application.

## When to pick another tool

- **Fink**, if you want nothing to host and everybody already has a GitHub
  account with the rights they need.
- **Tolgee**, if people must edit the texts inside the running application.
- **Crowdin**, if an agency or professional translators work in the tool every
  day, with translation memory and machine translation.
- **Weblate**, if your code is not on GitHub, or your files are not JSON.

Coming from Crowdin? [Migrate from Crowdin](./migrate-from-crowdin.md).
