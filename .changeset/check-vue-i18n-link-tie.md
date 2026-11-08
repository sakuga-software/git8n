---
'@git8n/cli': patch
---

`check --syntax vue-i18n` no longer picks a merge of the files when as many links name a key with no file (`@:ok`) as with its file (`@:common.ok`): each of these links is an error of `unknown-link`, which asks for one form.
