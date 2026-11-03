# Access tokens

An agent, a script or the CLI acts as an account. It sends a token of that
account in each request to `/i18n`:

```
Authorization: Bearer <token>
```

The API checks the rights of the account on each call: its repositories, its
languages and its role. A token gives no more than its account has, and an
access token can give less: see [Its scope](#its-scope).

There are two ways to get a token.

## An access token, from the page « Jetons d'accès »

For an agent, a CI job or the [MCP server](./mcp.md).

1. In the editor, open the account menu at the top right.
2. Choose **Jetons d'accès**.
3. Give the token a name, for example « Agent de traduction ». Choose its
   scope (« Proposer » by default) and its life: 30 days, 90 days, one year, or
   no end.
4. Choose **Créer le jeton**, and copy the token.

The page shows a new token one time only. The editor keeps its SHA-256 and the
first characters, `g8n_` and four more, so that you can tell your tokens
apart. If you lose a token, revoke it and create another one.

The list shows the scope of each token, when it was created, when it ends, and
when it last served. **Révoquer** deletes a token: the API refuses it at once.

An access token starts with `g8n_`. The API reads that prefix and finds the
account of the token. A token that expired, or that was revoked, gets `401`.

## Its scope

The scope of an access token limits what it can do inside the rights of its
account. The API checks the scope before the rights.

| Scope                                  | What the token can call                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `read` (« Lecture seule »)             | The routes that only read: `GET` and `HEAD`.                                   |
| `propose` (« Proposer »), the default  | Those, and `POST /i18n/proposals`: a proposal. No publication, review or key.  |
| `full` (« Tous les droits du compte ») | Every route that the account can call: publish, add a key, change the members. |

A call outside the scope gets `403` with `"reason": "token_scope"`, and the
[CLI](./cli.md) stops with [`G8N2004`](../reference/errors/g8n2004.md). The
scope cannot change: to widen it, create a new token and revoke the old one.

Give an agent that reads the catalogue a `read` token, and an agent that
translates a `propose` token. A `full` token of a reviewer can publish, and a
`full` token of an owner can change the members.

A token made before scopes existed has the scope `full`: it keeps what it could
do. A session of `git8n login` is not an access token, and has every right of
its account.

## A sign-in from a terminal

For a person at a terminal. This is the device flow of OAuth (RFC 8628), as
`gh auth login` does. `git8n login` of the [CLI](./cli.md) uses it.

1. The terminal asks for a code:

   ```sh
   curl -X POST https://git8n.example.com/api/auth/device/code \
     -H 'Content-Type: application/json' \
     -d '{"client_id":"git8n-cli"}'
   ```

   The answer gives `device_code`, `user_code` (for example `W3ND6J6U`),
   `verification_uri_complete` and `interval` in seconds. The code expires
   after 10 minutes. The API refuses any other `client_id`.

2. The person opens `verification_uri_complete`, that is the page `/device` of
   the editor, and signs in if necessary. The page shows the code and the
   account. The person compares the code with the one of the terminal, then
   chooses **Approuver** or **Refuser**. On `/device` with no code, the page
   asks for it: `w3nd-6j6u` and `W3ND6J6U` are the same code.

3. The terminal polls every `interval` seconds:

   ```sh
   curl -X POST https://git8n.example.com/api/auth/device/token \
     -H 'Content-Type: application/json' \
     -d '{"grant_type":"urn:ietf:params:oauth:grant-type:device_code","device_code":"…","client_id":"git8n-cli"}'
   ```

   Before the approval, the answer is `400` with
   `"error": "authorization_pending"`. After it, the answer gives
   `access_token`.

The `access_token` is a session of the account, as the one of a browser. It
lasts 14 days, and each day of use extends it. A sign-out of the terminal ends
it.

::: warning Approve only your own code
A person who approves a code gives the terminal the rights of their account.
Approve a code only if you just started the command, and if the code on the page
is the one of your terminal.
:::

## What a token cannot do

Only the session of the browser can:

- create, list and revoke the access tokens (`/i18n/tokens` answers `403` to a
  token);
- approve or refuse a device code (`/api/auth/device`, `/device/approve` and
  `/device/deny` answer `403` to a request that carries `Authorization`).

Thus a token cannot make another token that stays valid after you revoke the
first one.
