import type { PublishMode, Repository } from '@i18n-editor/mcp/api';

/**
 * The rules of the flow that connects a repository (DB-581), with no React,
 * so a test reads them directly.
 */

/** The address GitHub sends the browser back to after an installation. */
export const SETUP_PATH = '/setup';

/** What GitHub put in the address of the return: `?installation_id=…&setup_action=install`. */
export interface SetupReturn {
  installationId: number | null;
  action: 'install' | 'update' | 'request' | null;
}

export const setupReturnOf = (search: string): SetupReturn => {
  const params = new URLSearchParams(search);
  const id = Number(params.get('installation_id'));
  const action = params.get('setup_action');

  return {
    installationId: Number.isInteger(id) && id > 0 ? id : null,
    action: action === 'install' || action === 'update' || action === 'request' ? action : null,
  };
};

/** One repository that an installation reaches, and the row of the editor that holds it, if one does. */
export interface RepositoryChoice {
  installationId: number;
  account: string;
  owner: string;
  name: string;
  private: boolean;
  /** The id of the row when the repository is connected already. */
  connectedId: string | null;
}

/** The key of a repository in the picker: `owner/name`, which GitHub compares whatever its case. */
export const keyOf = (repository: Pick<RepositoryChoice, 'owner' | 'name'>): string =>
  `${repository.owner}/${repository.name}`.toLowerCase();

/**
 * The rows of a page, and of the pages loaded before it, each once.
 *
 * A repository installed while the admin scrolls moves the rows of the next
 * pages by one. A row can then come twice, and a list box refuses two items
 * with one key.
 */
export const withPage = (
  before: readonly RepositoryChoice[],
  page: readonly Omit<RepositoryChoice, 'connectedId'>[],
  connected: readonly Pick<Repository, 'id' | 'owner' | 'name'>[],
): RepositoryChoice[] => {
  const rowOf = new Map(connected.map((row) => [keyOf(row), row.id]));
  const seen = new Set(before.map(keyOf));
  const added = page
    .filter((row) => !seen.has(keyOf(row)) && seen.add(keyOf(row)))
    .map((row) => ({ ...row, connectedId: rowOf.get(keyOf(row)) ?? null }));

  return [...before, ...added];
};

/** How long the picker waits after the last key before it asks the API. */
export const SEARCH_DELAY_MS = 250;

/** How many repositories one page of the picker holds. */
export const PICKER_PAGE = 30;

/** `fr, en  pt-BR` → `['fr', 'en', 'pt-BR']`, each once, in the order typed. */
export const languagesOf = (text: string): string[] => [
  ...new Set(
    text
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  ),
];

/** The fields of the form, as typed. */
export interface ConnectForm {
  branch: string;
  localesPath: string;
  manifestPath: string;
  languages: string;
}

export type ConnectField = keyof ConnectForm;

const climbs = (value: string) => value.split('/').some((segment) => segment === '.' || segment === '..');

/** The same rule as the API, so the form says it before the request does. */
const LANGUAGE = /^[A-Za-z0-9_-]+$/;

/**
 * What is wrong with each field, in the words the form shows under it.
 * An empty object means the form can be sent.
 */
export const problemsOf = (form: ConnectForm): Partial<Record<ConnectField, string>> => {
  const problems: Partial<Record<ConnectField, string>> = {};
  const languages = languagesOf(form.languages);

  if (form.branch.trim() === '') problems.branch = "Indiquez la branche que l'éditeur lit et écrit.";
  else if (climbs(form.branch.trim())) problems.branch = 'Une branche ne contient ni « . » ni « .. » entre deux « / ».';

  if (form.localesPath.trim() === '') problems.localesPath = 'Indiquez le dossier qui contient un dossier par langue.';
  else if (climbs(form.localesPath.trim())) problems.localesPath = 'Le chemin ne peut pas sortir du dépôt.';

  const manifest = form.manifestPath.trim();

  if (manifest !== '' && !manifest.endsWith('.json')) problems.manifestPath = 'Le manifeste est un fichier .json.';
  else if (manifest !== '' && climbs(manifest)) problems.manifestPath = 'Le chemin ne peut pas sortir du dépôt.';

  if (languages.length === 0) problems.languages = 'Indiquez au moins la langue source.';
  else if (languages.some((language) => !LANGUAGE.test(language))) {
    problems.languages = 'Une langue est un code comme fr ou pt-BR, séparé des autres par une virgule.';
  }

  return problems;
};

/** The body of `POST /i18n/repositories`. A manifest left empty is the one beside the languages. */
export const bodyOf = (choice: RepositoryChoice, form: ConnectForm, publishMode: PublishMode = 'commit') => {
  const manifestPath = form.manifestPath.trim();

  return {
    installationId: choice.installationId,
    owner: choice.owner,
    name: choice.name,
    branch: form.branch.trim(),
    localesPath: form.localesPath.trim().replace(/\/+$/, ''),
    ...(manifestPath === '' ? {} : { manifestPath }),
    languages: languagesOf(form.languages),
    publishMode,
  };
};
