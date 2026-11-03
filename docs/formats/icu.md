---
description: What git8n understands of ICU MessageFormat in a text, and what it does not.
---

# ICU MessageFormat

A text in the files can use the syntax of
[ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/),
as FormatJS, next-intl and i18next-icu write it. The files stay
[i18next JSON](./i18next.md): only the text of a key changes.

## Arguments

`git8n check` reads each argument of a text, and compares them with those of
the source:

| In the source                                   | Read as      |
| ----------------------------------------------- | ------------ |
| `{name}`                                        | `{name}`     |
| `{n, number}`, `{d, date, short}`               | `{n}`, `{d}` |
| `{count, plural, one {# item} other {# items}}` | `{count}`    |
| `{gender, select, male {He} other {They}}`      | `{gender}`   |
| `{n, selectordinal, one {#st} other {#th}}`     | `{n}`        |

- The format of an argument, after its first comma, can change: `{n, number}`
  and `{n}` are the same argument.
- The branches of a choice are text. `#` is not an argument.
- An argument inside a branch counts: in
  `{count, plural, one {{who} has one} other {{who} has #}}`, the text holds
  `{count}` and `{who}`. A translation whose branches all drop `{who}` loses it.
- `offset:1` and the exact branches `=0`, `=1` are read.
- A translation that renames an argument, `{total}` for `{count}`, loses one
  and adds one: two errors of `placeholders`.

A text can mix the two syntaxes. When it holds an ICU choice, `{{` starts a
branch and not an interpolation of i18next: `one {{who}}` is the branch `one`
that holds `{who}`.

## Quoted text

An apostrophe quotes text, as ICU reads it:

- `''` writes one apostrophe: `It''s {name}` holds `{name}`.
- `'{name}'` writes `{name}` literally. It is text, not an argument.
- In a text with a choice, an apostrophe before `{`, `}` or `#` starts literal
  text, up to the next apostrophe: `one {'#' sold}` writes `#`.

`'{{name}}'` stays an interpolation of i18next: « Delete '{{name}}'? » quotes
the value. An apostrophe that quotes nothing, as in `l'{name}`, is text.

## Plurals

An ICU plural is one key. In each translation, `git8n check` compares the
branches of each `plural` and `selectordinal` with the rules of the language,
from `Intl.PluralRules`: a form that the language needs and that the
translation does not write, or a form that the language never uses, is a
warning of [`icu-plural-forms`](../reference/rules/icu-plural-forms.md). A
Polish plural needs `one`, `few`, `many` and `other`. An exact branch such as
`=0` is always allowed. Exact branches that hold all the numbers of a form
replace it: `=1` replaces `one` in English, but not in French, where `one` is 0
and 1. A form that only a number past 9999 takes, such as the `many` of
French, is allowed and not needed. [i18next JSON](./i18next.md#plurals) gives the forms of
some languages.

## Not supported

- An argument whose name starts with a digit, such as `{0}`: it is not read.
