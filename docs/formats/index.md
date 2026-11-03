---
description: The file formats and placeholder syntaxes that git8n reads, and the ones it does not.
---

# Formats

git8n reads and writes **JSON locale files**, one folder for each language.
Inside a file, the text of a key can use the placeholders of i18next, of ICU
MessageFormat, or of both.

| Page                          | For                                                                |
| ----------------------------- | ------------------------------------------------------------------ |
| [i18next JSON](./i18next.md)  | The files: folders, keys, plurals, and the placeholders of i18next |
| [ICU MessageFormat](./icu.md) | `{name}`, and the choices `plural`, `select`, `selectordinal`      |
| [Libraries](./libraries.md)   | react-i18next, next-i18next, vue-i18n, next-intl and FormatJS      |

## Who reads the placeholders

Two parts of git8n read a file, and they do not read it the same way:

- **The editor and the API** read each key as plain text. They do not parse a
  placeholder or a plural. A proposal that loses `{{name}}` goes in as it is,
  from a person or from an agent.
- **`git8n check`** parses the placeholders and the plurals of each text. It
  fails on a translation that loses or adds a placeholder of its source, and
  warns about a plural form that a language needs and does not have.

Run `git8n check` in the CI of the repository: it is what catches a lost
placeholder before a publication reaches users. [In CI](../agents/cli.md#in-ci)
gives a workflow, and [the CLI reference](../reference/cli.md#check) every rule.

## Not supported

git8n reads only files that end with `.json`. These formats are not read, and
`git8n check` passes over them with no message:

- YAML (`.yml`, `.yaml`), as Rails i18n and some vue-i18n projects write it;
- gettext (`.po`, `.pot`);
- XLIFF (`.xlf`, `.xliff`), as Angular writes it;
- ARB (`.arb`), as Flutter writes it;
- Android XML, iOS `.strings` and `.xcstrings`;
- JavaScript or TypeScript modules that export messages;
- JSON5 and JSON with comments.
