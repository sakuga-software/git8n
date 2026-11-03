# Security policy

## Supported versions

| Part                            | Supported                 |
| ------------------------------- | ------------------------- |
| The editor (API, page and docs) | The last commit of `main` |
| The npm package `@git8n/cli`    | The latest minor version  |

A fix goes to `main`, and to a new patch version of `@git8n/cli`. Older
versions get no fix.

## Report a vulnerability

Do not open a public issue. Report it in private on GitHub:
<https://github.com/sakuga-software/git8n/security/advisories/new>.

Include:

- what an attacker can do, and what they need first (an account, a role, a
  token);
- the steps to reproduce it, on a local stack if you can;
- the version: the commit of `main`, or the version of `@git8n/cli`.

A small team maintains git8n. We try to answer within 7 days, and to agree a
date for the fix with you. This is a best effort, and there is no bounty.

## Scope

[Security](https://git8n.sakuga.dev/docs/operate/security) describes the
threats that the editor handles, and how. In scope: the API, the page, the
CLI and the MCP server of this repository. Out of scope: an instance that
somebody else hosts, and a vulnerability of GitHub or of a dependency that
has no effect on git8n.
