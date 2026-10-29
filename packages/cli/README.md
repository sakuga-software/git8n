# @git8n/cli

The command line of [git8n](https://git8n.sakuga.dev/docs/), an editor for the
JSON locale files of a GitHub repository. It reads and proposes translations
from a terminal, a script or a CI job, checks the locale files of a clone, and
starts an MCP server for agents.

```sh
npx @git8n/cli check                                # check the locale files of this folder, with no server
npx @git8n/cli login --api https://git8n.example.com
npx @git8n/cli status                               # what is left to translate
npx @git8n/cli mcp                                  # the MCP server, on stdio
```

It needs Node 22 or later. The package installs the command `git8n`:

```sh
npm install --global @git8n/cli
git8n --version
```

- [CLI guide](https://git8n.sakuga.dev/docs/agents/cli)
- [CLI reference](https://git8n.sakuga.dev/docs/reference/cli)
- [MCP server](https://git8n.sakuga.dev/docs/agents/mcp)

## License

AGPL-3.0-only
