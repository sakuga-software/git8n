# Set up git8n for this user

You are an AI coding agent. Connect yourself to git8n, an editor for the JSON
locale files of a GitHub repository, so that you can read its keys and propose
translations. This prompt was checked against `@git8n/cli` 0.1.1.

## What you need from the user

- The address of their git8n editor, for example `https://git8n.example.com`.
  Ask for it. There is no default address.
- Either a sign-in in a terminal (step 2), or an access token that they create
  on the page « Jetons d'accès » of the editor. A token starts with `g8n_`.
  Never print a token, and never write it in a file that git tracks.

## Steps

1. Check that Node 22 or later is installed: `node --version`.
2. Sign in, if the user can approve a code in their browser:

   ```sh
   npx -y @git8n/cli login --api https://git8n.example.com
   npx -y @git8n/cli whoami
   ```

   `login` shows a code and opens the page `/device` of the editor. The user
   compares the code and approves it. The CLI keeps the session in
   `~/.config/git8n/credentials.json`, and that address becomes the default.
   Without a browser, use an access token in `GIT8N_API_URL` and
   `GIT8N_API_TOKEN` instead.

3. Add the MCP server to the client that you run in. The command is
   `npx -y @git8n/cli mcp`, on stdio. For Claude Code:

   ```sh
   claude mcp add --scope user git8n -- npx -y @git8n/cli mcp
   ```

   For another client, use the configuration of its tab on
   https://git8n.sakuga.dev/docs/agents/mcp. With a token and no sign-in, set
   `GIT8N_API_URL` and `GIT8N_API_TOKEN` in the `env` of the server.

4. Check the connection: call the tool `i18n_me`. It answers the account, and
   the repositories, roles and languages that it may use. If it fails, read
   the error code: https://git8n.sakuga.dev/docs/reference/errors/

## What does not exist

Do not run these. They are not commands of `@git8n/cli` 0.1.1, and the CLI
answers `G8N1001`:

- `git8n init`, `git8n setup`, `git8n install`, `git8n configure`;
- `git8n publish`: a person publishes in the editor, never an agent;
- `git8n check --reporter markdown`: the reporters are `pretty`, `json` and
  `github`.

The package is `@git8n/cli`. There is no npm package `git8n`: do not install one.

## After the setup

Read https://git8n.sakuga.dev/docs/agents/mcp for the two rules of a session:
carry the `commit` of a listing back as `readAt`, and send one language in one
`i18n_propose`.
