/**
 * The formats of the messages that the editor writes on GitHub (DB-609).
 *
 * A repository can change four of them. A format is a text with `{variable}`
 * placeholders, from the fixed list of its kind. `{{` and `}}` write a brace.
 *
 * The API renders them, and the page renders them too for its preview. So this
 * file holds no import, and is plain TypeScript that both can bundle.
 *
 * A format changes only the text a person reads. The editor adds the lines
 * that it reads back after the format, whatever the format says:
 *
 * - a proposal ends with its `Read-at:` trailer;
 * - a publication ends with one line for each key.
 */

export const TEMPLATE_KINDS = ['proposalCommit', 'publicationCommit', 'pullRequestTitle', 'pullRequestBody'] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** The variables of each kind, in the order the documentation lists them. */
export const TEMPLATE_VARIABLES = {
  proposalCommit: ['language', 'count', 'count_keys', 'author', 'repository', 'branch'],
  publicationCommit: ['language', 'count', 'count_keys', 'action', 'author', 'repository', 'branch'],
  pullRequestTitle: ['count', 'count_keys', 'languages', 'repository', 'branch'],
  pullRequestBody: ['count', 'count_keys', 'languages', 'keys_list', 'repository', 'branch'],
} as const satisfies Record<TemplateKind, readonly string[]>;

export type TemplateValues<K extends TemplateKind> = Record<(typeof TEMPLATE_VARIABLES)[K][number], string>;

/** The formats a repository gets when it sets none. They write the messages of before DB-609. */
export const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  proposalCommit: 'i18n({language}): {count_keys} proposed by {author}',
  publicationCommit: 'i18n({language}): {count_keys} {action} by {author}',
  pullRequestTitle: 'i18n: {count_keys} published ({languages})',
  pullRequestBody:
    'Translations published from the translation editor. Each commit names the person who published it.\n\n{keys_list}',
};

/** Values to preview a format with, and to check that it renders something. */
export const EXAMPLE_VALUES: { [K in TemplateKind]: TemplateValues<K> } = {
  proposalCommit: {
    language: 'en',
    count: '3',
    count_keys: '3 keys',
    author: 'Ada Lovelace',
    repository: 'acme/acme-app',
    branch: 'main',
  },
  publicationCommit: {
    language: 'en',
    count: '3',
    count_keys: '3 keys',
    action: 'published',
    author: 'Ada Lovelace',
    repository: 'acme/acme-app',
    branch: 'main',
  },
  pullRequestTitle: {
    count: '4',
    count_keys: '4 keys',
    languages: 'de, en',
    repository: 'acme/acme-app',
    branch: 'main',
  },
  pullRequestBody: {
    count: '4',
    count_keys: '4 keys',
    languages: 'de, en',
    keys_list: '### de\n\n- `common:hello`\n\n### en\n\n- `common:hello`\n- `common:menu.quit`\n- `home:title`\n',
    repository: 'acme/acme-app',
    branch: 'main',
  },
};

/**
 * The longest text of each kind, after its variables are written.
 *
 * GitHub shows about 72 characters of a commit subject and refuses a title of
 * more than 256. A longer result is cut, with `…` at the end.
 */
export const RENDERED_MAX: Record<TemplateKind, number> = {
  proposalCommit: 100,
  publicationCommit: 100,
  pullRequestTitle: 256,
  pullRequestBody: 60_000,
};

/** The longest format an admin can write, before its variables are written. */
export const TEMPLATE_MAX: Record<TemplateKind, number> = {
  proposalCommit: 200,
  publicationCommit: 200,
  pullRequestTitle: 300,
  pullRequestBody: 10_000,
};

/** The kinds that are one line: a commit subject and a title. */
const SINGLE_LINE: ReadonlySet<TemplateKind> = new Set(['proposalCommit', 'publicationCommit', 'pullRequestTitle']);

/** Why a format is refused. The API and the page each say it in their own words. */
export type TemplateProblem =
  | { code: 'unknown_variable'; variable: string; known: readonly string[] }
  | { code: 'unclosed_brace'; at: number }
  | { code: 'lone_closing_brace'; at: number }
  | { code: 'multiline' }
  | { code: 'too_long'; max: number }
  | { code: 'empty' };

type Part = { text: string } | { variable: string };

const VARIABLE_NAME = /^[a-z_]+$/;

/**
 * Reads a format into its texts and its variables.
 *
 * A `{` that a name and a `}` do not follow is refused, not kept: it is almost
 * always a mistyped variable.
 */
export const parseTemplate = (template: string): { parts: Part[] } | { problem: TemplateProblem } => {
  const parts: Part[] = [];
  let text = '';

  for (let at = 0; at < template.length; at += 1) {
    const character = template[at];

    if (character === '{' && template[at + 1] === '{') {
      text += '{';
      at += 1;
    } else if (character === '}' && template[at + 1] === '}') {
      text += '}';
      at += 1;
    } else if (character === '{') {
      const end = template.indexOf('}', at);
      const name = end === -1 ? '' : template.slice(at + 1, end);

      if (!VARIABLE_NAME.test(name)) return { problem: { code: 'unclosed_brace', at } };

      if (text) parts.push({ text });
      parts.push({ variable: name });
      text = '';
      at = end;
    } else if (character === '}') {
      return { problem: { code: 'lone_closing_brace', at } };
    } else {
      text += character;
    }
  }

  if (text) parts.push({ text });

  return { parts };
};

/** Cuts a text to `max` characters, with `…` as the last one. */
const clamp = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Writes the values into a format.
 *
 * An unknown variable stays as it is written. A format the API took holds
 * none, so this happens only to a row written by hand.
 */
export const renderTemplate = (template: string, values: Record<string, string>): string => {
  const parsed = parseTemplate(template);

  if ('problem' in parsed) return template;

  return parsed.parts
    .map((part) => ('text' in part ? part.text : (values[part.variable] ?? `{${part.variable}}`)))
    .join('');
};

/**
 * Says what is wrong with a format for its kind, or null when nothing is.
 *
 * It renders the format on the example values, so a format that writes
 * nothing is refused here, not on the first commit.
 */
export const templateProblem = (kind: TemplateKind, template: string): TemplateProblem | null => {
  if (template.length > TEMPLATE_MAX[kind]) return { code: 'too_long', max: TEMPLATE_MAX[kind] };
  if (SINGLE_LINE.has(kind) && /[\r\n]/.test(template)) return { code: 'multiline' };

  const parsed = parseTemplate(template);

  if ('problem' in parsed) return parsed.problem;

  const known: readonly string[] = TEMPLATE_VARIABLES[kind];
  const unknown = parsed.parts.find((part) => 'variable' in part && !known.includes(part.variable));

  if (unknown && 'variable' in unknown) return { code: 'unknown_variable', variable: unknown.variable, known };

  if (renderTemplate(template, EXAMPLE_VALUES[kind]).trim() === '') return { code: 'empty' };

  return null;
};

/**
 * The text of one message: the format of the repository, or the default one.
 *
 * A format that is absent, that renders nothing, or that a hand wrote wrong
 * gives the default text, so a write never fails on its message.
 */
export const messageOf = <K extends TemplateKind>(
  kind: K,
  template: string | null | undefined,
  values: TemplateValues<K>,
): string => {
  const usable = template && templateProblem(kind, template) === null ? template : DEFAULT_TEMPLATES[kind];
  const rendered = renderTemplate(usable, values).trim();

  return clamp(rendered || renderTemplate(DEFAULT_TEMPLATES[kind], values).trim(), RENDERED_MAX[kind]);
};

/** `1 key`, `3 keys`. */
export const countKeys = (count: number): string => `${count} ${count === 1 ? 'key' : 'keys'}`;
