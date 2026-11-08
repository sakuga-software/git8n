/**
 * The rules of `git8n check`, and what the documentation says of each one (DB-672, G8N-82).
 *
 * The check reads `severity`. The site of the documentation makes one page of each rule from the
 * rest, and runs `invalid` and `valid` through the check to show its real output.
 */

export type Severity = 'error' | 'warning';

/** The syntaxes of the texts that `check` reads. `i18next` also reads ICU MessageFormat. */
export const SYNTAXES = ['i18next', 'vue-i18n'] as const;

export type Syntax = (typeof SYNTAXES)[number];

/** Locale files by their path under `locales/`. The source language is `en`. */
export type Example = Record<string, string>;

export interface RuleEntry {
  severity: Severity;
  /** One line: what the rule finds. */
  title: string;
  /** Why the problem matters for the product that reads the files. */
  why: string;
  /** What to do. For a warning, also how to let it pass. */
  fix: string;
  /** Files that break the rule, and only this rule. */
  invalid: Example;
  /** The same files, fixed. `check` finds nothing in them. */
  valid: Example;
  /** The `--syntax` that the rule needs. Default: `i18next`. */
  syntax?: Syntax;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export const RULES = {
  'invalid-json': {
    severity: 'error',
    title: 'The file is not a JSON object.',
    why: 'The application cannot load a file that does not parse, and the editor cannot read it or write it. Every key of the file is then missing in this language.',
    fix: 'Correct the JSON: a trailing comma, a missing quote and a comment are the usual causes. The top of the file must be an object.',
    invalid: {
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': '{\n  "title": "Bonjour",\n}\n',
    },
    valid: {
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour' }),
    },
  },
  'invalid-manifest': {
    severity: 'error',
    title: 'The manifest is not valid.',
    why: 'The manifest tells the editor which files a language disables and which keys stay empty on purpose. A wrong entry is ignored, so the editor and the check read another state than the one you wrote.',
    fix: 'Correct the manifest: it is a JSON object, its `source` is a language, and the state of a file is `available`, `partial` or `disabled`.',
    invalid: {
      'manifest.json': json({ files: { common: { fr: 'done' } } }),
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour' }),
    },
    valid: {
      'manifest.json': json({ files: { common: { fr: 'partial' } } }),
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour' }),
    },
  },
  'not-a-string': {
    severity: 'error',
    title: 'A value is not a string or an object.',
    why: 'i18next reads a string, or an object of more keys. A number, an array or `null` shows as a broken text, and the editor cannot write it.',
    fix: 'Write the text as a string. Put a list in more keys, or join it in one text.',
    invalid: {
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour', tags: ['nouveau', 'promo'] }),
    },
    valid: {
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour' }),
    },
  },
  placeholders: {
    severity: 'error',
    title: 'The translation does not keep the placeholders of the source.',
    why: 'The application fills each placeholder with a value. A translation that loses one hides the value, and a translation that adds one shows the raw placeholder.',
    fix: 'Keep every placeholder of the source in the translation: `{{name}}`, `{name}`, `{0}`, `$t(…)`, a tag such as `<0>` or `<br/>`, `%s`, and with `--syntax vue-i18n` a linked message `@:key`. The branches of an ICU plural are text: translate them. The modifier of a linked message, `@.lower:key`, can change.',
    invalid: {
      'en/common.json': json({ greeting: 'Hello {{name}}' }),
      'fr/common.json': json({ greeting: 'Bonjour' }),
    },
    valid: {
      'en/common.json': json({ greeting: 'Hello {{name}}' }),
      'fr/common.json': json({ greeting: 'Bonjour {{name}}' }),
    },
  },
  'icu-plural-forms': {
    severity: 'warning',
    title: 'An ICU plural does not have the forms of its language.',
    why: 'An ICU plural picks a branch by the plural rules of the language. A form that the translation does not write shows the text of `other`, so a Polish « 5 elementów » becomes « 5 elementy ». A form that the language never uses is text that nobody reads.',
    fix: 'Write a branch for each form of the language, and delete the others. Polish needs `one`, `few`, `many` and `other`; Japanese needs `other` only. An exact branch such as `=0` is always allowed, and exact branches that hold all the numbers of a form replace it: `=1` replaces `one` in English, but not in French, where `one` is 0 and 1. A form that only a number past 9999 takes, such as the `many` of French, is allowed and not needed.',
    invalid: {
      'en/common.json': json({ items: '{count, plural, one {# item} other {# items}}' }),
      'pl/common.json': json({ items: '{count, plural, one {# element} other {# elementu}}' }),
    },
    valid: {
      'en/common.json': json({ items: '{count, plural, one {# item} other {# items}}' }),
      'pl/common.json': json({
        items: '{count, plural, one {# element} few {# elementy} many {# elementów} other {# elementu}}',
      }),
      'fr/common.json': json({ items: '{count, plural, =0 {aucun article} =1 {# article} other {# articles}}' }),
    },
  },
  'unknown-link': {
    severity: 'error',
    syntax: 'vue-i18n',
    title: 'A linked message of vue-i18n names a key that does not exist.',
    why: 'vue-i18n writes the text of the key in place of `@:key`. The rule runs with `--syntax vue-i18n` only. A key that no file holds shows the key itself, and vue-i18n warns in the console. The key ends only at a space, `{`, `(`, `)`, `|` or `@`, so in `@:nav.home!` the key is `nav.home!`.',
    fix: "Name a key of the source: `ok` or `common.ok` for the key `ok` of `common.json`. Put a space or a literal, `{'!'}`, between the key and the text that follows it.",
    invalid: {
      'en/common.json': json({ ok: 'OK', confirm: 'Press @:common.okay' }),
      'fr/common.json': json({ ok: 'OK', confirm: 'Appuyez sur @:common.okay' }),
    },
    valid: {
      'en/common.json': json({ ok: 'OK', confirm: 'Press @:common.ok' }),
      'fr/common.json': json({ ok: 'OK', confirm: 'Appuyez sur @:common.ok' }),
    },
  },
  'plural-branches': {
    severity: 'warning',
    syntax: 'vue-i18n',
    title: 'A plural of vue-i18n does not have the branches of the source.',
    why: 'vue-i18n picks a branch of `no car | one car | {count} cars` by the number of its branches: with 2, the first is for 1; with 3, the first is for 0 and the second for 1. A translation with other branches shows the wrong one. Only a source with branches is read as a plural, and a text with an ICU choice is never one. The rule runs with `--syntax vue-i18n` only.',
    fix: "Write as many branches as the source, separated by `|`. Write `{'|'}` for a `|` that is text. If the application sets `pluralRules` for this language, its number of branches can differ: `--max-warnings` lets a number of warnings pass.",
    invalid: {
      'en/common.json': json({ cars: 'no car | one car | {count} cars' }),
      'fr/common.json': json({ cars: 'une voiture | {count} voitures' }),
    },
    valid: {
      'en/common.json': json({ cars: 'no car | one car | {count} cars' }),
      'fr/common.json': json({ cars: 'aucune voiture | une voiture | {count} voitures' }),
    },
  },
  'missing-key': {
    severity: 'warning',
    title: 'A key of the source has no translation.',
    why: 'The application shows the text of the fallback language, or the key itself, in place of the translation.',
    fix: 'Translate the key, in the editor or with `git8n apply`. If the whole file must stay untranslated in this language, mark it `disabled` in the manifest. `--max-warnings` lets a number of warnings pass.',
    invalid: {
      'en/common.json': json({ title: 'Hello', save: 'Save' }),
      'fr/common.json': json({ title: 'Bonjour' }),
    },
    valid: {
      'en/common.json': json({ title: 'Hello', save: 'Save' }),
      'fr/common.json': json({ title: 'Bonjour', save: 'Enregistrer' }),
    },
  },
  'empty-value': {
    severity: 'warning',
    title: 'A translation is empty, and the manifest does not mark it.',
    why: 'An empty text shows nothing. It is often a key that somebody forgot, but some texts are empty on purpose in a language.',
    fix: 'Translate the key. If the text must stay empty, mark it in the editor (« vide voulu »): the manifest then records the source text it was empty for.',
    invalid: {
      'en/common.json': json({ suffix: 'Ltd' }),
      'fr/common.json': json({ suffix: '' }),
    },
    valid: {
      'manifest.json': json({ empty: { fr: { 'common:suffix': { source: '0e6cd0ce0450' } } } }),
      'en/common.json': json({ suffix: 'Ltd' }),
      'fr/common.json': json({ suffix: '' }),
    },
  },
  'stale-empty': {
    severity: 'warning',
    title: 'A key is empty on purpose, but its source changed since.',
    why: 'The mark says that the text is empty for one source text. The source changed, so the empty text can now be wrong.',
    fix: 'Read the new source. Translate the key, or mark it empty again in the editor: the mark then records the new source text.',
    invalid: {
      'manifest.json': json({ empty: { fr: { 'common:suffix': { source: '0e6cd0ce0450' } } } }),
      'en/common.json': json({ suffix: 'Inc.' }),
      'fr/common.json': json({ suffix: '' }),
    },
    valid: {
      'manifest.json': json({ empty: { fr: { 'common:suffix': { source: '57d4cdfb579e' } } } }),
      'en/common.json': json({ suffix: 'Inc.' }),
      'fr/common.json': json({ suffix: '' }),
    },
  },
  'empty-source': {
    severity: 'warning',
    title: 'A text of the source is empty.',
    why: 'A translator has nothing to translate, and every language gets an empty text.',
    fix: 'Write the text of the source, or delete the key.',
    invalid: {
      'en/common.json': json({ title: '' }),
      'fr/common.json': json({ title: 'Bonjour' }),
    },
    valid: {
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour' }),
    },
  },
  'extra-key': {
    severity: 'warning',
    title: 'A key is not in the source.',
    why: 'The application never asks for the key. It is often a key that the source renamed or deleted, and its translation is lost work.',
    fix: 'Delete the key, or move its text to the new key of the source. A plural form that the language does not need is an extra key too.',
    invalid: {
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour', welcome: 'Bienvenue' }),
    },
    valid: {
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour' }),
    },
  },
  'extra-file': {
    severity: 'warning',
    title: 'A file has no version in the source.',
    why: 'The editor reads the files of the source. A file of a language alone is a file that nobody can see or translate there.',
    fix: 'Delete the file, or add its version to the source.',
    invalid: {
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour' }),
      'fr/legacy.json': json({ title: 'Ancien' }),
    },
    valid: {
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour' }),
    },
  },
  'skipped-file': {
    severity: 'warning',
    title: 'The editor leaves out a file with this name.',
    why: 'The name of a file is the namespace of its keys. The editor reads only names of letters, digits, `-` and `_`, so it does not show this file.',
    fix: 'Rename the file in each language, for example `common.v2.json` to `common-v2.json`.',
    invalid: {
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour' }),
      'en/common.v2.json': json({ save: 'Save' }),
      'fr/common.v2.json': json({ save: 'Enregistrer' }),
    },
    valid: {
      'en/common.json': json({ title: 'Hello' }),
      'fr/common.json': json({ title: 'Bonjour' }),
      'en/common-v2.json': json({ save: 'Save' }),
      'fr/common-v2.json': json({ save: 'Enregistrer' }),
    },
  },
} as const satisfies Record<string, RuleEntry>;

export type Rule = keyof typeof RULES;
