---
layout: home
title: i18n-editor

hero:
  name: i18n-editor
  text: Translate the locale files of a GitHub repository
  tagline: Translators propose, reviewers publish, and each publication is a commit. Agents work through an MCP server, with the same rights as a person.
  actions:
    - theme: brand
      text: Getting started
      link: /guide/getting-started
    - theme: alt
      text: Try the editor
      link: '#demo-title'
    - theme: alt
      text: Concepts
      link: /guide/concepts
    - theme: alt
      text: MCP server
      link: /agents/mcp

features:
  - title: The repository is the source of truth
    details: The editor reads the JSON locale files on the base branch and keeps no text of its own. A GitHub App writes each change as a commit.
  - title: Propose, then publish
    details: A proposal is one commit on the branch i18n/&lt;language&gt;. A reviewer publishes it to the base branch, by commit or by pull request.
  - title: Rights per repository
    details: Each member has a role and a list of languages in each repository. People sign in with GitHub or with a link by email.
  - title: Built for agents
    details: An MCP server reads the catalogue and proposes whole batches. Every page of this site is also plain Markdown, listed in llms.txt.
---
