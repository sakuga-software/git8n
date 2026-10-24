import { ask, GithubError, insideRepository, installationToken } from '@/services/github-app.service';
import { ensureReachable, UnknownRepositoryError } from '@/services/i18n-repositories.service';
import { fileName, localeManifestSchema } from '@/schemas/i18n';
import { withoutTrailingSlashes } from '@/utils/trailing-slashes';

/**
 * What a repository holds, read before an admin connects it (DB-581).
 *
 * The form of the page starts from this answer. Every field stays editable:
 * a detection that guesses wrong costs a correction, never a row.
 */

/** A folder that holds one folder for each language, each with locale files. */
export interface LocalesCandidate {
  path: string;
  languages: string[];
}

export interface Detection {
  defaultBranch: string;
  /** The branch that was read: the one asked for, or the default one. */
  branch: string;
  /** GitHub cut the listing of the tree. A folder deep in a large repository can then be absent. */
  truncated: boolean;
  candidates: LocalesCandidate[];
  /** The folder the rest of this answer is about, or null when nothing looks like one. */
  localesPath: string | null;
  /** The manifest beside the languages, when there is one. */
  manifestPath: string | null;
  /** The source named by the manifest, or null when no manifest names one. */
  source: string | null;
  /** The languages under `localesPath`, the source first when it is known. */
  languages: string[];
}

/** One entry of a tree of git, as GitHub lists it. */
export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
}

/**
 * A language tag as a folder carries it: `fr`, `en`, `pt-BR`, `zh_Hant`.
 *
 * It is narrower than the rule of the repository schema on purpose. A folder
 * named `components` must not read as a language.
 */
const LANGUAGE_FOLDER = /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * The folders of a tree that hold languages, the one with the most languages first.
 *
 * A folder counts when one of its children is named as a language and holds a
 * `.json` file whose name a proposal can write. The root of the repository
 * never counts: the row needs a path.
 */
export const candidatesOf = (tree: readonly TreeEntry[]): LocalesCandidate[] => {
  const byFolder = new Map<string, Set<string>>();

  for (const entry of tree) {
    if (entry.type !== 'blob' || !entry.path.endsWith('.json')) continue;
    if (!fileName.safeParse(baseOf(entry.path).replace(/\.json$/, '')).success) continue;

    const languageFolder = parentOf(entry.path);
    const language = baseOf(languageFolder);
    const locales = parentOf(languageFolder);

    if (locales === '' || !LANGUAGE_FOLDER.test(language)) continue;

    if (!byFolder.has(locales)) byFolder.set(locales, new Set());

    byFolder.get(locales)!.add(language);
  }

  return [...byFolder]
    .map(([path, languages]) => ({ path, languages: [...languages].sort() }))
    .sort((a, b) => b.languages.length - a.languages.length || a.path.localeCompare(b.path));
};

/** The languages, the source first. A source that is not among them changes nothing. */
export const sourceFirst = (languages: readonly string[], source: string | null): string[] =>
  source !== null && languages.includes(source)
    ? [source, ...languages.filter((language) => language !== source)]
    : [...languages];

interface ContentsEntry {
  content?: string;
  encoding?: string;
}

/** The source that a manifest names, or null when it names none or does not parse. */
const manifestSourceOf = async (
  owner: string,
  name: string,
  path: string,
  branch: string,
  token: string,
): Promise<string | null> => {
  const answer = await ask<ContentsEntry>(
    `/repos/${insideRepository(owner, name)}/contents/${insideRepository(path)}?ref=${encodeURIComponent(branch)}`,
    token,
  );

  if (!answer.content || answer.encoding !== 'base64') return null;

  try {
    const parsed = localeManifestSchema.safeParse(JSON.parse(Buffer.from(answer.content, 'base64').toString('utf8')));

    return parsed.success ? (parsed.data.source ?? null) : null;
  } catch {
    // A manifest that is not JSON is the admin's to fix. The detection still answers the folders.
    return null;
  }
};

/**
 * Reads a repository of an installation and says how it holds its locales.
 *
 * `localesPath` picks one candidate. Without it, the answer is about the
 * candidate with the most languages.
 */
export const detect = async (input: {
  installationId: number;
  owner: string;
  name: string;
  branch?: string;
  localesPath?: string;
}): Promise<Detection> => {
  await ensureReachable(input.installationId, input.owner, input.name);

  const token = await installationToken(input.installationId, {
    repository: input.name,
    permissions: { contents: 'read', metadata: 'read' },
  });
  const repository = `/repos/${insideRepository(input.owner, input.name)}`;
  const { default_branch: defaultBranch } = await ask<{ default_branch: string }>(repository, token);
  const branch = input.branch || defaultBranch;

  const listing = await ask<{ tree: TreeEntry[]; truncated: boolean }>(
    `${repository}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token,
  ).catch((error: unknown) => {
    // A branch the repository does not hold is the admin's typing, not our failure.
    if (error instanceof GithubError && [404, 409, 422].includes(error.status)) {
      throw new UnknownRepositoryError(`${input.owner}/${input.name} holds no branch ${branch}.`);
    }

    throw error;
  });

  const candidates = candidatesOf(listing.tree);
  const localesPath =
    (input.localesPath ? withoutTrailingSlashes(input.localesPath) : null) || candidates[0]?.path || null;

  if (localesPath === null) {
    return {
      defaultBranch,
      branch,
      truncated: listing.truncated,
      candidates,
      localesPath,
      manifestPath: null,
      source: null,
      languages: [],
    };
  }

  // A folder typed by hand is read from the tree too, so its languages show before the row exists.
  const languages = candidates.find((candidate) => candidate.path === localesPath)?.languages ?? [];
  const besideManifest = `${localesPath}/manifest.json`;
  const manifestPath = listing.tree.some((entry) => entry.type === 'blob' && entry.path === besideManifest)
    ? besideManifest
    : null;
  const source = manifestPath ? await manifestSourceOf(input.owner, input.name, manifestPath, branch, token) : null;

  return {
    defaultBranch,
    branch,
    truncated: listing.truncated,
    candidates,
    localesPath,
    manifestPath,
    source,
    languages: sourceFirst(languages, source),
  };
};
