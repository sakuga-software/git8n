import { useCallback, useEffect, useRef } from 'react';
import { hashKey, QueryClient, useQuery, type QueryObserverResult } from '@tanstack/react-query';
import { ApiError } from '@i18n-editor/mcp/api';

/**
 * A read that failed, and what the person can do about it.
 *
 * « No key is missing » and « the read failed » must not look alike (DB-206).
 * The status says which screen to draw: 401 asks for a sign-in, 403 says the
 * account has no grant, 503 says nobody set the tool up.
 */
export interface ReadError {
  status: number | null;
  message: string;
}

/** The message of the API is JSON with a `message`, or plain text. */
const said = (text: string): string => {
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };

    return String(parsed.message ?? parsed.error ?? text);
  } catch {
    return text;
  }
};

export const readErrorOf = (error: unknown): ReadError =>
  error instanceof ApiError
    ? { status: error.status, message: said(error.message) }
    : { status: null, message: error instanceof Error ? error.message : String(error) };

export type Read<T> =
  | { state: 'loading' }
  | { state: 'failed'; error: ReadError }
  | {
      state: 'done';
      value: T;
      /** A new read of the same thing is on its way. `value` is the answer before it. */
      refreshing?: boolean;
      /** The last new read failed. `value` is older than this failure, and can be out of date. */
      stale?: ReadError;
    };

/**
 * The cache of the reads of the editor (DB-638).
 *
 * A read stays fresh for 30 seconds: in that time, a page that comes back
 * shows it and does not ask the API. After that, the page shows it and reads
 * it again. A write must not wait for that time: see `forgetReads`.
 *
 * The browser asks nothing again when its tab gets the focus, and a failed
 * read is not tried again: the screen says it failed, and offers a retry.
 * A read also starts with no network, so that it fails and says so, as
 * before the cache, and does not wait with no word.
 */
export const reads = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false, networkMode: 'always' },
  },
});

let owner: string | null = null;

/**
 * Gives the cache to the account `id`, or to nobody (`null`).
 *
 * The answers of one account must never show to another: `me` says who
 * administers, and the lists say what the account reads. If the account
 * changes, the cache forgets every answer. The same account keeps them.
 */
export const readsFor = (id: string | null): void => {
  if (id === owner) return;

  owner = id;
  reads.clear();
  dropOnLeave.clear();
};

/** A key names what a read reads. Its lines are the segments that `forgetReads` matches from the start. */
const queryKeyOf = (key: string): string[] => key.split('\n');

/** The answer of a read in the cache, as the screens draw it. */
export const readOf = <T>(result: QueryObserverResult<T>): Read<T> => {
  if (result.data === undefined) {
    return result.error && !result.isFetching
      ? { state: 'failed', error: readErrorOf(result.error) }
      : { state: 'loading' };
  }

  if (result.isFetching) return { state: 'done', value: result.data, refreshing: true };
  if (result.error) return { state: 'done', value: result.data, stale: readErrorOf(result.error) };

  return { state: 'done', value: result.data };
};

/** Whether a poll starts now: the tab shows, no poll is in flight, and `when` says yes. */
export const mayPoll = (visible: boolean, inFlight: boolean, when?: () => boolean): boolean =>
  visible && !inFlight && (when?.() ?? true);

/** The answer during a poll. It does not say that it refreshes, but it keeps a failure. */
export const quietly = <T>(answer: Read<T>): Read<T> =>
  answer.state === 'done' && answer.refreshing ? { state: 'done', value: answer.value } : answer;

/**
 * The reads to drop when the last page that shows them leaves.
 *
 * A page that wrote keeps its own record of the write on top of the read
 * (the values just published, for example). That record goes with the page.
 * The read alone is then older than the write: shown again, it would put a
 * row in a state it never had.
 */
const dropOnLeave = new Set<string>();

/**
 * Drops the reads whose key starts with `start`, after a write changed what they read.
 *
 * A read that no page shows goes now: the next page that needs it reads it
 * and says that it loads. A read on the screen stays, because the page that
 * wrote draws it, and goes when that page leaves it.
 */
export const forgetReads = (start: string): void => {
  for (const query of reads.getQueryCache().findAll({ queryKey: queryKeyOf(start) })) {
    if (query.getObserversCount() === 0) reads.getQueryCache().remove(query);
    else dropOnLeave.add(query.queryHash);
  }
};

const dropIfLeft = (hash: string): void => {
  const query = reads.getQueryCache().get(hash);

  if (query && query.getObserversCount() > 0) return;

  dropOnLeave.delete(hash);
  if (query) reads.getQueryCache().remove(query);
};

/**
 * Reads when `key` changes, and again on `reload`. `key` null reads nothing.
 *
 * Two reads with one key share one answer: a key must name the read, not only
 * its subject (`catalogue\n<repository>\n<language>`).
 *
 * **A new read of the same thing keeps what is on the screen** (DB-241). The
 * answer stays as `done` and says that it refreshes. If the new read fails, it
 * still stays, and says that it can be out of date. A read of another thing,
 * another language for example, shows its own answer from the cache, or loads:
 * it never shows the answer of the thing before.
 *
 * With `poll`, the read starts again every `everyMs` while the tab shows and
 * `when` says yes (DB-651). Then a change made outside the editor, a merge on
 * GitHub for example, shows with no reload. A poll does not say that it
 * refreshes: the screen does not blink every few seconds. A poll that fails
 * says that the answer can be out of date, as any other read does.
 */
export const useRead = <T>(
  key: string | null,
  read: () => Promise<T>,
  poll?: { everyMs: number; when?: () => boolean },
): [Read<T>, () => void] => {
  const queryKey = key === null ? ['none'] : queryKeyOf(key);
  const result = useQuery({ queryKey, queryFn: read, enabled: key !== null }, reads);
  const { refetch } = result;
  const polling = useRef(false);
  const everyMs = poll?.everyMs;
  const when = useRef(poll?.when);

  when.current = poll?.when;

  useEffect(() => {
    if (key === null || everyMs === undefined) return;

    const timer = window.setInterval(() => {
      if (!mayPoll(document.visibilityState === 'visible', polling.current, when.current)) return;

      polling.current = true;
      void refetch().finally(() => {
        polling.current = false;
      });
    }, everyMs);

    return () => window.clearInterval(timer);
  }, [key, everyMs, refetch]);

  useEffect(() => {
    if (key === null) return;

    const hash = hashKey(queryKeyOf(key));

    // The observer of `useQuery` leaves in a cleanup of its own, maybe after this one. The check waits for it.
    return () => {
      if (dropOnLeave.has(hash)) setTimeout(() => dropIfLeft(hash), 0);
    };
  }, [key]);

  const answer = readOf(result);
  const reload = useCallback(() => void refetch(), [refetch]);

  return [polling.current ? quietly(answer) : answer, reload];
};
