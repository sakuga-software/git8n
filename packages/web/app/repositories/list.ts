import type { LanguageProgress, OverviewSort } from '@git8n/mcp/api';

/**
 * The state of the page of every repository (DB-610), read from the address
 * and written back to it, with no React, so a test reads it directly. The
 * address holds it so that the back button and a shared link give the same
 * page.
 */

export const LIST_PAGE = 20;

/** How long the search waits after the last key before it asks the API. */
export const SEARCH_DELAY_MS = 300;

export interface ListState {
  q: string;
  sort: OverviewSort;
  order: 'asc' | 'desc';
  page: number;
}

const SORTS: readonly OverviewSort[] = ['name', 'created', 'progress'];

export const DEFAULT_STATE: ListState = { q: '', sort: 'name', order: 'asc', page: 1 };

/** The state an address says. A value it cannot read is the default, never an error page. */
export const stateOf = (params: URLSearchParams): ListState => {
  const sort = params.get('sort') as OverviewSort | null;
  const page = Number(params.get('page'));

  return {
    q: params.get('q')?.trim() ?? '',
    sort: sort && SORTS.includes(sort) ? sort : DEFAULT_STATE.sort,
    order: params.get('order') === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
};

/** The address of a state, without what the default already says. */
export const paramsOf = (state: ListState): URLSearchParams => {
  const params = new URLSearchParams();

  if (state.q) params.set('q', state.q);
  if (state.sort !== DEFAULT_STATE.sort) params.set('sort', state.sort);
  if (state.order !== DEFAULT_STATE.order) params.set('order', state.order);
  if (state.page !== 1) params.set('page', String(state.page));

  return params;
};

/**
 * The state after a click on a column.
 *
 * The same column turns the order over. Another column starts in the order a
 * reader expects of it: a name from A, a date and a progress from the most
 * recent and the furthest. Either way the list starts again at its first page.
 */
export const sortedBy = (state: ListState, sort: OverviewSort): ListState => ({
  ...state,
  sort,
  order: state.sort === sort ? (state.order === 'asc' ? 'desc' : 'asc') : sort === 'name' ? 'asc' : 'desc',
  page: 1,
});

/** The state after a new search. A search starts at the first page. */
export const searchedFor = (state: ListState, q: string): ListState => ({ ...state, q: q.trim(), page: 1 });

/** How many pages a total makes. An empty list has one page, with nothing on it. */
export const pagesOf = (total: number, perPage: number): number => Math.max(1, Math.ceil(total / perPage));

/** The share of one language that is published, from 0 to 100, rounded down so that 100 means every key. */
export const percentOf = (row: LanguageProgress): number =>
  row.total === 0 ? 100 : Math.floor((row.published / row.total) * 100);
