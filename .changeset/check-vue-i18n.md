---
'@git8n/cli': patch
---

`check` reads the list arguments `{0}` and the names with `-` or `$` (`{user-id}`): a translation that loses one is an error. `check --syntax vue-i18n` also reads the linked messages of vue-i18n (`@:key`, `@.lower:key`): a translation that loses one is an error, and a link to a key that no file of the source holds is an error of `unknown-link`. A plural of vue-i18n (`car | cars`) whose translation has another number of branches is a warning of `plural-branches`.
