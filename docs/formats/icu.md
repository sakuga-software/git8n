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

## Plurals

An ICU plural is one key. `git8n check` does not compare its branches with the
plural rules of the language: a Polish translation with only `one` and `other`
passes, and needs `few` and `many` to be right. Write a plural of i18next, one
key for each form, for `git8n check` to ask for each form. [i18next
JSON](./i18next.md#plurals) gives the rules.

## Not supported

- **Quoted text.** `'{name}'` writes `{name}` literally in ICU, but
  `git8n check` reads it as an argument. A translation that leaves it out is
  an error.
- **The branches of a plural**, against the rules of the language: see above.
- An argument whose name starts with a digit, such as `{0}`: it is not read.
