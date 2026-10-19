import { installations, repositoriesOf, type InstallationRepository } from '@/services/github-app.service';

/**
 * The repositories that the installations of the App reach, one page at a
 * time, with a search on their name (DB-581).
 *
 * GitHub lists the repositories of an installation by page and has no search
 * on that listing. The search API is no substitute: it answers every
 * repository of an owner, the ones the installation was not granted too, it
 * indexes a new repository late, and it allows 30 calls a minute. So this
 * reads the whole listing, holds it for a minute, and filters and cuts it
 * here.
 */

/** How long a listing of the installations is held. An installation changed on GitHub shows after this. */
const CACHE_MS = 60 * 1000;

export const MAX_PER_PAGE = 100;

/** A repository that one installation reaches, with the account the App is installed on. */
export interface ReachableRepository extends InstallationRepository {
  installationId: number;
  account: string;
}

export interface ReachablePage {
  rows: ReachableRepository[];
  page: number;
  perPage: number;
  /** How many repositories match the search, over every page. */
  total: number;
  hasMore: boolean;
}

let held: { at: number; rows: ReachableRepository[] } | null = null;

/** Empties the cache. The tests call it, and so does a request that asks for a fresh listing. */
export const clearReachableCache = (): void => {
  held = null;
};

/** Every repository the installations reach, each once, sorted by `owner/name`. */
const everyReachable = async (now: number): Promise<ReachableRepository[]> => {
  if (held && now - held.at < CACHE_MS) return held.rows;

  const found = await installations();
  const listed = await Promise.all(
    found.map(async (installation) =>
      (await repositoriesOf(installation.id)).map((repository) => ({
        ...repository,
        installationId: installation.id,
        account: installation.account,
      })),
    ),
  );
  const seen = new Set<string>();
  const rows: ReachableRepository[] = [];

  // Two installations can reach one repository. The row of the editor holds one installation, so the list shows it once.
  for (const row of listed.flat()) {
    const key = `${row.owner}/${row.name}`.toLowerCase();

    if (seen.has(key)) continue;

    seen.add(key);
    rows.push(row);
  }

  rows.sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`, 'en', { sensitivity: 'base' }));
  held = { at: now, rows };

  return rows;
};

/**
 * One page of the reachable repositories whose `owner/name` holds `q`, whatever its case.
 *
 * `fresh` drops the held listing first: the page asks for it when it opens,
 * so a repository just installed on GitHub is in the list at once.
 */
export const reachableRepositories = async (options: {
  page: number;
  perPage: number;
  q?: string;
  fresh?: boolean;
  now?: Date;
}): Promise<ReachablePage> => {
  if (options.fresh) clearReachableCache();

  const all = await everyReachable((options.now ?? new Date()).getTime());
  const needle = options.q?.trim().toLowerCase() ?? '';
  const matching = needle === '' ? all : all.filter((row) => `${row.owner}/${row.name}`.toLowerCase().includes(needle));
  const from = (options.page - 1) * options.perPage;

  return {
    rows: matching.slice(from, from + options.perPage),
    page: options.page,
    perPage: options.perPage,
    total: matching.length,
    hasMore: from + options.perPage < matching.length,
  };
};
