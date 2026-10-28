# CLI

`i18n-editor` is a command line client of the API. It reads and proposes
translations from a terminal, a script or a CI job. It also starts the
[MCP server](./mcp.md).

The CLI goes through `/i18n`, as the page does. The API checks the rights of the
account on each call: the CLI can do no more than the account in the browser.

## Install it

The CLI is not on npm yet. Run it from a clone of the repository, with Node 26:

```sh
git clone https://github.com/sakuga-software/i18n-editor
cd i18n-editor && pnpm install
alias i18n-editor="node --experimental-strip-types $PWD/packages/mcp/src/cli/main.ts"
```

## Sign in

```sh
i18n-editor login --api https://i18n.example.com
```

The terminal shows a code and opens the page `/device` of the editor. Compare
the code, then choose **Approuver**. The terminal then holds a session of your
account for 14 days. [Access tokens](./tokens.md) tells how this works.

The CLI keeps the token in `~/.config/i18n-editor/credentials.json`
(`$XDG_CONFIG_HOME` if it is set). Only your account can read this file. The
address of the last `login` becomes the default: the next commands need no
`--api`.

`i18n-editor logout` ends the session on the API and deletes the token of
this computer. `i18n-editor whoami` shows the account and what it may do in each
repository.

In a CI job, do not sign in. Create an access token on the page
**Jetons d'accès**, and set two variables:

```sh
export I18N_EDITOR_API_URL=https://i18n.example.com
export I18N_EDITOR_API_TOKEN=i18e_…
```

## Choose the repository and the language

A command that reads keys works on one repository and one language:

- **The repository** is the one of `--repo <owner/name>`, else of
  `I18N_EDITOR_REPO`, else the one that a GitHub remote of the current folder
  names. If the folder has no GitHub remote and the account opens one
  repository only, the CLI takes it. A folder of a repository that the account
  does not open stops the command.
- **The language** is the one of `--lang`, else the only target language that
  the account can open in this repository.

If the choice is not clear, the CLI stops with exit status 2 and lists the
choices.

## Read

```sh
i18n-editor status                   # The progress of each language
i18n-editor keys --missing           # The keys with no translation
i18n-editor keys --state review --values
i18n-editor get common:hello.title   # One key, with its neighbours
i18n-editor search "mot de passe"    # The keys whose id, source or translation holds a text
i18n-editor proposals                # The batches that wait for a reviewer
```

A key is named `<file>:<key>`: the locale file, a colon, and the dotted path,
for example `common:hello.title`. A long list shows 100 rows. The last line
on stderr gives the `--cursor` of the next page.

## Propose

`apply` reads a JSON object of translations from a file, or from stdin with
`-`:

```sh
echo '{"common:hello.title": "Hello", "common:bye": "Goodbye"}' \
  | i18n-editor apply - --lang en --dry-run
```

The input can also put the keys under their file:
`{"common": {"hello": {"title": "Hello"}}}`. With `--file common`, the keys of
that file only: `{"hello.title": "Hello"}`.

`apply` reads the catalogue, then proposes the texts that differ from the
translation now, as **one** commit on the branch `i18n/<language>`. A reviewer
then publishes them in the editor. `--dry-run` shows the plan and sends
nothing.

The CLI refuses the whole input, and sends nothing, if:

- a key is not a key of the source;
- a key is in a file that has no version in the language;
- a text is empty. To leave a key empty on purpose, mark it in the editor.

A key to review whose text stays the same is not proposed: the file would not
change, and the key would stay to review. `apply` lists these keys. A reviewer
keeps them in the editor.

A proposal carries the revision of the source that the texts answer
(`readAt`). By default, `apply` sends the revision it reads. If the texts
answer an older read, pass its `commit` with `--read-at`: a publication then
refuses a key whose source changed since.

## Translate with an LLM

```sh
i18n-editor prompt translate --to en > prompt.md
```

The prompt lists the missing keys, 50 at a time, with their source text and
the keys beside them. It asks for one JSON object, and it ends with the
`apply` command to run with the answer, `--read-at` included. With
`--state review`, it asks again for the translations whose source changed, and
shows the old source.

## For a script

Each command takes `--json`. The answer is then one JSON document on stdout:
`{"data": …}`, or `{"error": {"code", "message", "details"}}`. A script reads
the exit status and the code, not the message. [CLI reference](../reference/cli.md)
gives each command, each field and each code.

## Later

`i18n-editor check` will read the locale files of a clone with no server, and
report the missing keys and the placeholders that differ, for a CI job.
