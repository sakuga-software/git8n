---
'@git8n/cli': patch
---

The tools of `git8n mcp` now carry MCP annotations: every tool is `readOnlyHint: true` except `i18n_propose`, which writes a commit and deletes nothing. The fields of `i18n_key` and of the values of `i18n_propose` now have a description.
