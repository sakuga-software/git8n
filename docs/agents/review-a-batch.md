# Review and publish a batch

An agent proposes, and a person publishes. This page is the half of a
reviewer: read the batch that an agent proposed, and publish what is right.

To publish, the account needs the role « Relecteur » or « Propriétaire » in
the language. [Accounts and rights](../guide/accounts.md) gives the roles.

## 1. Open the proposals

Open the repository in the editor, and choose the language. Open the tab
« Proposées »: each row shows the source, the text of the base branch and the
proposal.

## 2. Read them

Read each proposal against its source. The file and the dotted path of the key
say what the text is for. Look at:

- the placeholders and the tags of the source, which the proposal must keep;
- the words of the product, which a glossary of the agent can miss;
- a text that is right in the language, but too long for its place.

To change a proposal, write the new text in its field. The editor proposes it
as a new commit on `i18n/<language>`, with your name.

## 3. Publish

Tick the keys to publish in the column « Publier », or tick all of them in the
head of the column. The bar at the bottom of the page shows « Publier N clés ».
Click it.

The publication copies the ticked keys to the base branch: one commit, or one
pull request if the repository publishes by pull request.
[Concepts](../guide/concepts.md#publication) gives both modes.

## 4. Read what was refused

The publication leaves a key where it is, and says why, if:

- the source text changed after the proposal: the translation answers an old
  text. Read it again, then propose a new text or keep it;
- a more recent proposal changed the value after you ticked it;
- the file has no version in this language.

The other keys of the batch are published. A key that stays is still under
« Proposées ».

## What an agent cannot do here

The MCP server has no tool that publishes, and the API refuses a publication
from a translator. An agent that holds the role « Relecteur » can still publish
through the API: give the account of an agent the role « Traducteur » only.
