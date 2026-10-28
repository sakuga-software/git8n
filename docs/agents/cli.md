# CLI

`git8n` is a command line client of the API. It reads and proposes
translations from a terminal, a script or a CI job. It also starts the
[MCP server](./mcp.md).

The CLI goes through `/i18n`, as the page does. The API checks the rights of the
account on each call: the CLI can do no more than the account in the browser.

## Install it

The CLI is not on npm yet. Run it from a clone of the repository, with Node 26:

```sh
git clone https://github.com/sakuga-software/git8n
cd git8n && pnpm install
alias git8n="node --experimental-strip-types $PWD/packages/mcp/src/cli/main.ts"
```

## Sign in

```sh
git8n login --api https://git8n.example.com
```

The terminal shows a code and opens the page `/device` of the editor. Compare
the code, then choose **Approuver**. The terminal then holds a session of your
account for 14 days. [Access tokens](./tokens.md) tells how this works.

The CLI keeps the token in `~/.config/git8n/credentials.json`
(`$XDG_CONFIG_HOME` if it is set). Only your account can read this file. The
address of the last `login` becomes the default: the next commands need no
`--api`.

`git8n logout` ends the session on the API and deletes the token of
this computer. `git8n whoami` shows the account and what it may do in each
repository.

In a CI job, do not sign in. Create an access token on the page
**Jetons d'accès**, and set two variables:

```sh
export GIT8N_API_URL=https://git8n.example.com
export GIT8N_API_TOKEN=i18e_…
```

## Choose the repository and the language

A command that reads keys works on one repository and one language:

- **The repository** is the one of `--repo <owner/name>`, else of
  `GIT8N_REPO`, else the one that a GitHub remote of the current folder
  names. If the folder has no GitHub remote and the account opens one
  repository only, the CLI takes it. A folder of a repository that the account
  does not open stops the command.
- **The language** is the one of `--lang`, else the only target language that
  the account can open in this repository.

If the choice is not clear, the CLI stops with exit status 2 and lists the
choices.

## Read

```sh
git8n status                   # The progress of each language
git8n keys --missing           # The keys with no translation
git8n keys --state review --values
git8n get common:hello.title   # One key, with its neighbours
git8n search "mot de passe"    # The keys whose id, source or translation holds a text
git8n proposals                # The batches that wait for a reviewer
```

A key is named `<file>:<key>`: the locale file, a colon, and the dotted path,
for example `common:hello.title`. A long list shows 100 rows. The last line
on stderr gives the `--cursor` of the next page.

## Propose

`apply` reads a JSON object of translations from a file, or from stdin with
`-`:

```sh
echo '{"common:hello.title": "Hello", "common:bye": "Goodbye"}' \
  | git8n apply - --lang en --dry-run
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
git8n prompt translate --to en > prompt.md
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

## In CI

`git8n check` reads the locale files of the clone, with no server and no
token. It fails on a file that does not parse, or on a translation that loses a
placeholder. A missing or empty key is a warning: `--max-warnings 0` makes it
fail too.

```yaml
name: i18n
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 26
      # Pin the commit of git8n that the job runs: a new version cannot change the check by itself.
      - run: |
          git clone --filter=blob:none https://github.com/sakuga-software/git8n /tmp/git8n
          git -C /tmp/git8n checkout <commit>
      - run: cd /tmp/git8n && corepack enable && pnpm install --frozen-lockfile --filter @git8n/mcp...
      - run: node --experimental-strip-types /tmp/git8n/packages/mcp/src/cli/main.ts check --reporter github
```

`--reporter github` writes one annotation for each problem, on the file of the
pull request. [CLI reference](../reference/cli.md#check) gives every option and
every rule.
