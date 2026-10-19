import type { Installation, Repository } from '@i18n-editor/mcp/api';

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
  owner: string;
  name: string;
  /** The id of the row when the repository is connected already. */
  connectedId: string | null;
}

/**
 * The repositories the admin can pick, those not connected first.
 *
 * The installation that GitHub just named comes before the others, so the
 * repository that was just installed is at the top of the list.
 */
export const choicesOf = (
  installations: readonly Installation[],
  connected: readonly Pick<Repository, 'id' | 'owner' | 'name'>[],
  justInstalled: number | null = null,
): RepositoryChoice[] => {
  const rowOf = new Map(connected.map((row) => [`${row.owner}/${row.name}`.toLowerCase(), row.id]));
  const seen = new Set<string>();
  const choices: RepositoryChoice[] = [];

  for (const installation of installations) {
    for (const repository of installation.repositories) {
      const key = `${repository.owner}/${repository.name}`.toLowerCase();

      // Two installations can reach one repository. The row would hold one of them, so the list shows it once.
      if (seen.has(key)) continue;

      seen.add(key);
      choices.push({
        installationId: installation.id,
        owner: repository.owner,
        name: repository.name,
        connectedId: rowOf.get(key) ?? null,
      });
    }
  }

  const rank = (choice: RepositoryChoice) =>
    (choice.connectedId === null ? 0 : 2) + (choice.installationId === justInstalled ? 0 : 1);

  return choices.sort(
    (a, b) => rank(a) - rank(b) || `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`, 'fr'),
  );
};

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
export const bodyOf = (choice: RepositoryChoice, form: ConnectForm) => {
  const manifestPath = form.manifestPath.trim();

  return {
    installationId: choice.installationId,
    owner: choice.owner,
    name: choice.name,
    branch: form.branch.trim(),
    localesPath: form.localesPath.trim().replace(/\/+$/, ''),
    ...(manifestPath === '' ? {} : { manifestPath }),
    languages: languagesOf(form.languages),
  };
};
