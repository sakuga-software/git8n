# i18next JSON

The JSON files of [i18next](https://www.i18next.com), as react-i18next and
next-i18next read them, are the format of git8n.

## The folders

One folder for each language, named with its tag. One file is one namespace:

```
locales/
├── manifest.json     optional
├── en/
│   ├── common.json
│   └── checkout.json
└── fr/
    ├── common.json
    └── checkout.json
```

- A file name holds only letters, digits, `-` and `_`. A file such as
  `common.v2.json` is left out: `git8n check` warns (`skipped-file`), and the
  API writes a warning to its log.
- A file of the source must exist in the source folder. A file that a target
  language does not have yet is a file of missing keys.
- One file for each language, such as `locales/en.json`, is **not** read. Put
  it in `locales/en/translation.json`. [Libraries](./libraries.md) tells how
  each library loads that layout.

[A repository and its files](../guide/repositories.md#the-files) gives every
field of a repository.

## The keys

A file is an object. Each string has a key, the dotted path to it, as i18next
reads it:

```json
{ "cart": { "title": "Your cart", "empty": "Nothing here" } }
```

gives the keys `cart.title` and `cart.empty`.

- A key can be **nested** (`{ "cart": { "empty": "…" } }`) or **flat**, with
  a dot in its name (`{ "cart.empty": "…" }`, i18next with
  `keySeparator: false`). Both give the key `cart.empty`. The editor changes a
  key in the shape that the file gives it. A new key is flat in an object whose
  keys hold dots and that holds no object, and nested everywhere else.
- If a file holds one key in both shapes, a read keeps the last one in the
  file. A change of that key writes the new value in both, so that the read
  sees it.
- A value is a string. A number, an array or `null` is an error of
  `git8n check` (`not-a-string`). The editor shows such a value as one text
  (`["a", "b"]` shows `a,b`), and a translation replaces it with a string. The
  arrays of `returnObjects` are thus not supported.
- A key cannot hold an empty segment (`cart..empty`), nor name `__proto__`,
  `constructor` or `prototype`.

The editor keeps the order of the keys, the indentation and the escapes of a
file: a change replaces only its own value, and a new key adds one line.

## Placeholders

`git8n check` compares the placeholders of each translation with those of its
source. A translation that loses or adds one is an error (`placeholders`).

| Placeholder    | Example                           | Read as                 |
| -------------- | --------------------------------- | ----------------------- |
| Interpolation  | `{{name}}`, `{{count, number}}`   | `{{name}}`, `{{count}}` |
| Nesting        | `$t(cart.title)`                  | `$t(cart.title)`        |
| `<Trans>` tags | `<0>Pay</0>`, `<strong>`, `<br/>` | each tag                |
| printf         | `%s`, `%d`, `%1$s`                | each one                |

The format of an interpolation, after the comma, can change: `{{count, number}}`
and `{{count}}` are the same placeholder.

## Plurals

A plural is a key with a suffix of each form: `_zero`, `_one`, `_two`, `_few`,
`_many`, `_other`. A key counts as a plural when the source has its form
`_other` and one more form. A source language with one form only, such as
Japanese, writes `_other` alone.

```json
{ "items_one": "{{count}} item", "items_other": "{{count}} items" }
```

Each target language needs the forms of its own rules, from
`Intl.PluralRules`:

| Language | Forms                           |
| -------- | ------------------------------- |
| `en`     | `one`, `other`                  |
| `fr`     | `one`, `other` (`many` allowed) |
| `pl`     | `one`, `few`, `many`, `other`   |
| `ja`     | `other`                         |

A form that a language needs and does not have is a warning of
`git8n check` (`missing-key`). A form that only a number past 9999 takes is
allowed and not needed: the `many` of French or Italian is for « 1 million
d'articles », and with no `_many` i18next shows `_other`. A form other than `_other` can leave out
`{{count}}`: « One item » is a correct `_one`.

An ordinal, `t('place', { count, ordinal: true })`, writes the forms with
`_ordinal_`: `place_ordinal_one`, `place_ordinal_two`, `place_ordinal_few`,
`place_ordinal_other`. Each target language needs the forms of its ordinal
rules, which are not those of its cardinal rules: English needs `one`, `two`,
`few` and `other`, French `one` and `other`, Polish `other` only.

The editor does not know plurals. It shows `items_one` and `items_other` as two
keys, and it does not list a form that the source does not have, such as the
`_few` of Polish. Only `git8n check` asks for it.

## Context

A key with a context, such as `friend_male` and `friend_female`, is an ordinary
key for git8n. Each one is translated on its own.

## Not supported

- One file for each language (`locales/en.json`).
- The plurals of i18next v3 and older (`key_plural`, `key_0`). git8n reads
  them as ordinary keys: `git8n check` does not ask for the forms of each
  language.
- Values that are not strings: arrays, numbers, objects as values.
- The formats of [Formats](./index.md#not-supported): YAML, gettext, XLIFF,
  ARB.
