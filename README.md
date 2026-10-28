# git8n

An editor for the translations of a product. Its source of truth is the JSON
locale files in a GitHub repository. Translators propose texts, reviewers
publish them, and each publication is a commit on the repository, made by a
GitHub App. Agents and scripts read and propose translations through a CLI or
an MCP server, with the rights of an account.

**Documentation: <https://git8n.sakuga.dev/docs/>**. The sources are in
[`docs/`](docs/). Every page is also plain Markdown for an agent:
[`llms.txt`](https://git8n.sakuga.dev/docs/llms.txt) lists them.

- [Getting started](docs/guide/getting-started.md): run it locally and connect
  a repository.
- [Concepts](docs/guide/concepts.md): the catalogue, a proposal, a publication.
- [Accounts and rights](docs/guide/accounts.md)
- [A repository and its files](docs/guide/repositories.md)
- [Deploy](docs/operate/deploy.md) and [the GitHub App](docs/operate/github-app.md)
- [CLI](docs/agents/cli.md) and [its reference](docs/reference/cli.md)
- [MCP server](docs/agents/mcp.md) and [its tools](docs/reference/mcp-tools.md)

## Checks

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm -F @git8n/docs demo  # the demo of the home page, built once
pnpm -F @git8n/docs dev   # the documentation, on port 5208
```

The tests of the API run on PGlite, a PostgreSQL in memory. They need no server.

## Licence

[GNU Affero General Public License v3.0](LICENSE). If you run a changed
version of this editor as a service, you must publish your changes to the
users of that service.
