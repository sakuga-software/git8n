import type { I18nRepository, PublishMode } from '@git8n/db';
import type { OVERVIEW_SORTS } from '@/schemas/i18n';
import { createCache } from '@/utils/cache';
import { describeError } from '@/utils/describe-error';
import { type LanguageProgress, progressOf } from '@/services/i18n-progress.service';
import { openPullOf, publishToken } from '@/services/i18n-pull-request.service';
import { languagesOf, listRepositories } from '@/services/i18n-repositories.service';

/**
 * The page of every repository (DB-610): one page of the connected
 * repositories, with how far each language is and the pull request that waits.
 *
 * The rows come from the database, which holds a few of them, so the search
 * and the order are done here rather than in SQL. The progress and the pull
 * request come from GitHub. They are read only for the rows of the page, and
 * for every row only when the order is by progress.
 */

export type OverviewSort = (typeof OVERVIEW_SORTS)[number];

export interface OverviewQuery {
  page: number;
  perPage: number;
  q?: string;
  sort: OverviewSort;
  order: 'asc' | 'desc';
  /**
   * The repositories the caller may read, and the languages of each (DB-637).
   * `undefined` means every repository. A language list of `undefined` means every language of that repository.
   */
  access?: ReadonlyMap<string, readonly string[] | undefined>;
}

export interface RepositoryOverview {
  id: string;
  owner: string;
  name: string;
  branch: string;
  publishMode: PublishMode;
  source: string;
  targets: string[];
  createdAt: string;
  /** One row per target language the caller may read. Null when GitHub did not answer. */
  progress: LanguageProgress[] | null;
  /** Why `progress` is null, in one line. */
  progressError?: string;
  /** The open pull request of the publications, for a repository that publishes by pull request. */
  pullRequest: { number: number; url: string } | null;
}

export interface OverviewPage {
  rows: RepositoryOverview[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}

/** How many repositories are read from GitHub at the same time. */
const PARALLEL_READS = 4;

/** How long the pull request of a repository is held. */
const PULL_HELD_MS = 60 * 1000;

const openPulls = createCache<RepositoryOverview['pullRequest']>(PULL_HELD_MS);

/** Empties the cache. The tests call it; nothing else needs it. */
export const clearOverviewCache = (): void => openPulls.clear();

/** Maps every item with at most `limit` calls in flight, in the order of the items. */
const mapLimited = async <T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> => {
  const answers: R[] = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next;

      next += 1;
      answers[index] = await map(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return answers;
};

const fullName = (row: I18nRepository): string => `${row.owner}/${row.name}`;

/** The share of the keys published, over the languages read. A repository with no key counts as done. */
export const shareOf = (progress: readonly LanguageProgress[] | null): number => {
  if (!progress) return -1;

  const total = progress.reduce((sum, row) => sum + row.total, 0);

  return total === 0 ? 1 : progress.reduce((sum, row) => sum + row.published, 0) / total;
};

type ProgressRead = Pick<RepositoryOverview, 'progress' | 'progressError'>;

const readProgress = async (row: I18nRepository, languages?: readonly string[]): Promise<ProgressRead> => {
  try {
    const all = await progressOf(row);

    return { progress: languages ? all.filter((entry) => languages.includes(entry.language)) : all };
  } catch (error) {
    // One repository that GitHub refuses must not hide the others.
    return { progress: null, progressError: describeError(error) };
  }
};

const readPull = async (row: I18nRepository, now: number): Promise<RepositoryOverview['pullRequest']> => {
  if (row.publishMode !== 'pull_request') return null;

  try {
    return await openPulls.get(
      row.id,
      async () => {
        const pull = await openPullOf(row, await publishToken(row));

        return pull ? { number: pull.number, url: pull.html_url } : null;
      },
      now,
    );
  } catch {
    // The table of the repository says why. The list only leaves the cell empty.
    return null;
  }
};

export const overview = async (query: OverviewQuery, options: { now?: Date } = {}): Promise<OverviewPage> => {
  const now = (options.now ?? new Date()).getTime();
  const needle = query.q?.trim().toLowerCase();
  const matched = (await listRepositories()).filter(
    (row) => (!query.access || query.access.has(row.id)) && (!needle || fullName(row).toLowerCase().includes(needle)),
  );
  const languagesOfRow = (row: I18nRepository) => query.access?.get(row.id);
  const direction = query.order === 'desc' ? -1 : 1;
  const progressById = new Map<string, ProgressRead>();

  if (query.sort === 'progress') {
    const reads = await mapLimited(matched, PARALLEL_READS, (row) => readProgress(row, languagesOfRow(row)));

    matched.forEach((row, index) => progressById.set(row.id, reads[index]));
  }

  const byName = (a: I18nRepository, b: I18nRepository) => fullName(a).localeCompare(fullName(b));
  const compare: Record<OverviewSort, (a: I18nRepository, b: I18nRepository) => number> = {
    name: byName,
    created: (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    progress: (a, b) =>
      shareOf(progressById.get(a.id)?.progress ?? null) - shareOf(progressById.get(b.id)?.progress ?? null),
  };

  // The name breaks a tie in the same direction, so a page never changes order between two reads.
  matched.sort((a, b) => direction * (compare[query.sort](a, b) || byName(a, b)));

  const start = (query.page - 1) * query.perPage;
  const slice = matched.slice(start, start + query.perPage);

  const rows = await mapLimited(slice, PARALLEL_READS, async (row): Promise<RepositoryOverview> => {
    const [progress, pullRequest] = await Promise.all([
      progressById.get(row.id) ?? readProgress(row, languagesOfRow(row)),
      readPull(row, now),
    ]);
    const { source, targets } = languagesOf(row);

    return {
      id: row.id,
      owner: row.owner,
      name: row.name,
      branch: row.branch,
      publishMode: row.publishMode,
      source,
      targets,
      createdAt: row.createdAt.toISOString(),
      ...progress,
      pullRequest,
    };
  });

  return {
    rows,
    page: query.page,
    perPage: query.perPage,
    total: matched.length,
    hasMore: start + slice.length < matched.length,
  };
};
