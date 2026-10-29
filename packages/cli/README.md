# git8n

The command line of [git8n](https://git8n.sakuga.dev/docs/), an editor for the
JSON locale files of a GitHub repository. It reads and proposes translations
from a terminal, a script or a CI job, checks the locale files of a clone, and
starts an MCP server for agents.

```sh
npx git8n check                                # check the locale files of this folder, with no server
npx git8n login --api https://git8n.example.com
npx git8n status                               # what is left to translate
npx git8n mcp                                  # the MCP server, on stdio
```

It needs Node 22 or later.

- [CLI guide](https://git8n.sakuga.dev/docs/agents/cli)
- [CLI reference](https://git8n.sakuga.dev/docs/reference/cli)
- [MCP server](https://git8n.sakuga.dev/docs/agents/mcp)

## License

AGPL-3.0-only
