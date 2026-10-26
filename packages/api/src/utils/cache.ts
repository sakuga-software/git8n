/**
 * Answers held in memory, by key, for a time (DB-639).
 *
 * The production runs one process, so a `Map` is the whole cache. Each key of a
 * repository starts with the id of the repository: `forgetRepository` then
 * drops every answer of that repository in all the caches at once.
 */

export interface Cache<T> {
  /**
   * The held answer if it is fresh, else the read in flight for the key, else a new read.
   *
   * The time of an answer starts at `now`, when the read starts, as in the
   * caches before this helper. Then a test can give its own clock.
   *
   * A failed read is not held: the next caller reads again. If the key is
   * forgotten while a read is in flight, the answer of that read is not held,
   * because it can be of before the write that forgot the key.
   */
  get: (key: string, read: () => Promise<T>, now?: number) => Promise<T>;
  /** The held answer even after its time, and whether it is still fresh. */
  peek: (key: string, now?: number) => { value: T; fresh: boolean } | undefined;
  /** Drops `key`, and each key that starts with `key:`. */
  forget: (key: string) => void;
  clear: () => void;
}

const caches = new Set<Cache<unknown>>();

/** `ttlMs` can depend on the answer, for example to hold a failure for less time. */
export const createCache = <T>(ttlMs: number | ((value: T) => number)): Cache<T> => {
  const held = new Map<string, { until: number; value: T }>();
  const reading = new Map<string, Promise<T>>();
  const lifeOf = typeof ttlMs === 'number' ? () => ttlMs : ttlMs;

  const cache: Cache<T> = {
    get: (key, read, now = Date.now()) => {
      const hit = held.get(key);

      if (hit && now < hit.until) return Promise.resolve(hit.value);

      const shared = reading.get(key);

      if (shared) return shared;

      // A read that throws before its first `await` gives a rejection, as an `async` function does.
      const started = new Promise<T>((resolve) => resolve(read()))
        .then((value) => {
          if (reading.get(key) === started) held.set(key, { until: now + lifeOf(value), value });

          return value;
        })
        .finally(() => {
          if (reading.get(key) === started) reading.delete(key);
        });

      reading.set(key, started);

      return started;
    },
    peek: (key, now = Date.now()) => {
      const hit = held.get(key);

      return hit && { value: hit.value, fresh: now < hit.until };
    },
    forget: (key) => {
      for (const map of [held, reading]) {
        for (const name of [...map.keys()]) {
          if (name === key || name.startsWith(`${key}:`)) map.delete(name);
        }
      }
    },
    clear: () => {
      held.clear();
      reading.clear();
    },
  };

  caches.add(cache as Cache<unknown>);

  return cache;
};

/**
 * Drops every answer of one repository, in every cache.
 *
 * Call it after each write to the repository. Then the person who wrote reads
 * the result of the write, and not an answer of before it.
 */
export const forgetRepository = (repositoryId: string): void => {
  for (const cache of caches) cache.forget(repositoryId);
};
