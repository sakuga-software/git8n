import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLocales, placeholdersOf, sourceHashOf, type CheckOptions, type LocalesReader } from './check.ts';
import { fakeIo } from './testing.ts';

/** A working copy in a temporary folder, with these files. */
const workingCopy = async (files: Record<string, unknown>): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'i18n-editor-check-'));

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

  it('reads a text with no placeholder as none, and a lone brace as text', () => {
    expect(placeholdersOf('3 < 4 and 50% off {')).toEqual([]);
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

describe('i18n-editor check', () => {
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
      '::error file=locales/de/common.json,title=i18n placeholders::common:hello: lost {{name}}.\n' +
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
    });

    const refused = await cli.run('check', '--json');

    expect(refused.exit).toBe(2);
    expect(refused.json().error.code).toBe('I18NE1005');
    expect((await cli.run('check', '--reporter', 'xml')).exit).toBe(2);
  });
});
