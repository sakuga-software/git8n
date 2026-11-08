---
'@git8n/cli': patch
---

`check` reads the list arguments of vue-i18n (`{0}`), its names with `-` or `$` (`{user-id}`), and its linked messages (`@:key`, `@.lower:key`): a translation that loses one is an error. A link to a key that no file of the source holds is an error of `unknown-link`, and a plural of vue-i18n (`car | cars`) whose translation has another number of branches is a warning of `plural-branches`.
