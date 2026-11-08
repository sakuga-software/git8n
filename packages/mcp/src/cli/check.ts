import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ruleUrl } from './docs.ts';
import { type Example, RULES, type Rule, type Severity, type Syntax } from './rules.ts';

/**
 * `git8n check`: the locale files of a folder, read with no server (DB-672).
 *
 * It applies the rules of the editor (docs/guide/repositories.md) to the files
 * of a working copy, so the CI of a repository can refuse a broken file before
 * it reaches the base branch.
 */

export { RULES, SYNTAXES, type Rule, type Severity, type Syntax } from './rules.ts';

export interface Problem {
  rule: Rule;
  severity: Severity;
  /** The path of the file, from the folder where the command runs. */
  path: string;
  language: string;
  /** `<file>:<key>`, or null for a problem of a whole file. */
  key: string | null;
  message: string;
}

export interface CheckReport {
  locales: string;
  source: string;
  languages: string[];
  files: number;
  keys: number;
  errors: number;
  warnings: number;
  problems: Problem[];
}

export interface Entry {
  name: string;
  directory: boolean;
}

/** What `check` reads. A missing path answers null. */
export interface LocalesReader {
  readDir: (path: string) => Promise<Entry[] | null>;
  readFile: (path: string) => Promise<string | null>;
}

export class CheckSetupError extends Error {
  constructor(message: string) {
    super(message);

    this.name = 'CheckSetupError';
  }
}

/** The folders that `check` tries, in this order, when no `--locales` is given. */
export const LOCALES_GUESSES = ['locales', 'src/locales', 'public/locales', 'src/i18n/locales', 'i18n'];

/** The name rule of the editor for a file (packages/api/src/schemas/i18n.ts, `fileName`). */
const FILE_NAME = /^[A-Za-z0-9_-]+$/;

type FileState = 'available' | 'partial' | 'disabled';

interface Manifest {
  source?: string;
  states: Map<string, FileState>;
  /** The hash of each mark, by `<language>\n<file>:<key>`. */
  marks: Map<string, string>;
}

/** The hash a mark records: the first 12 hexadecimal digits of the SHA-256 of the source text. */
export const sourceHashOf = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The dotted paths of an object, as i18next reads its keys. */
const pathsOf = (node: Record<string, unknown>, prefix = ''): Array<[string, unknown]> =>
  Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    return isObject(value) ? pathsOf(value, path) : [[path, value] as [string, unknown]];
  });

/** The text between a `{` at `open` and its own `}`, or null when it is not closed. */
const groupAt = (text: string, open: number): { inner: string; end: number } | null => {
  let depth = 0;

  for (let at = open; at < text.length; at += 1) {
    if (text[at] === '{') depth += 1;
    if (text[at] === '}') depth -= 1;
    if (depth === 0) return { inner: text.slice(open + 1, at), end: at + 1 };
  }

  return null;
};

/**
 * The name of an argument: `{name}`, or the index of a list, `{0}`.
 *
 * vue-i18n also writes `-` and `$` in a name: `{user-id}`, `{total$}`.
 */
const NAME = String.raw`(?:[A-Za-z_][\w.$-]*|\d+)`;

/** A text with an ICU `plural`, `select` or `selectordinal`. */
const ICU_CHOICE = new RegExp(String.raw`\{\s*${NAME}\s*,\s*(?:plural|select|selectordinal)\s*,`);

/**
 * The text with the literal parts of ICU quoting replaced by a space:
 *
 * - `''` is one apostrophe;
 * - `'{name}'` is literal text, also in a text with no choice;
 * - in a text with a choice, a `'` before `{`, `}` or `#` starts literal text up to the next `'`, as ICU reads it.
 *
 * `'{{name}}'` stays an interpolation of i18next: « Delete '{{name}}'? » quotes a value, not a syntax.
 */
const unquoted = (text: string): string => {
  const choice = ICU_CHOICE.test(text);
  let out = '';

  for (let at = 0; at < text.length; at += 1) {
    const next = text[at + 1];

    if (text[at] !== "'") {
      out += text[at];
    } else if (next === "'") {
      out += "'";
      at += 1;
    } else if (next === '{' && text[at + 2] !== '{' && text[groupAt(text, at + 1)?.end ?? -1] === "'") {
      out += ' ';
      at = groupAt(text, at + 1)!.end;
    } else if (choice && (next === '{' || next === '}' || next === '#')) {
      const close = text.indexOf("'", at + 1);

      out += ' ';
      at = close === -1 ? text.length : close;
    } else {
      out += text[at];
    }
  }

  return out;
};

/**
 * The inside of a group `{{name}}` of i18next, in a text that also holds an ICU choice.
 *
 * A branch `one {{who}}` is read first as the branch, so its inside `{who}` stays an ICU argument.
 */
const I18NEXT_GROUP = /^\{\s*([^{},]+?)\s*(?:,[^{}]*)?\}$/;

/** `name, plural, …`: an ICU argument. A choice holds its branches after the second comma. */
const ICU_ARGUMENT = new RegExp(
  String.raw`^\s*(${NAME})\s*(?:,\s*(plural|select|selectordinal)\s*,([\s\S]*))?(?:,[^{}]*)?$`,
);

/**
 * Adds the ICU arguments of a text: `{name}`, and the variable of a choice.
 *
 * The branches of a choice (`one {# item}`, `yes {Yes}`) are text, so only
 * the arguments inside them count.
 */
const addIcuArguments = (text: string, found: Set<string>): void => {
  for (let at = text.indexOf('{'); at !== -1; at = text.indexOf('{', at)) {
    const group = groupAt(text, at);

    if (!group) return;

    const argument = ICU_ARGUMENT.exec(group.inner);
    const interpolation = I18NEXT_GROUP.exec(group.inner);

    if (interpolation) {
      found.add(`{{${interpolation[1]}}}`);
    } else if (argument) {
      found.add(`{${argument[1]}}`);

      if (argument[2]) {
        const branches = argument[3]!.replace(/^\s*offset:\s*\d+/, '');

        for (let open = branches.indexOf('{'); open !== -1; open = branches.indexOf('{', open)) {
          const branch = groupAt(branches, open);

          if (!branch) break;
          addIcuArguments(branch.inner, found);
          open = branch.end;
        }
      }
    }

    at = group.end;
  }
};

/** An ICU `plural` or `selectordinal` of a text, the categories that its branches name, and its exact branches. */
interface IcuPlural {
  name: string;
  type: Intl.PluralRuleType;
  categories: string[];
  exact: number[];
}

/** The ICU plurals of a text, also inside the branches of a choice. `=0` is an exact branch, not a category. */
export const icuPluralsOf = (text: string): IcuPlural[] => {
  const plurals: IcuPlural[] = [];
  const walk = (part: string) => {
    for (let at = part.indexOf('{'); at !== -1; at = part.indexOf('{', at)) {
      const group = groupAt(part, at);

      if (!group) return;

      const argument = ICU_ARGUMENT.exec(group.inner);

      if (argument?.[2]) {
        const branches = argument[3]!.replace(/^\s*offset:\s*\d+/, '');
        const categories: string[] = [];
        const exact: number[] = [];

        for (let open = branches.indexOf('{'); open !== -1; open = branches.indexOf('{', open)) {
          const branch = groupAt(branches, open);

          if (!branch) break;

          const selector = /(\S+)\s*$/.exec(branches.slice(0, open))?.[1] ?? '';

          if (!selector.startsWith('=')) categories.push(selector);
          else if (/^=\d+$/.test(selector)) exact.push(Number(selector.slice(1)));
          walk(branch.inner);
          open = branch.end;
        }
        if (argument[2] !== 'select') {
          plurals.push({
            name: argument[1]!,
            type: argument[2] === 'plural' ? 'cardinal' : 'ordinal',
            categories,
            exact,
          });
        }
      }

      at = group.end;
    }
  };

  if (ICU_CHOICE.test(text)) walk(unquoted(text));

  return plurals;
};

/**
 * A linked message of vue-i18n: `@:key`, `@.lower:key`, `@:{'key'}`, or `@:{name}` (a key from a value).
 *
 * The key ends at a space, `{`, `(`, `)`, `|`, `@` or the end of the text, as vue-i18n reads it. So in
 * `@:nav.home!` the key is `nav.home!`. `\@` is text.
 */
const LINK = new RegExp(
  String.raw`(?<!\\)@(?:\.[\w$]+)?:(?:\{\s*'([^']*)'\s*\}|(\{\s*${NAME}\s*\})|([^ {()|@]+))`,
  'g',
);

/** The keys that the linked messages of a text name. A key from a value, `@:{name}`, is not one. */
export const linksOf = (text: string): string[] =>
  [...unquoted(text).matchAll(LINK)].flatMap((match) => (match[2] === undefined ? [match[1] ?? match[3]!] : []));

/**
 * The number of branches of a plural of vue-i18n: `no car | one car | {count} cars` has 3.
 *
 * A `|` in braces (`{'|'}`) and `\|` are text. A text with an ICU choice is one branch: there, `|` is text.
 */
export const pluralBranchesOf = (text: string): number => {
  if (ICU_CHOICE.test(text)) return 1;

  let depth = 0;
  let branches = 1;

  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '\\') at += 1;
    else if (text[at] === '{') depth += 1;
    else if (text[at] === '}') depth = Math.max(0, depth - 1);
    else if (text[at] === '|' && depth === 0) branches += 1;
  }

  return branches;
};

/**
 * The placeholders of a text, sorted, with no duplicate:
 *
 * - i18next: `{{name}}`, `{{count, number}}` (as `{{count}}`), `$t(key)`;
 * - ICU: `{name}`, `{count, plural, …}` (as `{count}`);
 * - the list `{0}`, as ICU and vue-i18n write it;
 * - tags of `<Trans>`: `<0>`, `</0>`, `<strong>`, `<br/>`;
 * - printf: `%s`, `%d`, `%1$s`;
 * - with the syntax `vue-i18n` only: the linked message `@:key` or `@.lower:key` (as `@:key`).
 */
export const placeholdersOf = (text: string, syntax: Syntax = 'i18next'): string[] => {
  const found = new Set<string>();
  let rest = unquoted(text);

  // An ICU choice writes `one {{who}}` for a branch that holds `{who}`. Such a message is not i18next.
  if (!ICU_CHOICE.test(rest)) {
    rest = rest.replace(/\{\{\s*([^{},]+?)\s*(?:,[^{}]*)?\}\}/g, (_, name: string) => {
      found.add(`{{${name}}}`);

      return ' ';
    });
  }
  rest = rest.replace(/\$t\([^)]*\)/g, (match) => {
    found.add(match.replace(/\s+/g, ''));

    return ' ';
  });
  // A modifier changes the case of the linked text, which a language can need or not: it is not compared.
  if (syntax === 'vue-i18n') {
    rest = rest.replace(LINK, (_, literal: string | undefined, value: string | undefined, key: string | undefined) => {
      found.add(`@:${literal ?? value?.replace(/\s+/g, '') ?? key}`);

      return ' ';
    });
  }

  addIcuArguments(rest, found);
  for (const match of rest.matchAll(/<\/?([A-Za-z0-9][\w-]*)\s*\/?>/g)) found.add(match[0].replace(/\s+/g, ''));
  for (const match of rest.matchAll(/%(?:\d+\$)?[sdif]/g)) found.add(match[0]);

  return [...found].sort();
};

/**
 * The manifest, with the reason of each entry it leaves out.
 *
 * A wrong entry costs only itself: the other states and marks still count.
 * A text that does not parse, or that is not an object, throws.
 */
const parseManifest = (text: string): Manifest & { issues: string[] } => {
  const raw: unknown = JSON.parse(text);

  if (!isObject(raw)) throw new Error('it is not a JSON object');

  const states = new Map<string, FileState>();
  const marks = new Map<string, string>();
  const issues: string[] = [];

  if (raw.source !== undefined && (typeof raw.source !== 'string' || raw.source === '')) {
    throw new Error('"source" is not a language');
  }

  for (const [file, byLanguage] of Object.entries(isObject(raw.files) ? raw.files : {})) {
    for (const [language, state] of Object.entries(isObject(byLanguage) ? byLanguage : {})) {
      if (state !== 'available' && state !== 'partial' && state !== 'disabled') {
        issues.push(`files.${file}.${language} is not available, partial or disabled`);
        continue;
      }
      states.set(`${language}\n${file}`, state);
    }
  }

  for (const [language, byName] of Object.entries(isObject(raw.empty) ? raw.empty : {})) {
    for (const [name, mark] of Object.entries(isObject(byName) ? byName : {})) {
      if (isObject(mark) && typeof mark.source === 'string') marks.set(`${language}\n${name}`, mark.source);
    }
  }

  return { source: raw.source as string | undefined, states, marks, issues };
};

const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

/** `cart.items_one` is the form `one` of `cart.items`, as i18next reads plurals. */
const pluralOf = (key: string): { base: string; form: string } | null => {
  const match = /^(.+)_(zero|one|two|few|many|other)$/.exec(key);

  return match ? { base: match[1]!, form: match[2]! } : null;
};

/** `place_ordinal_one` is a form of an ordinal, as i18next names the forms of `t(key, { ordinal: true })`. */
const typeOf = (base: string): Intl.PluralRuleType => (base.endsWith('_ordinal') ? 'ordinal' : 'cardinal');

/** The plural forms that a language needs. A tag that `Intl` does not know needs the forms of the source. */
const pluralFormsOf = (language: string, fallback: string[], type: Intl.PluralRuleType = 'cardinal'): string[] => {
  try {
    const forms = new Intl.PluralRules(language, { type }).resolvedOptions().pluralCategories as string[];

    return PLURAL_FORMS.filter((form) => forms.includes(form));
  } catch {
    return fallback;
  }
};

const integersOfForms = new Map<string, Map<string, number[]>>();

/**
 * The integers from 0 to 9999 that each plural form of a language takes, or `null` for a tag that `Intl`
 * does not know. Past 9999, a form takes only a number such as 1000000: the `many` of French or Italian.
 */
const integersOf = (language: string, type: Intl.PluralRuleType): Map<string, number[]> | null => {
  const id = `${language}\n${type}`;

  if (!integersOfForms.has(id)) {
    try {
      const rules = new Intl.PluralRules(language, { type });
      const forms = new Map<string, number[]>();

      for (let n = 0; n < 10_000; n += 1) {
        const form = rules.select(n);

        forms.set(form, [...(forms.get(form) ?? []), n]);
      }
      integersOfForms.set(id, forms);
    } catch {
      return null;
    }
  }

  return integersOfForms.get(id)!;
};

/**
 * The plural forms that a translation must write. It is `other`, and each form of the language that an
 * integer from 0 to 9999 takes, unless the exact branches (`=0`, `=1`) hold all its integers. The other
 * forms of the language stay allowed: an application with no text for them shows `other`.
 */
const requiredFormsOf = (
  language: string,
  fallback: string[],
  type: Intl.PluralRuleType = 'cardinal',
  exact: number[] = [],
): string[] => {
  const integers = integersOf(language, type);

  if (!integers) return fallback;

  return pluralFormsOf(language, fallback, type).filter((form) => {
    const taken = integers.get(form) ?? [];

    return form === 'other' || (taken.length > 0 && !taken.every((n) => exact.includes(n)));
  });
};

/** The count of a plural form can stay implicit: « One item » for `{{count}} items`. */
const COUNT = new Set(['{{count}}', '{count}']);

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

const describeDifference = (source: string[], target: string[]): string => {
  const lost = source.filter((item) => !target.includes(item));
  const added = target.filter((item) => !source.includes(item));

  return [lost.length > 0 ? `lost ${lost.join(' ')}` : '', added.length > 0 ? `added ${added.join(' ')}` : '']
    .filter(Boolean)
    .join(', ');
};

export interface CheckOptions {
  /** The folder of the languages. Null: the first of `LOCALES_GUESSES` that exists. */
  locales: string | null;
  /** The manifest. Null: `<locales>/manifest.json`, if it exists. */
  manifest: string | null;
  /** Null: the `source` of the manifest. */
  source: string | null;
  /** Null: every folder of `locales` past the source. */
  languages: string[] | null;
  /** `vue-i18n` also reads the linked messages and the `|` plurals of vue-i18n. Default: `i18next`. */
  syntax?: Syntax;
}

/** Reads every locale file of a folder, and answers what is wrong in them. */
export const checkLocales = async (options: CheckOptions, reader: LocalesReader): Promise<CheckReport> => {
  const syntax = options.syntax ?? 'i18next';
  const vue = syntax === 'vue-i18n';
  const problems: Problem[] = [];
  const report = (problem: Omit<Problem, 'severity'>) =>
    problems.push({ ...problem, severity: RULES[problem.rule].severity });
  const summarize = (counts: Omit<CheckReport, 'errors' | 'warnings' | 'problems'>): CheckReport => ({
    ...counts,
    errors: problems.filter((problem) => problem.severity === 'error').length,
    warnings: problems.filter((problem) => problem.severity === 'warning').length,
    problems,
  });

  let locales = options.locales;
  let folders: Entry[] | null = null;

  if (locales === null) {
    for (const guess of LOCALES_GUESSES) {
      folders = await reader.readDir(guess);
      if (folders !== null) {
        locales = guess;
        break;
      }
    }
    if (locales === null) {
      throw new CheckSetupError(`No folder of locales: pass --locales. Tried ${LOCALES_GUESSES.join(', ')}.`);
    }
  } else {
    folders = await reader.readDir(locales);
    if (folders === null) throw new CheckSetupError(`${locales} is not a folder.`);
  }

  const manifestPath = options.manifest ?? join(locales, 'manifest.json');
  const manifestText = await reader.readFile(manifestPath);
  let manifest: Manifest = { states: new Map(), marks: new Map() };

  if (manifestText === null && options.manifest !== null) throw new CheckSetupError(`${manifestPath} does not exist.`);
  if (manifestText !== null) {
    const invalid = (reason: string) =>
      report({
        rule: 'invalid-manifest',
        path: manifestPath,
        language: '',
        key: null,
        message: `${manifestPath} is not a manifest: ${reason}.`,
      });

    try {
      const { issues, ...read } = parseManifest(manifestText);

      manifest = read;
      issues.forEach(invalid);
    } catch (error) {
      invalid((error as Error).message);
    }
  }

  const source = options.source ?? manifest.source;

  // A manifest that does not parse can hide its source. Its own error is then the answer.
  if (!source && problems.length > 0) return summarize({ locales, source: '', languages: [], files: 0, keys: 0 });
  if (!source) throw new CheckSetupError('No source language: pass --source, or name "source" in the manifest.');
  if (options.source && manifest.source && options.source !== manifest.source) {
    throw new CheckSetupError(`--source is ${options.source}, and the manifest names ${manifest.source}.`);
  }

  const languageFolders = (folders ?? []).filter((entry) => entry.directory).map((entry) => entry.name);

  if (!languageFolders.includes(source)) throw new CheckSetupError(`${join(locales, source)} is not a folder.`);

  const languages = options.languages ?? languageFolders.filter((name) => name !== source).sort();
  const missingFolders = languages.filter((language) => !languageFolders.includes(language));

  if (missingFolders.length > 0) {
    throw new CheckSetupError(`No folder for ${missingFolders.join(', ')} in ${locales}.`);
  }

  const pathOf = (language: string, file: string) => join(locales, language, `${file}.json`);

  /** The JSON files of a language, by name. Every other entry is left out, as the editor does. */
  const filesOf = async (language: string): Promise<string[]> => {
    const names: string[] = [];

    for (const entry of (await reader.readDir(join(locales, language))) ?? []) {
      if (entry.directory || !entry.name.endsWith('.json')) continue;

      const file = entry.name.slice(0, -'.json'.length);

      if (FILE_NAME.test(file)) names.push(file);
      else {
        report({
          rule: 'skipped-file',
          path: join(locales, language, entry.name),
          language,
          key: null,
          message: `${entry.name}: a file name has only letters, digits, - and _.`,
        });
      }
    }

    return names.sort();
  };

  /** The strings of a file by key, or null when it does not parse. */
  const read = async (language: string, file: string): Promise<Map<string, string> | null> => {
    const path = pathOf(language, file);
    const text = await reader.readFile(path);

    if (text === null) return new Map();

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch (error) {
      report({ rule: 'invalid-json', path, language, key: null, message: (error as Error).message });

      return null;
    }

    if (!isObject(parsed)) {
      report({ rule: 'invalid-json', path, language, key: null, message: 'The top of the file is not an object.' });

      return null;
    }

    const strings = new Map<string, string>();

    for (const [key, value] of pathsOf(parsed)) {
      if (typeof value === 'string') strings.set(key, value);
      else {
        report({
          rule: 'not-a-string',
          path,
          language,
          key: `${file}:${key}`,
          message: `${file}:${key} holds ${value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value}.`,
        });
      }
    }

    return strings;
  };

  const sourceFiles = await filesOf(source);
  const sources = new Map<string, Map<string, string>>();
  /**
   * The keys that a linked message can name. An application merges the files of a language in one of two
   * ways: flat, where `@:ok` names the `ok` of any file, or one object for each file, where it is `@:common.ok`.
   */
  const flatKeys = new Set<string>();
  const fileKeys = new Set<string>();
  let files = sourceFiles.length;
  let keys = 0;

  for (const file of sourceFiles) {
    const strings = await read(source, file);

    if (strings === null) continue;

    sources.set(file, strings);
    keys += strings.size;

    for (const [key, text] of strings) {
      flatKeys.add(key);
      fileKeys.add(`${file}.${key}`);
      if (text === '') {
        report({
          rule: 'empty-source',
          path: pathOf(source, file),
          language: source,
          key: `${file}:${key}`,
          message: `${file}:${key} is empty in the source.`,
        });
      }
    }
  }

  // A translation keeps the links of its source (rule `placeholders`), so only the links of the source are read here.
  const links = [...(vue ? sources : [])].flatMap(([file, strings]) =>
    [...strings].flatMap(([key, text]) => linksOf(text).map((link) => ({ file, key, link }))),
  );
  // `check` cannot see how the application merges the files. The links tell it: one merge resolves them all.
  // When some links resolve in one merge only and others in the other only, the merge of the most links wins.
  const onlyFlat = links.filter(({ link }) => flatKeys.has(link) && !fileKeys.has(link)).map(({ link }) => link);
  const onlyFile = links.filter(({ link }) => fileKeys.has(link) && !flatKeys.has(link)).map(({ link }) => link);
  const merge =
    onlyFlat.length > 0 && onlyFile.length > 0 ? (onlyFlat.length > onlyFile.length ? 'flat' : 'file') : null;

  for (const { file, key, link } of links) {
    const id = `${file}:${key}`;
    const reportLink = (message: string) =>
      report({ rule: 'unknown-link', path: pathOf(source, file), language: source, key: id, message });

    if (!flatKeys.has(link) && !fileKeys.has(link)) {
      reportLink(`${id} links to @:${link}, which is a key of no file of ${source}.`);
    } else if (merge === 'file' && !fileKeys.has(link)) {
      reportLink(
        `${id} links to @:${link}, but the other links of ${source} name the file of their key, as @:${onlyFile[0]}.`,
      );
    } else if (merge === 'flat' && !flatKeys.has(link)) {
      reportLink(
        `${id} links to @:${link}, but the other links of ${source} name a key with no file, as @:${onlyFlat[0]}.`,
      );
    }
  }

  for (const language of languages) {
    const targetFiles = await filesOf(language);

    files += targetFiles.length;

    for (const file of targetFiles.filter((name) => !sourceFiles.includes(name))) {
      report({
        rule: 'extra-file',
        path: pathOf(language, file),
        language,
        key: null,
        message: `${file}.json has no version in ${source}.`,
      });
    }

    for (const file of sourceFiles) {
      const sourceStrings = sources.get(file);

      if (!sourceStrings || manifest.states.get(`${language}\n${file}`) === 'disabled') continue;

      const path = pathOf(language, file);
      const target = targetFiles.includes(file) ? await read(language, file) : new Map<string, string>();

      if (target === null) continue;

      /** The plural keys of the source by base. A base counts only with its form `other`, as in i18next. */
      const plurals = new Map<string, Map<string, string>>();

      for (const [key, text] of sourceStrings) {
        const plural = pluralOf(key);

        if (plural) plurals.set(plural.base, (plurals.get(plural.base) ?? new Map()).set(plural.form, text));
      }
      // A base counts as a plural with its form `other` and one more form. A source language with one
      // form only (`ja`) writes `_other` alone, so there `_other` alone is a plural too.
      const sourceHasOneForm = (base: string) => pluralFormsOf(source, ['one', 'other'], typeOf(base)).length === 1;

      for (const [base, forms] of plurals) {
        if (!forms.has('other') || (forms.size === 1 && !sourceHasOneForm(base))) plurals.delete(base);
      }

      const checkKey = (key: string, text: string, form: string | null) => {
        const id = `${file}:${key}`;
        const value = target.get(key);

        if (value === undefined) {
          report({ rule: 'missing-key', path, language, key: id, message: `${id} has no ${language} text.` });
        } else if (value === '') {
          const mark = manifest.marks.get(`${language}\n${id}`);

          if (mark === undefined) {
            report({ rule: 'empty-value', path, language, key: id, message: `${id} is empty in ${language}.` });
          } else if (mark !== sourceHashOf(text)) {
            report({
              rule: 'stale-empty',
              path,
              language,
              key: id,
              message: `${id} is empty on purpose in ${language}, but its ${source} text changed since.`,
            });
          }
        } else {
          const implicitCount = form !== null && form !== 'other';
          const expected = placeholdersOf(text, syntax).filter((item) => !implicitCount || !COUNT.has(item));
          const found = placeholdersOf(value, syntax).filter((item) => !implicitCount || !COUNT.has(item));

          if (!sameList(expected, found)) {
            report({
              rule: 'placeholders',
              path,
              language,
              key: id,
              message: `${id}: ${describeDifference(expected, found)}.`,
            });
          }

          const branches = vue ? pluralBranchesOf(text) : 1;
          const translated = vue ? pluralBranchesOf(value) : 1;

          // Only a source with branches is a plural. A `|` that a translation adds to a plain text is text.
          if (branches > 1 && branches !== translated) {
            report({
              rule: 'plural-branches',
              path,
              language,
              key: id,
              message: `${id}: ${translated} ${translated === 1 ? 'branch' : 'branches'}, and the source has ${branches}.`,
            });
          }

          for (const choice of icuPluralsOf(value)) {
            const needed = requiredFormsOf(language, choice.categories, choice.type, choice.exact);
            const allowed = pluralFormsOf(language, choice.categories, choice.type);
            const missing = needed.filter((category) => !choice.categories.includes(category));
            const unused = choice.categories.filter((category) => !allowed.includes(category));
            const kind = choice.type === 'ordinal' ? 'selectordinal' : 'plural';

            if (missing.length > 0 || unused.length > 0) {
              report({
                rule: 'icu-plural-forms',
                path,
                language,
                key: id,
                message:
                  `${id}: the ${kind} {${choice.name}} ` +
                  [
                    missing.length > 0 ? `has no ${missing.join(' ')}` : '',
                    unused.length > 0 ? `has ${unused.join(' ')}, which ${language} never uses` : '',
                  ]
                    .filter(Boolean)
                    .join(', and ') +
                  '.',
              });
            }
          }
        }
      };

      /** The keys this language can hold: the keys of the source, and the plural forms it needs. */
      const allowed = new Set(sourceStrings.keys());

      for (const [key, text] of sourceStrings) {
        if (!plurals.has(pluralOf(key)?.base ?? '')) checkKey(key, text, null);
      }

      for (const [base, forms] of plurals) {
        const required = requiredFormsOf(language, [...forms.keys()], typeOf(base));

        for (const form of pluralFormsOf(language, [...forms.keys()], typeOf(base))) {
          allowed.add(`${base}_${form}`);
          if (required.includes(form) || target.has(`${base}_${form}`)) {
            checkKey(`${base}_${form}`, forms.get(form) ?? forms.get('other')!, form);
          }
        }
      }

      for (const key of target.keys()) {
        if (!allowed.has(key)) {
          report({
            rule: 'extra-key',
            path,
            language,
            key: `${file}:${key}`,
            message: `${file}:${key} is not in ${source}.`,
          });
        }
      }
    }
  }

  return summarize({ locales, source, languages, files, keys });
};

export const REPORTERS = ['pretty', 'json', 'github'] as const;

export type Reporter = (typeof REPORTERS)[number];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const summaryOf = (report: CheckReport) =>
  `${plural(report.errors, 'error')}, ${plural(report.warnings, 'warning')} in ${plural(report.files, 'file')} ` +
  `(${report.source} → ${report.languages.join(', ') || 'no language'}, ${plural(report.keys, 'key')}).`;

/** The report for a person: the problems of each file, then one line of totals. */
export const prettyReport = (report: CheckReport): string => {
  const lines: string[] = [];
  const byPath = new Map<string, Problem[]>();

  for (const problem of report.problems) byPath.set(problem.path, [...(byPath.get(problem.path) ?? []), problem]);

  for (const [path, problems] of [...byPath].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(path);
    for (const problem of problems) {
      lines.push(`  ${problem.severity === 'error' ? 'error  ' : 'warning'}  ${problem.message}  ${problem.rule}`);
    }
    lines.push('');
  }

  const rules = [...new Set(report.problems.map((problem) => problem.rule))].sort();

  if (rules.length > 0) {
    lines.push('Read more:');
    for (const rule of rules) lines.push(`  ${rule}  ${ruleUrl(rule)}`);
    lines.push('');
  }

  lines.push(summaryOf(report));

  return `${lines.join('\n')}\n`;
};

/** The report of `--json`: each problem also names the page of its rule. */
export const withDocs = (report: CheckReport) => ({
  ...report,
  problems: report.problems.map((problem) => ({ ...problem, docs: ruleUrl(problem.rule) })),
});

/** A value of a workflow command, with the characters that GitHub reads escaped. */
const escapeData = (text: string) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (text: string) => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * One annotation of GitHub Actions for each problem, then the totals.
 *
 * GitHub shows at most 10 annotations of each kind for one step. The totals line tells the rest.
 */
export const githubReport = (report: CheckReport): string => {
  const lines = report.problems.map(
    (problem) =>
      `::${problem.severity} file=${escapeProperty(problem.path)},title=${escapeProperty(`i18n ${problem.rule}`)}::` +
      escapeData(`${problem.message} ${ruleUrl(problem.rule)}`),
  );

  lines.push(summaryOf(report));

  return `${lines.join('\n')}\n`;
};

/** Whether the check fails: an error, or more warnings than `maxWarnings` (null: no limit). */
export const failed = (report: CheckReport, maxWarnings: number | null): boolean =>
  report.errors > 0 || (maxWarnings !== null && report.warnings > maxWarnings);

/** Runs the check on the files of an example: a folder `locales` whose source is `en`. */
export const checkExample = (example: Example, syntax: Syntax = 'i18next'): Promise<CheckReport> => {
  const files = new Map(Object.entries(example).map(([path, text]) => [join('locales', path), text]));

  return checkLocales(
    { locales: 'locales', manifest: null, source: 'en', languages: null, syntax },
    {
      readFile: async (path) => files.get(path) ?? null,
      readDir: async (path) => {
        const entries = new Map<string, boolean>();

        for (const file of files.keys()) {
          if (!file.startsWith(`${path}/`)) continue;

          const [name = '', ...rest] = file.slice(path.length + 1).split('/');

          entries.set(name, rest.length > 0 || entries.get(name) === true);
        }

        return entries.size === 0 ? null : [...entries].map(([name, directory]) => ({ name, directory }));
      },
    },
  );
};
