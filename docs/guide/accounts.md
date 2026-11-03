---
description: Admins, the roles of a member in a repository, what each role and an agent can do.
---

# Accounts and rights

A person signs in with GitHub, or with a link by email. The first sign-in
creates the account, and the account opens nothing.

## Admins

An admin connects the repositories. An account is an admin if:

- its address is in `ADMIN_EMAILS`;
- GitHub says that the address is verified.

The address is the public address of the GitHub profile, or the primary
address if the profile shows none. The editor reads it again at each sign-in,
so a change on GitHub counts at the next sign-in.

**To administer gives no right to write a language.** An admin who connects a
repository becomes its owner. In any other repository, an admin needs a
membership like any other account.

## Members of a repository

A member holds rights in one repository only. Each repository has an
organization of better-auth. A member is a row of `members` in it, with a role
and one row of `member_languages` for each language.

| Role       | « Rôle » on the page | What it may do                               |
| ---------- | -------------------- | -------------------------------------------- |
| translator | Traducteur           | Propose texts in its languages.              |
| reviewer   | Relecteur            | Also publish the proposals of its languages. |
| owner      | Propriétaire         | Also manage the members of the repository.   |

**The source language** needs one more right: « Écrit la source (fr) », the
column `writes_source` of the member row. With it, a member proposes changes to
the source texts and adds keys with « Nouvelle clé ».

The last owner of a repository cannot leave it or lose the role.

Only an admin changes the settings of a repository: its branch, its folders,
its languages and its mode of publication.

## What each one can do

The API checks each right on each request. A member row grants its rights in
one repository, and only in the languages of the row. « Écrit la source » is a
right of its own: no role gives it, and it does not need a role that publishes.

| Action                                                 | Translator | Reviewer | Owner | « Écrit la source » | Admin, with no member row |
| ------------------------------------------------------ | ---------- | -------- | ----- | ------------------- | ------------------------- |
| Read the catalogue and the proposals of the repository | Yes        | Yes      | Yes   | Yes                 | Yes, in every repository  |
| Propose in one of its languages                        | Yes        | Yes      | Yes   | —                   | No                        |
| Publish one of its languages, or keep a translation    | No         | Yes      | Yes   | —                   | No                        |
| Propose and publish the source, add a key              | —          | —        | —     | Yes                 | No                        |
| Add, change and remove the members                     | No         | No       | Yes   | —                   | Yes                       |
| Connect a repository, change its settings              | No         | No       | No    | —                   | Yes                       |

A dash means that the column does not decide it: the right comes from another
column. An admin who connects a repository becomes its owner, and then also has
the rights of the column « Owner » there.

**An access token** acts as its account through the API, inside its scope:
`read`, `propose` (the default) or `full`, the rights of the account. A `propose`
token of a reviewer cannot publish. It cannot create, list or revoke the access tokens, and cannot approve a
device code: only the session of the browser does that. Through the
[MCP server](../agents/mcp.md), an agent can only read and propose:
`i18n_propose` is the only tool that writes. To keep an agent from
publishing, give it a `propose` token.
[Access tokens](../agents/tokens.md) gives the details.

**On GitHub**, a member needs nothing: no GitHub account if they sign in with
a link by email, and no access to the repository, because the GitHub App writes
every commit. Only the installation of the App needs a person who can install
an App on the GitHub account of the repository.
[The GitHub App](../operate/github-app.md) tells how.

## Add a member

An admin, or an owner of the repository, opens **Réglages → Membres**. They
add a person in one of two ways.

**By address.**

- A person with an account and this verified address becomes a member at once.
- Any other person gets an invitation and a mail with a magic link. They sign
  in with the link and need no GitHub account.
- The mail needs `SMTP_URL`. [Deploy](../operate/deploy.md) gives the variable.

**By GitHub login.** The editor keeps the numeric ID of the login. The person
becomes a member at their first sign-in with GitHub. A change of login on
GitHub does not break the invitation.

An invitation waits under « En attente de connexion » until the first sign-in.
The owner can send the link again, or remove the invitation.

## Agents

An agent acts as an account. It has the role and the languages of that account,
and the API checks them on each call. [MCP server](../agents/mcp.md) tells how
an agent connects.
