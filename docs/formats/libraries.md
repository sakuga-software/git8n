---
description: How react-i18next, vue-i18n, next-intl and other libraries fit the files that git8n edits.
---

# Libraries

git8n reads [i18next JSON](./i18next.md) files, in one folder for each
language. This page tells, for each library, what fits that layout and what
`git8n check` reads in its texts. Each claim was tried with `git8n check`.

## react-i18next and next-i18next

They read i18next JSON, so everything on [i18next JSON](./i18next.md) applies.
The default path of `i18next-http-backend` and of next-i18next is
`public/locales/<language>/<namespace>.json`, which `git8n check` finds with
no `--locales`.

## i18next-icu

The files are i18next JSON, and the texts are [ICU MessageFormat](./icu.md).
Both pages apply.

## vue-i18n

The texts of vue-i18n fit, with limits:

| vue-i18n                                   | git8n                                         |
| ------------------------------------------ | --------------------------------------------- |
| Named `{name}`, `{user-id}`                | Read, as an ICU argument                      |
| List `{0}`                                 | Read, as an ICU argument                      |
| Plural `no car \| one car \| {count} cars` | The branches are counted, `{count}` is read   |
| Linked `@:common.ok`, `@.lower:common.ok`  | Read as `@:common.ok`, and its key must exist |
| Literal `{'@'}`, escaped `\@` and `\|`     | Text                                          |

- A translation keeps the links of its source. The modifier, `.lower` in
  `@.lower:common.ok`, can change: a language can need a capital where
  another does not.
- The key of a link names a key of a file of the source language: `ok`, as one
  object of a language holds it once you merge the files, or `common.ok` for
  the key `ok` of `common.json`. A key that no file holds is an error of
  [`unknown-link`](../reference/rules/unknown-link.md). vue-i18n ends the key
  only at a space, `{`, `(`, `)`, `|` or `@`: in `@:nav.home!`, the key is
  `nav.home!`. Write `@:nav.home{'!'}`.
- A translation has as many branches as its source. A plural of 2 branches
  and one of 3 do not pick the same branch for 0, so another number is a
  warning of [`plural-branches`](../reference/rules/plural-branches.md). An
  application that sets `pluralRules` for a language can need other numbers:
  `--max-warnings` lets them pass.
- These forms are read in every text, whatever the library: a `|` in an
  i18next text is a branch too. The `|` of a text with an ICU choice is text.

The layout is the other limit. A vue-i18n project often keeps one file for
each language (`locales/en.json`), or its messages in JavaScript. git8n reads
neither: put the messages in `locales/<language>/<name>.json`, and merge the
files of a language when you load them.

## next-intl

next-intl writes [ICU MessageFormat](./icu.md), which `git8n check` reads.
Its default layout, one file for each language (`messages/en.json`), is not
read: `git8n check` stops with `G8N1005`. Put the messages in
`messages/<language>/<name>.json`, and merge them in the request config.

## FormatJS and react-intl

The texts are ICU MessageFormat. Two habits of these projects do not fit:

- one file for each language (`lang/en.json`);
- flat ids that hold dots, such as `"app.title"`. git8n reads them, but the
  editor writes a key as nested objects: see [The keys](./i18next.md#the-keys).

The files that `formatjs extract` writes hold objects
(`{ "defaultMessage": …, "description": … }`), not strings: they are not read.

## Not supported

- One file for each language, whatever the library.
- Messages in JavaScript, TypeScript, YAML, gettext, XLIFF or ARB.
- A link whose key comes from a value, `@:{name}`: its key is not checked.
