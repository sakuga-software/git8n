import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 * Starts reads, and hands over the answer of the last one alone.
 *
 * An answer that arrives after a later read started is dropped: a slow read
 * of one language must not replace the table of the next. `start` returns a
 * function that drops the answer of its read, for a page that leaves.
 *
 * **A new read of the same thing keeps what is on the screen** (DB-241). `of`
 * names what a read reads. If the last answer is of the same thing, it stays
 * as `done` and says that it refreshes. If the new read fails, it still stays,
 * and says that it can be out of date. A read of another thing — another
 * language — forgets the last answer: it must not show under a new header.
 *
 * It holds no React, so a test can run it with promises that it resolves
 * itself.
 */
export const latestOnly = <T>(apply: (answer: Read<T>) => void) => {
  let last = 0;
  let held: { of: string; value: T } | null = null;

  return (read: () => Promise<T>, of: string): (() => void) => {
    const mine = (last += 1);

    if (held?.of !== of) held = null;

    const kept = held;

    apply(kept ? { state: 'done', value: kept.value, refreshing: true } : { state: 'loading' });
    read().then(
      (value) => {
        if (mine !== last) return;

        held = { of, value };
        apply({ state: 'done', value });
      },
      (error: unknown) => {
        if (mine !== last) return;

        apply(
          kept
            ? { state: 'done', value: kept.value, stale: readErrorOf(error) }
            : { state: 'failed', error: readErrorOf(error) },
        );
      },
    );

    return () => {
      if (mine === last) last += 1;
    };
  };
};

/** Reads when `key` changes, and again on `reload`. `key` null reads nothing. */
export const useRead = <T>(key: string | null, read: () => Promise<T>): [Read<T>, () => void] => {
  const [answer, setAnswer] = useState<Read<T>>({ state: 'loading' });
  const [turn, setTurn] = useState(0);
  const start = useMemo(() => latestOnly<T>(setAnswer), []);
  // `read` is a new function at each render, and `key` names what it reads.
  // The effect calls the last one, and runs again only when `key` changes.
  const latest = useRef(read);

  latest.current = read;

  useEffect(() => {
    if (key === null) return;

    return start(() => latest.current(), key);
  }, [key, turn, start]);

  return [answer, useCallback(() => setTurn((value) => value + 1), [])];
};
