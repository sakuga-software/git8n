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
