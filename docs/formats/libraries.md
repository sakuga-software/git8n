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

| vue-i18n                                   | git8n                                                 |
| ------------------------------------------ | ----------------------------------------------------- |
| Named `{name}`                             | Read, as an ICU argument                              |
| List `{0}`                                 | **Not read**: a translation can lose it with no error |
| Plural `no car \| one car \| {count} cars` | Text: the branches are not counted, `{count}` is read |
| Linked `@:common.ok`                       | **Not read**: a translation can lose it with no error |
| Literal `{'@'}`                            | Text                                                  |

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
- The placeholders that this page marks as not read.
