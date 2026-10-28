# Access tokens

::: info Coming
This page describes work in progress. The editor does not have these features
yet.
:::

An agent, a script or the CLI acts as an account. It needs a token of that
account. Two ways to get one come next:

- **An access token.** A page « Jetons » in the editor creates, lists and
  revokes the tokens of your account. The page shows a new token once. A token
  acts as its account: the same repositories, languages and role.
- **A sign-in from a terminal.** `i18n-editor login` shows a code and opens the
  editor in the browser. You approve the code, and the CLI keeps the token. This
  is the device flow of OAuth (RFC 8628), as `gh auth login` does.

Until then, the API takes the session token of an account as a bearer token.
[MCP server](./mcp.md) gives the variables that hold the token.
