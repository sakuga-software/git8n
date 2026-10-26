import {
  DEFAULT_TEMPLATES,
  EXAMPLE_VALUES,
  messageOf,
  TEMPLATE_VARIABLES,
  templateProblem,
  type TemplateKind,
  type TemplateProblem,
  type TemplateValues,
} from '@i18n-editor/db/messages';
import type { PublishMode, Repository, RepositoryChange } from '@i18n-editor/mcp/api';
import { languagesOf, problemsOf as placeProblemsOf } from '../editor/connect-flow';

/**
 * The rules of the settings of a repository (DB-609), with no React, so a
 * test reads them directly.
 */

/** The field of a template, by its kind. The API names the fields this way. */
export const TEMPLATE_FIELD = {
  proposalCommit: 'proposalCommitTemplate',
  publicationCommit: 'publicationCommitTemplate',
  pullRequestTitle: 'pullRequestTitleTemplate',
  pullRequestBody: 'pullRequestBodyTemplate',
} as const satisfies Record<TemplateKind, keyof RepositoryChange>;

/** The fields of the page, as typed. An empty template is the default one. */
export interface SettingsForm {
  branch: string;
  localesPath: string;
  manifestPath: string;
  languages: string;
  publishMode: PublishMode;
  proposalCommit: string;
  publicationCommit: string;
  pullRequestTitle: string;
  pullRequestBody: string;
}

export type SettingsField = keyof SettingsForm;

export const formOf = (repository: Repository): SettingsForm => ({
  branch: repository.branch,
  localesPath: repository.localesPath,
  manifestPath: repository.manifestPath ?? '',
  languages: [repository.source, ...repository.targets].join(', '),
  publishMode: repository.publishMode ?? 'commit',
  proposalCommit: repository.proposalCommitTemplate ?? '',
  publicationCommit: repository.publicationCommitTemplate ?? '',
  pullRequestTitle: repository.pullRequestTitleTemplate ?? '',
  pullRequestBody: repository.pullRequestBodyTemplate ?? '',
});

/** What is wrong with a template, in the words the page shows under it. */
export const templateProblemText = (problem: TemplateProblem): string => {
  switch (problem.code) {
    case 'unknown_variable':
      return `{${problem.variable}} n'est pas une variable de ce message. Variables : ${problem.known.map((name) => `{${name}}`).join(', ')}.`;
    case 'unclosed_brace':
      return `L'accolade { du caractère ${problem.at + 1} n'ouvre aucune variable. Écrivez {{ pour une accolade.`;
    case 'lone_closing_brace':
      return `L'accolade } du caractère ${problem.at + 1} ne ferme aucune variable. Écrivez }} pour une accolade.`;
    case 'multiline':
      return 'Ce message tient sur une ligne.';
    case 'too_long':
      return `Un format tient en ${problem.max} caractères au plus.`;
    case 'empty':
      return "Ce format n'écrit rien.";
  }
};

/** Whether the field of a kind holds its default: empty, or the default typed out. */
const isDefault = (kind: TemplateKind, value: string): boolean =>
  value.trim() === '' || value === DEFAULT_TEMPLATES[kind];

/** What is wrong with each field. An empty object means the page can save. */
export const problemsOf = (form: SettingsForm): Partial<Record<SettingsField, string>> => {
  const problems: Partial<Record<SettingsField, string>> = placeProblemsOf(form);

  for (const kind of Object.keys(TEMPLATE_FIELD) as TemplateKind[]) {
    if (isDefault(kind, form[kind])) continue;

    const problem = templateProblem(kind, form[kind]);

    if (problem) problems[kind] = templateProblemText(problem);
  }

  return problems;
};

/** The text a template writes on the example of its kind, as the preview shows it. */
export const previewOf = (kind: TemplateKind, value: string): string =>
  // Each kind takes its own values, which TypeScript cannot pair with a kind it does not know yet.
  messageOf(kind, isDefault(kind, value) ? null : value, EXAMPLE_VALUES[kind] as TemplateValues<TemplateKind> as never);

/** The variables a kind takes, as the page lists them under its field. */
export const variablesOf = (kind: TemplateKind): readonly string[] => TEMPLATE_VARIABLES[kind];

/**
 * The body of `PATCH /i18n/repositories/:id`: the fields that changed, and no other.
 * A template set back to its default is sent as null.
 */
export const changeOf = (before: SettingsForm, after: SettingsForm): RepositoryChange => {
  const change: RepositoryChange = {};

  if (after.branch.trim() !== before.branch) change.branch = after.branch.trim();

  const localesPath = after.localesPath.trim().replace(/\/+$/, '');

  if (localesPath !== before.localesPath) change.localesPath = localesPath;

  const manifestPath = after.manifestPath.trim();

  if (manifestPath !== before.manifestPath) change.manifestPath = manifestPath === '' ? null : manifestPath;

  const languages = languagesOf(after.languages);

  if (languages.join(',') !== languagesOf(before.languages).join(',')) change.languages = languages;
  if (after.publishMode !== before.publishMode) change.publishMode = after.publishMode;

  for (const kind of Object.keys(TEMPLATE_FIELD) as TemplateKind[]) {
    const next = isDefault(kind, after[kind]) ? null : after[kind];
    const was = isDefault(kind, before[kind]) ? null : before[kind];

    if (next !== was) change[TEMPLATE_FIELD[kind]] = next;
  }

  return change;
};

/** The field of the page that a field of the API names, so its refusal shows under it. */
export const fieldOfIssue = (field: string): SettingsField | null => {
  const kind = (Object.keys(TEMPLATE_FIELD) as TemplateKind[]).find((name) => TEMPLATE_FIELD[name] === field);

  if (kind) return kind;

  return (
    (['branch', 'localesPath', 'manifestPath', 'languages', 'publishMode'] as const).find((name) => name === field) ??
    null
  );
};

/** The sections of the page, in the order of the tabs. The first one opens by default. */
export const SETTINGS_SECTIONS = [
  { id: 'repository', title: 'Dépôt', fields: ['branch', 'localesPath', 'manifestPath', 'languages'] },
  { id: 'publication', title: 'Publication', fields: ['publishMode'] },
  {
    id: 'messages',
    title: 'Messages',
    fields: ['proposalCommit', 'publicationCommit', 'pullRequestTitle', 'pullRequestBody'],
  },
] as const satisfies readonly { id: string; title: string; fields: readonly SettingsField[] }[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

/** The section that the `?section=` of the address names, or the first one for any other value. */
export const sectionOf = (value: string | null): SettingsSection =>
  SETTINGS_SECTIONS.find((section) => section.id === value)?.id ?? SETTINGS_SECTIONS[0].id;

/** The first section, in the order of the tabs, that holds one of these fields. */
export const firstSectionWith = (fields: Iterable<SettingsField>): SettingsSection | null => {
  const wanted = new Set(fields);

  return SETTINGS_SECTIONS.find((section) => section.fields.some((field) => wanted.has(field)))?.id ?? null;
};
