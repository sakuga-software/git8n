import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkLocales,
  placeholdersOf,
  pluralBranchesOf,
  sourceHashOf,
  type CheckOptions,
  type LocalesReader,
} from './check.ts';
import { fakeIo } from './testing.ts';

/** A working copy in a temporary folder, with these files. */
const workingCopy = async (files: Record<string, unknown>): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'git8n-check-'));

  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }

  return root;
};

const readerOf = (root: string): LocalesReader => ({
  readDir: async (path) => {
    try {
      return (await readdir(join(root, path), { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        directory: entry.isDirectory(),
      }));
    } catch {
      return null;
    }
  },
  readFile: (path) => readFile(join(root, path), 'utf8').catch(() => null),
});

const DEFAULTS: CheckOptions = { locales: null, manifest: null, source: null, languages: null };

const check = async (files: Record<string, unknown>, options: Partial<CheckOptions> = {}) =>
  checkLocales({ ...DEFAULTS, ...options }, readerOf(await workingCopy(files)));

const rulesOf = (report: Awaited<ReturnType<typeof check>>) =>
  report.problems.map((problem) => `${problem.rule} ${problem.language} ${problem.key ?? problem.path}`).sort();

describe('placeholdersOf', () => {
  it('reads the placeholders of i18next, ICU, Trans and printf', () => {
    expect(placeholdersOf('Hi {{ name }}, {{count, number}} items')).toEqual(['{{count}}', '{{name}}']);
    expect(placeholdersOf('See $t(common:legal) and <0>this</0><br/>')).toEqual([
      '$t(common:legal)',
      '</0>',
      '<0>',
      '<br/>',
    ]);
    expect(placeholdersOf('%s of %1$d, {user}')).toEqual(['%1$d', '%s', '{user}']);
  });

  it('reads the variable of an ICU plural, not the text of its branches', () => {
    expect(placeholdersOf('{count, plural, one {# item} other {# items for {owner}}}')).toEqual(['{count}', '{owner}']);
    expect(placeholdersOf('{count, plural, =0 {nothing} other {things}}')).toEqual(['{count}']);
  });

  it('reads a placeholder after a word that ends as a branch, or after a branch word outside ICU', () => {
    expect(placeholdersOf('Thanks to someone {owner}')).toEqual(['{owner}']);
    expect(placeholdersOf('Pick one {item}')).toEqual(['{item}']);
  });

  it('reads the branches of an ICU select as text', () => {
    expect(placeholdersOf('{choice, select, yes {Yes} no {No}}')).toEqual(['{choice}']);
    expect(placeholdersOf('{choice, select, yes {Ja} no {Nein}}')).toEqual(['{choice}']);
    expect(placeholdersOf('{n, plural, offset:1 one {{who}} other {{who} and # more}}')).toEqual(['{n}', '{who}']);
    expect(placeholdersOf('{{name}} has {count, plural, one {# item} other {# items}}')).toEqual([
      '{count}',
      '{{name}}',
    ]);
    expect(placeholdersOf('{count, plural, other {Hi {{name}}}}')).toEqual(['{count}', '{{name}}']);
  });

  it('reads quoted ICU text as text, and keeps a quoted interpolation of i18next', () => {
    expect(placeholdersOf("Write '{name}' to show a name")).toEqual([]);
    expect(placeholdersOf("It''s {name}")).toEqual(['{name}']);
    expect(placeholdersOf("{n, plural, one {'#' and '{x}'} other {# {y}}}")).toEqual(['{n}', '{y}']);
    expect(placeholdersOf("Delete '{{name}}'?")).toEqual(['{{name}}']);
    expect(placeholdersOf("l'{name}")).toEqual(['{name}']);
  });

  it('reads a text with no placeholder as none, and a lone brace as text', () => {
    expect(placeholdersOf('3 < 4 and 50% off {')).toEqual([]);
  });

  it('reads the list and named arguments of vue-i18n', () => {
    expect(placeholdersOf('{0} of {1}, {0} again')).toEqual(['{0}', '{1}']);
    expect(placeholdersOf('{user-id} has {total$} and { name }')).toEqual(['{name}', '{total$}', '{user-id}']);
    expect(placeholdersOf('{0, plural, one {# item} other {# items}}')).toEqual(['{0}']);
    expect(placeholdersOf("{account}{'@'}{domain}")).toEqual(['{account}', '{domain}']);
  });

  it('reads a linked message of vue-i18n as its key, with no modifier', () => {
    const vue = (text: string) => placeholdersOf(text, 'vue-i18n');

    expect(vue('@:message.dio @:message.the_world !!!!')).toEqual(['@:message.dio', '@:message.the_world']);
    expect(vue('Press @.lower:common.ok to go on')).toEqual(['@:common.ok']);
    expect(vue("@.snakeCase:{'message.snake'}")).toEqual(['@:message.snake']);
    expect(vue('@:{target} now')).toEqual(['@:{target}']);
    // vue-i18n ends a key only at a space, `{`, `(`, `)`, `|`, `@` or the end: `!` is part of the key.
    expect(vue('Go to @:nav.home!')).toEqual(['@:nav.home!']);
  });

  it('reads an address, `@` alone and an escaped `\\@:` as text', () => {
    expect(placeholdersOf('Write to team@example.com or @team', 'vue-i18n')).toEqual([]);
    expect(placeholdersOf('Type \\@:key to link', 'vue-i18n')).toEqual([]);
  });

  it('reads `@:` as text with no syntax vue-i18n', () => {
    expect(placeholdersOf('Ping @:smile: and @:common.ok')).toEqual([]);
  });
});

describe('pluralBranchesOf', () => {
  it('counts the branches of a plural of vue-i18n', () => {
    expect(pluralBranchesOf('no car | one car | {count} cars')).toBe(3);
    expect(pluralBranchesOf('car | cars')).toBe(2);
    expect(pluralBranchesOf('Cart')).toBe(1);
  });

  it('reads a `|` in braces, an escaped `\\|` and the `|` of an ICU text as text', () => {
    expect(pluralBranchesOf("a {'|'} b")).toBe(1);
    expect(pluralBranchesOf('a \\| b')).toBe(1);
    expect(pluralBranchesOf('{n, plural, one {a | b} other {c}} | d')).toBe(1);
  });
});

describe('checkLocales', () => {
  const SOURCE = {
    hello: 'Hello {{name}}',
    cart: { empty: 'Your cart is empty', title: 'Cart' },
    items_one: 'One item',
    items_other: '{{count}} items',
    legal: 'Legal notice',
  };

  it('reports missing, empty, extra and broken keys of each language', async () => {
    const report = await check({
      'locales/manifest.json': {
        source: 'en',
        empty: {
          de: { 'common:legal': { source: sourceHashOf('Legal notice') } },
          fr: { 'common:legal': { source: 'a1b2c3d4e5f6' } },
        },
      },
      'locales/en/common.json': SOURCE,
      'locales/de/common.json': {
        hello: 'Hallo {{name}}',
        cart: { empty: 'Dein Warenkorb ist leer' },
        items_one: 'Ein Artikel',
        items_other: '{{count}} Artikel',
        legal: '',
      },
      'locales/fr/common.json': {
        hello: 'Bonjour',
        cart: { empty: '', title: 'Panier', old: 'Ancien' },
        items_one: '{{count}} article',
        items_many: '{{count}} d’articles',
        items_other: '{{count}} articles',
        legal: '',
      },
    });

    expect(report.source).toBe('en');
    expect(report.languages).toEqual(['de', 'fr']);
    expect(rulesOf(report)).toEqual([
      'empty-value fr common:cart.empty',
      'extra-key fr common:cart.old',
      'missing-key de common:cart.title',
      'placeholders fr common:hello',
      'stale-empty fr common:legal',
    ]);
    expect(report.problems.find((problem) => problem.rule === 'placeholders')?.message).toBe(
      'common:hello: lost {{name}}.',
    );
    expect(report.errors).toBe(1);
    expect(report.warnings).toBe(4);
  });

  it('asks each language for its own plural forms, and lets a form other than `other` drop the count', async () => {
    const report = await check(
      {
        'locales/en/common.json': { items_one: 'One item', items_other: '{{count}} items' },
        'locales/pl/common.json': {
          items_one: 'Jeden element',
          items_few: '{{count}} elementy',
          items_many: '{{count}} elementów',
          items_other: '{{count}} elementu',
        },
        'locales/ja/common.json': { items_other: '{{count}} 個' },
        'locales/de/common.json': { items_other: '{{count}} Artikel' },
      },
      { source: 'en' },
    );

    expect(rulesOf(report)).toEqual(['missing-key de common:items_one']);
  });

  it('asks an ordinal for the ordinal forms of its language', async () => {
    const report = await check(
      {
        'locales/en/common.json': {
          place_ordinal_one: '{{count}}st',
          place_ordinal_two: '{{count}}nd',
          place_ordinal_few: '{{count}}rd',
          place_ordinal_other: '{{count}}th',
        },
        'locales/fr/common.json': { place_ordinal_other: '{{count}}e' },
        'locales/de/common.json': { place_ordinal_other: '{{count}}.' },
      },
      { source: 'en' },
    );

    expect(rulesOf(report)).toEqual(['missing-key fr common:place_ordinal_one']);
  });

  it('asks an ICU plural for the forms of its language, in each choice', async () => {
    const report = await check(
      {
        'locales/en/common.json': {
          items: '{count, plural, one {# item} other {# items}}',
          place: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
        },
        'locales/pl/common.json': {
          items: '{count, plural, =0 {nic} one {# element} other {# elementu}}',
          place: '{n, selectordinal, other {#.}}',
        },
        'locales/ja/common.json': {
          items: '{count, plural, one {# 個} other {# 個}}',
          place: '{n, selectordinal, other {#番目}}',
        },
      },
      { source: 'en' },
    );

    expect(report.problems.map(({ rule, language, key, message }) => `${rule} ${language} ${key} ${message}`)).toEqual([
      'icu-plural-forms ja common:items common:items: the plural {count} has one, which ja never uses.',
      'icu-plural-forms pl common:items common:items: the plural {count} has no few many.',
    ]);
  });

  it('asks for no form that only a number past 9999 takes, and keeps it allowed', async () => {
    const report = await check(
      {
        'locales/en/common.json': { items_one: 'One item', items_other: '{{count}} items' },
        'locales/fr/common.json': { items_one: 'Un article', items_other: '{{count}} articles' },
        'locales/it/common.json': {
          items_one: 'Un articolo',
          items_many: 'Un milione di articoli',
          items_other: '{{count}} articoli',
        },
      },
      { source: 'en' },
    );

    expect(rulesOf(report)).toEqual([]);
  });

  it('takes the exact branches of an ICU plural as the forms whose integers they hold', async () => {
    const report = await check(
      {
        'locales/en/common.json': {
          items: '{count, plural, =1 {one item} other {# items}}',
          gifts: '{count, plural, =1 {one gift} other {# gifts}}',
        },
        'locales/de/common.json': {
          items: '{count, plural, =1 {ein Artikel} other {# Artikel}}',
          gifts: '{count, plural, =1 {ein Geschenk} other {# Geschenke}}',
        },
        'locales/fr/common.json': {
          items: '{count, plural, =0 {aucun article} =1 {un article} other {# articles}}',
          gifts: '{count, plural, =1 {un cadeau} other {# cadeaux}}',
        },
        'locales/it/common.json': {
          items: '{count, plural, =1 {un articolo} many {# di articoli} other {# articoli}}',
          gifts: '{count, plural, one {un regalo} other {# regali}}',
        },
      },
      { source: 'en' },
    );

    expect(report.problems.map(({ rule, language, key, message }) => `${rule} ${language} ${key} ${message}`)).toEqual([
      'icu-plural-forms fr common:gifts common:gifts: the plural {count} has no one.',
    ]);
  });

  it('reports a translation that loses a list argument or a linked message of vue-i18n', async () => {
    const report = await check(
      {
        'locales/en/common.json': { ok: 'OK', page: 'Page {0} of {1}', confirm: 'Press @:common.ok to go on' },
        'locales/fr/common.json': { ok: 'OK', page: 'Page {0}', confirm: 'Appuyez sur OK' },
      },
      { source: 'en', syntax: 'vue-i18n' },
    );

    expect(report.problems.map((problem) => problem.message).sort()).toEqual([
      'common:confirm: lost @:common.ok.',
      'common:page: lost {1}.',
    ]);
  });

  it('reports a linked message whose key is in no file of the source', async () => {
    const report = await check(
      {
        'locales/en/common.json': { ok: 'OK', nav: { home: 'Home' } },
        'locales/en/home.json': {
          short: 'Press @:ok',
          long: 'Press @.upper:ok or @:nav.home and @:{page}',
          broken: 'Back to @:nav.home!',
          lost: 'Press @:common.okay',
        },
        'locales/fr/common.json': { ok: 'OK', nav: { home: 'Accueil' } },
        'locales/fr/home.json': {
          short: 'Appuyez sur @:ok',
          long: 'Appuyez sur @:ok ou @:nav.home et @:{page}',
          broken: 'Retour à @:nav.home!',
          lost: 'Appuyez sur @:common.okay',
        },
      },
      { source: 'en', syntax: 'vue-i18n' },
    );

    expect(rulesOf(report)).toEqual(['unknown-link en home:broken', 'unknown-link en home:lost']);
    expect(report.problems.map((problem) => problem.message)).toEqual([
      'home:broken links to @:nav.home!, which is a key of no file of en.',
      'home:lost links to @:common.okay, which is a key of no file of en.',
    ]);
    expect(report.errors).toBe(2);
  });

  it('reports a link that only the other merge of the files resolves', async () => {
    const files = (links: Record<string, string>) => ({
      'locales/en/common.json': { ok: 'OK', save: 'Save' },
      'locales/en/home.json': links,
      'locales/fr/common.json': { ok: 'OK', save: 'Enregistrer' },
      'locales/fr/home.json': links,
    });
    const linksIn = async (links: Record<string, string>) =>
      (await check(files(links), { source: 'en', syntax: 'vue-i18n' })).problems.map((problem) => problem.message);

    // One merge resolves every link: flat, or one object for each file.
    expect(await linksIn({ a: '@:ok', b: '@:save' })).toEqual([]);
    expect(await linksIn({ a: '@:common.ok', b: '@:common.save' })).toEqual([]);
    // The two forms mixed: the merge of the most links wins, and the other links are reported.
    expect(await linksIn({ a: '@:ok', b: '@:common.save', c: '@:common.ok' })).toEqual([
      'home:a links to @:ok, but the other links of en name the file of their key, as @:common.save.',
    ]);
    expect(await linksIn({ a: '@:ok', b: '@:save', c: '@:common.ok' })).toEqual([
      'home:c links to @:common.ok, but the other links of en name a key with no file, as @:ok.',
    ]);
  });

  it('warns on a plural of vue-i18n whose translation has other branches than the source', async () => {
    const report = await check(
      {
        'locales/en/common.json': {
          cars: 'no car | one car | {count} cars',
          apples: 'apple | apples',
          pears: 'pear | pears',
          title: 'Home',
        },
        'locales/fr/common.json': {
          cars: 'une voiture | {count} voitures',
          apples: 'pomme | pommes',
          pears: 'poires',
          title: 'Accueil | Acme',
        },
      },
      { source: 'en', syntax: 'vue-i18n' },
    );

    // A `|` that the translation adds to a plain text is text.
    expect(rulesOf(report)).toEqual(['plural-branches fr common:cars', 'plural-branches fr common:pears']);
    expect(report.problems.map((problem) => problem.message)).toEqual([
      'common:cars: 2 branches, and the source has 3.',
      'common:pears: 1 branch, and the source has 2.',
    ]);
    expect(report.warnings).toBe(2);
  });

  it('reads no link and no `|` plural with no syntax vue-i18n', async () => {
    const report = await check(
      {
        'locales/en/common.json': { ping: 'Ping @:smile:', title: 'Save | Cancel' },
        'locales/fr/common.json': { ping: 'Ping @:smile:', title: 'Enregistrer' },
      },
      { source: 'en' },
    );

    expect(report.problems).toEqual([]);
  });

  it('reads a key that ends with _other as a plain key, unless the source has one plural form only', async () => {
    const plain = await check(
      {
        'locales/en/common.json': { contact_other: 'Other contact' },
        'locales/de/common.json': { contact_other: 'Andere' },
      },
      { source: 'en' },
    );
    const japanese = await check(
      {
        'locales/ja/common.json': { items_other: '{{count}} 個' },
        'locales/de/common.json': { items_other: '{{count}} Artikel' },
      },
      { source: 'ja' },
    );

    expect(rulesOf(plain)).toEqual([]);
    expect(rulesOf(japanese)).toEqual(['missing-key de common:items_one']);
  });

  it('leaves out a file that the manifest disables, and a file name that the editor refuses', async () => {
    const report = await check({
      'locales/manifest.json': { source: 'en', files: { legacy: { de: 'disabled' } } },
      'locales/en/common.json': { ok: 'OK' },
      'locales/en/legacy.json': { old: 'Old' },
      'locales/en/common.v2.json': { ok: 'OK' },
      'locales/de/common.json': { ok: 'OK' },
      'locales/de/extra.json': { more: 'Mehr' },
    });

    expect(rulesOf(report)).toEqual([
      'extra-file de locales/de/extra.json',
      'skipped-file en locales/en/common.v2.json',
    ]);
  });

  it('reports a file that does not parse, and a value that is not a string', async () => {
    const report = await check(
      {
        'locales/en/common.json': { count: 3, ok: 'OK' },
        'locales/de/common.json': '{ "ok": "OK", }',
      },
      { source: 'en' },
    );

    expect(rulesOf(report)).toEqual(['invalid-json de locales/de/common.json', 'not-a-string en common:count']);
  });

  it('keeps the rest of a manifest when one file state is wrong', async () => {
    const report = await check(
      {
        'locales/manifest.json': {
          source: 'en',
          files: { legacy: { de: 'disabled' }, common: { de: 'off' } },
          empty: { de: { 'common:legal': { source: sourceHashOf('Legal') } } },
        },
        'locales/en/common.json': { legal: 'Legal' },
        'locales/en/legacy.json': { old: 'Old' },
        'locales/de/common.json': { legal: '' },
      },
      { source: 'en' },
    );

    expect(rulesOf(report)).toEqual(['invalid-manifest  locales/manifest.json']);
    expect(report.problems[0]?.message).toContain('files.common.de is not available, partial or disabled');
  });

  it('answers the error of a manifest that does not parse, even when it hides the source', async () => {
    const report = await check({ 'locales/manifest.json': '{ "source": "en", }', 'locales/en/a.json': {} });

    expect(rulesOf(report)).toEqual(['invalid-manifest  locales/manifest.json']);
    expect(report.errors).toBe(1);
  });

  it('finds the locales folder, and refuses a setup it cannot read', async () => {
    const files = { 'src/locales/en/common.json': { ok: 'OK' }, 'src/locales/de/common.json': { ok: 'OK' } };

    expect((await check(files, { source: 'en' })).locales).toBe('src/locales');
    await expect(check(files)).rejects.toThrow('No source language');
    await expect(check(files, { source: 'en', languages: ['it'] })).rejects.toThrow('No folder for it');
    await expect(check({ 'README.md': '' }, { source: 'en' })).rejects.toThrow('No folder of locales');
    await expect(
      check({ 'locales/manifest.json': { source: 'fr' }, 'locales/en/a.json': {} }, { source: 'en' }),
    ).rejects.toThrow('the manifest names fr');
  });
});

describe('git8n check', () => {
  const FILES = {
    'locales/en/common.json': { hello: 'Hello {{name}}', bye: 'Bye' },
    'locales/de/common.json': { hello: 'Hallo {{name}}' },
  };

  /** The command line in a working copy, with the real files. Any call to the API fails the test. */
  const cliIn = async (files: Record<string, unknown>) => {
    const root = await workingCopy(files);
    const reader = readerOf('/');

    return fakeIo(
      async (url) => {
        throw new Error(`check called the API: ${url}`);
      },
      {
        cwd: root,
        readDir: reader.readDir,
        readFile: (path) => readFile(path, 'utf8'),
      },
    );
  };

  it('passes with warnings, and fails past --max-warnings', async () => {
    const cli = await cliIn(FILES);

    const pretty = await cli.run('check', '--source', 'en');

    expect(pretty.exit).toBe(0);
    expect(pretty.stdout).toBe(
      'locales/de/common.json\n' +
        '  warning  common:bye has no de text.  missing-key\n' +
        '\n' +
        'Read more:\n' +
        '  missing-key  https://git8n.sakuga.dev/docs/reference/rules/missing-key.html\n' +
        '\n' +
        '0 errors, 1 warning in 2 files (en → de, 2 keys).\n',
    );
    expect((await cli.run('check', '--source', 'en', '--max-warnings', '1')).exit).toBe(0);
    expect((await cli.run('check', '--source', 'en', '--max-warnings', '0')).exit).toBe(1);
  });

  it('fails on an error, and writes annotations for GitHub Actions', async () => {
    const cli = await cliIn({ ...FILES, 'locales/de/common.json': { hello: 'Hallo', bye: 'Tschüss' } });

    const github = await cli.run('check', '--source', 'en', '--reporter', 'github');

    expect(github.exit).toBe(1);
    expect(github.stdout).toBe(
      '::error file=locales/de/common.json,title=i18n placeholders::common:hello: lost {{name}}. https://git8n.sakuga.dev/docs/reference/rules/placeholders.html\n' +
        '1 error, 0 warnings in 2 files (en → de, 2 keys).\n',
    );
  });

  it('answers the report as JSON, and a usage error with its code', async () => {
    const cli = await cliIn(FILES);

    const ran = await cli.run('check', '--source', 'en', '--json');

    expect(ran.exit).toBe(0);
    expect(ran.json().data).toMatchObject({
      source: 'en',
      languages: ['de'],
      errors: 0,
      warnings: 1,
      failed: false,
      maxWarnings: null,
      problems: [{ rule: 'missing-key', docs: 'https://git8n.sakuga.dev/docs/reference/rules/missing-key.html' }],
    });

    const refused = await cli.run('check', '--json');

    expect(refused.exit).toBe(2);
    expect(refused.json().error).toMatchObject({
      code: 'G8N1005',
      docs: 'https://git8n.sakuga.dev/docs/reference/errors/g8n1005.html',
    });
    expect((await cli.run('check', '--reporter', 'xml')).exit).toBe(2);
  });

  it('reads the links of vue-i18n with --syntax vue-i18n, and refuses another syntax', async () => {
    const cli = await cliIn({
      'locales/en/common.json': { ok: 'OK', confirm: 'Press @:common.ok' },
      'locales/fr/common.json': { ok: 'OK', confirm: 'Appuyez sur OK' },
    });

    expect((await cli.run('check', '--source', 'en')).exit).toBe(0);

    const vue = await cli.run('check', '--source', 'en', '--syntax', 'vue-i18n', '--json');

    expect(vue.exit).toBe(1);
    expect(vue.json().data.problems).toMatchObject([
      { rule: 'placeholders', message: 'common:confirm: lost @:common.ok.' },
    ]);

    const refused = await cli.run('check', '--source', 'en', '--syntax', 'vue', '--json');

    expect(refused.exit).toBe(2);
    expect(refused.json().error).toMatchObject({
      code: 'G8N1001',
      message: '--syntax takes one of i18next, vue-i18n.',
    });
  });
});
