import { checkExample, prettyReport, RULES, type Rule } from '@git8n/mcp/cli/check';
import { ERRORS, type ErrorCode } from '@git8n/mcp/cli/errors';
import type { Example, RuleEntry, Syntax } from '@git8n/mcp/cli/rules';

/**
 * The pages of the rules of `git8n check` and of the error codes, made from the registry of the
 * CLI (G8N-82). A page cannot say something that the code does not do.
 */

const LEVEL = { error: 'Error', warning: 'Warning' } as const;

const filesOf = (example: Example) =>
  Object.entries(example)
    .map(([path, text]) => `\`locales/${path}\`\n\n\`\`\`json\n${text.trimEnd()}\n\`\`\``)
    .join('\n\n');

/** The output of `git8n check` on the example, made by the check itself. */
const outputOf = async (example: Example, syntax?: Syntax) =>
  `\`\`\`text\n$ git8n check --source en${syntax ? ` --syntax ${syntax}` : ''}\n${prettyReport(await checkExample(example, syntax)).trimEnd()}\n\`\`\``;

export const ruleIds = Object.keys(RULES) as Rule[];
export const errorCodes = Object.keys(ERRORS) as ErrorCode[];

export const rulePage = async (rule: Rule): Promise<string> => {
  const entry: RuleEntry = RULES[rule];

  return [
    '---',
    `title: ${rule}`,
    `description: ${JSON.stringify(entry.title)}`,
    '---',
    '',
    `# \`${rule}\``,
    '',
    `**${LEVEL[entry.severity]}** · ${entry.title}`,
    '',
    entry.severity === 'error'
      ? '`git8n check` fails on this rule.'
      : '`git8n check` reports this rule as a warning. It fails only past `--max-warnings`.',
    '',
    '## Why it matters',
    '',
    entry.why,
    '',
    '## Invalid',
    '',
    filesOf(entry.invalid),
    '',
    await outputOf(entry.invalid, entry.syntax),
    '',
    '## Valid',
    '',
    filesOf(entry.valid),
    '',
    await outputOf(entry.valid, entry.syntax),
    '',
    '## What to do',
    '',
    entry.fix,
    '',
    '[All the rules](./index.md) · [The command `check`](../cli.md#check)',
    '',
  ].join('\n');
};

export const rulesIndex = (): string =>
  [
    '---',
    'title: The rules of git8n check',
    'description: Every rule of git8n check, with its level.',
    '---',
    '',
    '# The rules of `git8n check`',
    '',
    'An error fails the check. A warning fails it only past `--max-warnings`. Each problem names its rule, and the CLI prints the address of its page.',
    '',
    '| Rule | Level | What it finds |',
    '| --- | --- | --- |',
    ...ruleIds.map(
      (rule) => `| [\`${rule}\`](./${rule}.md) | ${LEVEL[RULES[rule].severity].toLowerCase()} | ${RULES[rule].title} |`,
    ),
    '',
  ].join('\n');

export const errorPage = (code: ErrorCode): string => {
  const entry = ERRORS[code];

  return [
    '---',
    `title: ${code}`,
    `description: ${JSON.stringify(entry.title)}`,
    '---',
    '',
    `# \`${code}\``,
    '',
    entry.title,
    '',
    `The exit status is **${entry.exit}**.`,
    '',
    '## What to do',
    '',
    entry.fix,
    '',
    '[All the error codes](./index.md) · [The exit status](../cli.md#exit-status)',
    '',
  ].join('\n');
};

export const errorsIndex = (): string =>
  [
    '---',
    'title: The error codes of git8n',
    'description: Every error code of the CLI, with its exit status.',
    '---',
    '',
    '# The error codes of `git8n`',
    '',
    'A script reads the code, never the message: the message can change. The CLI prints the address of the page of the code with each error, and `--json` gives it as `error.docs`.',
    '',
    '| Code | Status | Meaning |',
    '| --- | --- | --- |',
    ...errorCodes.map(
      (code) => `| [\`${code}\`](./${code.toLowerCase()}.md) | ${ERRORS[code].exit} | ${ERRORS[code].title} |`,
    ),
    '',
  ].join('\n');
